import { describe, expect, it } from 'vitest';
import { GraphError, GraphSession, MICROSOFT_FILE_SCOPES, MICROSOFT_SCOPES, OneDriveFiles, missingFileScopes } from '../index.js';

const app = { clientId: 'client-1', tenantId: 'tenant-1' };

/**
 * A fake Microsoft: the token endpoint (granting `scope`) and Graph routes
 * matched by exact path (query left out), answering as Graph does.
 */
function fakeGraph(routes: Record<string, () => Response>, scope = [...MICROSOFT_SCOPES, ...MICROSOFT_FILE_SCOPES].join(' ')) {
    const urls: string[] = [];
    const f = (async (input: string) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600, scope }), { status: 200 });
        const path = decodeURIComponent(url.replace('https://graph.microsoft.com/v1.0', '').split('?')[0]!);
        const route = routes[path];
        return route ? route() : new Response(JSON.stringify({ error: { code: 'itemNotFound', message: `no route for ${path}` } }), { status: 404 });
    }) as unknown as typeof fetch;
    const session = new GraphSession({ app, refreshToken: async () => 'refresh-0', saveRefreshToken: async () => undefined, fetch: f, now: () => 0 });
    return { files: new OneDriveFiles(session), session, urls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

// Shaped as Graph's driveItem (https://learn.microsoft.com/graph/api/resources/driveitem).
const folder = { id: 'F1', name: 'Contracts', folder: { childCount: 2 }, lastModifiedDateTime: '2026-11-10T09:00:00Z', webUrl: 'https://firm-my.sharepoint.com/personal/jane/Documents/Contracts', parentReference: { driveId: 'b!me' } };
const file = { id: 'D1', name: 'SPA draft.docx', size: 48213, file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, lastModifiedDateTime: '2026-11-12T15:30:00Z', webUrl: 'https://firm-my.sharepoint.com/personal/jane/Documents/SPA%20draft.docx', parentReference: { driveId: 'b!me' } };
const notebook = { id: 'N1', name: 'Notes', package: { type: 'oneNote' }, parentReference: { driveId: 'b!me' } };

describe('OneDriveFiles', () => {
    it('lists the top of the user\'s OneDrive as folders and files, leaving out notebooks', async () => {
        const g = fakeGraph({ '/me/drive/root/children': json({ value: [folder, file, notebook] }) });
        expect(await g.files.myFiles()).toEqual([
            { id: 'F1', driveId: 'b!me', name: 'Contracts', kind: 'folder', size: null, modified: '2026-11-10T09:00:00Z', webUrl: folder.webUrl, mimeType: null },
            { id: 'D1', driveId: 'b!me', name: 'SPA draft.docx', kind: 'file', size: 48213, modified: '2026-11-12T15:30:00Z', webUrl: file.webUrl, mimeType: file.file.mimeType },
        ]);
    });

    it('opens a folder of a drive, and the top of a document library', async () => {
        const g = fakeGraph({
            '/drives/b!me/items/F1/children': json({ value: [file] }),
            '/drives/b!lib/root/children': json({ value: [{ ...folder, parentReference: { driveId: 'b!lib' } }] }),
        });
        expect((await g.files.children('b!me', 'F1')).map((e) => e.name)).toEqual(['SPA draft.docx']);
        expect((await g.files.children('b!lib')).map((e) => [e.name, e.driveId])).toEqual([['Contracts', 'b!lib']]);
    });

    it('describes a shared item by where it really is', async () => {
        const shared = { id: 'local', name: 'Term sheet.pdf', remoteItem: { id: 'R1', name: 'Term sheet.pdf', size: 900, file: { mimeType: 'application/pdf' }, webUrl: 'https://client.sharepoint.com/x', parentReference: { driveId: 'b!client' } } };
        const g = fakeGraph({ '/me/drive/sharedWithMe': json({ value: [shared] }) });
        expect(await g.files.sharedWithMe()).toEqual([
            { id: 'R1', driveId: 'b!client', name: 'Term sheet.pdf', kind: 'file', size: 900, modified: null, webUrl: 'https://client.sharepoint.com/x', mimeType: 'application/pdf' },
        ]);
    });

    it('searches the OneDrive with the query as an OData string', async () => {
        const g = fakeGraph({ "/me/drive/root/search(q='O''Brien lease')": json({ value: [file] }) });
        expect((await g.files.search("O'Brien lease")).map((e) => e.id)).toEqual(['D1']);
    });

    it('lists followed and found SharePoint sites and a site\'s libraries', async () => {
        const g = fakeGraph({
            '/me/followedSites': json({ value: [{ id: 'site-1', displayName: 'Litigation', webUrl: 'https://firm.sharepoint.com/sites/lit' }] }),
            '/sites': json({ value: [{ id: 'site-2', name: 'deals', webUrl: null }] }),
            '/sites/site-1/drives': json({ value: [{ id: 'b!lib', name: 'Documents', webUrl: 'https://firm.sharepoint.com/sites/lit/Shared%20Documents' }] }),
        });
        expect(await g.files.followedSites()).toEqual([{ id: 'site-1', name: 'Litigation', webUrl: 'https://firm.sharepoint.com/sites/lit' }]);
        expect(await g.files.searchSites('deals')).toEqual([{ id: 'site-2', name: 'deals', webUrl: null }]);
        expect(g.urls.some((u) => u.includes('/sites?search=deals'))).toBe(true);
        expect(await g.files.libraries('site-1')).toEqual([{ id: 'b!lib', name: 'Documents', webUrl: 'https://firm.sharepoint.com/sites/lit/Shared%20Documents' }]);
    });

    it('downloads a file\'s content, and stops at the size limit', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        const g = fakeGraph({ '/drives/b!me/items/D1/content': () => new Response(bytes, { status: 200 }) });
        expect(Array.from(await g.files.download('b!me', 'D1', 5))).toEqual([1, 2, 3, 4, 5]);
        await expect(g.files.download('b!me', 'D1', 4)).rejects.toMatchObject({ code: 'too_large' });
    });

    it('reads one item, and refuses one that is not a file or folder', async () => {
        const g = fakeGraph({ '/drives/b!me/items/D1': json(file), '/drives/b!me/items/N1': json(notebook) });
        expect(await g.files.item('b!me', 'D1')).toMatchObject({ kind: 'file', size: 48213 });
        await expect(g.files.item('b!me', 'N1')).rejects.toBeInstanceOf(GraphError);
    });

    it('reports Graph\'s refusal as refused, with its status', async () => {
        const g = fakeGraph({ '/me/drive/root/children': json({ error: { code: 'accessDenied', message: 'Access denied' } }, 403) });
        await expect(g.files.myFiles()).rejects.toMatchObject({ code: 'refused', status: 403 });
    });
});

describe('granted scopes', () => {
    it('tells which file scopes a token lacks, whether or not Microsoft writes Graph\'s address in front', async () => {
        const old = fakeGraph({}, 'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read');
        expect(missingFileScopes(await old.session.grantedScopes())).toEqual(['Files.Read.All', 'Sites.Read.All']);
        const now = fakeGraph({}, 'https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Sites.Read.All');
        expect(missingFileScopes(await now.session.grantedScopes())).toEqual([]);
        expect(missingFileScopes(['files.read.all', 'Sites.Read.All'])).toEqual([]);
    });
});
