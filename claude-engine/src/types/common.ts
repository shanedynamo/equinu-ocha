import type { Request } from "express";
import type { AuditContext } from "../services/auditLogger.js";
import type { ScanResult } from "../services/sensitiveDataScanner.js";

export type AuthMethod = "api_key" | "jwt" | "mock" | "session" | "none";

export interface RequestContext {
  requestId: string;
  userId?: string;
  userEmail?: string;
  displayName?: string;
  role?: string;
  apiKeyId?: number;
  authMethod?: AuthMethod;
  startTime: number;
  audit?: AuditContext;
  scanResult?: ScanResult;
}

export interface EngineRequest extends Request {
  context: RequestContext;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code: string | number;
    requestId: string;
  };
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  uptime: number;
}
