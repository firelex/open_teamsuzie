// Per-jurisdiction integration tests for the unified legal-research surface.
//
// These hit live public APIs. They're skipped unless
//   LEGAL_RESEARCH_INTEGRATION=1 pnpm test
// because the regular test run shouldn't depend on the network or on
// slow upstream services.
//
// FR providers additionally need PISTE creds (SUZIELAW_PISTE_*,
// SUZIELAW_JUDILIBRE_API_KEY) and are skipped when those are absent.

import { describe, it, expect } from 'vitest';
import { arInfoleg } from '../providers/ar-infoleg.js';
import { buildUsCourtListener } from '../providers/us-courtlistener.js';
import { euEurLex } from '../providers/eu-eurlex.js';
import { euCuria } from '../providers/eu-curia.js';
import { buildFrLegifrance } from '../providers/fr-legifrance.js';
import { buildFrJudilibre } from '../providers/fr-judilibre.js';
import { esBoe } from '../providers/es-boe.js';
import { itNormattiva } from '../providers/it-normattiva.js';
import { ukLegislation } from '../providers/uk-legislation.js';
import { ukFindCaseLaw } from '../providers/uk-findcaselaw.js';
import { deOpenLegalData } from '../providers/de-openlegaldata.js';
import { deGesetzeImInternet } from '../providers/de-gesetze.js';
import { atRis } from '../providers/at-ris.js';
import { chFedlex } from '../providers/ch-fedlex.js';
import { coeHudoc } from '../providers/coe-hudoc.js';
import { usCfr } from '../providers/us-ecfr.js';
import { brPlanalto } from '../providers/br-planalto.js';
import { buildInIndianKanoon } from '../providers/in-indiankanoon.js';
import { auFederalRegister } from '../providers/au-federalregister.js';
import { nlWetten } from '../providers/nl-wetten.js';
import { nlRechtspraak } from '../providers/nl-rechtspraak.js';
import { ieStatuteBook } from '../providers/ie-statutebook.js';
import { caJustice } from '../providers/ca-justice.js';
import { beJustel } from '../providers/be-justel.js';
import { jpEGov } from '../providers/jp-egov.js';
import { mxDof } from '../providers/mx-dof.js';

const RUN = process.env.LEGAL_RESEARCH_INTEGRATION === '1';
const TEST_TIMEOUT = 60_000;

function expectHit(hit: unknown, expectedSource: string, expectedJurisdiction: string): void {
  const h = hit as Record<string, unknown>;
  expect(h.source_id).toBe(expectedSource);
  expect(h.jurisdiction).toBe(expectedJurisdiction);
  expect(typeof h.doc_id).toBe('string');
  expect((h.doc_id as string).length).toBeGreaterThan(0);
  expect(typeof h.title).toBe('string');
  expect(typeof h.url).toBe('string');
}

