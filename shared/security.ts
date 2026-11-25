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
  createdAt: string;
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
  revokeOtherSessions: "/api/security/sessions/revoke-others",
} as const;
