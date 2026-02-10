// ── Types ───────────────────────────────────────────────────────────────────

export type RequestCategory =
  | "code_generation"
  | "document_creation"
  | "business_development"
  | "human_resources"
  | "accounting_finance"
  | "general_qa";

export interface ClassificationResult {
  category: RequestCategory;
  confidence: number;
  secondary?: RequestCategory;
}

// ── Keyword definitions ─────────────────────────────────────────────────────
// Phrases (multi-word) are checked first and score higher than single words.

interface CategoryKeywords {
  phrases: string[];
  words: string[];
}

const CATEGORY_KEYWORDS: Record<Exclude<RequestCategory, "general_qa">, CategoryKeywords> = {
  code_generation: {
    phrases: [
      "code review", "pull request", "merge conflict", "stack trace",
      "unit test", "integration test", "type error", "syntax error",
      "null pointer", "race condition", "memory leak", "design pattern",
      "rest api", "api endpoint", "http request", "error handling",
      "data structure", "linked list", "binary tree", "hash map",
    ],
    words: [
      "code", "function", "script", "debug", "error", "bug",
      "api", "sql", "python", "javascript", "typescript", "deploy",
      "git", "regex", "algorithm", "refactor", "test", "compile",
      "runtime", "database", "frontend", "backend", "middleware",
      "docker", "kubernetes", "aws", "lambda", "terraform",
      "react", "vue", "angular", "express", "node",
      "class", "interface", "method", "variable", "import",
      "async", "promise", "callback", "loop", "array",
      "json", "yaml", "config", "dependency", "npm",
      "component", "module", "package", "library", "framework",
      "lint", "build", "ci", "pipeline", "devops",
      "schema", "migration", "query", "index", "table",
      "endpoint", "route", "controller", "service", "repository",
    ],
  },
  document_creation: {
    phrases: [
      "executive summary", "table of contents", "cover letter",
      "press release", "white paper", "case study", "blog post",
      "meeting notes", "meeting minutes", "status update",
      "project plan", "action items",
    ],
    words: [
      "write", "draft", "memo", "report", "email",
      "letter", "proposal", "summary", "blog", "article",
      "presentation", "template", "format", "document",
      "outline", "paragraph", "essay", "newsletter", "copy",
      "edit", "proofread", "rewrite", "tone", "audience",
    ],
  },
  business_development: {
    phrases: [
      "win strategy", "past performance", "compliance matrix",
      "task order", "capture management", "competitive analysis",
      "market research", "value proposition", "price to win",
      "oral presentation", "gate review", "color team",
      "teaming agreement", "small business", "set aside",
    ],
    words: [
      "proposal", "rfp", "rfi", "capture", "pricing",
      "bid", "contract", "idiq", "pws", "sow",
      "procurement", "solicitation", "incumbent", "subcontractor",
      "prime", "naics", "cage", "duns", "sam",
      "evaluation", "criteria", "technical volume",
    ],
  },
  human_resources: {
    phrases: [
      "performance review", "employee handbook", "job description",
      "offer letter", "exit interview", "background check",
      "pay raise", "salary range", "open enrollment",
      "disciplinary action", "reasonable accommodation",
      "equal opportunity", "workplace safety", "workers compensation",
    ],
    words: [
      "policy", "pto", "benefits", "onboarding",
      "hiring", "termination", "leave", "compensation",
      "employee", "payroll", "recruit", "retention",
      "diversity", "inclusion", "harassment", "grievance",
      "fmla", "cobra", "wellness", "training",
    ],
  },
  accounting_finance: {
    phrases: [
      "balance sheet", "income statement", "cash flow",
      "purchase order", "cost estimate", "accounts payable",
      "accounts receivable", "general ledger", "chart of accounts",
      "tax return", "fiscal year", "profit margin",
      "cost center", "budget variance", "financial statement",
    ],
    words: [
      "invoice", "budget", "forecast", "expense",
      "revenue", "financial", "p&l", "procurement",
      "accounting", "audit", "tax", "depreciation",
      "amortization", "equity", "liability", "asset",
      "reconciliation", "accrual", "ebitda", "roi",
    ],
  },
};

const PHRASE_WEIGHT = 3;
const WORD_WEIGHT = 1;
const CLI_CODE_BIAS = 4;

// ── Classifier ──────────────────────────────────────────────────────────────

export function tokenize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s&]/g, " ");
}

export function scoreCategory(
  normalizedText: string,
  keywords: CategoryKeywords,
): number {
  let score = 0;

  for (const phrase of keywords.phrases) {
    if (normalizedText.includes(phrase)) {
      score += PHRASE_WEIGHT;
    }
  }

  // Split into word set for exact word matching
  const words = new Set(normalizedText.split(/\s+/).filter(Boolean));

  for (const keyword of keywords.words) {
    if (keyword.includes("&")) {
      // Special case: keywords with & (e.g. "p&l") — check in normalized text
      if (normalizedText.includes(keyword)) {
        score += WORD_WEIGHT;
      }
    } else if (words.has(keyword)) {
      score += WORD_WEIGHT;
    }
  }

  return score;
}

export function classify(
  promptText: string,
  source: "web" | "cli" = "web",
): ClassificationResult {
  if (!promptText.trim()) {
    return { category: "general_qa", confidence: 1 };
  }

  const normalized = tokenize(promptText);

  const scores: Record<string, number> = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = scoreCategory(normalized, keywords);
  }

  // Apply CLI bias toward code_generation
  if (source === "cli") {
    scores.code_generation = (scores.code_generation ?? 0) + CLI_CODE_BIAS;
  }

  // Sort categories by score descending
  const ranked = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return { category: "general_qa", confidence: 1 };
  }

  const [topCategory, topScore] = ranked[0];
  const secondScore = ranked.length > 1 ? ranked[1][1] : 0;
  const totalTop2 = topScore + secondScore;

  const confidence = totalTop2 > 0
    ? Math.round((topScore / totalTop2) * 100) / 100
    : 1;

  const result: ClassificationResult = {
    category: topCategory as RequestCategory,
    confidence,
  };

  if (ranked.length > 1 && secondScore > 0) {
    result.secondary = ranked[1][0] as RequestCategory;
  }

  return result;
}
