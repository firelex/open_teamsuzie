const API = 'https://api.box.com/2.0';

/**
 * Box's own document types (Box Notes, Box Canvas): they live only in Box
 * and have no file to download, so they are never downloaded.
 */
export const BOX_NATIVE_EXTENSIONS: readonly string[] = ['boxnote', 'boxcanvas'];

/** A folder, a file or a bookmark (web link) in Box. */
export interface BoxItem {
    id: string;
    name: string;
    kind: 'folder' | 'file' | 'web_link';
    /** Bytes of a file; null for folders and bookmarks. */
    size: number | null;
    /** ISO time of the last change. */
    modified: string | null;
    /** A file's extension as Box gives it (lower case, no dot); null for folders and bookmarks. */
    extension: string | null;
    /** The item's address in Box, for a person to open; null for a bookmark. */
    webUrl: string | null;
    /** Whether the file can be downloaded: false for folders, bookmarks, and Box Notes and Box Canvas. */
    download: boolean;
}

/** The signed-in Box user. */
export interface BoxUser { id: string; name: string; login: string }

/** Box answered with an error. `code` is Box's own error code (e.g. not_found, insufficient_scope) when it gave one. */
export class BoxApiError extends Error {
    override readonly name = 'BoxApiError';
    constructor(readonly status: number, readonly code: string | null, message: string) { super(message); }
    /** Box asks to slow down. */
    get rateLimited(): boolean {
        return this.status === 429;
    }
    /** The access token lacks a scope the call needs (the app's scopes changed since the user signed in). */
    get insufficientScope(): boolean {
        return this.status === 403 && this.code === 'insufficient_scope';
    }
}

/**
 * Why a Box item was not downloaded: a folder or bookmark, a Box Note or
 * Canvas, larger than allowed, or a file Box is still preparing.
 */
export type BoxFileErrorCode = 'not_a_file' | 'not_downloadable' | 'too_large' | 'not_ready';

export class BoxFileError extends Error {
    override readonly name = 'BoxFileError';
    constructor(readonly code: BoxFileErrorCode, message: string) { super(message); }
}

interface ApiItem {
    type: string;
    id: string;
    name?: string;
    size?: number;
    modified_at?: string;
    extension?: string;
}

const ITEM_FIELDS = 'name,size,modified_at,type,extension';
/** The most entries one listing returns. */
const LIST_LIMIT = 500;
/** The most Box gives in one page: 1000 for a folder's items, 200 for a search. */
const FOLDER_PAGE = 1000;
const SEARCH_PAGE = 200;

/** A Box API item as a BoxItem. */
function itemOf(i: ApiItem): BoxItem {
    if (!i.name) throw new Error(`Box gave no name for ${i.type} ${i.id}`);
    if (i.type === 'folder') {
        return { id: i.id, name: i.name, kind: 'folder', size: null, modified: i.modified_at ?? null, extension: null, webUrl: `https://app.box.com/folder/${i.id}`, download: false };
    }
    if (i.type === 'web_link') {
        return { id: i.id, name: i.name, kind: 'web_link', size: null, modified: i.modified_at ?? null, extension: null, webUrl: null, download: false };
    }
    if (i.type !== 'file') throw new Error(`Box gave an item of an unknown type "${i.type}" (${i.id})`);
    if (typeof i.size !== 'number') throw new Error(`Box gave no size for the file "${i.name}" (${i.id})`);
    const extension = (i.extension ?? '').toLowerCase() || null;
    return {
        id: i.id,
        name: i.name,
        kind: 'file',
        size: i.size,
        modified: i.modified_at ?? null,
        extension,
        webUrl: `https://app.box.com/file/${i.id}`,
        download: !(extension && BOX_NATIVE_EXTENSIONS.includes(extension)),
    };
}

/** Box's error answer as a BoxApiError naming the call. */
async function apiError(res: Response, what: string): Promise<BoxApiError> {
    const text = await res.text();
    const parsed = (() => { try { return JSON.parse(text) as { code?: string; message?: string }; } catch { return undefined; } })();
    return new BoxApiError(res.status, parsed?.code ?? null, `Box answered ${res.status} to ${what}: ${parsed?.message ?? text.slice(0, 300)}`);
}

