import { describe, expect, it } from 'vitest';
import { BoxApiError, BoxFileError, BoxFiles, type BoxItem } from './files.js';

/** A fetch that records each call and answers with `reply`, as the Box API answers. */
function fakeBox(reply: (url: URL, init: RequestInit | undefined) => Response) {
    const calls: Array<{ url: URL; auth: string | null; redirect: RequestRedirect | undefined }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect });
        return reply(url, init);
    }) as typeof fetch;
    return { box: new BoxFiles({ accessToken: async () => 'at-1', fetch: f }), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Shaped as the Box API's folder items (https://developer.box.com/reference/get-folders-id-items/).
const folder = { type: 'folder', id: '11', name: 'Clients', size: 9000, modified_at: '2026-11-10T09:00:00-08:00' };
const docx = { type: 'file', id: '21', name: 'SPA draft.docx', size: 11, modified_at: '2026-11-12T15:30:00-08:00', extension: 'docx' };
const note = { type: 'file', id: '22', name: 'Call notes.boxnote', size: 300, modified_at: '2026-11-13T10:00:00-08:00', extension: 'boxnote' };
const link = { type: 'web_link', id: '31', name: 'Court website' };

describe('BoxFiles', () => {
    it('lists a folder with the access token and the fields needed, telling Box Notes and bookmarks apart', async () => {
        const g = fakeBox(() => json({ total_count: 4, entries: [folder, docx, note, link], offset: 0, limit: 500 }));
        const found = await g.box.children('0');
        const url = g.calls[0]!.url;
        expect(url.origin + url.pathname).toBe('https://api.box.com/2.0/folders/0/items');
        expect(url.searchParams.get('fields')).toBe('name,size,modified_at,type,extension');
        expect(url.searchParams.get('offset')).toBe('0');
        expect(g.calls[0]!.auth).toBe('Bearer at-1');
        expect(found).toEqual<BoxItem[]>([
            { id: '11', name: 'Clients', kind: 'folder', size: null, modified: folder.modified_at, extension: null, webUrl: 'https://app.box.com/folder/11', download: false },
            { id: '21', name: 'SPA draft.docx', kind: 'file', size: 11, modified: docx.modified_at, extension: 'docx', webUrl: 'https://app.box.com/file/21', download: true },
            { id: '22', name: 'Call notes.boxnote', kind: 'file', size: 300, modified: note.modified_at, extension: 'boxnote', webUrl: 'https://app.box.com/file/22', download: false },
            { id: '31', name: 'Court website', kind: 'web_link', size: null, modified: null, extension: null, webUrl: null, download: false },
        ]);
    });

    it('follows pages by offset until Box\'s total is reached', async () => {
        const g = fakeBox((url) => (url.searchParams.get('offset') === '0' ? json({ total_count: 2, entries: [folder] }) : json({ total_count: 2, entries: [docx] })));
        expect((await g.box.children('11')).map((i) => i.id)).toEqual(['11', '21']);
        expect(g.calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1']);
    });

    it('searches for files only, at most 200 a page', async () => {
        const g = fakeBox(() => json({ total_count: 1, entries: [docx] }));
        expect((await g.box.search('SPA')).map((i) => i.name)).toEqual(['SPA draft.docx']);
        const url = g.calls[0]!.url;
        expect(url.pathname).toBe('/2.0/search');
        expect(url.searchParams.get('query')).toBe('SPA');
        expect(url.searchParams.get('type')).toBe('file');
        expect(url.searchParams.get('limit')).toBe('200');
        await expect(g.box.search('  ')).rejects.toThrow(/needs words/);
    });

    it('reads the signed-in user', async () => {
        const g = fakeBox(() => json({ type: 'user', id: '99', name: 'Jane Doe', login: 'jane@firm-box.test' }));
        expect(await g.box.me()).toEqual({ id: '99', name: 'Jane Doe', login: 'jane@firm-box.test' });
        expect(g.calls[0]!.url.searchParams.get('fields')).toBe('id,name,login');
    });

    it('gives Box\'s error answers as BoxApiError with its code', async () => {
        const g = fakeBox(() => json({ type: 'error', status: 403, code: 'insufficient_scope', message: 'The request requires higher privileges than provided by the access token.' }, 403));
        const err = await g.box.file('21').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BoxApiError);
        expect(err).toMatchObject({ status: 403, code: 'insufficient_scope', insufficientScope: true, rateLimited: false });
        expect((err as Error).message).toContain('higher privileges');
    });

    it('downloads a file by following Box\'s redirect, without the access token on the download address', async () => {
        const g = fakeBox((url) => {
            if (url.pathname === '/2.0/files/21/content') return new Response(null, { status: 302, headers: { location: 'https://dl.boxcloud.com/d/1/abc/download' } });
            if (url.hostname === 'dl.boxcloud.com') return new Response('docx-bytes!');
            throw new Error(`unexpected ${url}`);
        });
        const file = { id: '21', name: 'SPA draft.docx', kind: 'file', size: 11, modified: null, extension: 'docx', webUrl: 'https://app.box.com/file/21', download: true } as const;
        expect(Buffer.from(await g.box.download(file, 100)).toString()).toBe('docx-bytes!');
        expect(g.calls[0]!.redirect).toBe('manual');
        expect(g.calls[0]!.auth).toBe('Bearer at-1');
        expect(g.calls[1]!.auth).toBeNull();
    });

    it('refuses a Box Note, a folder, and a file over the limit before downloading anything', async () => {
        const g = fakeBox(() => { throw new Error('nothing should be fetched'); });
        const asItem = (i: typeof note | typeof folder) => ({ ...i, kind: i.type as 'file' | 'folder', modified: null, extension: 'extension' in i ? i.extension : null, webUrl: null, download: false });
        await expect(g.box.download(asItem(note), 1000)).rejects.toMatchObject({ code: 'not_downloadable', message: expect.stringContaining('Box Note') });
        await expect(g.box.download(asItem(folder), 1000)).rejects.toMatchObject({ code: 'not_a_file' });
        const big = { id: '21', name: 'SPA draft.docx', kind: 'file', size: 5000, modified: null, extension: 'docx', webUrl: null, download: true } as const;
        await expect(g.box.download(big, 1000)).rejects.toBeInstanceOf(BoxFileError);
        expect(g.calls).toEqual([]);
    });

    it('stops reading a download that turns out larger than allowed, and says when Box is still preparing a file', async () => {
        const file = { id: '21', name: 'a.pdf', kind: 'file', size: 3, modified: null, extension: 'pdf', webUrl: null, download: true } as const;
        await expect(fakeBox(() => new Response('more than ten bytes')).box.download(file, 10)).rejects.toMatchObject({ code: 'too_large' });
        await expect(fakeBox(() => new Response(null, { status: 202, headers: { 'retry-after': '5' } })).box.download(file, 10)).rejects.toMatchObject({ code: 'not_ready', message: expect.stringContaining('5 seconds') });
    });
});
