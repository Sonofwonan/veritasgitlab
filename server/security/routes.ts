import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { generateURI } from "otplib";
import { hasDatabaseConfig, pool } from "../db";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import { securityPaths } from "@shared/security";
import { comparePasswords, decryptSecret, digest, encryptSecret, generateSecret, hashPassword, recoveryDigest, SecurityError, verifyTotp } from "./crypto";
import {
  audit,
  consumeFactor,
  getSecurity,
  listClientActiveSessions,
  rateLimit,
  recordComplianceAudit,
  revokeSessions,
  revokeSingleClientSession,
  safeUser,
  withSecurity,
} from "./store";
import { destroySession, finishLogin } from "./session";
import { isTrustedOrigin } from "./origins";

const reauthentication = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(128, "Use no more than 128 characters."),
  code: z.string().trim().max(128).optional(),
}).strict();

// Browsers must make sensitive writes from an explicitly trusted origin using JSON.
export function securityOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!isTrustedOrigin(origin, req) || !req.is("application/json")) {
    return void res.status(403).json({ message: "This security request could not be verified." });
  }
  next();
}

export function securityHandler(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: error.errors[0]?.message || "Check your security details." });
      if (error instanceof SecurityError) return void res.status(error.status).json({ message: error.message });
      // No SQL parameters, credentials, authenticator secrets, or recovery codes in logs.
      console.error("Security request failed.");
      res.status(500).json({ message: "We couldn’t update your security settings. Please try again." });
    }
  };
}

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  password_sign_in: "Signed in with password",
  password_verified_for_mfa: "Password verified for two-factor sign-in",
  mfa_sign_in: "Completed two-factor sign-in",
  login_failed: "Failed sign-in attempt blocked",
  mfa_challenge_failed: "Failed two-factor verification code",
  client_logout: "Signed out of client portal",
  session_expired_inactivity: "Session closed due to inactivity",
  password_changed: "Account password updated",
  password_reset_by_admin_link: "Password set via verified advisor link",
  mfa_setup_started: "Authenticator setup initiated",
  mfa_enabled: "Two-factor authentication enabled",
  mfa_disabled: "Two-factor authentication disabled",
  recovery_codes_replaced: "Recovery codes regenerated",
  recovery_codes_requested: "Emergency recovery codes requested",
  admin_recovery_codes_issued_identity_verified: "Advisor issued verified recovery codes",
  admin_recovery_request_rejected: "Recovery code request declined",
  contact_details_updated: "Contact or address details updated",
  banking_preferences_updated: "Statement and alert preferences updated",
  portal_preferences_updated: "Portal preferences updated",
  other_sessions_signed_out: "Signed out of all other sessions",
  single_session_revoked: "Signed out of a specific device session",
  admin_sessions_revoked: "Advisor terminated all client sessions",
  admin_single_session_revoked: "Advisor terminated a client device session",
  wire_transfer_submitted: "Wire disbursement instruction submitted",
  internal_transfer_executed: "Internal account transfer executed",
  initial_deposit_submitted: "Initial / funding deposit submitted",
  institutional_transfer_submitted: "Institutional transfer instruction submitted",
  beneficiary_added: "Beneficiary payee added",
  beneficiary_deleted: "Beneficiary payee removed",
  investment_order_executed: "Portfolio order executed",
  account_opening_requested: "New account opening request submitted",
  card_status_changed: "Card lock or status changed",
  card_settings_updated: "Card spend controls updated",
  admin_profile_updated: "Advisor updated client profile details",
  admin_controls_updated: "Advisor updated client feature permissions",
  admin_account_activated: "Advisor activated client account",
};

