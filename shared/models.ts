export type ResearchMode = 'Quick answer' | 'Research' | 'Deep research';
export type Effort = 'Low' | 'Medium' | 'High' | 'Max';
export type ModelId = 'obsidian' | 'opal' | 'jade' | 'garnet' | 'topaz' | 'aventurine';
export type ProviderId = 'openai' | 'jarvislabs';

export interface ModelProfile {
  id: ModelId;
  name: string;
  role: string;
  description: string;
  multiplier: number;
  tone: string;
  speed: string;
  depth: string;
  harness: string[];
}

export const MODEL_IDS: ModelId[] = ['obsidian', 'opal', 'jade', 'garnet', 'topaz', 'aventurine'];
export const RESEARCH_MODES: ResearchMode[] = ['Quick answer', 'Research', 'Deep research'];
export const EFFORTS: Effort[] = ['Low', 'Medium', 'High', 'Max'];

export const MODELS: ModelProfile[] = [
  {
    id: 'obsidian',
    name: 'Kairo Obsidian',
    role: 'Flagship deep reasoning',
    description: 'Complex research, synthesis, and difficult analytical questions.',
    multiplier: 3,
    tone: 'silver',
    speed: 'Deliberate',
    depth: 'Extensive',
    harness: ['Adaptive reasoning', 'Multi-stage planning', 'Contradiction analysis', 'Optional JEV verification'],
  },
  {
    id: 'opal',
    name: 'Kairo Opal',
    role: 'Fast and efficient',
    description: 'Quick answers, short explanations, and lightweight reasoning.',
    multiplier: 0.65,
    tone: 'pearl',
    speed: 'Fast',
    depth: 'Focused',
    harness: ['Minimal orchestration', 'Limited retrieval', 'Concise outputs'],
  },
  {
    id: 'jade',
    name: 'Kairo Jade',
    role: 'Research and discovery',
    description: 'Query expansion, source discovery, and evidence collection.',
    multiplier: 1.5,
    tone: 'jade',
    speed: 'Balanced',
    depth: 'Broad retrieval',
    harness: ['Search planning', 'Source diversity', 'Evidence extraction'],
  },
  {
    id: 'garnet',
    name: 'Kairo Garnet',
    role: 'Critical analysis',
    description: 'Claim decomposition, counterarguments, and evidence challenges.',
    multiplier: 1.8,
    tone: 'garnet',
    speed: 'Measured',
    depth: 'Critical',
    harness: ['Checkable claims', 'Counter-evidence', 'Uncertainty reporting'],
  },
  {
    id: 'topaz',
    name: 'Kairo Topaz',
    role: 'Complex problem-solving',
    description: 'Multi-step logic, technical investigations, and structured analysis.',
    multiplier: 2.1,
    tone: 'topaz',
    speed: 'Measured',
    depth: 'Structured',
    harness: ['Task decomposition', 'Dependency tracking', 'Intermediate checks'],
  },
  {
    id: 'aventurine',
    name: 'Kairo Aventurine',
    role: 'Experimental exploration',
    description: 'Alternative hypotheses and open-ended connections.',
    multiplier: 1.25,
    tone: 'aventurine',
    speed: 'Balanced',
    depth: 'Exploratory',
    harness: ['Alternative hypotheses', 'Relationship discovery', 'Labeled speculation'],
  },
];

export const MODE_PRESETS: Record<
  ResearchMode,
  { queries: number; maxSources: number; answerSources: number; sourceChars: number; label: string }
> = {
  'Quick answer': { queries: 1, maxSources: 3, answerSources: 3, sourceChars: 2400, label: 'Light' },
  Research: { queries: 3, maxSources: 6, answerSources: 6, sourceChars: 3200, label: 'Standard' },
  'Deep research': { queries: 5, maxSources: 10, answerSources: 8, sourceChars: 4200, label: 'Extended' },
};

export const EFFORT_PRESETS: Record<Effort, { maxTokens: number; temperature: number; extraQueries: number }> = {
  Low: { maxTokens: 700, temperature: 0.3, extraQueries: 0 },
  Medium: { maxTokens: 1200, temperature: 0.25, extraQueries: 0 },
  High: { maxTokens: 1900, temperature: 0.2, extraQueries: 1 },
  Max: { maxTokens: 2800, temperature: 0.15, extraQueries: 2 },
};

export function findModel(id: string): ModelProfile | undefined {
  return MODELS.find(model => model.id === id);
}
