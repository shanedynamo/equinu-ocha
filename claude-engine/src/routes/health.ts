import { Router } from "express";
import type { HealthResponse } from "../types/index.js";

const startTime = Date.now();

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const response: HealthResponse = {
    status: "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
  res.json(response);
});
