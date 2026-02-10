import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreCategory,
  classify,
} from "../src/services/classifier.js";
import type { RequestCategory } from "../src/services/classifier.js";

// ── tokenize ─────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases text", () => {
    expect(tokenize("HELLO World")).toBe("hello world");
  });

  it("replaces punctuation with spaces", () => {
    expect(tokenize("hello, world!")).toBe("hello  world ");
  });

  it("preserves ampersand", () => {
    expect(tokenize("P&L statement")).toBe("p&l statement");
  });

  it("preserves underscores", () => {
    expect(tokenize("my_var")).toBe("my_var");
  });

  it("handles empty string", () => {
    expect(tokenize("")).toBe("");
  });
});

// ── scoreCategory ────────────────────────────────────────────────────────────

describe("scoreCategory", () => {
  it("scores phrase matches with weight 3", () => {
    const keywords = { phrases: ["unit test"], words: [] };
    const score = scoreCategory("write a unit test for my app", keywords);
    expect(score).toBe(3);
  });

  it("scores word matches with weight 1", () => {
    const keywords = { phrases: [], words: ["debug", "code"] };
    const score = scoreCategory("debug this code", keywords);
    expect(score).toBe(2);
  });

  it("scores phrases and words together", () => {
    const keywords = { phrases: ["unit test"], words: ["code"] };
    const score = scoreCategory("write a unit test for my code", keywords);
    expect(score).toBe(4); // 3 (phrase) + 1 (word)
  });

  it("returns 0 for no matches", () => {
    const keywords = { phrases: ["unit test"], words: ["python"] };
    const score = scoreCategory("what is the weather today", keywords);
    expect(score).toBe(0);
  });

  it("handles keywords with ampersand", () => {
    const keywords = { phrases: [], words: ["p&l"] };
    const score = scoreCategory("review the p&l report", keywords);
    expect(score).toBe(1);
  });

  it("does not partial-match words", () => {
    const keywords = { phrases: [], words: ["test"] };
    // "testing" should NOT match "test" since we use exact word matching
    const score = scoreCategory("testing the application", keywords);
    expect(score).toBe(0);
  });
});

// ── classify: code_generation ────────────────────────────────────────────────

describe("classify — code_generation", () => {
  it("classifies a debugging request", () => {
    const result = classify("I have a bug in my Python function that throws a runtime error");
    expect(result.category).toBe("code_generation");
  });

  it("classifies an API development request", () => {
    const result = classify("Create a REST API endpoint with Express for user authentication");
    expect(result.category).toBe("code_generation");
  });

  it("classifies a code review request", () => {
    const result = classify("Can you do a code review of this pull request that has a merge conflict?");
    expect(result.category).toBe("code_generation");
  });

  it("classifies a DevOps request", () => {
    const result = classify("Write a Dockerfile and Kubernetes deployment config for my Node.js app");
    expect(result.category).toBe("code_generation");
  });

  it("classifies a database query request", () => {
    const result = classify("Write a SQL query to join these database tables and create an index");
    expect(result.category).toBe("code_generation");
  });

  it("classifies a testing request", () => {
    const result = classify("Write a unit test and integration test for the error handling middleware");
    expect(result.category).toBe("code_generation");
  });
});

// ── classify: document_creation ──────────────────────────────────────────────

describe("classify — document_creation", () => {
  it("classifies an email drafting request", () => {
    const result = classify("Draft an email to the team about the project status update");
    expect(result.category).toBe("document_creation");
  });

  it("classifies a blog post request", () => {
    const result = classify("Write a blog post about our company's new product launch");
    expect(result.category).toBe("document_creation");
  });

  it("classifies a report writing request", () => {
    const result = classify("Create an executive summary report with a table of contents");
    expect(result.category).toBe("document_creation");
  });

  it("classifies a cover letter request", () => {
    const result = classify("Help me write a cover letter for a software engineering position");
    expect(result.category).toBe("document_creation");
  });

  it("classifies a meeting notes request", () => {
    const result = classify("Summarize these meeting notes and extract action items");
    expect(result.category).toBe("document_creation");
  });
});

