import { ALLOWED_KEYS_DESCRIPTION, keyKind } from './keys.js';
import { findPlaceholders, isPlaceholder } from './placeholders.js';
import {
    OPERATION_NAMES, PROVIDER_KEYS, STEP_ACTIONS,
    type Route,
} from './types.js';
import { isRouteVersion } from './version.js';

export class RouteValidationError extends Error {
    override readonly name = 'RouteValidationError';
    constructor(readonly problems: string[]) {
        super(`Invalid webmail route: ${problems.join('; ')}`);
    }
}

const MAX_ROUTE_BYTES = 64 * 1024;
const MAX_CSS_LENGTH = 512;
const FORBIDDEN_KEYS = new Set(['script', 'eval', 'function', 'code', 'js']);
const FIELD_FORMATS = new Set(['email', 'emails', 'date', 'nonempty', 'id', 'text', 'flag']);
const TARGET_KEYS = new Set(['role', 'name', 'name_pattern', 'css', 'within', 'has', 'each']);
const STATE_KEYS = new Set(['url_matches', 'visible', 'container']);
const FIELD_KEYS = new Set(['target', 'from', 'pattern', 'format', 'required']);
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
// Ids that apps generate per page load (`#116-group`, `[aria-labelledby="116-label"]`) change on every visit.
const GENERATED_ID = /#[0-9][\w-]*|\[(?:id|aria-labelledby|aria-describedby|aria-controls|for)\s*[~|^$*]?=\s*["']?[0-9][\w-]*["']?\s*\]/i;