export function registerSecurityRoutes(app: Express) {
  const authenticated = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return void res.status(401).json({ message: "Please sign in again." });
    next();
  };
  app.get(securityPaths.status, authenticated, securityHandler(async (req, res) => {
    const user = req.user as User;
    const state = await getSecurity(user.id);
    const { rows: [codes] } = hasDatabaseConfig
      ? await pool.query("SELECT COUNT(*)::INTEGER AS count FROM client_security_recovery WHERE user_id=$1 AND consumed_at IS NULL", [user.id])
      : { rows: [{ count: 0 }] };
    res.json({ twoFactorEnabled: state.mfa_enabled, setupRequired: user.twoFactorEnabled && !state.mfa_enabled, recoveryCodesRemaining: codes.count });
  }));

  const sensitive = [authenticated, securityOrigin];
  app.post(securityPaths.password, ...sensitive, securityHandler(async (req, res) => {
    const input = reauthentication.extend({
      newPassword: z.string().min(12, "Use at least 12 characters.").max(128),
      confirmPassword: z.string().max(128),
    }).refine(value => value.newPassword === value.confirmPassword, "The new passwords don’t match.").parse(req.body);
    const currentUser = req.user as User;
    const userId = currentUser.id;
    await rateLimit(`security:${userId}`);
    if (input.currentPassword === input.newPassword) throw new SecurityError(400, "Choose a different password.");
    const hash = await hashPassword(input.newPassword);
    await withSecurity(userId, async (db, state, user) => {
      if (!await comparePasswords(input.currentPassword, user.password)) throw new SecurityError(400, "Your current password is incorrect.");
      if (state.mfa_enabled) await consumeFactor(db, state, input.code || "");
      await db.query("UPDATE users SET password=$2 WHERE id=$1", [userId, hash]);
      await db.query("UPDATE client_security SET version=version+1,pending_secret=NULL,pending_expires=NULL,pending_session=NULL WHERE user_id=$1", [userId]);
      await revokeSessions(db, userId);
      await audit(db, userId, "password_changed", {
        req,
        category: "auth",
        actorType: "client",
        actorLabel: currentUser.clientRef || currentUser.name,
        targetClientRef: currentUser.clientRef ?? null,
      });
    });
    await destroySession(req);
    res.clearCookie("connect.sid", { path: "/" });
    res.json({ ok: true });
  }));

  app.post(securityPaths.setup, ...sensitive, securityHandler(async (req, res) => {
    const { currentPassword } = reauthentication.parse(req.body);
    const user = req.user as User;
    await rateLimit(`security:${user.id}`);
    const secret = generateSecret();
    const encrypted = encryptSecret(secret, user.id);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const uri = generateURI({ secret, issuer: "Veritas Wealth", label: user.clientRef || String(user.id) });
    const qrCodeDataUrl = await QRCode.toDataURL(uri);
    await withSecurity(user.id, async (db, state, current) => {
      if (!await comparePasswords(currentPassword, current.password)) throw new SecurityError(400, "Your current password is incorrect.");
      if (state.mfa_enabled) throw new SecurityError(409, "Two-factor authentication is already enabled.");
      await db.query("UPDATE client_security SET pending_secret=$2,pending_expires=$3,pending_session=$4 WHERE user_id=$1", [user.id, encrypted, expiresAt, digest(req.sessionID)]);
      await audit(db, user.id, "mfa_setup_started", {
        req,
        category: "mfa",
        actorType: "client",
        actorLabel: user.clientRef || user.name,
        targetClientRef: user.clientRef ?? null,
      });
    });
    res.json({ secret, qrCodeDataUrl, expiresAt: expiresAt.toISOString() });
  }));

  app.post(securityPaths.confirm, ...sensitive, securityHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your app.") }).strict().parse(req.body);
    const user = req.user as User;
    await rateLimit(`security:${user.id}`);
    // Recovery sets are issued only by an administrator after a client request.
    const codes: string[] = [];
    const version = await withSecurity(user.id, async (db, state) => {
      if (state.mfa_enabled || !state.pending_secret || !state.pending_expires ||
          state.pending_expires.getTime() <= Date.now() || state.pending_session !== digest(req.sessionID)) {
        throw new SecurityError(400, "Setup has expired. Please start again.");
      }
      const step = await verifyTotp(decryptSecret(state.pending_secret, user.id), code);
      if (step === null) throw new SecurityError(400, "Enter a valid code from your authenticator app.");
      await db.query("UPDATE client_security SET mfa_enabled=TRUE,secret=pending_secret,last_totp_step=$2,version=version+1,pending_secret=NULL,pending_expires=NULL,pending_session=NULL WHERE user_id=$1", [user.id, step]);
      await db.query("UPDATE users SET two_factor_enabled=TRUE WHERE id=$1", [user.id]);
      await replaceRecoveryCodes(db, user.id, codes);
      await revokeSessions(db, user.id, req.sessionID);
      await audit(db, user.id, "mfa_enabled", {
        req,
        category: "mfa",
        actorType: "client",
        actorLabel: user.clientRef || user.name,
        targetClientRef: user.clientRef ?? null,
      });
      return state.version + 1;
    });
    await finishLogin(req, user, version, true);
    res.json({ recoveryCodes: codes });
  }));

  app.post(securityPaths.recovery, ...sensitive, securityHandler(async (_req, res) => {
    res.status(403).json({ message: "Only an administrator can issue recovery codes. Submit a request in Security settings." });
  }));

  for (const operation of ["disable"] as const) {
    app.post(securityPaths[operation], ...sensitive, securityHandler(async (req, res) => {
      const input = reauthentication.parse(req.body);
      const user = req.user as User;
      await rateLimit(`security:${user.id}`);
      const codes: string[] = [];
      const version = await withSecurity(user.id, async (db, state, current) => {
        if (!await comparePasswords(input.currentPassword, current.password)) throw new SecurityError(400, "Your current password is incorrect.");
        await consumeFactor(db, state, input.code || "");
        if (operation === "disable") {
          await db.query("UPDATE client_security SET mfa_enabled=FALSE,secret=NULL,last_totp_step=-1,version=version+1,pending_secret=NULL,pending_expires=NULL,pending_session=NULL WHERE user_id=$1", [user.id]);
          await db.query("UPDATE users SET two_factor_enabled=FALSE WHERE id=$1", [user.id]);
        } else {
          await db.query("UPDATE client_security SET version=version+1 WHERE user_id=$1", [user.id]);
        }
        await replaceRecoveryCodes(db, user.id, codes);
        await revokeSessions(db, user.id, req.sessionID);
        await audit(db, user.id, operation === "disable" ? "mfa_disabled" : "recovery_codes_replaced", {
          req,
          category: "mfa",
          severity: "warning",
          actorType: "client",
          actorLabel: user.clientRef || user.name,
          targetClientRef: user.clientRef ?? null,
        });
        return state.version + 1;
      });
      await finishLogin(req, user, version, operation !== "disable");
      res.json(operation === "disable" ? { ok: true } : { recoveryCodes: codes });
    }));
  }

  // A pending password-only session has no Passport identity and cannot access any client API.
  app.post(securityPaths.challenge, securityOrigin, securityHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(128) }).strict().parse(req.body);
    const pending = req.session.pendingMfa;
    if (!pending || pending.expiresAt <= Date.now() || pending.attempts >= 5) {
      if (pending?.userId) {
        await recordComplianceAudit({
          req,
          category: "mfa",
          action: "mfa_challenge_failed",
          outcome: "denied",
          severity: "warning",
          actorType: "client",
          actorId: String(pending.userId),
          targetUserId: pending.userId,
          metadata: { reason: "expired_or_max_attempts" },
        });
      }
      await destroySession(req);
      throw new SecurityError(401, "Please sign in again to get a new security check.");
    }
    pending.attempts += 1;
    await rateLimit(`mfa-login:${pending.userId}`, 10);
    let version = 0;
    try {
      version = await withSecurity(pending.userId, async (db, state, user) => {
        if (!state.mfa_enabled || state.version !== pending.version || digest(user.password) !== pending.passwordStamp) {
          throw new SecurityError(401, "Please sign in again.");
        }
        await consumeFactor(db, state, code);
        await audit(db, pending.userId, "mfa_sign_in", {
          req,
          category: "auth",
          actorType: "client",
          actorId: String(pending.userId),
          metadata: { method: /^\d{6}$/.test(code) ? "totp" : "recovery_code" },
        });
        return state.version;
      });
    } catch (err) {
      await audit(pool, pending.userId, "mfa_challenge_failed", {
        req,
        category: "mfa",
        outcome: "failed",
        severity: "warning",
        actorType: "client",
        actorId: String(pending.userId),
        metadata: { attempt: pending.attempts },
      });
      throw err;
    }
    const user = await storage.getUser(pending.userId);
    if (!user) throw new SecurityError(401, "Please sign in again.");
    await finishLogin(req, user, version, true);
    res.json(await safeUser(user));
  }));

  app.get(securityPaths.activity, authenticated, securityHandler(async (req, res) => {
    const userId = (req.user as User).id;
    if (!hasDatabaseConfig) {
      return res.json([]);
    }
    const { rows } = await pool.query(
      `SELECT id,
              event,
              category,
              outcome,
              actor_type AS "actorType",
              actor_label AS "actorLabel",
              ip_address AS "ipAddress",
              location,
              device_summary AS "deviceSummary",
              browser,
              os,
              device_type AS "deviceType",
              session_prefix AS "sessionPrefix",
              metadata,
              created_at AS "createdAt"
       FROM client_security_events
       WHERE user_id=$1
       ORDER BY id DESC
       LIMIT 25`,
      [userId],
    );
    res.json(rows.map((row: any) => ({
      id: Number(row.id),
      event: row.event,
      label: SECURITY_EVENT_LABELS[row.event] || "Account security update",
      category: row.category || "security",
      outcome: row.outcome || "success",
      actorType: row.actorType || "client",
      actorLabel: row.actorLabel ?? null,
      ipAddress: row.ipAddress ?? null,
      location: row.location ?? null,
      deviceSummary: row.deviceSummary ?? null,
      browser: row.browser ?? null,
      os: row.os ?? null,
      deviceType: row.deviceType ?? null,
      sessionPrefix: row.sessionPrefix ?? null,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      createdAt: new Date(row.createdAt).toISOString(),
    })));
  }));

  app.get(securityPaths.sessions, authenticated, securityHandler(async (req, res) => {
    const userId = (req.user as User).id;
    const sessions = await listClientActiveSessions(userId, req.sessionID);
    res.json(sessions);
  }));

  app.post("/api/security/sessions/:prefix/revoke", ...sensitive, securityHandler(async (req, res) => {
    const prefix = z.string().regex(/^[a-f0-9]{12}$/i, "Invalid session identifier.").parse(req.params.prefix).toLowerCase();
    const user = req.user as User;
    if (req.sessionID && digest(req.sessionID).startsWith(prefix)) {
      throw new SecurityError(400, "Use Sign out to end your current session.");
    }
    await rateLimit(`revoke-session:${user.id}`);
    const revoked = await withSecurity(user.id, async (db) => {
      const ok = await revokeSingleClientSession(db, user.id, prefix);
      if (ok) {
        await audit(db, user.id, "single_session_revoked", {
          req,
          category: "session",
          severity: "warning",
          actorType: "client",
          actorLabel: user.clientRef || user.name,
          targetClientRef: user.clientRef ?? null,
          metadata: { revokedSessionPrefix: prefix },
        });
      }
      return ok;
    });
    if (!revoked) throw new SecurityError(404, "That device session is already closed.");
    res.json({ ok: true });
  }));

  app.post(securityPaths.revokeOtherSessions, ...sensitive, securityHandler(async (req, res) => {
    const user = req.user as User;
    const userId = user.id;
    await rateLimit(`revoke-sessions:${userId}`);
    await withSecurity(userId, async (db) => {
      await revokeSessions(db, userId, req.sessionID);
      await audit(db, userId, "other_sessions_signed_out", {
        req,
        category: "session",
        severity: "warning",
        actorType: "client",
        actorLabel: user.clientRef || user.name,
        targetClientRef: user.clientRef ?? null,
      });
    });
    res.json({ ok: true });
  }));
}

export async function replaceRecoveryCodes(db: import("pg").PoolClient, userId: number, codes: string[]) {
  await db.query("DELETE FROM client_security_recovery WHERE user_id=$1", [userId]);
  for (const code of codes) await db.query("INSERT INTO client_security_recovery(user_id,digest) VALUES($1,$2)", [userId, recoveryDigest(userId, code)]);
}
