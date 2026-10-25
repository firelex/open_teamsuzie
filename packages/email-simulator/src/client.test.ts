import { describe, expect, it } from 'vitest';
import { EmailAuthError, EmailCursorExpiredError, EmailNotFoundError } from '@teamsuzie/email';
import { MailSync, MemoryMailStore } from '@teamsuzie/email-sync';
import { FakeSimulator } from './__tests__/fake-simulator.js';
import { SimulatorEmailClient } from './index.js';

const KEY = 'app-key-1';
const BASE = 'http://sim.test:8025';
const pdf = Buffer.from('%PDF-1.4 term sheet').toString('base64');

function world() {
    const sim = new FakeSimulator(KEY);
    const seller = sim.addUser('sam@seller.test', 'Sam Seller');
    const buyer = sim.addUser('bea@buyer.test', 'Bea Buyer');
    const counsel = sim.addUser('cal@counsel.test', 'Cal Counsel');
    const client = (u: { id: string; email: string }) => new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: u.id, address: u.email, fetch: sim.fetch });
    return { sim, seller, buyer, counsel, sam: client(seller), bea: client(buyer), cal: client(counsel) };
}

describe('SimulatorEmailClient', () => {
    it('refuses to be built without its settings', () => {
        const sim = new FakeSimulator(KEY);
        expect(() => new SimulatorEmailClient({ baseUrl: '', apiKey: KEY, userId: 'u', address: 'a@b.test', fetch: sim.fetch })).toThrow(/baseUrl/);
        expect(() => new SimulatorEmailClient({ baseUrl: BASE, apiKey: '', userId: 'u', address: 'a@b.test', fetch: sim.fetch })).toThrow(/apiKey/);
        expect(() => new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: '', address: 'a@b.test', fetch: sim.fetch })).toThrow(/userId/);
        expect(() => new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: 'u', address: '', fetch: sim.fetch })).toThrow(/address/);
    });

    it('probes the persona and reports its status', async () => {
        const { sim, seller, sam } = world();
        expect(await sam.probe()).toBe(true);
        expect(sam.status()).toMatchObject({ configured: true, baseUrl: BASE, fromAccount: 'sam@seller.test', reachable: true, lastError: null });
        const wrong = new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: seller.id, address: 'someone@else.test', fetch: sim.fetch });
        await expect(wrong.probe()).rejects.toThrow(/sam@seller.test.*someone@else.test|someone@else.test.*sam@seller.test/);
        const missing = new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: 'u-404', address: 'x@y.test', fetch: sim.fetch });
        await expect(missing.probe()).rejects.toThrow(/u-404/);
    });

    it('throws HTTP errors with the status and the simulator message', async () => {
        const { sim, seller } = world();
        const badKey = new SimulatorEmailClient({ baseUrl: BASE, apiKey: 'wrong', userId: seller.id, address: seller.email, fetch: sim.fetch });
        const err = await badKey.probe().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(EmailAuthError);
        expect(String(err)).toMatch(/401.*Invalid app key/);
        expect(badKey.status()).toMatchObject({ reachable: false, lastError: expect.stringMatching(/401/) });
        const { sam } = world();
        const missing = await sam.getMessage('e-999').catch((e: unknown) => e);
        expect(missing).toBeInstanceOf(EmailNotFoundError);
        expect(String(missing)).toMatch(/404.*Message not found in this app/);
    });

    it('two personas exchange an email with an attachment and a reply in one thread', async () => {
        const { sam, bea } = world();
        const sent = await sam.send({ to: 'Bea Buyer <BEA@buyer.test>', subject: 'Term sheet', body: 'Attached.', attachments: [{ filename: 'terms.pdf', contentType: 'application/pdf', content: pdf }] });
        expect(sent).toMatchObject({ queued: true, direct: true });
        expect(sent.queueId).toBeTruthy();

        const inbox = await bea.listThreads();
        expect(inbox.threads).toHaveLength(1);
        const t = inbox.threads[0]!;
        expect(t).toMatchObject({ id: sent.threadId, subject: 'Term sheet', labels: ['INBOX'], unread: true, participants: ['sam@seller.test', 'bea@buyer.test'] });

        const original = (await bea.getThread(t.id)).messages[0]!;
        expect(original).toMatchObject({
            from: 'sam@seller.test', to: 'bea@buyer.test', cc: null, subject: 'Term sheet', bodyText: 'Attached.', threadId: t.id, inReplyToId: null,
            labels: ['INBOX'], unread: true, messageIdHeader: `<${original.id}@sim.test>`,
        });
        expect(new Date(original.date as string).toISOString()).toBe(original.date);
        expect(original.attachments).toEqual([{ id: expect.any(String), filename: 'terms.pdf', contentType: 'application/pdf', size: 19 }]);

        const reply = await bea.reply({ messageId: original.id, body: 'Our markup.', attachments: [{ filename: 'terms-v2.pdf', contentType: 'application/pdf', content: pdf }] });
        expect(reply.threadId).toBe(t.id);

        const samThread = await sam.getThread(t.id);
        expect(samThread.messages.map((m) => [m.from, m.to, m.subject, m.labels, m.unread])).toEqual([
            ['sam@seller.test', 'bea@buyer.test', 'Term sheet', ['SENT'], false],
            ['bea@buyer.test', 'sam@seller.test', 'RE: Term sheet', ['INBOX'], true],
        ]);
        expect(samThread.messages[1]!.inReplyToId).toBe(original.id);
        expect(samThread.messages[1]!.attachments![0]!.filename).toBe('terms-v2.pdf');
        expect(samThread).toMatchObject({ labels: ['SENT', 'INBOX'], unread: true, snippet: 'Our markup.' });

        // A reply to a message this persona sent goes to that message's recipients, with the subject given.
        await sam.reply({ messageId: samThread.messages[0]!.id, body: 'One more thing.', subject: 'Term sheet, point 4' });
        const last = (await bea.getThread(t.id)).messages[2]!;
        expect(last).toMatchObject({ from: 'sam@seller.test', to: 'bea@buyer.test', subject: 'Term sheet, point 4' });
    });

    it('replyAll copies the other recipients, as the fixture network does', async () => {
        const { sam, bea, cal } = world();
        await sam.send({ to: 'bea@buyer.test', cc: 'cal@counsel.test', subject: 'NDA', body: 'Draft.' });
        const msg = (await bea.listThreads()).threads[0]!;
        const original = (await bea.getThread(msg.id)).messages[0]!;
        expect(original.cc).toBe('cal@counsel.test');
        await bea.replyAll({ messageId: original.id, body: 'Fine by us.' });
        const calThread = await cal.getThread(msg.id);
        expect(calThread.messages[1]).toMatchObject({ from: 'bea@buyer.test', to: 'sam@seller.test', cc: 'cal@counsel.test', subject: 'RE: NDA' });
        // reply with replyAll: true does the same.
        await bea.reply({ messageId: original.id, body: 'And again.', replyAll: true });
        expect((await cal.getThread(msg.id)).messages).toHaveLength(3);
    });

    it('lists a message sent to oneself once, in both INBOX and SENT', async () => {
        const { sam } = world();
        await sam.send({ to: 'sam@seller.test', subject: 'Note to self', body: 'Remember.' });
        const { threads } = await sam.listThreads();
        expect(threads).toHaveLength(1);
        const thread = await sam.getThread(threads[0]!.id);
        expect(thread.messages).toHaveLength(1);
        expect(thread.messages[0]!.labels).toEqual(['INBOX', 'SENT']);
        expect((await sam.changesSince('1:0:0')).changes).toHaveLength(1);
    });

    it('groups threads by thread id, newest first, with label filters and paging', async () => {
        const { sam, bea, cal } = world();
        await sam.send({ to: 'bea@buyer.test', subject: 'One', body: '1' });
        await cal.send({ to: 'bea@buyer.test', subject: 'Two', body: '2' });
        await bea.send({ to: 'cal@counsel.test', subject: 'Three', body: '3' });
        const first = (await bea.listThreads()).threads.find((t) => t.subject === 'One')!;
        const firstMessage = (await bea.getThread(first.id)).messages[0]!;
        await sam.reply({ messageId: firstMessage.id, body: 'Following up on one.', to: 'bea@buyer.test' });

        const all = await bea.listThreads();
        expect(all.threads.map((t) => t.subject)).toEqual(['One', 'Three', 'Two']);
        expect(all.threads[0]!.messageIds).toHaveLength(2);
        expect(all.nextPageToken).toBeNull();
        expect((await bea.listThreads({ labels: ['SENT'] })).threads.map((t) => t.subject)).toEqual(['Three']);

        const page1 = await bea.listThreads({ limit: 2 });
        expect(page1.threads.map((t) => t.subject)).toEqual(['One', 'Three']);
        const page2 = await bea.listThreads({ limit: 2, pageToken: page1.nextPageToken });
        expect(page2.threads.map((t) => t.subject)).toEqual(['Two']);
        expect(page2.nextPageToken).toBeNull();

        await expect(bea.getThread('e-nope')).rejects.toBeInstanceOf(EmailNotFoundError);
        await expect(bea.listThreads({ pageToken: 'x' })).rejects.toThrow(/pageToken/);
    });

    it('reads every folder page by page, past the simulator limit of 1000 rows a read', async () => {
        const { sim, sam, bea } = world();
        for (let i = 0; i < 1002; i++) await sam.send({ to: 'bea@buyer.test', subject: `m${i}`, body: 'x' });
        expect((await bea.listThreads()).threads).toHaveLength(1002);
        expect(sim.calls.filter((c) => c.includes('folder=inbox')).length).toBeGreaterThanOrEqual(2);
    });

    it('keeps read and label state in the client, since the simulator has no flags', async () => {
        const { sam, bea } = world();
        await sam.send({ to: 'bea@buyer.test', subject: 'Hi', body: 'Hello.' });
        const thread = (await bea.listThreads()).threads[0]!;
        await bea.setRead(thread.messageIds, true);
        expect((await bea.getThread(thread.id)).unread).toBe(false);
        expect((await bea.getMessage(thread.messageIds[0]!)).unread).toBe(false);
        await bea.setRead(thread.messageIds, false);
        expect((await bea.getThread(thread.id)).unread).toBe(true);

        await bea.modifyLabels(thread.id, ['Deal/Falcon'], ['INBOX']);
        expect((await bea.getMessage(thread.messageIds[0]!)).labels).toEqual(['Deal/Falcon']);
        expect((await bea.listThreads({ labels: ['INBOX'] })).threads).toHaveLength(0);
        expect((await bea.listThreads({ labels: ['Deal/Falcon'] })).threads).toHaveLength(1);

        await expect(bea.setRead(['e-missing'], true)).rejects.toBeInstanceOf(EmailNotFoundError);
    });

    it('does not show a message the persona neither sent nor received', async () => {
        const { sam, cal } = world();
        const sent = await sam.send({ to: 'bea@buyer.test', subject: 'Private', body: 'Just for Bea.' });
        await expect(cal.getThread(sent.threadId!)).rejects.toBeInstanceOf(EmailNotFoundError);
        const samCopy = (await sam.getThread(sent.threadId!)).messages[0]!;
        await expect(cal.getMessage(samCopy.id)).rejects.toBeInstanceOf(EmailNotFoundError);
    });

    it('shows Bcc only on the sender’s copy', async () => {
        const { sam, bea, cal } = world();
        await sam.send({ to: 'bea@buyer.test', bcc: 'cal@counsel.test', subject: 'Quiet', body: 'Hush.' });
        const samMsg = (await sam.getThread((await sam.listThreads()).threads[0]!.id)).messages[0]!;
        expect(samMsg.bcc).toBe('cal@counsel.test');
        expect((await bea.getMessage(samMsg.id)).bcc).toBeNull();
        expect((await cal.getMessage(samMsg.id)).labels).toEqual(['INBOX']);
    });

    it('opens an attachment with its base64 content', async () => {
        const { sam, bea } = world();
        await sam.send({ to: 'bea@buyer.test', subject: 'File', body: 'See file.', attachments: [{ filename: 'terms.pdf', contentType: 'application/pdf', content: pdf }] });
        const m = (await bea.getThread((await bea.listThreads()).threads[0]!.id)).messages[0]!;
        const a = await bea.openAttachment(m.id, m.attachments![0]!.id!);
        expect(a).toEqual({ id: m.attachments![0]!.id, filename: 'terms.pdf', contentType: 'application/pdf', size: 19, content: pdf });
        await expect(bea.openAttachment(m.id, 'a-missing')).rejects.toThrow(/404.*Attachment not found/);
    });

    it('refuses an address that is no persona, naming it, and sends nothing', async () => {
        const { sim, sam } = world();
        await expect(sam.send({ to: 'bea@buyer.test, Nobody <nobody@nowhere.test>', subject: 'X', body: 'Y' })).rejects.toThrow(/nobody@nowhere.test/);
        await expect(sam.send({ to: 'bea@buyer.test', cc: 'ghost@nowhere.test', subject: 'X', body: 'Y' })).rejects.toThrow(/ghost@nowhere.test/);
        expect(sim.emails).toHaveLength(0);
    });

    it('picks up a persona added after the directory was first read', async () => {
        const { sim, sam } = world();
        await sam.probe();
        const late = sim.addUser('lee@late.test');
        await sam.send({ to: 'lee@late.test', subject: 'Welcome', body: 'Hi Lee.' });
        const lee = new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: late.id, address: late.email, fetch: sim.fetch });
        expect((await lee.listThreads()).threads).toHaveLength(1);
    });

    it('refuses what the simulator cannot send', async () => {
        const { sam } = world();
        await expect(sam.send({ to: 'bea@buyer.test', subject: 'X', body: 'Y', attachments: [{ filename: 'a.pdf', contentType: 'application/pdf' }] })).rejects.toThrow(/a.pdf.*content/);
        await expect(sam.send({ to: 'bea@buyer.test', subject: 'X', body: 'Y', html: '<p>Y</p>' })).rejects.toThrow(/HTML/);
        await expect(sam.send({ to: '', subject: 'X', body: 'Y' })).rejects.toThrow(/recipient/);
        await expect(sam.send({ to: 'bea@buyer.test', subject: 'X', body: 'Y', fromAccount: 'other@seller.test' })).rejects.toThrow(/other@seller.test/);
        expect('forward' in sam).toBe(false);
        expect('createDraft' in sam).toBe(false);
    });
});

