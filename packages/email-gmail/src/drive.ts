import { GoogleApiError } from './calendar.js';

const API = 'https://www.googleapis.com/drive/v3';

/** Read the user's Google Drive files, nothing more (GoogleDrive). Google counts it as a restricted scope. */
export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Google Docs, Sheets and Slides, and the Office format each is exported as. */
export const GOOGLE_EXPORTS: Readonly<Record<string, { mimeType: string; extension: string }>> = {
    'application/vnd.google-apps.document': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' },
    'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' },
    'application/vnd.google-apps.presentation': { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: 'pptx' },
};

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

/** A folder or a file in Google Drive. */
export interface DriveFile {
    id: string;
    name: string;
    kind: 'folder' | 'file';
    mimeType: string;
    /** Bytes of a stored file; null for Google Docs, Sheets, Slides and other Google types, which have no size until exported. */
    size: number | null;
    /** ISO time of the last change. */
    modified: string | null;
    /** The file's address in Google Drive, for a person to open. */
    webUrl: string | null;
    /** The shared drive the file is in; null in My Drive or shared with the user. */
    driveId: string | null;
    /**
     * How the file is downloaded: `content` as stored, `export` as an Office
     * file (Google Docs, Sheets, Slides), or `none` for other Google types
     * (forms, sites, drawings, maps...) and for folders.
     */
    download: 'content' | 'export' | 'none';
}

/** A shared drive the user is a member of. */
export interface SharedDrive {
    id: string;
    name: string;
}

/** Why a Drive file was not downloaded: it is a Google type with no Office export, a folder, or larger than allowed. */
export type GoogleDriveErrorCode = 'not_exportable' | 'not_a_file' | 'too_large';

export class GoogleDriveError extends Error {
    override readonly name = 'GoogleDriveError';
    constructor(readonly code: GoogleDriveErrorCode, message: string) { super(message); }
}

interface ApiFile {
    id: string;
    name?: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
    driveId?: string;
    shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,driveId,shortcutDetails';
/** The most entries one listing returns. */
const LIST_LIMIT = 500;

/** A Drive API file as a DriveFile; a shortcut is described as the file or folder it points to. */
function fileOf(f: ApiFile): DriveFile {
    if (!f.name || !f.mimeType) throw new Error(`Google Drive gave no name or type for file ${f.id}`);
    let id = f.id;
    let mimeType = f.mimeType;
    if (mimeType === SHORTCUT) {
        if (!f.shortcutDetails?.targetId || !f.shortcutDetails.targetMimeType) throw new Error(`Google Drive gave no target for the shortcut "${f.name}"`);
        id = f.shortcutDetails.targetId;
        mimeType = f.shortcutDetails.targetMimeType;
    }
    const folder = mimeType === FOLDER;
    const native = mimeType.startsWith('application/vnd.google-apps.');
    return {
        id,
        name: f.name,
        kind: folder ? 'folder' : 'file',
        mimeType,
        // A shortcut's own size is not its target's.
        size: !native && f.mimeType !== SHORTCUT && f.size !== undefined ? Number(f.size) : null,
        modified: f.modifiedTime ?? null,
        webUrl: f.webViewLink ?? null,
        driveId: f.driveId ?? null,
        download: folder ? 'none' : !native ? 'content' : GOOGLE_EXPORTS[mimeType] ? 'export' : 'none',
    };
}

/** A string inside a Drive search query: backslashes and single quotes escaped. */
const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Reads a response's body up to `maxBytes`; more is a GoogleDriveError too_large, stopped as soon as it is passed. */
async function readLimited(res: Response, maxBytes: number, what: string): Promise<Uint8Array> {
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (declared > maxBytes) {
        await res.body?.cancel();
        throw new GoogleDriveError('too_large', `${what} is ${declared} bytes; at most ${maxBytes} are taken`);
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
                throw new GoogleDriveError('too_large', `${what} is more than ${maxBytes} bytes`);
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
 * Reads the signed-in user's Google Drive (scope GOOGLE_DRIVE_READONLY_SCOPE):
 * My Drive, files shared with them, shared drives, search by name, and a
 * file's content, with Google Docs, Sheets and Slides exported as .docx,
 * .xlsx and .pptx. It is handed a function that returns a current access
 * token and never stores tokens; it never changes anything. Google's
 * failures are GoogleApiError (`insufficientScope` when the token lacks
 * the Drive scope).
 */
export class GoogleDrive {
    constructor(private readonly opts: { accessToken: () => Promise<string>; fetch?: typeof fetch }) {}

    private async get(path: string, params: Record<string, string>): Promise<Response> {
        const url = new URL(`${API}${path}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const res = await (this.opts.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${await this.opts.accessToken()}` } });
        if (res.ok) return res;
        const text = await res.text();
        const parsed = (() => { try { return (JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }).error; } catch { return undefined; } })();
        const reasons = (parsed?.errors ?? []).map((e) => e.reason).filter((r): r is string => Boolean(r));
        throw new GoogleApiError(res.status, reasons, `Google Drive answered ${res.status} to ${path}: ${parsed?.message ?? text.slice(0, 300)}`);
    }

