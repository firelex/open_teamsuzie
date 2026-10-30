// Prints a new OIDC signing key set (JSON) for OIDC_SIGNING_KEY_PATH. In production the service won't generate one
// itself, because a lost key signs everyone out; make it once and keep it somewhere safe (e.g. Secret Manager).
import { generateJwkSet } from '../dist/oidc/keys.js';

process.stdout.write(JSON.stringify(await generateJwkSet(), null, 2) + '\n');
