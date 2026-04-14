import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillRegistry, FilesystemSkillTarget, interpolate } from '../index.js';

let tmpDir: string;
let skillsDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsuzie-skills-'));
    skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSkill(name: string, content: string): void {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

describe('interpolate', () => {
    it('replaces simple placeholders', () => {
        expect(interpolate('Hello {{NAME}}!', { NAME: 'world' })).toBe('Hello world!');
    });

    it('replaces markdown-escaped placeholders', () => {
        expect(interpolate('Call {{AGENT\\_API\\_KEY}} here', { AGENT_API_KEY: 'abc' }))
            .toBe('Call abc here');
    });

    it('leaves placeholders untouched when the context has no matching key', () => {
        // The caller controls which keys are available. Unknown placeholders
        // stay visible so missing context is obvious in the rendered output.
        expect(interpolate('X={{FOO}}Y', {})).toBe('X={{FOO}}Y');
    });

    it('renders explicitly-undefined values as empty strings', () => {
        expect(interpolate('X={{FOO}}Y', { FOO: undefined })).toBe('X=Y');
    });
});

describe('SkillRegistry', () => {
    it('lists skills parsed from frontmatter', () => {
        writeSkill('alpha', '---\nname: Alpha\ndescription: An alpha skill\n---\n\nBody');
        writeSkill('beta', '---\nname: Beta\ndescription: A beta skill\n---\n\nBody');
        const registry = new SkillRegistry({ skillsDir });
        const skills = registry.listSkills().sort((a, b) => a.skillName.localeCompare(b.skillName));
        expect(skills).toEqual([
            { skillName: 'alpha', name: 'Alpha', description: 'An alpha skill' },
            { skillName: 'beta', name: 'Beta', description: 'A beta skill' },
        ]);
    });

    it('falls back to dir name when frontmatter is missing', () => {
        writeSkill('bare', '# No frontmatter here');
        const registry = new SkillRegistry({ skillsDir });
        expect(registry.listSkills()).toEqual([{ skillName: 'bare', name: 'bare', description: '' }]);
    });

    it('returns null for unknown skills', () => {
        const registry = new SkillRegistry({ skillsDir });
        expect(registry.getSkill('nope')).toBeNull();
        expect(registry.renderSkill('nope', {})).toBeNull();
    });

    it('rejects path-traversal skill names', () => {
        const registry = new SkillRegistry({ skillsDir });
        expect(registry.getSkill('../etc/passwd')).toBeNull();
        expect(registry.getSkill('a/b')).toBeNull();
    });

    it('renders with placeholder substitution', () => {
        writeSkill('hello', '---\nname: hello\ndescription: test\n---\nHi {{AGENT_NAME}}');
        const registry = new SkillRegistry({ skillsDir });
        const rendered = registry.renderSkill('hello', { AGENT_NAME: 'Suzie' });
        expect(rendered?.file_path).toBe('skills/hello/SKILL.md');
        expect(rendered?.content).toContain('Hi Suzie');
    });
});

describe('FilesystemSkillTarget', () => {
    it('writes rendered files under subjectId', async () => {
        writeSkill('hello', '---\nname: hello\ndescription: test\n---\nHi {{AGENT_NAME}}');
        const registry = new SkillRegistry({ skillsDir });
        const outDir = path.join(tmpDir, 'out');
        const target = new FilesystemSkillTarget({ rootDir: outDir });

        const applied = await registry.applySkills('agent-1', { AGENT_NAME: 'Suzie' }, target);
        expect(applied).toEqual(['hello']);

        const written = await fsp.readFile(path.join(outDir, 'agent-1', 'skills/hello/SKILL.md'), 'utf-8');
        expect(written).toContain('Hi Suzie');
    });

    it('rejects path traversal in file_path', async () => {
        const target = new FilesystemSkillTarget({ rootDir: path.join(tmpDir, 'out') });
        await expect(
            target.apply('agent-1', [{ file_path: '../escape.md', content: 'x', content_type: 'markdown' }])
        ).rejects.toThrow(/outside target root/);
    });
});