    /** Files matching a Drive search query, following pages up to the listing limit, folders first then by name. */
    private async list(q: string, corpus: { corpora: 'user' | 'allDrives' } | { corpora: 'drive'; driveId: string }): Promise<DriveFile[]> {
        const found: ApiFile[] = [];
        let pageToken: string | undefined;
        do {
            const params: Record<string, string> = {
                q,
                corpora: corpus.corpora,
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
                orderBy: 'folder,name',
                pageSize: String(Math.min(LIST_LIMIT - found.length, 1000)),
                fields: `nextPageToken,files(${FILE_FIELDS})`,
            };
            if (corpus.corpora === 'drive') params.driveId = corpus.driveId;
            if (pageToken) params.pageToken = pageToken;
            const page = (await (await this.get('/files', params)).json()) as { files?: ApiFile[]; nextPageToken?: string };
            found.push(...(page.files ?? []));
            pageToken = page.nextPageToken;
        } while (pageToken && found.length < LIST_LIMIT);
        return found.slice(0, LIST_LIMIT).map(fileOf);
    }

    /** The folders and files in a folder; 'root' is the top of My Drive. For a folder in a shared drive, give the drive. */
    async children(folderId: string, driveId?: string): Promise<DriveFile[]> {
        const q = `${quoted(folderId)} in parents and trashed = false`;
        return this.list(q, driveId ? { corpora: 'drive', driveId } : { corpora: 'user' });
    }

    /** Folders and files other people have shared with the user. */
    async sharedWithMe(): Promise<DriveFile[]> {
        return this.list('sharedWithMe = true and trashed = false', { corpora: 'user' });
    }

    /** Folders and files whose name contains `name`, in My Drive, shared with the user, and in shared drives. */
    async search(name: string): Promise<DriveFile[]> {
        return this.list(`name contains ${quoted(name)} and trashed = false`, { corpora: 'allDrives' });
    }

    /** The shared drives the user is a member of. */
    async sharedDrives(): Promise<SharedDrive[]> {
        const found: SharedDrive[] = [];
        let pageToken: string | undefined;
        do {
            const params: Record<string, string> = { pageSize: '100', fields: 'nextPageToken,drives(id,name)' };
            if (pageToken) params.pageToken = pageToken;
            const page = (await (await this.get('/drives', params)).json()) as { drives?: Array<{ id: string; name?: string }>; nextPageToken?: string };
            for (const d of page.drives ?? []) {
                if (!d.name) throw new Error(`Google Drive gave no name for shared drive ${d.id}`);
                found.push({ id: d.id, name: d.name });
            }
            pageToken = page.nextPageToken;
        } while (pageToken && found.length < LIST_LIMIT);
        return found;
    }

    /** One file (to check its kind, name and size before downloading it). */
    async file(id: string): Promise<DriveFile> {
        return fileOf((await (await this.get(`/files/${encodeURIComponent(id)}`, { supportsAllDrives: 'true', fields: FILE_FIELDS })).json()) as ApiFile);
    }

    /**
     * A file's name, type and bytes: as stored, or for a Google Doc, Sheet or
     * Slides exported as .docx, .xlsx or .pptx (the extension added to the
     * name). Other Google types are GoogleDriveError not_exportable, a folder
     * not_a_file; more than `maxBytes` is too_large.
     */
    async download(file: DriveFile, maxBytes: number): Promise<{ name: string; mimeType: string; bytes: Uint8Array }> {
        if (file.kind === 'folder') throw new GoogleDriveError('not_a_file', `"${file.name}" is a folder`);
        if (file.download === 'content') {
            const res = await this.get(`/files/${encodeURIComponent(file.id)}`, { alt: 'media', supportsAllDrives: 'true' });
            return { name: file.name, mimeType: file.mimeType, bytes: await readLimited(res, maxBytes, `"${file.name}"`) };
        }
        const target = GOOGLE_EXPORTS[file.mimeType];
        if (file.download === 'none' || !target) {
            throw new GoogleDriveError('not_exportable', `"${file.name}" is a Google type (${file.mimeType}) with no Office format to export it as`);
        }
        const res = await this.get(`/files/${encodeURIComponent(file.id)}/export`, { mimeType: target.mimeType });
        const name = file.name.toLowerCase().endsWith(`.${target.extension}`) ? file.name : `${file.name}.${target.extension}`;
        return { name, mimeType: target.mimeType, bytes: await readLimited(res, maxBytes, `"${file.name}"`) };
    }
}
