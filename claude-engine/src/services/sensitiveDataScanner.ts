// ── Types ───────────────────────────────────────────────────────────────────

export type ScanSeverity = "high" | "medium";

export interface ScanFinding {
  type: string;
  severity: ScanSeverity;
  redactedValue: string;
  index: number;
}

export interface ScanResult {
  hasHighSeverity: boolean;
  hasMediumSeverity: boolean;
  findings: ScanFinding[];
}

// ── Pattern definitions ────────────────────────────────────────────────────

interface PatternDef {
  type: string;
  severity: ScanSeverity;
  source: string;
  flags: string;
  validate?: (match: RegExpExecArray, text: string) => boolean;
}

const HIGH_PATTERNS: PatternDef[] = [
  {
    type: "aws_access_key",
    severity: "high",
    source: "\\bAKIA[0-9A-Z]{16}\\b",
    flags: "g",
  },
  {
    type: "aws_secret_key",
    severity: "high",
    source: "(?:aws|secret|credential)[^\\n]{0,40}?([A-Za-z0-9/+=]{40})",
    flags: "gi",
  },
  {
    type: "api_key_sk",
    severity: "high",
    source: "\\bsk-[a-zA-Z0-9_-]{20,}\\b",
    flags: "g",
  },
  {
    type: "api_key_github",
    severity: "high",
    source: "\\bghp_[a-zA-Z0-9]{36,}\\b",
    flags: "g",
  },
  {
    type: "api_key_slack",
    severity: "high",
    source: "\\bxox[bp]-[a-zA-Z0-9-]{10,}\\b",
    flags: "g",
  },
  {
    type: "bearer_token",
    severity: "high",
    source: "Bearer\\s+([A-Za-z0-9._~+/=-]{20,})",
    flags: "g",
  },
  {
    type: "ssn",
    severity: "high",
    source: "\\b(\\d{3})-(\\d{2})-(\\d{4})\\b",
    flags: "g",
    validate: (match) => {
      const area = parseInt(match[1], 10);
      // Reject invalid SSN area numbers: 000, 666, 900+
      if (area === 0 || area === 666 || area >= 900) return false;
      const group = parseInt(match[2], 10);
      if (group === 0) return false;
      const serial = parseInt(match[3], 10);
      if (serial === 0) return false;
      return true;
    },
  },
  {
    type: "credit_card",
    severity: "high",
    source: "\\b(\\d{4})[\\s-]?(\\d{4})[\\s-]?(\\d{4})[\\s-]?(\\d{4})\\b",
    flags: "g",
    validate: (match) => {
      const digits = match[1] + match[2] + match[3] + match[4];
      return luhnCheck(digits);
    },
  },
  {
    type: "private_key",
    severity: "high",
    source: "-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----",
    flags: "g",
  },
  {
    type: "db_password",
    severity: "high",
    source: "(?:postgres(?:ql)?|mongo(?:db)?|mysql|redis|amqp)://[^\\s:]+:([^@\\s]+)@[^\\s]+",
    flags: "gi",
  },
];

const MEDIUM_PATTERNS: PatternDef[] = [
  {
    type: "connection_string",
    severity: "medium",
    source: "(?:postgres(?:ql)?|mongo(?:db)?|mysql|redis|amqp)://[^\\s]+",
    flags: "gi",
  },
  {
    type: "bulk_email",
    severity: "medium",
    source: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    flags: "g",
    validate: (_match, text) => {
      // Only flag if >10 distinct emails in the text
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = emailRegex.exec(text)) !== null) {
        emails.add(m[0].toLowerCase());
      }
      return emails.size > 10;
    },
  },
  {
    type: "internal_ip",
    severity: "medium",
    source: "\\b(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3})\\b",
    flags: "g",
  },
];

// ── Pure helpers ────────────────────────────────────────────────────────────

export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 13) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactValue(value: string): string {
  if (value.length <= 4) {
    return value[0] + "****";
  }
  return value.slice(0, 4) + "****";
}

// ── Core scanning ──────────────────────────────────────────────────────────

export function scanText(text: string): ScanResult {
  const findings: ScanFinding[] = [];
  const coveredRanges: Array<{ start: number; end: number }> = [];

  // Pass 1: High severity
  for (const pat of HIGH_PATTERNS) {
    const regex = new RegExp(pat.source, pat.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (pat.validate && !pat.validate(match, text)) continue;
      const value = match[0];
      findings.push({
        type: pat.type,
        severity: "high",
        redactedValue: redactValue(value),
        index: match.index,
      });
      coveredRanges.push({ start: match.index, end: match.index + value.length });
    }
  }

  // Pass 2: Medium severity (skip ranges already covered by high-severity findings)
  for (const pat of MEDIUM_PATTERNS) {
    const regex = new RegExp(pat.source, pat.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (pat.validate && !pat.validate(match, text)) continue;
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      // Deduplicate: skip if this match overlaps with any high-severity range
      const overlaps = coveredRanges.some(
        (r) => start < r.end && end > r.start,
      );
      if (overlaps) continue;

      findings.push({
        type: pat.type,
        severity: "medium",
        redactedValue: redactValue(value),
        index: match.index,
      });
    }
  }

  return {
    hasHighSeverity: findings.some((f) => f.severity === "high"),
    hasMediumSeverity: findings.some((f) => f.severity === "medium"),
    findings,
  };
}

// ── User-facing message ────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  aws_access_key: "AWS Access Key",
  aws_secret_key: "AWS Secret Key",
  api_key_sk: "API Key",
  api_key_github: "GitHub Token",
  api_key_slack: "Slack Token",
  bearer_token: "Bearer Token",
  ssn: "Social Security Number",
  credit_card: "Credit Card Number",
  private_key: "Private Key",
  db_password: "Database Password",
  connection_string: "Connection String",
  bulk_email: "Bulk Email Addresses",
  internal_ip: "Internal IP Address",
};

export function buildBlockMessage(findings: ScanFinding[]): string {
  const highFindings = findings.filter((f) => f.severity === "high");
  if (highFindings.length === 0) return "";

  const uniqueTypes = [...new Set(highFindings.map((f) => f.type))];
  const labels = uniqueTypes.map((t) => TYPE_LABELS[t] ?? t);

  return (
    "Request blocked: sensitive data detected. " +
    `Found: ${labels.join(", ")}. ` +
    "Please remove sensitive data before retrying."
  );
}
