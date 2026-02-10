import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { getUserBudget } from "../services/budgetService.js";
import { AppError } from "./error-handler.js";
import type { EngineRequest } from "../types/index.js";

export async function budgetEnforcer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const engineReq = req as EngineRequest;
  const userId = engineReq.context.userId;
  const role = engineReq.context.role ?? "business";

  // No enforcement without a user identity
  if (!userId) {
    next();
    return;
  }

  // Admin bypass
  if (role === "admin") {
    next();
    return;
  }

  // No enforcement if budget tracking is disabled or DB not connected
  if (config.budgetEnforcement === "none" || !config.databaseUrl) {
    next();
    return;
  }

  try {
    const budget = await getUserBudget(userId, role);

    if (budget.warningThreshold && !budget.exceeded) {
      res.setHeader("X-Budget-Warning", `Usage at ${budget.percentUsed}% of monthly limit`);
      logger.warn({
        action: "budget_warning",
        requestId: engineReq.context.requestId,
        userId,
        role,
        currentUsage: budget.currentUsage,
        monthlyLimit: budget.monthlyLimit,
        percentUsed: budget.percentUsed,
      });
    }

    if (budget.exceeded) {
      res.setHeader(
        "X-Budget-Warning",
        `Monthly token budget exceeded (${budget.currentUsage}/${budget.monthlyLimit}). Resets ${budget.resetDate}.`,
      );

      logger.warn({
        action: "budget_exceeded",
        requestId: engineReq.context.requestId,
        userId,
        role,
        currentUsage: budget.currentUsage,
        monthlyLimit: budget.monthlyLimit,
        enforcement: config.budgetEnforcement,
      });

      if (config.budgetEnforcement === "hard") {
        throw new AppError(
          `Monthly token budget exceeded (${budget.currentUsage.toLocaleString()}/${budget.monthlyLimit?.toLocaleString()} tokens). ` +
            `Your budget resets on ${budget.resetDate}. Contact your administrator to request an increase.`,
          429,
          "budget_exceeded",
        );
      }
    }

    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    // DB errors should not block requests — log and pass through
    logger.error({
      action: "budget_check_failed",
      requestId: engineReq.context.requestId,
      userId,
      error: (err as Error).message,
    });
    next();
  }
}
