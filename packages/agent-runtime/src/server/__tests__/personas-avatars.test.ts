import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import request from 'supertest';
import { createAvatarsRouter } from '../personas-avatars.js';

describe('GET /api/personas/avatars', () => {
  it('lists webp/png files under each bucket', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'avs-'));
    mkdirSync(path.join(root, 'avatars', 'female'), { recursive: true });
    mkdirSync(path.join(root, 'avatars', 'male'), { recursive: true });
    writeFileSync(path.join(root, 'avatars', 'female', '1.webp'), '');
    writeFileSync(path.join(root, 'avatars', 'male', '7.png'), '');
    writeFileSync(path.join(root, 'avatars', 'female', 'readme.txt'), 'ignored');
    const app = express();
    app.use('/api/personas/avatars', createAvatarsRouter({ publicDir: root }));
    const res = await request(app).get('/api/personas/avatars');
    expect(res.status).toBe(200);
    expect(res.body.items.sort()).toEqual([
      '/avatars/female/1.webp',
      '/avatars/male/7.png',
    ]);
  });

  it('returns empty when avatars dir missing', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'avs-empty-'));
    const app = express();
    app.use('/api/personas/avatars', createAvatarsRouter({ publicDir: root }));
    const res = await request(app).get('/api/personas/avatars');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('ignores non-image files and non-directory entries', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'avs-mixed-'));
    mkdirSync(path.join(root, 'avatars', 'icons'), { recursive: true });
    writeFileSync(path.join(root, 'avatars', 'icons', 'a.jpg'), '');
    writeFileSync(path.join(root, 'avatars', 'icons', 'b.jpeg'), '');
    writeFileSync(path.join(root, 'avatars', 'icons', 'c.svg'), '');
    writeFileSync(path.join(root, 'avatars', 'icons', 'd.gif'), '');
    // a loose file at the bucket level (not a dir) — should be skipped
    writeFileSync(path.join(root, 'avatars', 'loose.png'), '');
    const app = express();
    app.use('/api/personas/avatars', createAvatarsRouter({ publicDir: root }));
    const res = await request(app).get('/api/personas/avatars');
    expect(res.status).toBe(200);
    expect(res.body.items.sort()).toEqual([
      '/avatars/icons/a.jpg',
      '/avatars/icons/b.jpeg',
    ]);
  });
});