describe('changesSince', () => {
    it('starts at the current end of both folders, then reports each new message in either folder once', async () => {
        const { sam, bea } = world();
        await sam.send({ to: 'bea@buyer.test', subject: 'Before', body: 'old' });
        const start = await bea.changesSince(null);
        expect(start.changes).toEqual([]);
        expect(start.cursor).toBe('1:1:0');

        const incoming = await sam.send({ to: 'bea@buyer.test', subject: 'In', body: 'in' });
        const outgoing = await bea.send({ to: 'sam@seller.test', subject: 'Out', body: 'out' });
        const next = await bea.changesSince(start.cursor);
        const threads = [(await bea.listThreads()).threads.find((t) => t.subject === 'In')!, (await bea.listThreads()).threads.find((t) => t.subject === 'Out')!];
        expect(next.changes).toEqual([
            { kind: 'message_added', threadId: incoming.threadId, messageId: threads[0]!.messageIds[0] },
            { kind: 'message_added', threadId: outgoing.threadId, messageId: threads[1]!.messageIds[0] },
        ]);
        expect(next.cursor).toBe('1:2:3');

        // An exhausted cursor gives nothing and stays where it is.
        expect(await bea.changesSince(next.cursor)).toEqual({ changes: [], cursor: next.cursor });
    });

    it('follows the simulator’s pages until there are no more', async () => {
        const { sim, sam, bea } = world();
        const { cursor } = await bea.changesSince(null);
        for (let i = 0; i < 1005; i++) await sam.send({ to: 'bea@buyer.test', subject: `m${i}`, body: 'x' });
        const before = sim.calls.length;
        const result = await bea.changesSince(cursor);
        expect(result.changes).toHaveLength(1005);
        expect(new Set(result.changes.map((c) => c.messageId)).size).toBe(1005);
        expect(result.cursor).toBe('1:1005:0');
        expect(sim.calls.slice(before).filter((c) => c.includes('folder=inbox'))).toHaveLength(2);
    });

    it('refuses a cursor it did not issue, and one from before the simulator was reset', async () => {
        const { sim, bea } = world();
        await expect(bea.changesSince('nonsense')).rejects.toThrow(/cursor/);
        await expect(bea.changesSince('1:-1:0')).rejects.toThrow(/cursor/);
        const { cursor } = await bea.changesSince(null);
        sim.reset();
        const again = sim.addUser('bea@buyer.test');
        const fresh = new SimulatorEmailClient({ baseUrl: BASE, apiKey: KEY, userId: again.id, address: again.email, fetch: sim.fetch });
        await expect(fresh.changesSince(cursor)).rejects.toBeInstanceOf(EmailCursorExpiredError);
    });
});

