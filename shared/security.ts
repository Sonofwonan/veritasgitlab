export type SecurityOutcome = "success" | "failed" | "denied" | "pending_review";
export type SecuritySeverity = "info" | "warning" | "critical";
export type SecurityActorType = "client" | "admin" | "system";

export type SecurityStatus = {
  twoFactorEnabled: boolean;
  setupRequired: boolean;
  recoveryCodesRemaining: number;
};

export type MfaChallenge = { mfaRequired: true };
export type SetupResult = { secret: string; qrCodeDataUrl: string; expiresAt: string };
export type RecoveryResult = { recoveryCodes: string[] };
export type Reauthentication = { currentPassword: string; code?: string };

export type SecurityActivityItem = {
  id: number;
  event: string;
  label: string;
  category?: string;
  outcome?: SecurityOutcome | string;
  actorType?: SecurityActorType | string;
  actorLabel?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  deviceSummary?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  sessionPrefix?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

export type ClientSessionItem = {
  sessionPrefix: string;
  deviceSummary: string;
  deviceType: string;
  os: string;
  browser: string;
  ipAddress: string | null;
  location: string | null;
  mfaVerified: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current?: boolean;
};

export type ComplianceAuditItem = {
  id: number;
  category: string;
  action: string;
  outcome: SecurityOutcome | string;
  severity: SecuritySeverity | string;
  actorType: SecurityActorType | string;
  actorId: string | null;
  actorLabel: string | null;
  targetUserId: number | null;
  targetClientRef: string | null;
  ipAddress: string | null;
  location: string | null;
  deviceSummary: string | null;
  userAgent: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  sessionPrefix: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ComplianceAuditSummary = {
  total24h: number;
  failedLogins24h: number;
  activeClientSessions: number;
  criticalEvents24h: number;
};

export const securityPaths = {
  status: "/api/security/status",
  password: "/api/security/password",
  setup: "/api/security/two-factor/setup",
  confirm: "/api/security/two-factor/confirm",
  disable: "/api/security/two-factor/disable",
  recovery: "/api/security/two-factor/recovery",
  challenge: "/api/security/two-factor/challenge",
  activity: "/api/security/activity",
  sessions: "/api/security/sessions",
  revokeSession: (prefix: string) => `/api/security/sessions/${encodeURIComponent(prefix)}/revoke`,
  revokeOtherSessions: "/api/security/sessions/revoke-others",
} as const;
