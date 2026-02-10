import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_DEFAULT_MODEL: z.string().default("claude-sonnet-4-20250514"),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().optional(),
  TOKEN_BUDGET_ENFORCEMENT: z.enum(["soft", "hard", "none"]).default("soft"),
  SNS_TOPIC_ARN: z.string().optional(),
  AUTH_MODE: z.enum(["mock", "oidc"]).default("mock"),
  JWT_SECRET: z.string().default("dynamo-webui-local-dev-secret"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  anthropic: {
    apiKey: parsed.data.ANTHROPIC_API_KEY,
    defaultModel: parsed.data.ANTHROPIC_DEFAULT_MODEL,
    maxTokens: parsed.data.ANTHROPIC_MAX_TOKENS,
  },
  corsOrigin: parsed.data.CORS_ORIGIN,
  logLevel: parsed.data.LOG_LEVEL,
  databaseUrl: parsed.data.DATABASE_URL,
  budgetEnforcement: parsed.data.TOKEN_BUDGET_ENFORCEMENT,
  snsTopicArn: parsed.data.SNS_TOPIC_ARN,
  authMode: parsed.data.AUTH_MODE,
  jwtSecret: parsed.data.JWT_SECRET,
} as const;
