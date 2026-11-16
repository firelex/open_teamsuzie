import { GraphError, MICROSOFT_FILE_SCOPES, type GraphSession } from './session.js';

/**
 * OneDrive and SharePoint files through Microsoft Graph, read only: the
 * user's own OneDrive, files shared with them, SharePoint sites they follow
 * or find, those sites' document libraries, search, and a file's content.
 * Needs MICROSOFT_FILE_SCOPES (Files.Read.All, Sites.Read.All) on the
 * session. Nothing is ever written to Microsoft from here.
 */

/** A folder or a file in a drive (a OneDrive or a SharePoint document library). */
export interface DriveEntry {
    /** The item's id within its drive. */
    id: string;
    /** The drive the item lives in (needed with `id` to open or download it). */
    driveId: string;
    name: string;
    kind: 'folder' | 'file';
    /** Bytes, for a file; null when Graph does not say. */
    size: number | null;
    /** ISO time of the last change. */
    modified: string | null;
    /** The item's address in OneDrive or SharePoint, for a person to open. */
    webUrl: string | null;
    mimeType: string | null;
}

/** A SharePoint site. */
export interface SharePointSite {
    id: string;
    name: string;
    webUrl: string | null;
}

/** A document library of a SharePoint site (a drive). */
export interface DocumentLibrary {
    id: string;
    name: string;
    webUrl: string | null;
}

interface GraphItem {
    id: string;
    name?: string;
    size?: number;
    lastModifiedDateTime?: string;
    webUrl?: string;
    folder?: { childCount?: number };
    file?: { mimeType?: string };
    parentReference?: { driveId?: string };
    /** Set on items shared with the user: the item as it is in its owner's drive. */
    remoteItem?: GraphItem;
}

const ITEM_FIELDS = 'id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference,remoteItem';
/** The most entries one listing returns. */
const LIST_LIMIT = 500;

/**
 * A Graph drive item as a DriveEntry; null for what is neither a folder nor
 * a file (a OneNote notebook and other packages), which cannot be opened or
 * downloaded as a file. An item shared with the user is described by its
 * remote item, which says where it really is.
 */
function entryOf(raw: GraphItem): DriveEntry | null {
    const item = raw.remoteItem ?? raw;
    const kind = item.folder ? 'folder' : item.file ? 'file' : null;
    if (!kind) return null;
    const driveId = item.parentReference?.driveId;
    if (!driveId) throw new GraphError('internal_error', `Microsoft Graph did not say which drive "${item.name ?? item.id}" is in`);
    return {
        id: item.id,
        driveId,
        name: named(item.name ?? raw.name, `drive item ${item.id}`),
        kind,
        size: kind === 'file' && typeof item.size === 'number' ? item.size : null,
        modified: item.lastModifiedDateTime ?? raw.lastModifiedDateTime ?? null,
        webUrl: item.webUrl ?? raw.webUrl ?? null,
        mimeType: item.file?.mimeType ?? null,
    };
}

/** A name Graph always gives; its absence is Graph answering in a way this reader does not know. */
function named(name: string | undefined, what: string): string {
    if (!name) throw new GraphError('internal_error', `Microsoft Graph gave no name for ${what}`);
    return name;
}

const entries = (items: GraphItem[]) => items.map(entryOf).filter((e): e is DriveEntry => e !== null);
const seg = (id: string) => encodeURIComponent(id);

/** The file scopes (MICROSOFT_FILE_SCOPES) a list of granted scopes lacks; Microsoft may list them with Graph's address in front. */
export function missingFileScopes(granted: readonly string[]): string[] {
    const have = new Set(granted.map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()));
    return MICROSOFT_FILE_SCOPES.filter((s) => !have.has(s.toLowerCase()));
}

export class OneDriveFiles {
    constructor(private readonly session: GraphSession) {}

    /** The folders and files at the top of the user's own OneDrive. */
    async myFiles(): Promise<DriveEntry[]> {
        return entries(await this.session.all<GraphItem>('/me/drive/root/children', { query: { $select: ITEM_FIELDS, $top: 200 }, limit: LIST_LIMIT }));
    }

    /** The folders and files in a folder of a drive; without `folderId`, at the top of the drive. */
    async children(driveId: string, folderId?: string): Promise<DriveEntry[]> {
        const path = folderId ? `/drives/${seg(driveId)}/items/${seg(folderId)}/children` : `/drives/${seg(driveId)}/root/children`;
        return entries(await this.session.all<GraphItem>(path, { query: { $select: ITEM_FIELDS, $top: 200 }, limit: LIST_LIMIT }));
    }

    /** Folders and files other people have shared with the user. */
    async sharedWithMe(): Promise<DriveEntry[]> {
        return entries(await this.session.all<GraphItem>('/me/drive/sharedWithMe', { limit: LIST_LIMIT }));
    }

    /** Folders and files in the user's OneDrive whose name or content matches `query`. */
    async search(query: string): Promise<DriveEntry[]> {
        // OData string literal: a single quote is written twice.
        const q = encodeURIComponent(query.replace(/'/g, "''"));
        return entries(await this.session.all<GraphItem>(`/me/drive/root/search(q='${q}')`, { query: { $select: ITEM_FIELDS, $top: 200 }, limit: LIST_LIMIT }));
    }

    /** SharePoint sites the user follows. */
    async followedSites(): Promise<SharePointSite[]> {
        return sites(await this.session.all<GraphSite>('/me/followedSites', { query: { $select: 'id,displayName,name,webUrl' }, limit: LIST_LIMIT }));
    }

    /** SharePoint sites the user can open whose name matches `query`. */
    async searchSites(query: string): Promise<SharePointSite[]> {
        return sites(await this.session.all<GraphSite>('/sites', { query: { search: query, $select: 'id,displayName,name,webUrl' }, limit: LIST_LIMIT }));
    }

    /** The document libraries of a SharePoint site. */
    async libraries(siteId: string): Promise<DocumentLibrary[]> {
        const found = await this.session.all<{ id: string; name?: string; webUrl?: string }>(`/sites/${seg(siteId)}/drives`, {
            query: { $select: 'id,name,webUrl' },
            limit: LIST_LIMIT,
        });
        return found.map((d) => ({ id: d.id, name: named(d.name, `document library ${d.id}`), webUrl: d.webUrl ?? null }));
    }

    /** One item of a drive (to check its kind, name and size before downloading it). */
    async item(driveId: string, itemId: string): Promise<DriveEntry> {
        const raw = await this.session.request<GraphItem>('GET', `/drives/${seg(driveId)}/items/${seg(itemId)}`, { query: { $select: ITEM_FIELDS } });
        const entry = entryOf(raw);
        if (!entry) throw new GraphError('invalid_request', `"${raw.name ?? itemId}" is neither a file nor a folder (a OneNote notebook, for example)`);
        return entry;
    }

    /** A file's content; more than `maxBytes` is a GraphError too_large. */
    async download(driveId: string, itemId: string, maxBytes: number): Promise<Uint8Array> {
        return (await this.session.download(`/drives/${seg(driveId)}/items/${seg(itemId)}/content`, { maxBytes })).bytes;
    }
}

interface GraphSite {
    id: string;
    displayName?: string;
    name?: string;
    webUrl?: string;
}

const sites = (found: GraphSite[]): SharePointSite[] =>
    // A site's display name is its title; its `name` is the address part, given when a site has no title.
    found.map((s) => ({ id: s.id, name: named(s.displayName || s.name, `SharePoint site ${s.id}`), webUrl: s.webUrl ?? null }));