const STEP_KEYS: Record<string, Set<string>> = {
    goto: new Set(['goto', 'expect']),
    click: new Set(['click', 'commits', 'expect']),
    fill: new Set(['fill', 'value', 'expect']),
    type: new Set(['type', 'value', 'each_address', 'then_press', 'expect']),
    press: new Set(['press', 'commits', 'expect']),
    scroll: new Set(['scroll']),
    wait_for: new Set(['wait_for']),
    extract: new Set(['extract', 'as']),
    verify_recipients: new Set(['verify_recipients']),
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function compiles(pattern: string): boolean {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

function captureGroupCount(pattern: string): number {
    return new RegExp(`${pattern}|`).exec('')!.length - 1;
}

function hostOf(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? parsed.hostname : null;
    } catch {
        return null;
    }
}

/** Every problem with `route`, as plain messages. Empty when the route is valid. */
export function validateRoute(route: unknown): string[] {
    if (!isObject(route)) return ['route must be an object'];
    const errors: string[] = [];
    const add = (message: string) => errors.push(message);

    findForbiddenKeys(route, '$', add);
    if (JSON.stringify(route).length > MAX_ROUTE_BYTES) add('route must be 64KB or smaller');

    if (route.schema_version !== 1) add('schema_version must be 1');
    if (!(PROVIDER_KEYS as readonly unknown[]).includes(route.provider)) add(`provider must be one of ${PROVIDER_KEYS.join(', ')}`);
    if (typeof route.route_version !== 'string' || !isRouteVersion(route.route_version)) add('route_version must match YYYY-MM-DD.N');
    if (!isNonEmptyString(route.learned_by)) add('learned_by must be a non-empty string');
    if (!isNonEmptyString(route.learned_at) || Number.isNaN(Date.parse(route.learned_at))) add('learned_at must be an ISO date');
    if (route.fingerprint !== null && !isNonEmptyString(route.fingerprint)) add('fingerprint must be a string or null');

    const domains = checkHostList(route.domains, 'domains', add);
    checkHostList(route.login_domains, 'login_domains', add);

    if (typeof route.home_url !== 'string' || !domains.includes(hostOf(route.home_url) ?? '')) {
        add('home_url must be an https URL on one of the domains');
    }

    const states = isObject(route.states) ? route.states : null;
    if (!states) add('states must be an object');
    const stateNames = new Set(states ? Object.keys(states) : []);
    if (states && !stateNames.has('inbox_list')) add('states.inbox_list is required: every operation starts from the inbox and waits for this state');
    const containerStates = new Set<string>();
    if (states) {
        for (const [name, state] of Object.entries(states)) {
            const path = `states.${name}`;
            if (!isObject(state)) {
                add(`${path} must be an object`);
                continue;
            }
            for (const key of Object.keys(state)) if (!STATE_KEYS.has(key)) add(`${path} has unknown key "${key}"`);
            if (state.url_matches !== undefined && (typeof state.url_matches !== 'string' || !compiles(state.url_matches))) {
                add(`${path}.url_matches must be a valid regular expression`);
            }
            if (!Array.isArray(state.visible)) add(`${path}.visible must be an array`);
            if (state.container !== undefined) containerStates.add(name);
        }
    }

    const ctx: TargetContext = { stateNames, containerStates, add };
    if (states) {
        for (const [name, state] of Object.entries(states)) {
            if (!isObject(state)) continue;
            if (Array.isArray(state.visible)) {
                state.visible.forEach((target, i) => checkTarget(target, `states.${name}.visible[${i}]`, ctx, { allowWithin: true }));
                if (state.visible.length === 0 && state.url_matches === undefined) add(`states.${name} must have url_matches or visible targets`);
            }
            if (state.container !== undefined) checkTarget(state.container, `states.${name}.container`, ctx, { allowWithin: false });
        }
    }

    const operations = isObject(route.operations) ? route.operations : null;
    if (!operations) {
        add('operations must be an object');
        return errors;
    }
    for (const name of Object.keys(operations)) {
        if (!(OPERATION_NAMES as readonly string[]).includes(name)) add(`operations.${name} is not a known operation`);
    }
    for (const name of OPERATION_NAMES) {
        const path = `operations.${name}`;
        const operation = operations[name];
        if (!isObject(operation)) {
            add(`${path} is missing`);
            continue;
        }
        for (const key of Object.keys(operation)) if (key !== 'steps' && key !== 'test_end') add(`${path} has unknown key "${key}"`);
        if (!Array.isArray(operation.steps) || operation.steps.length === 0) {
            add(`${path}.steps must be a non-empty array`);
            continue;
        }
        let commits = 0;
        operation.steps.forEach((step, i) => {
            if (checkStep(step, `${path}.steps[${i}]`, ctx, domains)) commits++;
        });
        if (operation.test_end !== undefined) {
            if (!Array.isArray(operation.test_end)) {
                add(`${path}.test_end must be an array`);
            } else {
                operation.test_end.forEach((step, i) => {
                    if (checkStep(step, `${path}.test_end[${i}]`, ctx, domains)) add(`${path}.test_end[${i}] must not commit`);
                });
            }
        }
        if (commits > 1) add(`${path} may have at most one commit step`);
        if (commits === 1 && (!Array.isArray(operation.test_end) || operation.test_end.length === 0)) {
            add(`${path} commits, so it needs a non-empty test_end`);
        }
    }
    return errors;
}

/** `route` typed as a `Route`, or a `RouteValidationError` listing every problem. */
export function assertValidRoute(route: unknown): Route {
    const problems = validateRoute(route);
    if (problems.length > 0) throw new RouteValidationError(problems);
    return route as Route;
}

function checkHostList(value: unknown, path: string, add: (m: string) => void): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        add(`${path} must be a non-empty array of hostnames`);
        return [];
    }
    const hosts: string[] = [];
    value.forEach((host, i) => {
        if (typeof host !== 'string' || !HOSTNAME.test(host)) add(`${path}[${i}] must be a hostname`);
        else hosts.push(host);
    });
    return hosts;
}

function findForbiddenKeys(value: unknown, path: string, add: (m: string) => void): void {
    if (Array.isArray(value)) {
        value.forEach((item, i) => findForbiddenKeys(item, `${path}[${i}]`, add));
    } else if (isObject(value)) {
        for (const [key, nested] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.has(key.toLowerCase())) add(`${path} has forbidden key "${key}"`);
            findForbiddenKeys(nested, `${path}.${key}`, add);
        }
    }
}

interface TargetContext {
    stateNames: Set<string>;
    containerStates: Set<string>;
    add: (message: string) => void;
}

function checkPlaceholders(text: string, path: string, add: (m: string) => void): void {
    for (const name of findPlaceholders(text)) {
        if (!isPlaceholder(name)) add(`${path} uses unknown placeholder ${name}`);
    }
}

function checkStateRef(name: unknown, path: string, ctx: TargetContext): void {
    if (typeof name !== 'string' || !ctx.stateNames.has(name)) ctx.add(`${path} refers to undefined state "${String(name)}"`);
}

