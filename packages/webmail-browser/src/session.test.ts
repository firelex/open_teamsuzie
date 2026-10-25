import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchSession, type Session } from './session.js';

let session: Session | null = null;
let dir: string | null = null;

afterEach(async () => {
    await session?.close();
    session = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
});

describe('launchSession', () => {
    it('opens installed Chrome headless on a private profile, without automation markers', async () => {
        dir = mkdtempSync(join(tmpdir(), 'webmail-session-'));
        const profileDir = join(dir, 'profile');
        session = await launchSession({ profileDir, headedOffscreen: false, locale: 'en-GB', timezoneId: 'Europe/London' });
        expect(statSync(profileDir).mode & 0o777).toBe(0o700);
        const seen = await session.page.evaluate(() => ({
            webdriver: navigator.webdriver,
            userAgent: navigator.userAgent,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            width: window.innerWidth,
        }));
        expect(seen.webdriver).toBe(false);
        expect(seen.userAgent).not.toContain('Headless');
        expect(seen.timezone).toBe('Europe/London');
        expect(seen.width).toBe(1440);
        const second = await session.context.newPage();
        await new Promise((r) => setTimeout(r, 200));
        expect(await second.evaluate(() => navigator.userAgent)).not.toContain('Headless');
    });
});
