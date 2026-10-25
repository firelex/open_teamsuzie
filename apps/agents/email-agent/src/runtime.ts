import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildTestParams, checkOutput, describeOutput, runCanary, WebmailEmailClient, OPERATION_GOALS,
    type CanaryResult, type FileRouteStore,
} from '@teamsuzie/email-webmail';
import {
    computeFingerprint, HumanBehaviour, launchSession, loginHandoff, NavigationError, RouteError, RouteExecutor,
    VolumeLimiter, type Session,
} from '@teamsuzie/webmail-browser';
import { RouteLearner, type LearnerRound, type LearnOutcome, type RouteModel } from '@teamsuzie/webmail-learn';
import type { OperationName, ProviderKey, Route } from '@teamsuzie/webmail-routes';
import type { AgentConfig } from './config.js';
import type { HandlerRuntime } from './handler.js';

export interface ChromeRuntimeDeps {
    account: { address: string; provider: ProviderKey; headed_offscreen: boolean };
    config: AgentConfig;
    routes: FileRouteStore;
    model: RouteModel;
    log: (message: string) => void;
    now: () => Date;
}

const LOGIN_POLL_MS = 2000;

/** The real browser side of one account: installed Chrome on the account's own profile. */
export class ChromeRuntime implements HandlerRuntime {
    private session: Session | null = null;
    private executor: RouteExecutor | null = null;
    private webmail: WebmailEmailClient | null = null;
    private readonly behaviour: HumanBehaviour;
    // One limiter for the account's lifetime, so closing and reopening the browser does not reset its pace.
    private readonly limiter: VolumeLimiter;
    private readonly profileDir: string;

    constructor(private readonly deps: ChromeRuntimeDeps) {
        this.behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 1, selectAllModifier: process.platform === 'darwin' ? 'Meta' : 'Control' });
        const volume = deps.config.volume;
        this.limiter = new VolumeLimiter({
            opensPerMinute: volume.opens_per_minute,
            opensPerHour: volume.opens_per_hour,
            minSecondsBetweenSends: volume.min_seconds_between_sends,
        });
        this.profileDir = join(deps.config.data_dir, 'profiles', deps.account.address.toLowerCase());
    }

    private route(): Route {
        return this.deps.routes.current(this.deps.account.provider);
    }

    async open(): Promise<void> {
        if (this.session) throw new Error(`The browser for ${this.deps.account.address} is already open`);
        this.session = await launchSession({
            profileDir: this.profileDir,
            headedOffscreen: this.deps.account.headed_offscreen,
            locale: this.deps.config.locale,
            timezoneId: this.deps.config.timezone,
        });
        this.executor = this.newExecutor(this.session.page);
        this.webmail = new WebmailEmailClient({
            account: { address: this.deps.account.address, provider: this.deps.account.provider },
            executor: this.executor,
            routes: { current: () => this.route() },
            limiter: this.limiter,
            behaviour: this.behaviour,
            now: this.deps.now,
        });
    }

    async close(): Promise<void> {
        const session = this.session;
        this.session = null;
        this.executor = null;
        this.webmail = null;
        if (session) await session.close();
    }

    client(): WebmailEmailClient {
        if (!this.webmail) throw new Error(`The browser for ${this.deps.account.address} is not open`);
        return this.webmail;
    }

    canary(only?: OperationName[]): Promise<CanaryResult[]> {
        return runCanary(this.client(), only);
    }

    async relearn(operation: OperationName): Promise<LearnOutcome> {
        const client = this.client();
        const { params, inboxError } = await buildTestParams(client);
        if (inboxError) this.deps.log(`[${this.deps.account.address}] test parameters without the inbox: ${inboxError.message}`);
        if (params[operation] === undefined) {
            return { ok: false, reason: `${operation} cannot be tested: ${inboxError ? `the inbox could not be listed (${inboxError.message})` : 'the inbox is empty'}` };
        }
        const learner = new RouteLearner({
            model: this.deps.model,
            executor: this.executor!,
            maxStepFixes: this.deps.config.learner.max_step_fixes,
            log: (message) => this.deps.log(`[${this.deps.account.address}] ${message}`),
            record: (round) => this.recordRound(round),
            now: this.deps.now,
        });
        const outcome = await learner.relearn({
            route: this.route(),
            operation,
            goal: OPERATION_GOALS[operation],
            outputs: describeOutput(operation),
            params,
            checkResult: checkOutput,
        });
        if (outcome.ok && outcome.changed) this.deps.routes.save(outcome.route);
        return outcome;
    }

    async fingerprint(): Promise<string> {
        const route = this.route();
        const executor = this.executor;
        if (!executor || !this.session) throw new Error(`The browser for ${this.deps.account.address} is not open`);
        try {
            await this.session.page.goto(route.home_url, { waitUntil: 'domcontentloaded', timeout: this.deps.config.timeouts.navigation_ms });
        } catch (error) {
            throw new NavigationError(`Could not load ${route.home_url}: ${(error as Error).message}`);
        }
        await this.waitForInbox(executor, route);
        return computeFingerprint(this.session.page);
    }

    login(): Promise<'completed' | 'timed_out'> {
        if (this.session) throw new Error('Close the headless browser before opening the sign-in window: Chrome allows one process per profile');
        const route = this.route();
        return loginHandoff({
            profileDir: this.profileDir,
            startUrl: route.home_url,
            isComplete: async (page) => {
                const url = page.url();
                if (!url.startsWith('https://') || !route.domains.includes(new URL(url).hostname)) return false;
                return this.newExecutor(page).stateHolds(route, 'inbox_list');
            },
            timeoutMs: this.deps.config.login_timeout_minutes * 60_000,
            pollMs: LOGIN_POLL_MS,
            locale: this.deps.config.locale,
            timezoneId: this.deps.config.timezone,
        });
    }

    private newExecutor(page: Session['page']): RouteExecutor {
        const t = this.deps.config.timeouts;
        return new RouteExecutor({
            page, behaviour: this.behaviour, stepTimeoutMs: t.step_ms, stateTimeoutMs: t.state_ms, navigationTimeoutMs: t.navigation_ms,
            dates: { locale: this.deps.config.locale, timeZone: this.deps.config.timezone, now: this.deps.now },
        });
    }

    /** Every model round goes to `<data_dir>/learner/<date>.jsonl`, so the model's replies can be reviewed. */
    private recordRound(round: LearnerRound): void {
        const dir = join(this.deps.config.data_dir, 'learner');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        appendFileSync(join(dir, `${round.at.slice(0, 10)}.jsonl`), `${JSON.stringify({ account: this.deps.account.address, ...round })}\n`);
    }

    private async waitForInbox(executor: RouteExecutor, route: Route): Promise<void> {
        const deadline = Date.now() + this.deps.config.timeouts.state_ms;
        while (Date.now() < deadline) {
            executor.checkSignedIn(route);
            if (await executor.stateHolds(route, 'inbox_list')) return;
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new RouteError('state_not_reached', 'list_inbox', -1, `the inbox did not appear within ${this.deps.config.timeouts.state_ms}ms`);
    }
}