function checkTarget(target: unknown, path: string, ctx: TargetContext, opts: { allowWithin: boolean }): void {
    const { add } = ctx;
    if (!isObject(target)) {
        add(`${path} must be an object`);
        return;
    }
    for (const key of Object.keys(target)) if (!TARGET_KEYS.has(key)) add(`${path} has unknown key "${key}"`);
    if (target.role === undefined && target.css === undefined) add(`${path} needs role or css`);
    if (target.role !== undefined && !isNonEmptyString(target.role)) add(`${path}.role must be a non-empty string`);
    if (target.name !== undefined && target.name_pattern !== undefined) add(`${path} has both name and name_pattern`);
    if (target.name !== undefined) {
        if (typeof target.name !== 'string') add(`${path}.name must be a string`);
        else checkPlaceholders(target.name, `${path}.name`, add);
    }
    if (target.name_pattern !== undefined && (typeof target.name_pattern !== 'string' || !compiles(target.name_pattern))) {
        add(`${path}.name_pattern must be a valid regular expression`);
    }
    if (target.css !== undefined) {
        if (!isNonEmptyString(target.css)) {
            add(`${path}.css must be a non-empty string`);
        } else {
            if (target.css.length > MAX_CSS_LENGTH) add(`${path}.css must be at most 512 characters`);
            if (GENERATED_ID.test(target.css)) add(`${path}.css must not depend on a generated numeric id`);
            checkPlaceholders(target.css, `${path}.css`, add);
        }
    }
    if (target.each !== undefined && typeof target.each !== 'boolean') add(`${path}.each must be a boolean`);
    if (target.within !== undefined) {
        if (!opts.allowWithin) {
            add(`${path} may not use within (has and container targets search inside their parent)`);
        } else {
            checkStateRef(target.within, `${path}.within`, ctx);
            if (typeof target.within === 'string' && ctx.stateNames.has(target.within) && !ctx.containerStates.has(target.within)) {
                add(`${path}.within state "${target.within}" has no container`);
            }
        }
    }
    if (target.has !== undefined) checkTarget(target.has, `${path}.has`, ctx, { allowWithin: false });
}

function checkField(field: unknown, path: string, ctx: TargetContext): void {
    const { add } = ctx;
    if (!isObject(field)) {
        add(`${path} must be an object`);
        return;
    }
    for (const key of Object.keys(field)) if (!FIELD_KEYS.has(key)) add(`${path} has unknown key "${key}"`);
    if (field.target !== undefined) checkTarget(field.target, `${path}.target`, ctx, { allowWithin: true });
    checkFieldSource(field.from, `${path}.from`, add);
    if (field.pattern !== undefined) {
        if (typeof field.pattern !== 'string' || !compiles(field.pattern)) add(`${path}.pattern must be a valid regular expression`);
        else if (captureGroupCount(field.pattern) !== 1) add(`${path}.pattern must have exactly one capture group`);
    }
    if (typeof field.format !== 'string' || !FIELD_FORMATS.has(field.format)) add(`${path}.format must be one of ${[...FIELD_FORMATS].join(', ')}`);
    if (typeof field.required !== 'boolean') add(`${path}.required must be a boolean`);
}

