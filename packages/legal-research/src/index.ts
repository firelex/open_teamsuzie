// packages/legal-research/src/index.ts
import type { Extension } from '@teamsuzie/agent-runtime/extensions';
import { buildLegalTools } from './tools.js';

// Static provider imports (key-free).
import { arInfoleg } from './providers/ar-infoleg.js';
import { atRis } from './providers/at-ris.js';
import { auFederalRegister } from './providers/au-federalregister.js';
import { beJustel } from './providers/be-justel.js';
import { brPlanalto } from './providers/br-planalto.js';
import { caJustice } from './providers/ca-justice.js';
import { chFedlex } from './providers/ch-fedlex.js';
import { coeHudoc } from './providers/coe-hudoc.js';
import { deGesetzeImInternet } from './providers/de-gesetze.js';
import { deOpenLegalData } from './providers/de-openlegaldata.js';
import { esBoe } from './providers/es-boe.js';
import { euCuria } from './providers/eu-curia.js';
import { euEurLex } from './providers/eu-eurlex.js';
import { ieStatuteBook } from './providers/ie-statutebook.js';
import { itNormattiva } from './providers/it-normattiva.js';
import { jpEGov } from './providers/jp-egov.js';
import { mxDof } from './providers/mx-dof.js';
import { nlRechtspraak } from './providers/nl-rechtspraak.js';
import { nlWetten } from './providers/nl-wetten.js';
import { ukFindCaseLaw } from './providers/uk-findcaselaw.js';
import { ukLegislation } from './providers/uk-legislation.js';
import { usCfr } from './providers/us-ecfr.js';

// Factory-based providers (API key / credentials required).
// buildUsCourtListener uses { token?, baseUrl? } — token is the Bearer token.
import { buildUsCourtListener } from './providers/us-courtlistener.js';
// buildFrLegifrance uses { clientId, clientSecret } — OAuth2 client credentials.
import { buildFrLegifrance } from './providers/fr-legifrance.js';
// buildFrJudilibre uses { apiKey }.
import { buildFrJudilibre } from './providers/fr-judilibre.js';
// buildInIndianKanoon uses { apiKey }.
import { buildInIndianKanoon } from './providers/in-indiankanoon.js';

export interface LegalResearchConfig {
  /** CourtListener Bearer token (optional — enables US case law via CourtListener). */
  courtListenerToken?: string;
  /** Légifrance OAuth2 client ID. */
  legifranceClientId?: string;
  /** Légifrance OAuth2 client secret. */
  legifranceClientSecret?: string;
  /** Judilibre API key. */
  judilibreApiKey?: string;
  /** Indian Kanoon API key. */
  indianKanoonApiKey?: string;
}

export function legalResearchExtension(config: LegalResearchConfig = {}): Extension {
  const providers = [
    arInfoleg, atRis, auFederalRegister, beJustel, brPlanalto, caJustice,
    chFedlex, coeHudoc, deGesetzeImInternet, deOpenLegalData, esBoe,
    euCuria, euEurLex, ieStatuteBook, itNormattiva, jpEGov, mxDof,
    nlRechtspraak, nlWetten, ukFindCaseLaw, ukLegislation, usCfr,
  ];

  if (config.courtListenerToken) {
    providers.push(buildUsCourtListener({ token: config.courtListenerToken }));
  }
  if (config.legifranceClientId && config.legifranceClientSecret) {
    providers.push(buildFrLegifrance({ clientId: config.legifranceClientId, clientSecret: config.legifranceClientSecret }));
  }
  if (config.judilibreApiKey) {
    providers.push(buildFrJudilibre({ apiKey: config.judilibreApiKey }));
  }
  if (config.indianKanoonApiKey) {
    providers.push(buildInIndianKanoon({ apiKey: config.indianKanoonApiKey }));
  }

  return {
    name: '@teamsuzie/legal-research',
    version: '0.1.0',
    tools: buildLegalTools(providers),
  };
}

export type { LegalProvider } from './types.js';
