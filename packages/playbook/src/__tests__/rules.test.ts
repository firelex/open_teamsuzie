import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import {
  draftRulesFromGuide,
  parseFinding,
  reviewAgainstRules,
  type PlaybookRule,
} from '../rules.js';
import { PLAYBOOK_MIGRATIONS, PlaybookStore } from '../store.js';

const rules: PlaybookRule[] = [
  { id: 'r1', title: 'Liability cap', standard: 'Cap at 12 months of fees.', fallback: 'Cap at 24 months of fees.' },
  { id: 'r2', title: 'Governing law', standard: 'English law.' },
  { id: 'r3', title: 'Confidentiality term', standard: 'At least 5 years.' },
];

const edit = { find: '36 months', replace: '12 months', context_before: 'shall not exceed the fees paid in the', context_after: 'preceding the claim' };

// Fake model: answers by the rule title found in the prompt.
const replies: Record<string, unknown> = {
  'Liability cap': { status: 'acceptable_fallback', excerpt: 'fees paid in the 24 months', explanation: 'Fallback.', edits: [edit] },
  'Governing law': { status: 'meets_standard', excerpt: 'laws of England', explanation: 'OK.', edits: [edit] },
  'Confidentiality term': { status: 'missing', excerpt: '', explanation: 'Absent.', edits: [{ ...edit, find: '' }] },
};
const fakeLlm = async (prompt: string): Promise<string> => {
  const title = Object.keys(replies).find((t) => prompt.includes(`TITLE: ${t}`))!;
  return '```json\n' + JSON.stringify(replies[title]) + '\n```';
};

describe('reviewAgainstRules', () => {
  it('returns findings in rule order and keeps edits only where the standard is not met', async () => {
    const seen: string[] = [];
    const out = await reviewAgainstRules({
      rules,
      contractText: 'contract',
      llm: fakeLlm,
      concurrency: 2,
      onFinding: (f) => seen.push(f.ruleId),
    });
    expect(out.map((f) => [f.ruleId, f.status, f.edits.length])).toEqual([
      ['r1', 'acceptable_fallback', 1],
      ['r2', 'meets_standard', 0],
      ['r3', 'missing', 1],
    ]);
    expect(seen.sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('drops fallback edits in lenient posture', async () => {
    const out = await reviewAgainstRules({ rules, contractText: 'c', llm: fakeLlm, posture: 'lenient' });
    expect(out[0]!.edits).toEqual([]);
    expect(out[2]!.edits.length).toBe(1);
  });

  it('rejects a reply with an invalid status instead of guessing', () => {
    expect(() => parseFinding(rules[0]!, '{"status":"fine"}')).toThrow(/invalid status/);
    expect(() => parseFinding(rules[0]!, 'no json here')).toThrow(/no JSON object/);
  });
});

describe('draftRulesFromGuide', () => {
  it('keeps rules with a title and standard and normalises empty fields to null', async () => {
    const llm = async () =>
      JSON.stringify({
        rules: [
          { title: 'Cap', standard: '12 months', fallback: '', unacceptable: 'Uncapped', guidance: null },
          { title: 'No standard' },
        ],
      });
    expect(await draftRulesFromGuide('guide', llm)).toEqual([
      { title: 'Cap', standard: '12 months', fallback: null, unacceptable: 'Uncapped', guidance: null, sampleClause: null },
    ]);
  });
});

describe('PlaybookStore', () => {
  function store() {
    return new PlaybookStore({ db: openDb({ path: ':memory:', migrations: PLAYBOOK_MIGRATIONS }) });
  }

  it('creates, reorders, scopes by owner and deletes', () => {
    const s = store();
    const pb = s.create('alice', {
      name: 'NDA playbook',
      rules: [
        { title: 'A', standard: 'a' },
        { title: 'B', standard: 'b', fallback: '  ' },
      ],
    });
    expect(pb.rules.map((r) => r.title)).toEqual(['A', 'B']);
    expect(pb.rules[1]!.fallback).toBeNull();
    expect(s.get(pb.id, 'bob')).toBeNull();
    expect(s.list('alice')[0]!.ruleCount).toBe(2);

    const [ruleA, ruleB] = pb.rules;
    const updated = s.update(pb.id, 'alice', {
      name: 'NDA v2',
      rules: [{ id: ruleB!.id, title: 'B', standard: 'b' }, { id: 'foreign-id', title: 'A', standard: 'a' }],
    })!;
    expect(updated.rules.map((r) => r.title)).toEqual(['B', 'A']);
    expect(updated.rules[0]!.id).toBe(ruleB!.id);
    expect(updated.rules[1]!.id).not.toBe('foreign-id');
    expect(updated.rules[1]!.id).not.toBe(ruleA!.id);
    expect(s.update(pb.id, 'bob', { name: 'x', rules: [] })).toBeNull();
    expect(() => s.create('alice', { name: 'Bad', rules: [{ title: 'No standard', standard: ' ' }] })).toThrow(/standard/);

    expect(s.delete(pb.id, 'bob')).toBe(false);
    expect(s.delete(pb.id, 'alice')).toBe(true);
    expect(s.list('alice')).toEqual([]);
  });

  it('records runs and fails runs interrupted by a restart', () => {
    const s = store();
    const pb = s.create('alice', { name: 'P', rules: [{ title: 'A', standard: 'a' }] });
    const run = s.startRun({ playbook: pb, ownerId: 'alice', workspaceId: 'm1', documentId: 'd1', documentName: 'NDA.docx' });
    expect(run.status).toBe('running');
    const done = s.finishRun(run.id, {
      findings: [{ ruleId: 'x', ruleTitle: 'A', status: 'meets_standard', excerpt: '', explanation: '', edits: [] }],
      redlineDocId: null,
    });
    expect(done.status).toBe('succeeded');
    expect(done.findings![0]!.status).toBe('meets_standard');
    const stuck = s.startRun({ playbook: pb, ownerId: 'alice', workspaceId: 'm1', documentId: 'd2', documentName: 'B.docx' });
    expect(s.failInterruptedRuns()).toBe(1);
    expect(s.getRun(stuck.id)!.status).toBe('failed');
    expect(s.listRuns('m1').length).toBe(2);
    expect(s.deleteRun(stuck.id)).toBe(true);
    expect(s.listRuns('m1').length).toBe(1);
  });
});