function checkFieldSource(from: unknown, path: string, add: (m: string) => void): void {
    if (from === 'text' || from === 'name') return;
    if (typeof from === 'string' && /^attr:[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(from)) return;
    add(`${path} must be text, name or attr:<attribute name>`);
}

function requireEach(target: unknown, path: string, add: (m: string) => void): void {
    if (isObject(target) && target.each !== true) add(`${path} must have each: true`);
}

/** Validates one step and returns true when it is a commit step. */
function checkStep(step: unknown, path: string, ctx: TargetContext, domains: string[]): boolean {
    const { add } = ctx;
    if (!isObject(step)) {
        add(`${path} must be an object`);
        return false;
    }
    const actions = Object.keys(step).filter((key) => (STEP_ACTIONS as readonly string[]).includes(key));
    if (actions.length !== 1) {
        add(`${path} must have exactly one action (${STEP_ACTIONS.join(', ')})`);
        return false;
    }
    const action = actions[0]!;
    for (const key of Object.keys(step)) if (!STEP_KEYS[action]!.has(key)) add(`${path} has unknown key "${key}"`);
    if (step.expect !== undefined) checkStateRef(step.expect, `${path}.expect`, ctx);

    switch (action) {
        case 'goto': {
            const url = step.goto;
            if (url !== 'home') {
                if (typeof url !== 'string' || !domains.includes(hostOf(url.replace(/\$[a-z_.]+/g, 'x')) ?? '')) {
                    add(`${path}.goto must be "home" or an https URL on one of the domains`);
                } else {
                    checkPlaceholders(url, `${path}.goto`, add);
                }
            }
            break;
        }
        case 'click':
            checkTarget(step.click, `${path}.click`, ctx, { allowWithin: true });
            if (step.commits !== undefined && typeof step.commits !== 'boolean') add(`${path}.commits must be a boolean`);
            return step.commits === true;
        case 'fill':
        case 'type': {
            checkTarget(step[action], `${path}.${action}`, ctx, { allowWithin: true });
            if (typeof step.value !== 'string') add(`${path}.value must be a string`);
            else checkPlaceholders(step.value, `${path}.value`, add);
            if (step.then_press !== undefined) {
                if (!isNonEmptyString(step.then_press)) add(`${path}.then_press must be a key name`);
                else if (keyKind(step.then_press) === 'send') add(`${path}.then_press "${step.then_press}" sends; a key that sends must be its own press step marked "commits": true`);
                else if (keyKind(step.then_press) === 'forbidden') add(`${path}.then_press "${step.then_press}" is not an allowed key. Allowed: ${ALLOWED_KEYS_DESCRIPTION}`);
            }
            if (step.each_address !== undefined && typeof step.each_address !== 'boolean') add(`${path}.each_address must be a boolean`);
            break;
        }
        case 'press': {
            if (!isNonEmptyString(step.press)) {
                add(`${path}.press must be a key name`);
                break;
            }
            if (step.commits !== undefined && typeof step.commits !== 'boolean') add(`${path}.commits must be a boolean`);
            const kind = keyKind(step.press);
            if (kind === 'forbidden') add(`${path}.press "${step.press}" is not an allowed key. Allowed: ${ALLOWED_KEYS_DESCRIPTION}`);
            if (kind === 'send' && step.commits !== true) add(`${path}.press "${step.press}" sends, so it must be marked "commits": true`);
            if (kind !== 'send' && step.commits === true) add(`${path}.press "${step.press}": only a key that sends may be marked "commits"`);
            return kind === 'send' && step.commits === true;
        }
        case 'scroll':
            if (step.scroll !== 'page') checkTarget(step.scroll, `${path}.scroll`, ctx, { allowWithin: true });
            break;
        case 'wait_for':
            checkStateRef(step.wait_for, `${path}.wait_for`, ctx);
            break;
        case 'extract': {
            if (!isNonEmptyString(step.as)) add(`${path}.as must be a non-empty string`);
            const spec = step.extract;
            if (!isObject(spec)) {
                add(`${path}.extract must be an object`);
                break;
            }
            for (const key of Object.keys(spec)) if (key !== 'items' && key !== 'fields') add(`${path}.extract has unknown key "${key}"`);
            if (spec.items !== undefined) {
                checkTarget(spec.items, `${path}.extract.items`, ctx, { allowWithin: true });
                requireEach(spec.items, `${path}.extract.items`, add);
            }
            if (!isObject(spec.fields)) add(`${path}.extract.fields must be an object`);
            else for (const [name, field] of Object.entries(spec.fields)) checkField(field, `${path}.extract.fields.${name}`, ctx);
            break;
        }
        case 'verify_recipients': {
            const check = step.verify_recipients;
            if (!isObject(check)) {
                add(`${path}.verify_recipients must be an object`);
                break;
            }
            for (const key of Object.keys(check)) if (!['to', 'cc', 'bcc', 'from'].includes(key)) add(`${path}.verify_recipients has unknown key "${key}"`);
            for (const kind of ['to', 'cc', 'bcc'] as const) {
                if (check[kind] === undefined) {
                    if (kind === 'to') add(`${path}.verify_recipients.to is required`);
                    continue;
                }
                checkTarget(check[kind], `${path}.verify_recipients.${kind}`, ctx, { allowWithin: true });
                requireEach(check[kind], `${path}.verify_recipients.${kind}`, add);
            }
            checkFieldSource(check.from, `${path}.verify_recipients.from`, add);
            break;
        }
    }
    return false;
}
