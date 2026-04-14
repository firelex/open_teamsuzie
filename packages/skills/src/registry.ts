import fs from 'node:fs';
import path from 'node:path';
import { interpolate } from './interpolate.js';
import type { SkillFile, SkillInfo, SkillRenderContext, SkillTarget } from './types.js';

function parseFrontmatter(content: string): { name: string; description: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { name: '', description: '' };
    const frontmatter = match[1];
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
    return { name, description };
}

function isSafeSkillName(skillName: string): boolean {
    // No path traversal, no separators, no empties.
    if (!skillName || skillName.length > 100) return false;
    if (skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) return false;
    return /^[a-zA-Z0-9_-]+$/.test(skillName);
}

export interface SkillRegistryOptions {
    /** Directory containing skill subdirectories (each with a SKILL.md) */
    skillsDir: string;
}

/**
 * Headless skill runtime. Discovers skills on disk, reads their metadata,
 * renders their templates, and hands rendered files off to a pluggable target.
 *
 * No DB, no container orchestration, no agent-model coupling — the target
 * abstraction is how those concerns plug in from outside this package.
 */
export class SkillRegistry {
    private readonly skillsDir: string;

    constructor(opts: SkillRegistryOptions) {
        this.skillsDir = opts.skillsDir;
    }

    /** List every skill directory under skillsDir that contains a SKILL.md. */
    listSkills(): SkillInfo[] {
        if (!fs.existsSync(this.skillsDir)) return [];

        const dirs = fs.readdirSync(this.skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        const skills: SkillInfo[] = [];
        for (const skillName of dirs) {
            const skillFile = path.join(this.skillsDir, skillName, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            const content = fs.readFileSync(skillFile, 'utf-8');
            const { name, description } = parseFrontmatter(content);
            skills.push({ skillName, name: name || skillName, description });
        }
        return skills;
    }

    /** Return the raw SKILL.md text for a skill, or null if not found. */
    getSkill(skillName: string): string | null {
        if (!isSafeSkillName(skillName)) return null;
        const skillFile = path.join(this.skillsDir, skillName, 'SKILL.md');
        if (!fs.existsSync(skillFile)) return null;
        return fs.readFileSync(skillFile, 'utf-8');
    }

    /**
     * Render a skill's SKILL.md with placeholders substituted from `context`.
     * Returns null if the skill doesn't exist.
     */
    renderSkill(skillName: string, context: SkillRenderContext): SkillFile | null {
        const raw = this.getSkill(skillName);
        if (raw === null) return null;
        return {
            file_path: `skills/${skillName}/SKILL.md`,
            content: interpolate(raw, context),
            content_type: 'markdown',
        };
    }

    /**
     * Render every requested skill (or all discovered skills if `skillNames` is omitted)
     * and hand the rendered files to the target.
     *
     * Returns the list of skills that were successfully applied.
     */
    async applySkills(
        subjectId: string,
        context: SkillRenderContext,
        target: SkillTarget,
        skillNames?: string[],
    ): Promise<string[]> {
        const available = this.listSkills().map(s => s.skillName);
        const requested = skillNames ? skillNames.filter(n => available.includes(n)) : available;

        const files: SkillFile[] = [];
        for (const skillName of requested) {
            const rendered = this.renderSkill(skillName, context);
            if (rendered) files.push(rendered);
        }

        if (files.length > 0) {
            await target.apply(subjectId, files);
        }
        return requested;
    }
}
