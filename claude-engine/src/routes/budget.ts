import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getUserBudget, getAllBudgets } from "../services/budgetService.js";
import { getMonthlyBudget } from "../services/budgetService.js";
import { AppError } from "../middleware/error-handler.js";
import type { EngineRequest } from "../types/common.js";

export const budgetRouter = Router();

// GET /v1/budget/:userId — current budget status for a user
budgetRouter.get(
  "/:userId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engineReq = req as EngineRequest;
      const userId = req.params.userId as string;

      // Users can only view their own budget unless they are admin
      const callerRole = engineReq.context.role ?? "business";
      const callerId = engineReq.context.userId;
      if (callerRole !== "admin" && callerId !== userId) {
        throw new AppError("You can only view your own budget", 403, "forbidden");
      }

      const role = callerRole === "admin" && callerId !== userId
        ? "business" // default when looking up another user
        : callerRole;

      const budget = await getUserBudget(userId, role);
      // Ensure the monthly limit reflects the role's config
      budget.monthlyLimit = getMonthlyBudget(role);

      res.json(budget);
    } catch (err) {
      next(err);
    }
  },
);

// GET /v1/budget/admin/summary — all users budget summary (admin only)
budgetRouter.get(
  "/admin/summary",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engineReq = req as EngineRequest;
      const role = engineReq.context.role ?? "business";

      if (role !== "admin") {
        throw new AppError("Admin access required", 403, "forbidden");
      }

      const budgets = await getAllBudgets();
      res.json({ users: budgets, count: budgets.length });
    } catch (err) {
      next(err);
    }
  },
);
