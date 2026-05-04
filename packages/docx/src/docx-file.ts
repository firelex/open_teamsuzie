import PizZip from 'pizzip';
import { parseXml, serializeXml } from './xml.js';
import type { XmlTree } from './types.js';

/**
 * A loaded `.docx` package. Every part read from the source zip is held as
 * raw bytes; specific parts (`word/document.xml` today, more later) gain
 * lazy parsed accessors. The save path re-zips, substituting modified
 * parts in for their originals — untouched parts pass through byte-for-byte.
 *
 * Lifecycle:
 *
 *   const file = DocxFile.load(bytes);
 *   const tree = file.document();         // lazy parse on first access
 *   // ... mutate `tree` in place, or compute a new one ...
 *   file.setDocument(tree);                // mark dirty
 *   const out = file.save();               // re-zip with the new document.xml
 *
 * If `document()` is never called (or `setDocument` never invoked), the
 * save path emits the original bytes for `word/document.xml` — preserving
 * structural equivalence end-to-end without any parse/serialize cycle.
 */
export class DocxFile {
    private readonly originalParts: Map<string, Buffer>;
    private readonly modifiedParts: Map<string, Buffer> = new Map();

    private documentTree: XmlTree | null = null;
    private documentDirty = false;

    private constructor(originalParts: Map<string, Buffer>) {
        this.originalParts = originalParts;
    }

    static load(bytes: Buffer | Uint8Array): DocxFile {
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const zip = new PizZip(buf);
        const parts = new Map<string, Buffer>();
        for (const path of Object.keys(zip.files)) {
            const entry = zip.file(path);
            if (!entry || entry.dir) continue;
            parts.set(path, Buffer.from(entry.asArrayBuffer()));
        }
        if (!parts.has('word/document.xml')) {
            throw new Error(
                'Not a valid .docx package: missing word/document.xml',
            );
        }
        return new DocxFile(parts);
    }

    /** All part paths in the package, in load order. */
    listParts(): string[] {
        return [...this.originalParts.keys()];
    }

    /** True if the package contains a part at `path`. */
    hasPart(path: string): boolean {
        return this.originalParts.has(path);
    }

    /**
     * Read a part as raw bytes. Returns the modified copy if the caller has
     * written to that path via `setPart`, otherwise the original. Returns
     * `undefined` if the part doesn't exist.
     */
    readPart(path: string): Buffer | undefined {
        return this.modifiedParts.get(path) ?? this.originalParts.get(path);
    }

    /**
     * Replace a part's bytes (or write a new one). Persisted on the next
     * `save()`. The original bytes remain available via the `originalParts`
     * map until the file is re-loaded.
     */
    setPart(path: string, bytes: Buffer): void {
        this.modifiedParts.set(path, bytes);
        if (path === 'word/document.xml') {
            // External byte-level write to document.xml invalidates any
            // cached parse — clear it so the next document() call re-reads.
            this.documentTree = null;
            this.documentDirty = false;
        }
    }

    /**
     * Lazy-parsed `word/document.xml` tree. Mutate the returned tree in
     * place and call `markDocumentDirty()`, OR compute a new tree and pass
     * it to `setDocument()`. Either path makes `save()` re-serialize.
     */
    document(): XmlTree {
        if (this.documentTree === null) {
            const bytes = this.readPart('word/document.xml');
            if (!bytes) {
                throw new Error('word/document.xml not found');
            }
            this.documentTree = parseXml(bytes.toString('utf-8'));
        }
        return this.documentTree;
    }

    /** Replace the parsed document tree wholesale. Marks the part dirty. */
    setDocument(tree: XmlTree): void {
        this.documentTree = tree;
        this.documentDirty = true;
    }

    /**
     * Mark the cached document tree as dirty so the next `save()`
     * re-serializes it. Use after mutating the tree returned by `document()`
     * in place.
     */
    markDocumentDirty(): void {
        if (this.documentTree === null) {
            throw new Error(
                'markDocumentDirty() called before document() — nothing to mark',
            );
        }
        this.documentDirty = true;
    }

    /**
     * Re-zip and return the resulting `.docx` bytes. Any in-memory
     * mutations to the document tree are serialized first; opaque parts
     * pass through untouched.
     */
    save(): Buffer {
        if (this.documentDirty && this.documentTree !== null) {
            const xml = serializeXml(this.documentTree);
            this.modifiedParts.set(
                'word/document.xml',
                Buffer.from(xml, 'utf-8'),
            );
            this.documentDirty = false;
        }
        const zip = new PizZip();
        for (const path of this.originalParts.keys()) {
            const overridden = this.modifiedParts.get(path);
            zip.file(path, overridden ?? this.originalParts.get(path)!);
        }
        // Include any parts that exist only in modifiedParts (newly added).
        for (const [path, bytes] of this.modifiedParts) {
            if (!this.originalParts.has(path)) {
                zip.file(path, bytes);
            }
        }
        const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
        return out;
    }
}

/** Convenience entry point mirroring `JSON.parse` / `JSON.stringify` style. */
export function loadDocx(bytes: Buffer | Uint8Array): DocxFile {
    return DocxFile.load(bytes);
}

export function saveDocx(file: DocxFile): Buffer {
    return file.save();
}
