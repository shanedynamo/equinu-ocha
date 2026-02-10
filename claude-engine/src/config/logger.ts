import winston from "winston";
import { config } from "./index.js";

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: "claude-engine" },
  transports: [new winston.transports.Console()],
});
