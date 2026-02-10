import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import type { ScanFinding } from "./sensitiveDataScanner.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AlertContext {
  requestId: string;
  userId?: string;
  userEmail?: string;
  route: string;
}

export interface SecurityAlert {
  type: "sensitive_data_detected";
  severity: "high" | "medium";
  timestamp: string;
  context: AlertContext;
  findings: Array<{
    type: string;
    severity: string;
    redactedValue: string;
  }>;
}

// ── Pure builder ───────────────────────────────────────────────────────────

export function buildSecurityAlert(
  findings: ScanFinding[],
  context: AlertContext,
): SecurityAlert {
  const hasHigh = findings.some((f) => f.severity === "high");
  return {
    type: "sensitive_data_detected",
    severity: hasHigh ? "high" : "medium",
    timestamp: new Date().toISOString(),
    context,
    findings: findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      redactedValue: f.redactedValue,
    })),
  };
}

// ── Publisher ──────────────────────────────────────────────────────────────

export async function publishAlert(alert: SecurityAlert): Promise<void> {
  const topicArn = config.snsTopicArn;

  if (topicArn) {
    try {
      const { SNSClient, PublishCommand } = await import(
        "@aws-sdk/client-sns"
      );
      const sns = new SNSClient({});
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Subject: `[${alert.severity.toUpperCase()}] Sensitive data detected`,
          Message: JSON.stringify(alert, null, 2),
        }),
      );
      logger.info({
        action: "security_alert_published",
        requestId: alert.context.requestId,
        severity: alert.severity,
      });
    } catch (err) {
      logger.error({
        action: "security_alert_publish_failed",
        requestId: alert.context.requestId,
        error: (err as Error).message,
      });
    }
  } else {
    logger.warn({
      action: "security_alert",
      severity: alert.severity,
      requestId: alert.context.requestId,
      findings: alert.findings,
      message: `[ALERT] Sensitive data detected (${alert.severity})`,
    });
  }
}