// ── classify: business_development ───────────────────────────────────────────

describe("classify — business_development", () => {
  it("classifies an RFP response request", () => {
    const result = classify("Help me respond to this RFP and build a compliance matrix for the solicitation");
    expect(result.category).toBe("business_development");
  });

  it("classifies a capture management request", () => {
    const result = classify("Develop a win strategy for this capture with competitive analysis");
    expect(result.category).toBe("business_development");
  });

  it("classifies a pricing request", () => {
    const result = classify("Calculate price to win for this IDIQ contract bid");
    expect(result.category).toBe("business_development");
  });

  it("classifies a proposal request", () => {
    const result = classify("Write a proposal for the PWS task order with past performance volume");
    expect(result.category).toBe("business_development");
  });
});

// ── classify: human_resources ────────────────────────────────────────────────

describe("classify — human_resources", () => {
  it("classifies a job description request", () => {
    const result = classify("Write a job description for a senior software engineer with hiring criteria");
    expect(result.category).toBe("human_resources");
  });

  it("classifies a policy request", () => {
    const result = classify("Draft an employee handbook policy on PTO and leave benefits");
    expect(result.category).toBe("human_resources");
  });

  it("classifies a performance review request", () => {
    const result = classify("Help me write a performance review for an employee on my team");
    expect(result.category).toBe("human_resources");
  });

  it("classifies an onboarding request", () => {
    const result = classify("Create an onboarding checklist for new employee hiring with training plan");
    expect(result.category).toBe("human_resources");
  });
});

// ── classify: accounting_finance ─────────────────────────────────────────────

describe("classify — accounting_finance", () => {
  it("classifies an invoice request", () => {
    const result = classify("Generate an invoice template for accounts payable with line items");
    expect(result.category).toBe("accounting_finance");
  });

  it("classifies a budget request", () => {
    const result = classify("Create a budget forecast for the fiscal year with expense categories");
    expect(result.category).toBe("accounting_finance");
  });

  it("classifies a financial statement request", () => {
    const result = classify("Analyze the balance sheet and income statement for profit margin");
    expect(result.category).toBe("accounting_finance");
  });

  it("classifies a tax request", () => {
    const result = classify("Help with the tax return depreciation and amortization schedule");
    expect(result.category).toBe("accounting_finance");
  });
});

// ── classify: general_qa ─────────────────────────────────────────────────────

describe("classify — general_qa", () => {
  it("classifies empty string as general_qa", () => {
    const result = classify("");
    expect(result.category).toBe("general_qa");
    expect(result.confidence).toBe(1);
  });

  it("classifies whitespace-only as general_qa", () => {
    const result = classify("   \n\t  ");
    expect(result.category).toBe("general_qa");
  });

  it("classifies a generic question", () => {
    const result = classify("What is the capital of France?");
    expect(result.category).toBe("general_qa");
  });

  it("classifies a conversational message", () => {
    const result = classify("Hello, how are you doing today?");
    expect(result.category).toBe("general_qa");
  });

  it("classifies random text with no keyword matches", () => {
    const result = classify("Tell me about the history of ancient Rome");
    expect(result.category).toBe("general_qa");
  });
});

// ── classify: CLI bias ───────────────────────────────────────────────────────

describe("classify — CLI bias", () => {
  it("biases CLI requests toward code_generation", () => {
    // A generic message that would normally be general_qa
    const webResult = classify("help me with this task", "web");
    const cliResult = classify("help me with this task", "cli");
    expect(cliResult.category).toBe("code_generation");
    // Web may or may not be code_generation; the point is CLI gets the bias
  });

  it("CLI bias can push code_generation above other categories", () => {
    // A prompt that leans slightly toward document_creation
    const prompt = "write a summary of this meeting";
    const webResult = classify(prompt, "web");
    const cliResult = classify(prompt, "cli");
    // CLI should bias toward code_generation even if doc_creation has some score
    expect(cliResult.category).toBe("code_generation");
  });

  it("does not apply CLI bias when source is web", () => {
    const prompt = "What color is the sky?";
    const result = classify(prompt, "web");
    expect(result.category).toBe("general_qa");
  });
});

