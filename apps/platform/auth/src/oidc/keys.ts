import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';

export interface JwkSet { keys: any[]; }

export async function generateJwkSet(): Promise<JwkSet> {
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.kid = await calculateJwkThumbprint(jwk);
  return { keys: [jwk] };
}

export async function loadJwkSet(
  path: string,
  opts: { autoGenerate?: boolean } = {},
): Promise<JwkSet> {
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as JwkSet;
  }
  if (!opts.autoGenerate) {
    throw new Error(`JWK set not found at ${path} and autoGenerate=false`);
  }
  const set = await generateJwkSet();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(set, null, 2), { mode: 0o600 });
  return set;
}
