import type { Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import type { EngineRequest } from "../types/index.js";

export function requestContext(
  req: EngineRequest,
  _res: Response,
  next: NextFunction,
): void {
  req.context = {
    requestId: (req.headers["x-request-id"] as string) || uuidv4(),
    userId: req.headers["x-user-id"] as string | undefined,
    userEmail: req.headers["x-user-email"] as string | undefined,
    startTime: Date.now(),
  };
  next();
}
