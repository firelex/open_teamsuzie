import { describe, expect, it } from 'vitest';
import { GoogleApiError } from './calendar.js';
import { GoogleDrive, GoogleDriveError, type DriveFile } from './drive.js';

/** A fetch that records each call and answers with `reply`, as the Drive API answers. */
function fakeDrive(reply: (url: URL) => Response) {
    const calls: Array<{ url: URL; auth: string | null }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
        return reply(url);
    }) as typeof fetch;
    return { drive: new GoogleDrive({ accessToken: async () => 'at-1', fetch: f }), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Shaped as the Drive API's files.list answers (https://developers.google.com/drive/api/reference/rest/v3/files).
const folder = { id: 'fo1', name: 'Clients', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-11-10T09:00:00.000Z', webViewLink: 'https://drive.google.com/drive/folders/fo1' };
const pdf = { id: 'pd1', name: 'Lease.pdf', mimeType: 'application/pdf', size: '20480', modifiedTime: '2026-11-11T10:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/pd1/view' };
const doc = { id: 'gd1', name: 'Board minutes', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-12T11:00:00.000Z', webViewLink: 'https://docs.google.com/document/d/gd1/edit', driveId: 'sd1' };
const form = { id: 'gf1', name: 'Intake form', mimeType: 'application/vnd.google-apps.form', webViewLink: 'https://docs.google.com/forms/d/gf1/edit' };
const shortcut = { id: 'sc1', name: 'Lease.pdf', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'pd1', targetMimeType: 'application/pdf' } };

describe('GoogleDrive', () => {
    it('lists a folder of My Drive, folders first, with the access token, across all drives\' items', async () => {
        const g = fakeDrive(() => json({ files: [folder, pdf, doc, form] }));
        const found = await g.drive.children('root');
        const url = g.calls[0]!.url;
        expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files');
        expect(url.searchParams.get('q')).toBe("'root' in parents and trashed = false");
        expect(url.searchParams.get('corpora')).toBe('user');
        expect(url.searchParams.get('supportsAllDrives')).toBe('true');
        expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
        expect(g.calls[0]!.auth).toBe('Bearer at-1');
        expect(found).toEqual<DriveFile[]>([
            { id: 'fo1', name: 'Clients', kind: 'folder', mimeType: folder.mimeType, size: null, modified: folder.modifiedTime, webUrl: folder.webViewLink, driveId: null, download: 'none' },
            { id: 'pd1', name: 'Lease.pdf', kind: 'file', mimeType: 'application/pdf', size: 20480, modified: pdf.modifiedTime, webUrl: pdf.webViewLink, driveId: null, download: 'content' },
            { id: 'gd1', name: 'Board minutes', kind: 'file', mimeType: doc.mimeType, size: null, modified: doc.modifiedTime, webUrl: doc.webViewLink, driveId: 'sd1', download: 'export' },
            { id: 'gf1', name: 'Intake form', kind: 'file', mimeType: form.mimeType, size: null, modified: null, webUrl: form.webViewLink, driveId: null, download: 'none' },
        ]);
    });

    it('lists a shared drive\'s folder within that drive, files shared with the user, and shared drives', async () => {
        const g = fakeDrive((url) => url.pathname.endsWith('/drives') ? json({ drives: [{ id: 'sd1', name: 'Deals' }] }) : json({ files: [] }));
        await g.drive.children('sd1', 'sd1');
        expect(g.calls[0]!.url.searchParams.get('corpora')).toBe('drive');
        expect(g.calls[0]!.url.searchParams.get('driveId')).toBe('sd1');
        await g.drive.sharedWithMe();
        expect(g.calls[1]!.url.searchParams.get('q')).toBe('sharedWithMe = true and trashed = false');
        expect(await g.drive.sharedDrives()).toEqual([{ id: 'sd1', name: 'Deals' }]);
    });

    it('searches by name across all drives, quoting the name', async () => {
        const g = fakeDrive(() => json({ files: [] }));
        await g.drive.search("O'Brien");
        expect(g.calls[0]!.url.searchParams.get('q')).toBe("name contains 'O\\'Brien' and trashed = false");
        expect(g.calls[0]!.url.searchParams.get('corpora')).toBe('allDrives');
    });

    it('describes a shortcut as the file it points to', async () => {
        const g = fakeDrive(() => json({ files: [shortcut] }));
        expect((await g.drive.children('root'))[0]).toMatchObject({ id: 'pd1', mimeType: 'application/pdf', kind: 'file', download: 'content', size: null });
    });

    it('downloads a stored file as it is', async () => {
        const g = fakeDrive((url) => url.searchParams.get('alt') === 'media' ? new Response(new Uint8Array([1, 2, 3])) : json(pdf));
        const file = await g.drive.file('pd1');
        const got = await g.drive.download(file, 10);
        expect(got).toEqual({ name: 'Lease.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) });
        expect(g.calls[1]!.url.pathname).toBe('/drive/v3/files/pd1');
        await expect(g.drive.download(file, 2)).rejects.toMatchObject({ code: 'too_large' });
    });

    it('exports a Google Doc as .docx', async () => {
        const g = fakeDrive(() => new Response(new Uint8Array([9, 9])));
        const file: DriveFile = { id: 'gd1', name: 'Board minutes', kind: 'file', mimeType: doc.mimeType, size: null, modified: null, webUrl: null, driveId: null, download: 'export' };
        const got = await g.drive.download(file, 10);
        expect(got.name).toBe('Board minutes.docx');
        expect(got.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(g.calls[0]!.url.pathname).toBe('/drive/v3/files/gd1/export');
        expect(g.calls[0]!.url.searchParams.get('mimeType')).toBe(got.mimeType);
    });

    it('refuses a Google type with no Office export, and a folder', async () => {
        const g = fakeDrive(() => json({ files: [form, folder] }));
        const [f, fo] = await g.drive.children('root');
        await expect(g.drive.download(f!, 10)).rejects.toEqual(expect.objectContaining({ code: 'not_exportable' }));
        await expect(g.drive.download(fo!, 10)).rejects.toBeInstanceOf(GoogleDriveError);
        expect(g.calls).toHaveLength(1);
    });

    it('tells a token without the Drive scope apart from other refusals', async () => {
        const g = fakeDrive(() => json({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }, 403));
        const err = await g.drive.children('root').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GoogleApiError);
        expect((err as GoogleApiError).insufficientScope).toBe(true);
        const other = fakeDrive(() => json({ error: { code: 404, message: 'File not found: x.', errors: [{ reason: 'notFound' }] } }, 404));
        expect(((await other.drive.file('x').catch((e: unknown) => e)) as GoogleApiError).insufficientScope).toBe(false);
    });
});
