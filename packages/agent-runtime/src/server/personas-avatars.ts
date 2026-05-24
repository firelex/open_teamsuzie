import express, { type Router } from 'express';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function createAvatarsRouter(opts: { publicDir: string }): Router {
  const router = express.Router();
  router.get('/', (_req, res) => {
    const root = path.join(opts.publicDir, 'avatars');
    const out: string[] = [];
    try {
      for (const bucket of readdirSync(root)) {
        const b = path.join(root, bucket);
        if (!statSync(b).isDirectory()) continue;
        for (const file of readdirSync(b)) {
          if (/\.(webp|png|jpg|jpeg)$/i.test(file)) {
            out.push(`/avatars/${bucket}/${file}`);
          }
        }
      }
    } catch { /* publicDir missing — return empty */ }
    res.json({ items: out });
  });
  return router;
}