// -----------------------------------------------------------------------------
// AR / InfoLEG
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('AR/InfoLEG', () => {
  it('searches for Ley 19550 (Sociedades Comerciales)', async () => {
    const r = await arInfoleg.search({ query: 'sociedades 19550', type: 'legislation' });
    expect(r.source_id).toBe('AR/InfoLEG');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'AR/InfoLEG', 'AR');
  }, TEST_TIMEOUT);

  it('fetches the consolidated text for a found norm and finds an article by keyword', async () => {
    const search = await arInfoleg.search({ query: 'sociedades 19550', type: 'legislation' });
    const docId = search.results[0]?.doc_id;
    expect(docId).toBeTruthy();

    const doc = await arInfoleg.getDocument({ doc_id: docId!, truncate: false });
    expect(doc.text.length).toBeGreaterThan(500);
    expect(doc.source_id).toBe('AR/InfoLEG');

    const found = await arInfoleg.findInDocument!({ doc_id: docId!, keyword: 'sociedad', max_articles: 3 });
    expect(found.matches.length).toBeGreaterThan(0);
    expect(found.matches[0].article_number).toBeTruthy();
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// US / CourtListener
// -----------------------------------------------------------------------------
const HAS_COURTLISTENER_TOKEN = !!process.env.SUZIELAW_COURTLISTENER_TOKEN;
describe.skipIf(!RUN)('US/CourtListener', () => {
  const provider = buildUsCourtListener({ token: process.env.SUZIELAW_COURTLISTENER_TOKEN });

  it('searches for Miranda opinions', async () => {
    const r = await provider.search({ query: 'Miranda warning', type: 'case_law' });
    expect(r.source_id).toBe('US/CourtListener');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'US/CourtListener', 'US');
    expect(r.results[0].type).toBe('case_law');
  }, TEST_TIMEOUT);

  // CourtListener now requires a token to fetch /opinions/{id}/. Skip when no token.
  it.skipIf(!HAS_COURTLISTENER_TOKEN)('fetches an opinion by id from a search hit', async () => {
    const r = await provider.search({ query: 'Miranda warning', type: 'case_law' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await provider.getDocument({ doc_id: docId! });
    expect(doc.source_id).toBe('US/CourtListener');
    expect(doc.text.length).toBeGreaterThan(50);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// EU / EUR-Lex
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('EU/EUR-Lex', () => {
  it('searches for GDPR-related legislation', async () => {
    const r = await euEurLex.search({ query: 'general data protection', type: 'legislation' });
    expect(r.source_id).toBe('EU/EUR-Lex');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'EU/EUR-Lex', 'EU');
  }, TEST_TIMEOUT);

  it('fetches the GDPR text by CELEX', async () => {
    const doc = await euEurLex.getDocument({ doc_id: '32016R0679', truncate: true, max_chars: 5000 });
    expect(doc.source_id).toBe('EU/EUR-Lex');
    expect(doc.text.length).toBeGreaterThan(200);
    expect(doc.url).toContain('CELEX:32016R0679');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// EU / CURIA (CJEU)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('EU/CURIA', () => {
  it('searches for CJEU competition rulings', async () => {
    const r = await euCuria.search({ query: 'competition', type: 'case_law' });
    expect(r.source_id).toBe('EU/CURIA');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'EU/CURIA', 'EU');
    // CURIA hits are CELEX sector 6 (case law)
    expect((r.results[0].doc_id as string).startsWith('6')).toBe(true);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// FR / Légifrance — needs PISTE creds
// -----------------------------------------------------------------------------
const HAS_PISTE = !!(process.env.SUZIELAW_PISTE_CLIENT_ID && process.env.SUZIELAW_PISTE_CLIENT_SECRET);
describe.skipIf(!RUN || !HAS_PISTE)('FR/Legifrance', () => {
  const provider = buildFrLegifrance({
    clientId: process.env.SUZIELAW_PISTE_CLIENT_ID!,
    clientSecret: process.env.SUZIELAW_PISTE_CLIENT_SECRET!,
  });

  it('searches Code civil for "domicile"', async () => {
    const r = await provider.search({ query: 'domicile', type: 'legislation' });
    expect(r.source_id).toBe('FR/Legifrance');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'FR/Legifrance', 'FR');
    // doc_id should be a LEGIARTI identifier
    expect((r.results[0].doc_id as string).startsWith('LEGIARTI')).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches an article by LEGIARTI from a search hit', async () => {
    const r = await provider.search({ query: 'domicile', type: 'legislation' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await provider.getDocument({ doc_id: docId! });
    expect(doc.source_id).toBe('FR/Legifrance');
    expect(doc.text.length).toBeGreaterThan(50);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// FR / Judilibre — needs PISTE API key
// -----------------------------------------------------------------------------
const HAS_JUDILIBRE = !!process.env.SUZIELAW_JUDILIBRE_API_KEY;
describe.skipIf(!RUN || !HAS_JUDILIBRE)('FR/Judilibre', () => {
  const provider = buildFrJudilibre({ apiKey: process.env.SUZIELAW_JUDILIBRE_API_KEY! });

  it('searches Cour de cassation decisions', async () => {
    const r = await provider.search({ query: 'responsabilité', type: 'case_law' });
    expect(r.source_id).toBe('FR/Judilibre');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'FR/Judilibre', 'FR');
  }, TEST_TIMEOUT);

  it('fetches a decision by id from a search hit', async () => {
    const r = await provider.search({ query: 'responsabilité', type: 'case_law' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await provider.getDocument({ doc_id: docId! });
    expect(doc.source_id).toBe('FR/Judilibre');
    expect(doc.text.length).toBeGreaterThan(50);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// ES / BOE
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('ES/BOE', () => {
  it('searches for "constitución" legislation', async () => {
    const r = await esBoe.search({ query: 'constitución', type: 'legislation' });
    expect(r.source_id).toBe('ES/BOE');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'ES/BOE', 'ES');
    // doc_id should be a BOE-A-YYYY-NNNNN identifier
    expect(/^BOE-A-\d{4}-\d+$/.test(r.results[0].doc_id as string)).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches the consolidated text for a BOE-A id from a search hit', async () => {
    const r = await esBoe.search({ query: 'constitución', type: 'legislation' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await esBoe.getDocument({ doc_id: docId!, truncate: true, max_chars: 5000 });
    expect(doc.source_id).toBe('ES/BOE');
    expect(doc.text.length).toBeGreaterThan(200);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// IT / Normattiva
//
// Normattiva's search frontend is JS-rendered + session-bound, so the
// runtime POST often returns an "Errore" page. We still call search to
// confirm it doesn't throw, but allow zero results. Document fetch via
// ELI URI is reliable.
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('IT/Normattiva', () => {
  it('runs a search without throwing', async () => {
    const r = await itNormattiva.search({ query: 'codice civile', type: 'legislation' });
    expect(r.source_id).toBe('IT/Normattiva');
    // Upstream is brittle — assert shape only, not result count.
    expect(Array.isArray(r.results)).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches the Codice civile by ELI URI', async () => {
    // Codice civile: R.D. 16 marzo 1942, n. 262, codice redazionale 042U0262.
    const doc = await itNormattiva.getDocument({
      doc_id: '/eli/id/1942/04/04/042U0262/sg',
      truncate: true,
      max_chars: 5000,
    });
    expect(doc.source_id).toBe('IT/Normattiva');
    expect(doc.text.length).toBeGreaterThan(200);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// UK / Legislation.gov.uk
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('UK/Legislation', () => {
  it('searches for the Data Protection Act', async () => {
    const r = await ukLegislation.search({ query: 'Data Protection Act', type: 'legislation' });
    expect(r.source_id).toBe('UK/Legislation');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'UK/Legislation', 'UK');
  }, TEST_TIMEOUT);

  it('fetches a known Act by id (ukpga/2018/12 — DPA 2018)', async () => {
    const doc = await ukLegislation.getDocument({ doc_id: 'ukpga/2018/12', truncate: true, max_chars: 5000 });
    expect(doc.source_id).toBe('UK/Legislation');
    expect(doc.text.length).toBeGreaterThan(200);
    expect(doc.url).toContain('legislation.gov.uk/ukpga/2018/12');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// UK / Find Case Law
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('UK/FindCaseLaw', () => {
  it('searches for judicial-review decisions', async () => {
    const r = await ukFindCaseLaw.search({ query: 'judicial review', type: 'case_law' });
    expect(r.source_id).toBe('UK/FindCaseLaw');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'UK/FindCaseLaw', 'UK');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// DE / OpenLegalData
//
// OpenLegalData's Elasticsearch search backend is intermittently 503. When
// it's down, search() throws "search_backend_unavailable" — we treat that
// as a skip rather than a failure, since it's an upstream outage, not our
// code. Document fetch (SQL backend) stays up regardless.
// -----------------------------------------------------------------------------
async function searchOrSkipDe(opts: Parameters<typeof deOpenLegalData.search>[0]) {
  try {
    return await deOpenLegalData.search(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('search_backend_unavailable') || msg.toLowerCase().includes('backend unavailable')) {
      console.warn(`[skip] OpenLegalData search backend down: ${msg.slice(0, 120)}`);
      return null;
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// DE / GesetzeImInternet — official federal legislation, lazy section cache
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('DE/GesetzeImInternet', () => {
  it('resolves a structured citation: § 535 BGB', async () => {
    const r = await deGesetzeImInternet.search({ query: '§ 535 BGB', type: 'legislation' });
    expect(r.source_id).toBe('DE/GesetzeImInternet');
    expect(r.results.length).toBe(1);
    expect(r.results[0].doc_id).toBe('BGB:535');
    expect(r.results[0].title).toContain('BGB');
    expect((r.results[0].snippet ?? '').toLowerCase()).toContain('mietvertrag');
  }, TEST_TIMEOUT);

  it('fetches a section directly by doc_id (no full-cache load needed)', async () => {
    const doc = await deGesetzeImInternet.getDocument({ doc_id: 'BGB:573c', truncate: false });
    expect(doc.source_id).toBe('DE/GesetzeImInternet');
    expect(doc.text.toLowerCase()).toContain('kündigung');
    expect(doc.url).toBe('https://www.gesetze-im-internet.de/bgb/__573c.html');
  }, TEST_TIMEOUT);

  it('keyword discovery: finds termination period sections without a citation', async () => {
    // Free-text "minimum termination period for tenancy". Code mention "BGB"
    // narrows the scan to BGB, lazily loading its full text on first hit.
    const r = await deGesetzeImInternet.search({
      query: 'BGB Kündigungsfrist Mietverhältnis',
      type: 'legislation',
    });
    expect(r.results.length).toBeGreaterThan(0);
    const sections = r.results.map((h) => h.doc_id);
    // §§ 573, 573c, 574, 580a are the canonical termination-related provisions
    expect(sections.some((id) => /^BGB:573c?$|^BGB:580a?$/.test(id))).toBe(true);
  }, TEST_TIMEOUT * 2); // first run: zip download + parse

  it('keyword search hits cached code instantly on second call', async () => {
    // BGB cached from previous test; this should be sub-second.
    const t0 = Date.now();
    const r = await deGesetzeImInternet.search({ query: 'BGB Schadensersatz', type: 'legislation' });
    const elapsed = Date.now() - t0;
    expect(r.results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000); // generous bound; first call took 5-10s
  }, TEST_TIMEOUT);

  it('findInDocument scopes keyword search to a single code', async () => {
    // BGB uses the official term "Mietsicherheit", not the colloquial "Kaution".
    const r = await deGesetzeImInternet.findInDocument!({
      doc_id: 'BGB',
      keyword: 'Mietsicherheit',
      max_articles: 3,
    });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].text.toLowerCase()).toContain('mietsicherheit');
    expect(r.total_articles).toBeGreaterThan(2000); // BGB has ~2,500 sections
  }, TEST_TIMEOUT);
});

describe.skipIf(!RUN)('DE/OpenLegalData', () => {
  it('searches German case law (and verifies the query is honored)', async () => {
    const r1 = await searchOrSkipDe({ query: 'Mietrecht', type: 'case_law' });
    if (!r1) return;
    expect(r1.results.length).toBeGreaterThan(0);
    expectHit(r1.results[0], 'DE/OpenLegalData', 'DE');
    expect((r1.results[0].doc_id as string).startsWith('case:')).toBe(true);

    // Second query with a different term — different top hit confirms search
    // is actually filtering.
    const r2 = await searchOrSkipDe({ query: 'Steuerrecht', type: 'case_law' });
    if (!r2) return;
    expect(r2.results.length).toBeGreaterThan(0);
    expect(r1.results[0].doc_id).not.toBe(r2.results[0].doc_id);
  }, TEST_TIMEOUT);

  it('fetches a case by id (works regardless of search backend status)', async () => {
    // Use a known stable case ID — fetch detail directly.
    const doc = await deOpenLegalData.getDocument({ doc_id: 'case:325566' });
    expect(doc.source_id).toBe('DE/OpenLegalData');
    expect(doc.text.length).toBeGreaterThan(50);
  }, TEST_TIMEOUT);

  // Legislation is no longer handled by OpenLegalData (DE/GesetzeImInternet
  // owns that). When a caller passes type:'legislation' the provider returns
  // an empty result without error.
  it('returns empty for legislation type (case_law-only provider now)', async () => {
    const r = await deOpenLegalData.search({ query: 'anything', type: 'legislation' });
    expect(r.results.length).toBe(0);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// AT / RIS
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('AT/RIS', () => {
  it('searches Austrian Bundesrecht', async () => {
    const r = await atRis.search({ query: 'Mietrechtsgesetz', type: 'legislation' });
    expect(r.source_id).toBe('AT/RIS');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'AT/RIS', 'AT');
    expect((r.results[0].doc_id as string).startsWith('leg:')).toBe(true);
  }, TEST_TIMEOUT);

  it('searches Austrian Judikatur', async () => {
    const r = await atRis.search({ query: 'Schadenersatz', type: 'case_law' });
    expect(r.results.length).toBeGreaterThan(0);
    expect((r.results[0].doc_id as string).startsWith('case:')).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches a Bundesrecht document by id', async () => {
    const r = await atRis.search({ query: 'Mietrechtsgesetz', type: 'legislation' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await atRis.getDocument({ doc_id: docId!, truncate: true, max_chars: 3000 });
    expect(doc.text.length).toBeGreaterThan(100);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// CH / Fedlex
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('CH/Fedlex', () => {
  it('searches Swiss legislation by title keyword', async () => {
    const r = await chFedlex.search({ query: 'Datenschutz', type: 'legislation' });
    expect(r.source_id).toBe('CH/Fedlex');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'CH/Fedlex', 'CH');
    expect((r.results[0].doc_id as string).startsWith('https://fedlex')).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches a Swiss act by ELI URI', async () => {
    const r = await chFedlex.search({ query: 'Datenschutz', type: 'legislation' });
    // Pick a hit that's likely to have a German HTML manifestation;
    // walk the list a few entries until we find one that resolves.
    let success = false;
    for (const hit of r.results.slice(0, 5)) {
      try {
        const doc = await chFedlex.getDocument({ doc_id: hit.doc_id, truncate: true, max_chars: 2000 });
        if (doc.text.length > 50) {
          success = true;
          break;
        }
      } catch {
        /* try next */
      }
    }
    expect(success).toBe(true);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// US / CFR (eCFR)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('US/CFR', () => {
  it('searches eCFR for "privacy"', async () => {
    const r = await usCfr.search({ query: 'privacy', type: 'legislation' });
    expect(r.source_id).toBe('US/CFR');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'US/CFR', 'US');
    expect(r.results[0].doc_id).toMatch(/title=\d+/);
  }, TEST_TIMEOUT);

  it('fetches a CFR section by hierarchy doc_id', async () => {
    const r = await usCfr.search({ query: 'privacy training', type: 'legislation' });
    const hit = r.results.find((h) => h.doc_id.includes('section='));
    expect(hit).toBeTruthy();
    const doc = await usCfr.getDocument({ doc_id: hit!.doc_id, truncate: true, max_chars: 3000 });
    expect(doc.text.length).toBeGreaterThan(100);
    expect(doc.url).toContain('ecfr.gov/current/title-');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// BR / Planalto + LexML
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('BR/Planalto', () => {
  it('searches LexML for "arbitragem"', async () => {
    const r = await brPlanalto.search({ query: 'arbitragem', type: 'legislation' });
    expect(r.source_id).toBe('BR/Planalto');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'BR/Planalto', 'BR');
    expect((r.results[0].doc_id as string).startsWith('urn:lex:br:federal:')).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches Lei 9.307/1996 (arbitration law) from Planalto', async () => {
    // Planalto.gov.br occasionally returns ECONNRESET / 5xx; treat that as a
    // skip rather than a hard failure.
    let doc;
    try {
      doc = await brPlanalto.getDocument({
        doc_id: 'urn:lex:br:federal:lei:1996-09-23;9307',
        truncate: true,
        max_chars: 3000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('fetch failed') || msg.includes('Could not fetch')) {
        console.warn(`[skip] Planalto upstream unavailable: ${msg.slice(0, 120)}`);
        return;
      }
      throw err;
    }
    expect(doc.source_id).toBe('BR/Planalto');
    expect(doc.text.length).toBeGreaterThan(500);
    expect(doc.text.toLowerCase()).toContain('arbitragem');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// IN / Indian Kanoon — needs API key
// -----------------------------------------------------------------------------
const HAS_INDIANKANOON = !!process.env.SUZIELAW_INDIANKANOON_API_KEY;
describe.skipIf(!RUN || !HAS_INDIANKANOON)('IN/IndianKanoon', () => {
  const provider = buildInIndianKanoon({ apiKey: process.env.SUZIELAW_INDIANKANOON_API_KEY! });

  it('searches Indian Supreme Court judgments', async () => {
    const r = await provider.search({ query: 'arbitration agreement', type: 'case_law' });
    expect(r.source_id).toBe('IN/IndianKanoon');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'IN/IndianKanoon', 'IN');
  }, TEST_TIMEOUT);

  it('fetches a document by tid', async () => {
    const r = await provider.search({ query: 'arbitration agreement', type: 'case_law' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await provider.getDocument({ doc_id: docId! });
    expect(doc.text.length).toBeGreaterThan(100);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// AU / Federal Register of Legislation
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('AU/FederalRegister', () => {
  it('searches for "privacy" Acts', async () => {
    const r = await auFederalRegister.search({ query: 'privacy', type: 'legislation' });
    expect(r.source_id).toBe('AU/FederalRegister');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'AU/FederalRegister', 'AU');
    // AU register IDs look like "C2004A00594" (Acts) or "F2004L..." (Legislative Instruments)
    expect((r.results[0].doc_id as string)).toMatch(/^[CF]\d{4}[A-Z]/);
  }, TEST_TIMEOUT);

  it('fetches the Privacy Act 1988 EPUB and extracts text', async () => {
    // Privacy Act 1988 register ID is C2004A03712 (well-known stable identifier).
    const doc = await auFederalRegister.getDocument({
      doc_id: 'C2004A03712',
      truncate: true,
      max_chars: 3000,
    });
    expect(doc.source_id).toBe('AU/FederalRegister');
    expect(doc.text.length).toBeGreaterThan(200);
    expect(doc.version).toBe('Epub');
  }, TEST_TIMEOUT * 2); // EPUB download can be slow
});

// -----------------------------------------------------------------------------
// NL / Wetten (legislation)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('NL/Wetten', () => {
  it('searches Dutch legislation by title keyword', async () => {
    const r = await nlWetten.search({ query: 'bestuursrecht', type: 'legislation' });
    expect(r.source_id).toBe('NL/Wetten');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'NL/Wetten', 'NL');
    expect((r.results[0].doc_id as string)).toMatch(/^BWBR\d+$/);
  }, TEST_TIMEOUT);

  it('fetches BWBR0005537 (Algemene wet bestuursrecht)', async () => {
    const doc = await nlWetten.getDocument({ doc_id: 'BWBR0005537', truncate: true, max_chars: 3000 });
    expect(doc.source_id).toBe('NL/Wetten');
    expect(doc.text.length).toBeGreaterThan(200);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// NL / Rechtspraak (case law) — date-window browse + client-side title filter
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('NL/Rechtspraak', () => {
  it('browses recent decisions and accepts a keyword filter on titles', async () => {
    const r = await nlRechtspraak.search({
      query: 'belasting', // ~tax appears in many titles
      type: 'case_law',
      date_from: '2024-01-15',
    });
    expect(r.source_id).toBe('NL/Rechtspraak');
    expectHit(r.results[0], 'NL/Rechtspraak', 'NL');
    expect((r.results[0].doc_id as string).startsWith('ECLI:NL:')).toBe(true);
  }, TEST_TIMEOUT);

  it('fetches a decision by ECLI', async () => {
    const r = await nlRechtspraak.search({ query: '', type: 'case_law', date_from: '2024-01-15' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await nlRechtspraak.getDocument({ doc_id: docId!, truncate: true, max_chars: 3000 });
    expect(doc.text.length).toBeGreaterThan(100);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// IE / Irish Statute Book — citation-only
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('IE/IrishStatuteBook', () => {
  it('resolves a citation: Act 7 of 2018 (Data Protection Act)', async () => {
    const r = await ieStatuteBook.search({ query: 'Act 7 of 2018', type: 'legislation' });
    expect(r.source_id).toBe('IE/IrishStatuteBook');
    expect(r.results.length).toBe(1);
    expect(r.results[0].doc_id).toBe('2018/act/7');
  }, TEST_TIMEOUT);

  it('returns empty for a non-citation keyword (no free-text search)', async () => {
    const r = await ieStatuteBook.search({ query: 'data protection', type: 'legislation' });
    expect(r.results.length).toBe(0);
  }, TEST_TIMEOUT);

  it('fetches the Data Protection Act 2018 by doc_id', async () => {
    const doc = await ieStatuteBook.getDocument({ doc_id: '2018/act/7', truncate: true, max_chars: 3000 });
    expect(doc.source_id).toBe('IE/IrishStatuteBook');
    expect(doc.text.length).toBeGreaterThan(500);
    expect(doc.title.toLowerCase()).toContain('data protection');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// CA / Justice Laws — federal Acts + Regulations
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('CA/Justice', () => {
  it('searches Canadian Acts by title keyword', async () => {
    const r = await caJustice.search({ query: 'privacy', type: 'legislation' });
    expect(r.source_id).toBe('CA/Justice');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'CA/Justice', 'CA');
    // P-21 is the Privacy Act; expected to be among the hits.
    expect(r.results.some((h) => h.doc_id === 'P-21')).toBe(true);
  }, TEST_TIMEOUT * 2); // first call: TOC fetch (~5MB) + parse

  it('fetches the Privacy Act XML', async () => {
    const doc = await caJustice.getDocument({ doc_id: 'P-21', truncate: true, max_chars: 3000 });
    expect(doc.source_id).toBe('CA/Justice');
    expect(doc.text.length).toBeGreaterThan(500);
    expect(doc.text.toLowerCase()).toContain('privacy');
  }, TEST_TIMEOUT);

  it('returns Income Tax Act when filtering for "income tax"', async () => {
    const r = await caJustice.search({ query: 'income tax', type: 'legislation' });
    expect(r.results.some((h) => /income\s+tax/i.test(h.title))).toBe(true);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// BE / Justel — year-listing scan with client-side keyword filter
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('BE/Justel', () => {
  it('finds 2018 lois about "données" (data protection)', async () => {
    const r = await beJustel.search({
      query: 'données 2018 loi',
      type: 'legislation',
    });
    expect(r.source_id).toBe('BE/Justel');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'BE/Justel', 'BE');
    expect((r.results[0].doc_id as string)).toMatch(/^loi\/\d{4}\/\d{2}\/\d{2}\/\d+$/);
  }, TEST_TIMEOUT * 2);

  it('fetches the 30 July 2018 GDPR national law', async () => {
    const doc = await beJustel.getDocument({
      doc_id: 'loi/2018/07/30/2018040581',
      truncate: true,
      max_chars: 3000,
    });
    expect(doc.source_id).toBe('BE/Justel');
    expect(doc.text.length).toBeGreaterThan(500);
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// JP / e-Gov (national laws)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('JP/eGov', () => {
  it('searches Japanese laws by name (民法 = Civil Code)', async () => {
    const r = await jpEGov.search({ query: '民法', type: 'legislation' });
    expect(r.source_id).toBe('JP/eGov');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'JP/eGov', 'JP');
  }, TEST_TIMEOUT * 2); // first search loads multiple categories

  it('fetches the Civil Code (民法) full XML by LawId', async () => {
    const doc = await jpEGov.getDocument({ doc_id: '129AC0000000089', truncate: true, max_chars: 3000 });
    expect(doc.source_id).toBe('JP/eGov');
    expect(doc.text.length).toBeGreaterThan(500);
    // Title should contain 民法
    expect(doc.title).toContain('民法');
  }, TEST_TIMEOUT);
});

// -----------------------------------------------------------------------------
// MX / DOF (Diario Oficial)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('MX/DOF', () => {
  it('scans recent days and returns notes (no keyword)', async () => {
    const r = await mxDof.search({ query: 'decreto', type: 'legislation' });
    expect(r.source_id).toBe('MX/DOF');
    // DOF doesn't publish on weekends/holidays — so this might rarely return
    // 0; treat that as a soft check rather than a failure.
    if (r.results.length === 0) {
      console.warn('[soft] MX/DOF returned no recent decreto notes; OK if weekend.');
      return;
    }
    expectHit(r.results[0], 'MX/DOF', 'MX');
    expect((r.results[0].doc_id as string)).toMatch(/^\d{2}-\d{2}-\d{4}:\d+$/);
  }, TEST_TIMEOUT * 2);
});

// -----------------------------------------------------------------------------
// CoE / HUDOC (ECHR)
// -----------------------------------------------------------------------------
describe.skipIf(!RUN)('CoE/HUDOC', () => {
  it('searches ECHR case law', async () => {
    const r = await coeHudoc.search({ query: '"fair trial"', type: 'case_law' });
    expect(r.source_id).toBe('CoE/HUDOC');
    expect(r.results.length).toBeGreaterThan(0);
    expectHit(r.results[0], 'CoE/HUDOC', 'CoE');
  }, TEST_TIMEOUT);

  it('fetches an ECHR judgment by itemid', async () => {
    const r = await coeHudoc.search({ query: '"fair trial"', type: 'case_law' });
    const docId = r.results[0]?.doc_id;
    expect(docId).toBeTruthy();
    const doc = await coeHudoc.getDocument({ doc_id: docId!, truncate: true, max_chars: 3000 });
    expect(doc.text.length).toBeGreaterThan(100);
  }, TEST_TIMEOUT);
});
