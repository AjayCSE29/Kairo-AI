import { describe, expect, it } from 'vitest';
import { CLAIMS, ESTIMATE, MODELS, SOURCES } from './data';

describe('Kairo mock research data', () => {
  it('estimates deeper modes and verification with additional credits', () => {
    const quick = ESTIMATE('opal', 'Quick answer', false);
    expect(ESTIMATE('opal', 'Research', false)).toBeGreaterThan(quick);
    expect(ESTIMATE('opal', 'Quick answer', true)).toBe(quick + 3);
  });

  it('keeps every claim evidence reference connected to a source fixture', () => {
    const sourceIds = new Set(SOURCES.map(source => source.id));
    expect(CLAIMS.length).toBeGreaterThan(0);
    for (const claim of CLAIMS) {
      expect(claim.sourceIds.length).toBeGreaterThan(0);
      for (const id of claim.sourceIds) expect(sourceIds.has(id)).toBe(true);
    }
  });

  it('provides six distinct gemstone model profiles', () => {
    expect(MODELS).toHaveLength(6);
    expect(new Set(MODELS.map(model => model.id)).size).toBe(6);
    expect(MODELS.every(model => model.multiplier > 0 && model.harness.length > 0)).toBe(true);
  });
});
