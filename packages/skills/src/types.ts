/**
 * A skill is a named, versioned, installable capability packaged as a directory.
 * The directory contains a SKILL.md (instructions the agent reads) and optional
 * support files. The runtime discovers, renders, and hands skills off to a
 * pluggable target (e.g. a DB-backed workspace, a filesystem).
 */

export interface SkillInfo {
    /** Directory name — the canonical id */
    skillName: string;
    /** Display name from frontmatter, or falls back to skillName */
    name: string;
    /** Short description from frontmatter */
    description: string;
}

export interface SkillFile {
    /** Path relative to the target root (e.g. "skills/hello-world/SKILL.md") */
    file_path: string;
    /** Rendered contents (placeholders substituted) */
    content: string;
    content_type: 'markdown' | 'json' | 'yaml' | 'text';
}

/**
 * Values used to fill {{PLACEHOLDER}} tokens in skill templates.
 * The runtime does not prescribe which keys must be present — callers supply
 * whatever their skills reference. Missing keys render as empty strings by default.
 */
export type SkillRenderContext = Record<string, string | undefined>;

/**
 * A skill target receives rendered skill files and decides what to do with them.
 *
 * Implementations:
 *  - FilesystemSkillTarget (in this package): writes to a directory on disk.
 *  - Admin-app DB target (not in OSS core): upserts into AgentWorkspaceFile.
 *  - Custom: publish to a message bus, push into a git repo, etc.
 */
export interface SkillTarget {
    /** Apply one or more rendered files for a given agent / subject. */
    apply(subjectId: string, files: SkillFile[]): Promise<void>;
    /** Remove previously applied files for a given agent / subject. */
    remove?(subjectId: string, filePaths: string[]): Promise<void>;
}
