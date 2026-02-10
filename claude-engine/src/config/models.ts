export interface ModelDefinition {
  id: string;
  displayName: string;
  tier: number; // higher = more capable; used for downgrade ordering
  costPerMillionTokens: {
    input: number;
    output: number;
  };
}

export const MODEL_CATALOG: Record<string, ModelDefinition> = {
  "claude-opus-4-20250514": {
    id: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    tier: 3,
    costPerMillionTokens: { input: 15, output: 75 },
  },
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    tier: 2,
    costPerMillionTokens: { input: 3, output: 15 },
  },
  "claude-haiku-4-20250514": {
    id: "claude-haiku-4-20250514",
    displayName: "Claude Haiku 4",
    tier: 1,
    costPerMillionTokens: { input: 0.8, output: 4 },
  },
};

export function getModel(id: string): ModelDefinition | undefined {
  return MODEL_CATALOG[id];
}

export function getModelTier(id: string): number {
  return MODEL_CATALOG[id]?.tier ?? 0;
}