/** Reads a response's body up to `maxBytes`; more is a BoxFileError too_large, stopped as soon as it is passed. */
async function readLimited(res: Response, maxBytes: number, what: string): Promise<Uint8Array> {
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (declared > maxBytes) {
        await res.body?.cancel();
        throw new BoxFileError('too_large', `${what} is ${declared} bytes; at most ${maxBytes} are taken`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new BoxFileError('too_large', `${what} is more than ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        bytes.set(c, at);
        at += c.byteLength;
    }
    return bytes;
}

/**
 * Reads the signed-in user's Box (scope BOX_READONLY_SCOPE): a folder's
 * items (folder '0' is the top), search for files, one file, the user, and a
 * file's bytes. It is handed a function that returns a current access token
 * and never stores tokens; it never changes anything. Box's error answers
 * are BoxApiError. Meant for a server: a download's redirect is read and
 * followed here.
 */
export class BoxFiles {
    constructor(private readonly opts: { accessToken: () => Promise<string>; fetch?: typeof fetch }) {}

    private get f(): typeof fetch {
        return this.opts.fetch ?? fetch;
    }

    private async get<T>(path: string, params: Record<string, string>): Promise<T> {
        const url = new URL(`${API}${path}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const res = await this.f(url, { headers: { authorization: `Bearer ${await this.opts.accessToken()}` } });
        if (!res.ok) throw await apiError(res, path);
        return (await res.json()) as T;
    }

    /** Pages of a listing (offset and limit, as Box pages them) up to the listing limit. */
    private async pages(path: string, params: Record<string, string>, pageSize: number): Promise<BoxItem[]> {
        const found: ApiItem[] = [];
        for (;;) {
            const page = await this.get<{ entries?: ApiItem[]; total_count?: number }>(path, {
                ...params,
                fields: ITEM_FIELDS,
                limit: String(Math.min(pageSize, LIST_LIMIT - found.length)),
                offset: String(found.length),
            });
            const entries = page.entries ?? [];
            found.push(...entries);
            if (entries.length === 0 || found.length >= LIST_LIMIT || typeof page.total_count !== 'number' || found.length >= page.total_count) break;
        }
        return found.slice(0, LIST_LIMIT).map(itemOf);
    }

    /** The signed-in user: their Box name and the address they sign in with. */
    async me(): Promise<BoxUser> {
        const u = await this.get<{ id?: string; name?: string; login?: string }>('/users/me', { fields: 'id,name,login' });
        if (!u.id || !u.login || !u.name) throw new Error('Box did not say which user is signed in');
        return { id: u.id, name: u.name, login: u.login };
    }

    /** The folders, files and bookmarks in a folder; '0' is the top of the user's Box. */
    async children(folderId: string): Promise<BoxItem[]> {
        return this.pages(`/folders/${encodeURIComponent(folderId)}/items`, {}, FOLDER_PAGE);
    }

    /** Files matching `query` (in their name, description or content, as Box searches) anywhere the user can see. */
    async search(query: string): Promise<BoxItem[]> {
        if (!query.trim()) throw new Error('A Box search needs words to search for');
        return this.pages('/search', { query, type: 'file' }, SEARCH_PAGE);
    }

    /** One file (to check its kind, name and size before downloading it). */
    async file(id: string): Promise<BoxItem> {
        return itemOf(await this.get<ApiItem>(`/files/${encodeURIComponent(id)}`, { fields: ITEM_FIELDS }));
    }

    /**
     * A file's bytes. A folder or bookmark is BoxFileError not_a_file, a Box
     * Note or Canvas not_downloadable, more than `maxBytes` too_large (checked
     * against the size Box gave before anything is downloaded, and again
     * while reading), and a file Box is still preparing not_ready. Box
     * answers with a redirect to a short-lived download address, which is
     * fetched without the access token.
     */
    async download(file: BoxItem, maxBytes: number): Promise<Uint8Array> {
        if (file.kind !== 'file') throw new BoxFileError('not_a_file', `"${file.name}" is a ${file.kind === 'folder' ? 'folder' : 'bookmark'}, not a file`);
        if (!file.download) throw new BoxFileError('not_downloadable', `"${file.name}" is a Box ${file.extension === 'boxcanvas' ? 'Canvas' : 'Note'}, which exists only in Box and has no file to download`);
        if (file.size !== null && file.size > maxBytes) throw new BoxFileError('too_large', `"${file.name}" is ${file.size} bytes; at most ${maxBytes} are taken`);
        const path = `/files/${encodeURIComponent(file.id)}/content`;
        const res = await this.f(`${API}${path}`, { headers: { authorization: `Bearer ${await this.opts.accessToken()}` }, redirect: 'manual' });
        if (res.status === 202) {
            await res.body?.cancel();
            throw new BoxFileError('not_ready', `Box is still preparing "${file.name}" for download; try again in ${res.headers.get('retry-after') ?? 'a few'} seconds`);
        }
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            await res.body?.cancel();
            if (!location) throw new Error(`Box answered ${res.status} to ${path} without a download address`);
            const got = await this.f(location);
            if (!got.ok) throw await apiError(got, `the download of "${file.name}"`);
            return readLimited(got, maxBytes, `"${file.name}"`);
        }
        if (!res.ok) throw await apiError(res, path);
        return readLimited(res, maxBytes, `"${file.name}"`);
    }
}
