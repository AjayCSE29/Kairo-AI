import { describe, expect, it } from 'vitest';
import { EFFORTS, MODELS, MODEL_IDS, MODE_PRESETS, RESEARCH_MODES } from '../shared/models';

describe('Kairo model catalog', () => {
  it('keeps six distinct profiles with positive usage multipliers', () => {
    expect(MODELS).toHaveLength(6);
    expect(new Set(MODELS.map(model => model.id)).size).toBe(6);
    expect(MODELS.map(model => model.id).sort()).toEqual([...MODEL_IDS].sort());
    expect(MODELS.every(model => model.multiplier > 0 && model.harness.length > 0)).toBe(true);
  });

  it('defines presets for every mode and effort', () => {
    expect(Object.keys(MODE_PRESETS).sort()).toEqual([...RESEARCH_MODES].sort());
    expect(EFFORTS).toEqual(['Low', 'Medium', 'High', 'Max']);
  });
});