describe('with MailSync', () => {
    it('imports the mailbox, then picks up a new message end to end', async () => {
        const { sam, bea } = world();
        await sam.send({ to: 'bea@buyer.test', subject: 'Term sheet', body: 'Attached.', attachments: [{ filename: 'terms.pdf', contentType: 'application/pdf', content: pdf }] });
        await bea.send({ to: 'sam@seller.test', subject: 'Intro', body: 'Hello Sam.' });

        const store = new MemoryMailStore();
        const changed: string[] = [];
        const sync = new MailSync({ client: bea, store, account: 'bea@buyer.test', onThreadChanged: (id) => { changed.push(id); } });
        expect(await sync.initialImport(50)).toEqual({ threads: 2, messages: 2 });
        const held = [...store.messages('bea@buyer.test').values()];
        expect(held.map((m) => [m.subject, m.direction, m.unread, m.labels])).toEqual(expect.arrayContaining([
            ['Term sheet', 'inbound', true, ['INBOX']],
            ['Intro', 'outbound', false, ['SENT']],
        ]));
        const termSheet = held.find((m) => m.subject === 'Term sheet')!;
        expect(termSheet.attachments).toEqual([{ id: expect.any(String), filename: 'terms.pdf', contentType: 'application/pdf', size: 19 }]);
        expect(termSheet.from).toBe('sam@seller.test');
        expect(termSheet.to).toEqual(['bea@buyer.test']);

        const samCopy = (await sam.getThread(termSheet.threadId)).messages[0]!;
        await sam.reply({ messageId: samCopy.id, body: 'Any comments?' });
        changed.length = 0;
        expect(await sync.syncOnce()).toEqual({ applied: 1, threads: [termSheet.threadId] });
        expect(changed).toEqual([termSheet.threadId]);
        const thread = [...store.messages('bea@buyer.test').values()].filter((m) => m.threadId === termSheet.threadId);
        expect(thread.map((m) => m.subject)).toEqual(['Term sheet', 'RE: Term sheet']);
        expect(await sync.syncOnce()).toEqual({ applied: 0, threads: [] });

        const opened = await bea.openAttachment(termSheet.id, termSheet.attachments[0]!.id);
        expect(opened.content).toBe(pdf);
    });
});
