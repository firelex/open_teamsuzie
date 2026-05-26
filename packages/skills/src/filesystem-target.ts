import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkillFile, SkillTarget } from './types.js';

export interface FilesystemSkillTargetOptions {
    /**
     * Root directory where rendered skill files land. The target will create
     * a subdirectory per subjectId (agent id, workspace id, etc.) unless
     * `partitionBySubject` is set to false.
     */
    rootDir: string;
    partitionBySubject?: boolean;
}

/**
 * Simple target that writes rendered skill files to disk. Useful for local
 * development, the demo app, and as a reference implementation of SkillTarget.
 *
 * DB-backed targets (e.g., upserting into AgentWorkspaceFile) live in the
 * application that owns the agent model — not in this package.
 */
export class FilesystemSkillTarget implements SkillTarget {
    private readonly rootDir: string;
    private readonly partitionBySubject: boolean;

    constructor(opts: FilesystemSkillTargetOptions) {
        this.rootDir = opts.rootDir;
        this.partitionBySubject = opts.partitionBySubject ?? true;
    }

    private assertSafeSubjectId(subjectId: string): void {
        // subjectId is partitioned into the path before filePath is joined.
        // A subjectId like '../other' makes the per-subject "base" itself
        // escape rootDir, and the later filePath check still passes because
        // it's relative to the (already-escaped) base. Validate up-front.
        if (!subjectId || subjectId === '.' || subjectId === '..') {
            throw new Error(`Invalid subjectId: ${JSON.stringify(subjectId)}`);
        }
        if (subjectId.includes('/') || subjectId.includes('\\') || subjectId.includes('\0')) {
            throw new Error(`Invalid subjectId (path separators not allowed): ${JSON.stringify(subjectId)}`);
        }
    }

    private resolve(subjectId: string, filePath: string): string {
        if (this.partitionBySubject) {
            this.assertSafeSubjectId(subjectId);
        }
        const base = this.partitionBySubject ? path.join(this.rootDir, subjectId) : this.rootDir;
        const abs = path.join(base, filePath);
        // Guard against path traversal via filePath. Belt-and-suspenders with
        // the subjectId check above: even if the subject guard ever regresses,
        // this still prevents escapes via filePath.
        const normalizedRoot = path.resolve(this.rootDir);
        const normalizedBase = path.resolve(base);
        const normalizedAbs = path.resolve(abs);
        if (!normalizedBase.startsWith(normalizedRoot + path.sep) && normalizedBase !== normalizedRoot) {
            throw new Error(`Refusing to write outside target root via subjectId: ${subjectId}`);
        }
        if (!normalizedAbs.startsWith(normalizedBase + path.sep) && normalizedAbs !== normalizedBase) {
            throw new Error(`Refusing to write outside target root: ${filePath}`);
        }
        return abs;
    }

    async apply(subjectId: string, files: SkillFile[]): Promise<void> {
        for (const file of files) {
            const abs = this.resolve(subjectId, file.file_path);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, file.content, 'utf-8');
        }
    }

    async remove(subjectId: string, filePaths: string[]): Promise<void> {
        for (const filePath of filePaths) {
            const abs = this.resolve(subjectId, filePath);
            await fs.rm(abs, { force: true });
        }
    }
}
