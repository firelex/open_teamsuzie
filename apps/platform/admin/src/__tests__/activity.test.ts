import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type supertest from 'supertest';
import { Agent } from '@teamsuzie/shared-auth';
import { setupTestApp, type TestApp } from './setup.js';

describe('Phase 7 — activity', () => {
  let harness: TestApp;
  let authed: supertest.Agent;

  beforeAll(async () => {
    harness = await setupTestApp();
    authed = await harness.loginAsAdmin();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('requires auth', async () => {
    await harness.request.get('/api/activity').expect(401);
  });

  it('surfaces audit_log rows written by earlier phases', async () => {
    // Drive some audit-log writes across a few surfaces.
    const agent = await authed
      .post('/api/agents')
      .send({ name: 'Activiteer', config: { baseUrl: 'http://localhost:18789' } })
      .expect(201);
    const agentId = agent.body.agent.id;

    await authed
      .put('/api/config/values/chat.default_model')
      .send({ scope: 'global', value: 'gpt-4.1-mini' })
      .expect(200);

    const proposed = await authed
      .post('/api/approvals')
      .send({ action_type: 'agent.action', payload: { noop: true } })
      .expect(201);
    await authed
      .post(`/api/approvals/${proposed.body.item.id}/review`)
      .send({ verdict: 'approve' })
      .expect(200);

    await authed
      .post('/api/agent-keys')
      .send({ agent_id: agentId, name: 'activity-key' })
      .expect(201);

    const response = await authed.get('/api/activity?limit=20').expect(200);
    const actions = response.body.items.map((r: { action: string }) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'config.update',
        'approval.propose',
        'approval.approve',
        'api_key.create',
      ]),
    );
    expect(response.body.total).toBeGreaterThanOrEqual(response.body.items.length);
  });

  it('enriches actor_label with the user email for user-lane rows', async () => {
    const response = await authed.get('/api/activity?actor_type=user&limit=5').expect(200);
    const firstWithActor = response.body.items.find((r: { actor_id: string | null }) => r.actor_id);
    expect(firstWithActor).toBeDefined();
    expect(firstWithActor.actor_label).toBe('admin@example.com');
  });

  it('filters by action_prefix', async () => {
    const response = await authed.get('/api/activity?action_prefix=approval.&limit=10').expect(200);
    for (const row of response.body.items) {
      expect(row.action.startsWith('approval.')).toBe(true);
    }
    expect(response.body.items.length).toBeGreaterThan(0);
  });

  it('supports limit + offset pagination', async () => {
    const page1 = await authed.get('/api/activity?limit=3&offset=0').expect(200);
    const page2 = await authed.get('/api/activity?limit=3&offset=3').expect(200);
    expect(page1.body.items.length).toBeGreaterThan(0);
    const ids1 = new Set(page1.body.items.map((r: { id: string }) => r.id));
    for (const row of page2.body.items) {
      expect(ids1.has(row.id)).toBe(false);
    }
  });

  it('recent-agents reflects Agent.last_active_at ordering', async () => {
    // Simulate a chat hit by bumping last_active_at directly — same code path
    // ChatProxyService uses. Avoids needing a live OpenClaw backend in tests.
    const rows = await authed.get('/api/agents').expect(200);
    const agentId = rows.body.items[0].id;
    await Agent.update({ last_active_at: new Date() }, { where: { id: agentId } });

    const response = await authed.get('/api/activity/recent-agents?limit=5').expect(200);
    expect(response.body.items.length).toBeGreaterThanOrEqual(1);
    expect(response.body.items[0].id).toBe(agentId);
    expect(response.body.items[0].last_active_at).not.toBeNull();
  });
});