// ── classify: confidence ─────────────────────────────────────────────────────

describe("classify — confidence", () => {
  it("returns confidence 1 for general_qa (no matches)", () => {
    const result = classify("What is the meaning of life?");
    expect(result.confidence).toBe(1);
  });

  it("returns confidence 1 when only one category scores", () => {
    const result = classify("debug this python script");
    expect(result.confidence).toBe(1);
    expect(result.secondary).toBeUndefined();
  });

  it("returns confidence < 1 when multiple categories score", () => {
    // "write" matches doc_creation, "code" matches code_generation
    const result = classify("write the code for a proposal template");
    expect(result.confidence).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("confidence is between 0 and 1", () => {
    const prompts = [
      "build a react component for the dashboard",
      "draft a proposal for the contract bid pricing",
      "create an employee onboarding policy for hiring",
      "analyze the balance sheet for the budget forecast",
    ];
    for (const prompt of prompts) {
      const result = classify(prompt);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ── classify: secondary category ─────────────────────────────────────────────

describe("classify — secondary category", () => {
  it("returns secondary when multiple categories score", () => {
    // "write" → doc_creation, "code" + "function" → code_generation
    const result = classify("write a proposal document and also code a function");
    expect(result.secondary).toBeDefined();
    expect(result.secondary).not.toBe(result.category);
  });

  it("does not return secondary for single-category match", () => {
    const result = classify("debug python script error bug");
    expect(result.secondary).toBeUndefined();
  });

  it("does not return secondary for general_qa", () => {
    const result = classify("What is the meaning of life?");
    expect(result.secondary).toBeUndefined();
  });
});

// ── classify: multi-category / edge cases ────────────────────────────────────

describe("classify — edge cases", () => {
  it("handles a prompt mixing code and HR keywords", () => {
    const result = classify("build an employee onboarding portal with a react frontend and database");
    // Code keywords: build, react, frontend, database → 4
    // HR keywords: employee, onboarding → 2
    expect(result.category).toBe("code_generation");
    expect(result.secondary).toBe("human_resources");
  });

  it("handles a prompt mixing finance and business dev", () => {
    const result = classify("create a pricing proposal for the contract bid with budget forecast");
    const validCategories: RequestCategory[] = ["business_development", "accounting_finance"];
    expect(validCategories).toContain(result.category);
    expect(result.secondary).toBeDefined();
  });

  it("handles very long prompts", () => {
    const longPrompt = "debug this function ".repeat(500);
    const result = classify(longPrompt);
    expect(result.category).toBe("code_generation");
  });

  it("handles special characters gracefully", () => {
    const result = classify("Fix the bug in @user's code!! #urgent $$$");
    expect(result.category).toBe("code_generation");
  });

  it("handles unicode text", () => {
    const result = classify("请帮我写一个函数");
    expect(result.category).toBe("general_qa");
  });

  it("phrase matching takes priority over word matching", () => {
    // "code review" phrase = 3 points, stronger than individual word matches
    const result = classify("code review");
    expect(result.category).toBe("code_generation");
    expect(result.confidence).toBe(1);
  });

  it("classifies a prompt that spans doc_creation and code_generation", () => {
    const result = classify("Write a blog post about how to deploy a Node.js API endpoint");
    // "blog post" phrase (3) + "write" (1) for doc = 4
    // "deploy" (1) + "api" (1) + "endpoint" (1) + "node" (1) for code = 4
    // Both should score, and secondary should be present
    expect(["code_generation", "document_creation"]).toContain(result.category);
    expect(result.secondary).toBeDefined();
  });
});
