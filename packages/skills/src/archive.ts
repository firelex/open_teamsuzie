import AdmZip from 'adm-zip';
import { extname } from 'node:path';

/**
 * A `.skill` (or `.plugin`) file as distributed by Claude / Claude Code is a
 * plain zip archive containing one top-level directory: `<skill-name>/SKILL.md`
 * plus optional `references/`, `scripts/`, `assets/`, etc. This module decodes
 * that bundle in-memory so an agent can read the SKILL.md and any reference
 * markdown without first writing the archive to disk.
 */

const TEXTUAL_EXT = new Set([
    '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv',
    '.html', '.htm', '.xml', '.log', '.toml', '.ini',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go',
    '.java', '.kt', '.rs', '.swift', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.sql', '.css', '.scss', '.less',
]);

export interface SkillArchiveEntry {
    /** Path inside the archive, including the top-level skill directory. */
    path: string;
    size: number;
    /** Decoded text for entries with a textual extension; otherwise omitted. */
    text?: string;
    /** True when the entry was skipped because it's binary. */
    binary?: true;
}

export interface DecodedSkillArchive {
    /** Top-level directory name in the archive (e.g. "blixt-deal-screening"). */
    skillName: string | null;
    /** Contents of `<skillName>/SKILL.md`, or null when missing. */
    skillMd: string | null;
    /** Every file in the archive (text inlined for readable formats). */
    entries: SkillArchiveEntry[];
}

const MAX_TEXT_BYTES = 256 * 1024;

/**
 * Decode a `.skill` / `.plugin` archive given its bytes. Inlines text entries
 * up to {@link MAX_TEXT_BYTES} each; reports everything else as `binary: true`
 * so callers can decide whether to fetch them on demand.
 */
export function decodeSkillArchive(bytes: Buffer | Uint8Array): DecodedSkillArchive {
    const zip = new AdmZip(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    const entries: SkillArchiveEntry[] = [];
    let skillName: string | null = null;
    let skillMd: string | null = null;

    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const path = entry.entryName.replace(/^\.\//, '');
        const top = path.split('/')[0];
        if (!skillName && top && !path.startsWith('__MACOSX')) skillName = top;

        const ext = extname(path).toLowerCase();
        const size = entry.header.size;
        if (path.startsWith('__MACOSX/')) continue; // macOS metadata; ignore

        if (TEXTUAL_EXT.has(ext)) {
            const raw = entry.getData();
            const text = raw.slice(0, MAX_TEXT_BYTES).toString('utf8');
            entries.push({ path, size, text });
            if (!skillMd && /(^|\/)SKILL\.md$/i.test(path)) skillMd = text;
        } else {
            entries.push({ path, size, binary: true });
        }
    }

    return { skillName, skillMd, entries };
}

/**
 * Convenience renderer: concatenates the SKILL.md plus every textual
 * reference entry into one markdown blob, with H2 separators. Useful when
 * feeding the whole bundle into an LLM as a single document.
 */
export function renderSkillArchiveAsMarkdown(decoded: DecodedSkillArchive): string {
    const parts: string[] = [];
    if (decoded.skillName) parts.push(`# Skill bundle: ${decoded.skillName}\n`);
    if (decoded.skillMd) {
        parts.push(`## SKILL.md\n\n${decoded.skillMd.trim()}\n`);
    }
    for (const entry of decoded.entries) {
        if (!entry.text || /(^|\/)SKILL\.md$/i.test(entry.path)) continue;
        parts.push(`## ${entry.path}\n\n${entry.text.trim()}\n`);
    }
    const binaries = decoded.entries.filter((e) => e.binary);
    if (binaries.length) {
        parts.push(`## Binary entries (not inlined)\n`);
        for (const b of binaries) parts.push(`- ${b.path} (${b.size} bytes)`);
    }
    return parts.join('\n').trim() + '\n';
}
