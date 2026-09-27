import { describe, expect, it } from 'vitest';
import { FixtureEmailClient, type FixtureMailbox } from '@teamsuzie/email-fixture';
import { MailSync, MemoryMailStore, emailText, sanitizeEmailHtml, type MailStore, type StoredMessage } from './index.js';

const ACCOUNT = 'me@firm.com';
const mailbox = (): FixtureMailbox => ({
    account: ACCOUNT,
    threads: [
        { id: 't1', labels: ['INBOX'], messages: [
            { id: 'm1', subject: 'SPA', from: 'anna@sterlingrowe.com', to: ACCOUNT, date: '2026-09-20T09:00:00Z', bodyText: 'See attached.', unread: true, attachments: [{ filename: 'SPA.docx', contentType: 'application/octet-stream', size: 4, content: 'UEsDBA==' }] },
            { id: 'm2', subject: 'RE: SPA', from: ACCOUNT, to: 'anna@sterlingrowe.com', date: '2026-09-21T09:00:00Z', bodyText: 'Thanks.', unread: false },
        ] },
        { id: 't2', labels: ['INBOX'], messages: [
            { id: 'm3', subject: 'Signing', from: 'ben@hawk.com', to: ACCOUNT, cc: 'cara@hawk.com', date: '2026-09-25T09:00:00Z', bodyHtml: '<p>Friday?</p>', unread: true },
        ] },
    ],
});

const setup = (store: MailStore = new MemoryMailStore()) => {
    const client = new FixtureEmailClient(mailbox());
    const changed: string[] = [];
    const sync = new MailSync({ client, store, account: ACCOUNT, onThreadChanged: (id) => { changed.push(id); } });
    return { client, store, sync, changed };
};

describe('MailSync', () => {
    it('imports every message and sets the cursor', async () => {
        const { store, sync } = setup();
        const memory = store as MemoryMailStore;
        await sync.initialImport(50);
        expect([...memory.messages(ACCOUNT).keys()].sort()).toEqual(['m1', 'm2', 'm3']);
        expect(memory.messages(ACCOUNT).get('m2')).toMatchObject({ direction: 'outbound', threadId: 't1' });
        expect(memory.messages(ACCOUNT).get('m3')).toMatchObject({ direction: 'inbound', to: [ACCOUNT], cc: ['cara@hawk.com'], text: 'Friday?', unread: true });
        expect(await store.getCursor(ACCOUNT)).toBe('0');
    });

    it('applies a delivered message once, and applying it again updates rather than duplicates', async () => {
        const { client, store, sync, changed } = setup();
        await sync.initialImport(50);
        // The import reports every thread it copied, so the host can file them.
        expect(changed.sort()).toEqual(['t1', 't2']);
        changed.length = 0;
        client.deliver('t2', { id: 'm4', subject: 'RE: Signing', from: 'ben@hawk.com', to: ACCOUNT, date: '2026-09-26T09:00:00Z', bodyText: 'Or Monday.', unread: true });
        expect(await sync.syncOnce()).toEqual({ applied: 1, threads: ['t2'] });
        expect(changed).toEqual(['t2']);
        expect((store as MemoryMailStore).messages(ACCOUNT).size).toBe(4);
        // The provider repeats a change (it happens with Gmail history): an update, not a second copy.
        await store.setCursor(ACCOUNT, '0');
        const upserts: Array<'inserted' | 'updated'> = [];
        const original = store.upsertMessage.bind(store);
        store.upsertMessage = async (a, m) => { const r = await original(a, m); upserts.push(r); return r; };
        await sync.syncOnce();
        expect(upserts).toEqual(['updated']);
        expect((store as MemoryMailStore).messages(ACCOUNT).size).toBe(4);
    });

    it('applies read and label changes as flags', async () => {
        const { client, store, sync } = setup();
        await sync.initialImport(50);
        await client.setRead(['m3'], true);
        await client.modifyLabels('t1', ['Deal/Falcon'], []);
        const result = await sync.syncOnce();
        expect(result.threads.sort()).toEqual(['t1', 't2']);
        expect((store as MemoryMailStore).messages(ACCOUNT).get('m3')!.unread).toBe(false);
        expect((store as MemoryMailStore).messages(ACCOUNT).get('m1')!.labels).toEqual(['INBOX', 'Deal/Falcon']);
    });

    it('keeps the cursor where it was when applying a change fails, so nothing is skipped', async () => {
        const memory = new MemoryMailStore();
        const { client, sync } = setup(memory);
        await sync.initialImport(50);
        client.deliver('t2', { id: 'm4', subject: 'x', from: 'ben@hawk.com', to: ACCOUNT, date: '2026-09-26T09:00:00Z', bodyText: 'a', unread: true });
        client.deliver('t2', { id: 'm5', subject: 'x', from: 'ben@hawk.com', to: ACCOUNT, date: '2026-09-26T10:00:00Z', bodyText: 'b', unread: true });
        let calls = 0;
        const original = memory.upsertMessage.bind(memory);
        memory.upsertMessage = async (a, m) => { if (++calls === 2) throw new Error('disk full'); return original(a, m); };
        await expect(sync.syncOnce()).rejects.toThrow('disk full');
        expect(await memory.getCursor(ACCOUNT)).toBe('0');
    });

    it('refuses to sync before the first import', async () => {
        const { sync } = setup();
        await expect(sync.syncOnce()).rejects.toThrow('run initialImport first');
    });

    it('never stores attachment content', async () => {
        const { store, sync } = setup();
        await sync.initialImport(50);
        const m1 = (store as MemoryMailStore).messages(ACCOUNT).get('m1')!;
        expect(m1.attachments).toEqual([{ filename: 'SPA.docx', contentType: 'application/octet-stream', size: 4 }]);
        expect(JSON.stringify(m1)).not.toContain('UEsDBA');
    });
});

