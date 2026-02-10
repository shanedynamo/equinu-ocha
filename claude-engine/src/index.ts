import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { requestContext } from "./middleware/request-context.js";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { modelRouter } from "./middleware/model-router.js";
import { budgetEnforcer } from "./middleware/budget-enforcer.js";
import { auditSetup } from "./middleware/audit-logger.js";
import { sensitiveDataScanner } from "./middleware/sensitive-data-scanner.js";
import { auth } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { chatCompletionsRouter } from "./routes/chat-completions.js";
import { messagesRouter } from "./routes/messages.js";
import { budgetRouter } from "./routes/budget.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { closePool } from "./services/db.js";

const app = express();

// ── Global middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type", "Authorization",
      "X-Request-Id", "X-User-Id", "X-User-Email", "X-User-Role",
      "X-Mock-User-Email", "X-Mock-User-Role",
    ],
    exposedHeaders: ["X-Model-Downgraded", "X-Request-Id", "X-Budget-Warning", "X-Sensitive-Data-Warning"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(requestContext as express.RequestHandler);
app.use(requestLogger as express.RequestHandler);
app.use(auth as express.RequestHandler);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/v1/admin/api-keys", apiKeysRouter);
// Pipeline: sensitiveDataScanner → budgetEnforcer → modelRouter → auditSetup(classifier) → proxy → audit(fire-and-forget)
app.use("/v1/chat/completions", sensitiveDataScanner, budgetEnforcer, modelRouter, auditSetup, chatCompletionsRouter);
app.use("/v1/messages", sensitiveDataScanner, budgetEnforcer, modelRouter, auditSetup, messagesRouter);
app.use("/v1/budget", modelRouter, budgetRouter);

// ── Error handler (must be last) ────────────────────────────────────────────
app.use(errorHandler as unknown as express.ErrorRequestHandler);

// ── Start server ────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info({
    action: "server_start",
    port: config.port,
    env: config.env,
    budgetEnforcement: config.budgetEnforcement,
    message: `Claude Engine listening on port ${config.port}`,
  });
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info({ action: "shutdown_start", signal });

  server.close(async () => {
    await closePool();
    logger.info({ action: "shutdown_complete", signal });
    process.exit(0);
  });

  // Force exit after 10s if connections won't drain
  setTimeout(() => {
    logger.error({ action: "shutdown_forced", signal });
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
