import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capturePage, computeFingerprint, fingerprintFromAria } from './capture.js';
import { openFixtureBrowser, serveFixture, FIXTURE_HOME, type FixtureBrowser } from './testing/fixture.js';

let fixture: FixtureBrowser;

beforeAll(async () => {
    fixture = await openFixtureBrowser();
});

afterAll(async () => {
    await fixture.close();
});

describe('capturePage', () => {
    it('captures the url, accessibility snapshot and unnamed interactive elements', async () => {
        await fixture.page.goto(FIXTURE_HOME);
        const capture = await capturePage(fixture.page);
        expect(capture.url).toBe(FIXTURE_HOME);
        expect(capture.aria).toContain('button "Compose"');
        expect(capture.aria).toContain('grid "Inbox"');
        expect(capture.unnamed.every((tag) => tag.startsWith('<'))).toBe(true);
    });
});

describe('fingerprint', () => {
    const base = [
        '- banner:',
        '  - searchbox "Search mail"',
        '  - button "Account"',
        '- toolbar "Actions":',
        '  - button "Compose"',
        '- link "Inbox 3"',
        '- grid "Inbox":',
        '  - row "unread, Alice, Quarterly numbers":',
        '    - button "Star"',
    ].join('\n');

    it('ignores message content and counts', () => {
        const newMail = base.replace('Inbox 3', 'Inbox 4').replace('Alice, Quarterly numbers', 'Bob, Lunch');
        expect(fingerprintFromAria(newMail)).toBe(fingerprintFromAria(base));
    });

    it('changes when the layout changes', () => {
        expect(fingerprintFromAria(base.replace('button "Compose"', 'button "New message"'))).not.toBe(fingerprintFromAria(base));
    });

    it('differs between the fixture layouts', async () => {
        await serveFixture(fixture.context, 'standard');
        await fixture.page.goto('about:blank');
        await fixture.page.goto(FIXTURE_HOME);
        const standard = await computeFingerprint(fixture.page);
        await serveFixture(fixture.context, 'renamed');
        await fixture.page.goto('about:blank');
        await fixture.page.goto(FIXTURE_HOME);
        expect(await computeFingerprint(fixture.page)).not.toBe(standard);
    });
});
