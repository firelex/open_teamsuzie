import { describe, expect, it } from 'vitest';
import { COMPONENT_CATALOG, COMPONENT_KEYS, MODULE_CATALOG, MODULE_KEYS } from '../index.js';

/**
 * Catalog coverage. Enforces the contract: every key in MODULE_KEYS /
 * COMPONENT_KEYS has a non-empty descriptor.
 *
 * The type-level `Record<ModuleKey, FeatureDescriptor>` ensures STRUCTURAL
 * presence; this test additionally checks the DESCRIPTOR CONTENT is real —
 * a contributor can't ship `{ key, label: '', purpose: '', ... }` to silence
 * the compiler. The catalog is the source-of-truth that agents read aloud
 * when asked "what does Library do?" — empty fields would surface as the
 * agent saying "Library does ." mid-sentence.
 */
describe('catalog coverage', () => {
  it('every MODULE_KEY has a descriptor with real content', () => {
    for (const key of MODULE_KEYS) {
      const d = MODULE_CATALOG[key];
      expect(d, `missing MODULE_CATALOG entry for ${key}`).toBeDefined();
      expect(d.key, `MODULE_CATALOG[${key}].key`).toBe(key);
      expect(d.label.length, `MODULE_CATALOG[${key}].label is empty`).toBeGreaterThan(0);
      expect(d.purpose.length, `MODULE_CATALOG[${key}].purpose is empty`).toBeGreaterThan(20);
    }
  });

  it('every COMPONENT_KEY has a descriptor with real content', () => {
    for (const key of COMPONENT_KEYS) {
      const d = COMPONENT_CATALOG[key];
      expect(d, `missing COMPONENT_CATALOG entry for ${key}`).toBeDefined();
      expect(d.key, `COMPONENT_CATALOG[${key}].key`).toBe(key);
      expect(d.label.length, `COMPONENT_CATALOG[${key}].label is empty`).toBeGreaterThan(0);
      expect(d.purpose.length, `COMPONENT_CATALOG[${key}].purpose is empty`).toBeGreaterThan(20);
    }
  });

  it('dependsOn references only point at real keys', () => {
    // Cross-catalog refs are allowed (component `workspace` depends on module
    // `matters`), so the universe is the union of both key sets.
    const allKeys = new Set<string>([...MODULE_KEYS, ...COMPONENT_KEYS]);
    for (const key of MODULE_KEYS) {
      for (const dep of MODULE_CATALOG[key].dependsOn) {
        expect(allKeys.has(dep), `MODULE_CATALOG[${key}].dependsOn -> unknown key "${dep}"`).toBe(true);
      }
    }
    for (const key of COMPONENT_KEYS) {
      for (const dep of COMPONENT_CATALOG[key].dependsOn) {
        expect(allKeys.has(dep), `COMPONENT_CATALOG[${key}].dependsOn -> unknown key "${dep}"`).toBe(true);
      }
    }
  });
});
