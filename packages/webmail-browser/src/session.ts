import { mkdirSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

export interface SessionOptions {
    /** Chrome profile directory for this account. Created (owner-only) if missing. */
    profileDir: string;
    /** Run a normal (headed) window placed off-screen instead of headless, for an account that keeps being challenged. */
    headedOffscreen: boolean;
    locale: string;
    timezoneId: string;
}

export interface Session {
    context: BrowserContext;
    page: Page;
    close(): Promise<void>;
}

const VIEWPORT = { width: 1440, height: 900 };

function launchOptions(opts: SessionOptions, headless: boolean, extraArgs: string[]) {
    return {
        channel: 'chrome',
        headless,
        // Without this flag Chrome shows the "controlled by automated software" bar and sets navigator.webdriver.
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled', ...extraArgs],
        viewport: VIEWPORT,
        locale: opts.locale,
        timezoneId: opts.timezoneId,
    };
}

/**
 * Installed Google Chrome with the account's persistent profile: headless (or headed off-screen), no automation
 * markers, and the user agent reported as plain Chrome.
 */
export async function launchSession(opts: SessionOptions): Promise<Session> {
    mkdirSync(opts.profileDir, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(
        opts.profileDir,
        launchOptions(opts, !opts.headedOffscreen, opts.headedOffscreen ? ['--window-position=-2400,-2400'] : []),
    );
    const existing = context.pages();
    const page = existing.length > 0 ? existing[0]! : await context.newPage();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    if (userAgent.includes('HeadlessChrome')) {
        const plain = userAgent.replace('HeadlessChrome', 'Chrome');
        const override = async (p: Page) => {
            const cdp = await context.newCDPSession(p);
            await cdp.send('Emulation.setUserAgentOverride', { userAgent: plain, acceptLanguage: opts.locale });
        };
        await override(page);
        context.on('page', (p) => {
            override(p).catch((error: unknown) => {
                throw new Error(`Could not set the user agent on a new page: ${(error as Error).message}`);
            });
        });
    }
    return { context, page, close: () => context.close() };
}

export interface LoginHandoffOptions {
    profileDir: string;
    /** Where the visible window starts (the webmail home; the provider redirects to its sign-in page). */
    startUrl: string;
    /** True once the user has finished signing in. */
    isComplete: (page: Page) => Promise<boolean>;
    timeoutMs: number;
    pollMs: number;
    locale: string;
    timezoneId: string;
}

/**
 * Open a visible Chrome window on the account's profile so the user can sign in (password, 2FA), wait until
 * `isComplete`, then close it. The headless session for the same profile must be closed first: Chrome allows
 * one process per profile.
 */
export async function loginHandoff(opts: LoginHandoffOptions): Promise<'completed' | 'timed_out'> {
    mkdirSync(opts.profileDir, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(
        opts.profileDir,
        launchOptions({ profileDir: opts.profileDir, headedOffscreen: false, locale: opts.locale, timezoneId: opts.timezoneId }, false, []),
    );
    try {
        const existing = context.pages();
        const page = existing.length > 0 ? existing[0]! : await context.newPage();
        await page.bringToFront();
        await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded' });
        const deadline = Date.now() + opts.timeoutMs;
        while (Date.now() < deadline) {
            if (await opts.isComplete(page)) return 'completed';
            await new Promise((r) => setTimeout(r, opts.pollMs));
        }
        return 'timed_out';
    } finally {
        await context.close();
    }
}
