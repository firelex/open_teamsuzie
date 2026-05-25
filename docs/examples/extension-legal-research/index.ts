// Per-build extension: legal-research
//
// Demonstrates the Tier-3 (build-specific) extension pattern described in
// open_teamsuzie/docs/COMPOSITION.md. The runtime auto-discovers this
// directory at boot (extensionsDir defaults to ./extensions next to
// agent.json) and registers the tools globally via the ToolRegistry, so
// the model can call them on every turn alongside the upstream tools.
//
// Provider-specific API keys come from environment variables. Providers
// that don't have a usable key configured silently drop out of the
// returned tool set (no error; the coverage description in the tool's
// system text just doesn't list them), so partial configuration is fine
// for local dev.

import type { Extension } from '@teamsuzie/agent-runtime/extensions';
import { buildLegalResearchTools } from './legal-research-tools.js';

const tools = buildLegalResearchTools({
  // US — CourtListener case law. Without a token, falls back to the
  // public unauth tier (rate-limited; OK for demo).
  courtListenerToken: process.env.COURTLISTENER_TOKEN,
  courtListenerBaseUrl: process.env.COURTLISTENER_BASE_URL,
  // FR — PISTE OAuth2 for Legifrance (legislation) + Judilibre (cases).
  pisteClientId: process.env.PISTE_CLIENT_ID,
  pisteClientSecret: process.env.PISTE_CLIENT_SECRET,
  judilibreApiKey: process.env.JUDILIBRE_API_KEY,
  // IN — Indian Kanoon. Without a key, the provider isn't registered.
  indianKanoonApiKey: process.env.INDIAN_KANOON_API_KEY,
});

export default {
  name: 'legal-research',
  version: '0.1.0',
  tools,
} satisfies Extension;