describe('sanitizeEmailHtml', () => {
    it('removes scripts, event handlers and javascript links, and keeps tables with their styles', () => {
        const out = sanitizeEmailHtml('<table style="width:100%;border:1px solid #ccc"><tr><td onclick="steal()">Cap</td></tr></table><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://sterlingrowe.com">site</a>');
        expect(out).toContain('<table style="width:100%;border:1px solid #ccc">');
        expect(out).not.toContain('script');
        expect(out).not.toContain('onclick');
        expect(out).not.toContain('javascript:');
        expect(out).toContain('href="https://sterlingrowe.com"');
    });

    it('strips dangerous CSS and embedded frames and forms', () => {
        const out = sanitizeEmailHtml('<div style="width:expression(alert(1));color:red">a</div><div style="background:url(https://track.er/p.gif)">b</div><iframe src="https://x"></iframe><form><input></form>');
        expect(out).not.toContain('expression');
        expect(out).not.toContain('url(');
        expect(out).not.toContain('iframe');
        expect(out).not.toContain('form');
        expect(out).toContain('color:red');
    });

    it('replaces remote images with a marker and keeps embedded ones', () => {
        const out = sanitizeEmailHtml('<img src="https://track.er/pixel.gif"><img src="cid:logo@x"><img src="data:image/png;base64,AAAA">');
        expect(out).toContain('[image]');
        expect(out).not.toContain('track.er');
        expect(out).toContain('src="cid:logo@x"');
        expect(out).toContain('src="data:image/png;base64,AAAA"');
    });
});

describe('emailText', () => {
    const at = (m: { text: string; quotedFrom: number | null }) => (m.quotedFrom === null ? null : m.text.slice(m.quotedFrom));

    it('finds a Gmail quote block in HTML', () => {
        const m = emailText({ bodyHtml: '<div>Agreed.</div><div class="gmail_quote">On Tue, 22 Sep 2026, Anna wrote:<br>Cap at 20%?</div>' });
        expect(m.text.slice(0, m.quotedFrom!).trim()).toBe('Agreed.');
        expect(at(m)).toContain('Cap at 20%?');
    });

    it('finds an "On … wrote:" line in plain text', () => {
        const m = emailText({ bodyText: 'Agreed.\n\nOn Tue, 22 Sep 2026 at 09:00, Anna Reed <anna@sterlingrowe.com> wrote:\n> Cap at 20%?' });
        expect(m.text.slice(0, m.quotedFrom!).trim()).toBe('Agreed.');
    });

    it('finds a run of ">" lines and an Outlook original-message block', () => {
        expect(at(emailText({ bodyText: 'Fine.\n> earlier\n> text' }))).toBe('> earlier\n> text');
        const outlook = emailText({ bodyText: 'Fine by us.\n\n-----Original Message-----\nFrom: Anna\nSent: Tuesday\nCap?' });
        expect(outlook.text.slice(0, outlook.quotedFrom!).trim()).toBe('Fine by us.');
        const header = emailText({ bodyText: 'Noted.\n\nFrom: Anna Reed\nSent: 22 September 2026 09:00\nTo: me\nCap?' });
        expect(header.text.slice(0, header.quotedFrom!).trim()).toBe('Noted.');
    });

    it('leaves a message with no quote whole', () => {
        expect(emailText({ bodyText: 'Can we sign Friday?\nThanks, Ben' })).toEqual({ text: 'Can we sign Friday?\nThanks, Ben', quotedFrom: null });
    });

    it('fails loudly on a message with no body at all', () => {
        expect(() => emailText({})).toThrow('has neither a text nor an HTML body');
    });
});

// Type check: the store interface is what hosts implement.
export const _storeShape: (s: MailStore) => Promise<'inserted' | 'updated'> = (s) => s.upsertMessage(ACCOUNT, {} as StoredMessage);
