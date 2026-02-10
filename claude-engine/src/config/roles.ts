export interface RoleDefinition {
  name: string;
  permittedModels: string[];
  maxTokensPerRequest: number | null; // null = unlimited
  monthlyTokenBudget: number | null;  // null = unlimited
}

export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  admin: {
    name: "admin",
    permittedModels: [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-20250514",
    ],
    maxTokensPerRequest: null,
    monthlyTokenBudget: null,
  },
  engineer: {
    name: "engineer",
    permittedModels: [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-20250514",
    ],
    maxTokensPerRequest: 8192,
    monthlyTokenBudget: 500_000,
  },
  power_user: {
    name: "power_user",
    permittedModels: [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-20250514",
    ],
    maxTokensPerRequest: 8192,
    monthlyTokenBudget: 350_000,
  },
  business: {
    name: "business",
    permittedModels: [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-20250514",
    ],
    maxTokensPerRequest: 4096,
    monthlyTokenBudget: 200_000,
  },
};

export const DEFAULT_ROLE = "business";

export function getRole(name: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS[name];
}
