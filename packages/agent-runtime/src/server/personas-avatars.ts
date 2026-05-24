import express, { type Router } from 'express';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const IMAGE_RE = /\.(webp|png|jpg|jpeg)$/i;

export function createAvatarsRouter(opts: { publicDir: string }): Router {
  const router = express.Router();
  router.get('/', (_req, res) => {
    const root = path.join(opts.publicDir, 'avatars');
    const out: string[] = [];
    try {
      for (const entry of readdirSync(root)) {
        const entryPath = path.join(root, entry);
        if (statSync(entryPath).isDirectory()) {
          // Bucketed layout: avatars/<bucket>/<file>
          for (const file of readdirSync(entryPath)) {
            if (IMAGE_RE.test(file)) {
              out.push(`/avatars/${entry}/${file}`);
            }
          }
        } else if (IMAGE_RE.test(entry)) {
          // Flat layout: avatars/<file>
          out.push(`/avatars/${entry}`);
        }
      }
    } catch { /* publicDir missing — return empty */ }
    res.json({ items: out });
  });
  return router;
}
