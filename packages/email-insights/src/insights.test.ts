import { describe, expect, it } from 'vitest';
import { InsightError, summariseThread, threadIssues, type InsightModel, type InsightThread } from './index.js';

/** A model that answers from a script and remembers what it was asked. */
function scripted(...replies: unknown[]): InsightModel & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    calls,
    async json(system: string, user: string) {
      calls.push({ system, user });
      if (replies.length === 0) throw new Error('scripted model: no reply left');
      return replies.shift();
    },
  };
}

const thread: InsightThread = {
  subject: 'SPA: liability cap',
  messages: [
    { id: 'm1', from: 'anna@sterlingrowe.com', sentAt: '2026-09-20T09:00:00Z', text: 'We propose a cap of 30% of price and a 24-month claims period.', quotedFrom: null },
    { id: 'm2', from: 'me@firm.com', sentAt: '2026-09-21T09:00:00Z', text: 'We can accept 24 months but not 30%.\n\nOn Sun, Anna wrote:\n> SECRET-QUOTED-HISTORY', quotedFrom: 38 },
  ],
};

const good = { summary: 'They propose a 30% cap; we accepted 24 months but not the cap.', short: 'Cap still open at 30%', asks: 'reply_needed' };

describe('summariseThread', () => {
  it('returns a valid summary as given', async () => {
    const model = scripted(good);
    expect(await summariseThread(model, thread)).toEqual(good);
    expect(model.calls).toHaveLength(1);
  });

  it('sends a short form over 40 characters back once, with the reason', async () => {
    const model = scripted({ ...good, short: 'x'.repeat(41) }, good);
    expect(await summariseThread(model, thread)).toEqual(good);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.user).toContain('short');
    expect(model.calls[1]!.user).toContain('40');
  });

  it('fails loudly with the reason when an unknown kind of ask comes back twice', async () => {
    const model = scripted({ ...good, asks: 'urgent' }, { ...good, asks: 'urgent' });
    const err = await summariseThread(model, thread).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsightError);
    expect((err as InsightError).message).toContain('asks');
  });

  it('never shows the model the quoted history', async () => {
    const model = scripted(good);
    await summariseThread(model, thread);
    expect(model.calls[0]!.user).not.toContain('SECRET-QUOTED-HISTORY');
    expect(model.calls[0]!.user).toContain('We can accept 24 months but not 30%.');
  });

  it('explains the task in plain words, including who "they" are', async () => {
    const model = scripted(good);
    await summariseThread(model, thread);
    expect(model.calls[0]!.system).toMatch(/the other side/i);
    expect(model.calls[0]!.system).toContain('reply_needed');
  });
});

describe('threadIssues', () => {
  const issues = { issues: [
    { issue: 'Liability cap: they want 30% of price; we have not agreed.', short: 'Cap: 30% not agreed', status: 'open', sources: ['m1', 'm2'] },
    { issue: 'Claims period agreed at 24 months.', short: 'Claims period: 24 months', status: 'agreed', sources: ['m2'] },
  ] };

  it('returns the issues with their sources', async () => {
    expect(await threadIssues(scripted(issues), thread)).toEqual(issues.issues);
  });

  it('sends an issue citing a message that is not in the conversation back once', async () => {
    const bad = { issues: [{ ...issues.issues[0]!, sources: ['m99'] }] };
    const model = scripted(bad, issues);
    expect(await threadIssues(model, thread)).toEqual(issues.issues);
    expect(model.calls[1]!.user).toContain('m99');
  });

  it('allows at most eight issues', async () => {
    const many = { issues: Array.from({ length: 9 }, () => issues.issues[1]!) };
    await expect(threadIssues(scripted(many, many), thread)).rejects.toBeInstanceOf(InsightError);
  });
});
