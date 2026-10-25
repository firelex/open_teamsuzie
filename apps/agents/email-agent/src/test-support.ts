import { readFileSync } from 'node:fs';
import { parseConfig, type AgentConfig } from './config.js';

/** The example config, parsed: a valid config for tests to change. */
export function exampleConfig(): AgentConfig {
    const raw = JSON.parse(readFileSync(new URL('../email-agent.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    return parseConfig({ ...raw, data_dir: '/tmp/email-agent-test' }, {});
}

export function exampleRaw(): Record<string, unknown> {
    return JSON.parse(readFileSync(new URL('../email-agent.config.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
}

/** A clock tests move by hand. */
export function manualClock(start = '2026-10-26T10:00:00.000Z') {
    let now = new Date(start).getTime();
    return {
        now: () => new Date(now),
        advance: (ms: number) => { now += ms; },
        set: (iso: string) => { now = new Date(iso).getTime(); },
    };
}
