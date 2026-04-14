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

    private resolve(subjectId: string, filePath: string): string {
        const base = this.partitionBySubject ? path.join(this.rootDir, subjectId) : this.rootDir;
        const abs = path.join(base, filePath);
        // Guard against path traversal via filePath.
        const normalizedBase = path.resolve(base);
        const normalizedAbs = path.resolve(abs);
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
