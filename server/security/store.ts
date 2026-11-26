import type { Request } from "express";
import type { PoolClient } from "pg";
import { hasDatabaseConfig, pool } from "../db";
import type { User } from "@shared/schema";
import type { ClientSessionItem, ComplianceAuditItem, ComplianceAuditSummary, SecurityActorType, SecurityOutcome, SecuritySeverity } from "@shared/security";
import { decryptSecret, digest, recoveryDigest, SecurityError, verifyTotp } from "./crypto";
import { extractRequestAuditContext, sanitizeAuditMetadata } from "./audit-context";

export type SecurityState = {
  user_id: number; version: number; mfa_enabled: boolean; secret: string | null;
  last_totp_step: string; pending_secret: string | null; pending_expires: Date | null;
  pending_session: string | null;
};

export type AuditOptions = {
  req?: Request | null;
  category?: string;
  outcome?: SecurityOutcome;
  severity?: SecuritySeverity;
  actorType?: SecurityActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  targetClientRef?: string | null;
  metadata?: Record<string, unknown> | null;
  skipComplianceLog?: boolean;
};

export type ComplianceAuditInput = {
  req?: Request | null;
  category: string;
  action: string;
  outcome?: SecurityOutcome;
  severity?: SecuritySeverity;
  actorType: SecurityActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  targetUserId?: number | null;
  targetClientRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

type MemoryActiveSession = ClientSessionItem & {
  sessionDigest: string;
  userId: number;
  revokedAt: number | null;
};

const memoryComplianceLogs: ComplianceAuditItem[] = [];
let memoryComplianceNextId = 1;
const memoryActiveSessions = new Map<string, MemoryActiveSession>();
const memoryRevokedSessionDigests = new Map<string, number>();
const lastTouchBySession = new Map<string, number>();

const CLIENT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

function inferCategoryFromEvent(event: string): string {
  if (/sign_in|login|logout|password_verified/i.test(event)) return "auth";
  if (/mfa|recovery/i.test(event)) return "mfa";
  if (/session/i.test(event)) return "session";
  if (/wire|transfer|deposit|payee|beneficiary|investment|trade/i.test(event)) return "money_movement";
  if (/card/i.test(event)) return "card_control";
  if (/contact|preference|profile|account_opening|application/i.test(event)) return "kyc_profile";
  if (/admin/i.test(event)) return "admin_action";
  return "security";
}

function inferSeverityFromEvent(event: string, outcome: SecurityOutcome): SecuritySeverity {
  if (outcome === "failed" || outcome === "denied") {
    return /admin|mfa|password/i.test(event) ? "critical" : "warning";
  }
  if (/disabled|revoked|deleted|frozen|reset|issued/i.test(event)) return "warning";
  return "info";
}

export async function initializeSecurity() {
  if (!hasDatabaseConfig) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_security (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 0,
      mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      secret TEXT,
      last_totp_step BIGINT NOT NULL DEFAULT -1,
      pending_secret TEXT,
      pending_expires TIMESTAMPTZ,
      pending_session TEXT,
      CHECK (NOT mfa_enabled OR secret IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS client_security_recovery (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      digest TEXT NOT NULL UNIQUE,
      consumed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS client_security_events (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'security';
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success';
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'client';
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS actor_label TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS ip_address TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS device_summary TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS os TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS browser TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS device_type TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS session_prefix TEXT;
    ALTER TABLE client_security_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS client_security_events_user_idx ON client_security_events(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS client_active_sessions (
      session_digest TEXT PRIMARY KEY,
      session_prefix TEXT NOT NULL,
      session_sid TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      location TEXT,
      device_type TEXT NOT NULL DEFAULT 'Desktop',
      os TEXT NOT NULL DEFAULT 'Unknown OS',
      browser TEXT NOT NULL DEFAULT 'Unknown Browser',
      device_summary TEXT NOT NULL DEFAULT 'Unknown Client',
      user_agent TEXT,
      mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS client_active_sessions_user_idx ON client_active_sessions(user_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS compliance_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'success',
      severity TEXT NOT NULL DEFAULT 'info',
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      actor_label TEXT,
      target_user_id INTEGER,
      target_client_ref TEXT,
      ip_address TEXT,
      location TEXT,
      device_summary TEXT,
      user_agent TEXT,
      request_method TEXT,
      request_path TEXT,
      session_prefix TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS compliance_audit_logs_created_idx ON compliance_audit_logs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS compliance_audit_logs_category_idx ON compliance_audit_logs(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS compliance_audit_logs_target_user_idx ON compliance_audit_logs(target_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS client_auth_limits (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS client_session_expire ON session(expire);
  `);
}

export async function getSecurity(userId: number): Promise<SecurityState> {
  if (!hasDatabaseConfig) {
    return {
      user_id: userId, version: 0, mfa_enabled: false, secret: null,
      last_totp_step: "-1", pending_secret: null, pending_expires: null, pending_session: null,
    };
  }
  const result = await pool.query("SELECT * FROM client_security WHERE user_id=$1", [userId]);
  return result.rows[0] || {
    user_id: userId, version: 0, mfa_enabled: false, secret: null,
    last_totp_step: "-1", pending_secret: null, pending_expires: null, pending_session: null,
  };
}

export async function safeUser(user: User) {
  const { password: _password, ...publicUser } = user;
  const state = await getSecurity(user.id);
  return { ...publicUser, twoFactorEnabled: state.mfa_enabled };
}

export async function withSecurity<T>(userId: number, action: (db: PoolClient, state: SecurityState, user: User) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO client_security(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
    const { rows: [state] } = await client.query("SELECT * FROM client_security WHERE user_id=$1 FOR UPDATE", [userId]);
    // Consistent lock order protects credential changes and one-time code consumption.
    const { rows: [raw] } = await client.query("SELECT password, account_frozen, login_restricted FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!raw || raw.account_frozen || raw.login_restricted) throw new SecurityError(403, "Account access is restricted. Please contact your advisor.");
    const user = { id: userId, password: raw.password } as User;
    const result = await action(client, state, user);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

// Persistent, atomic limits also apply across workers and server restarts.
export async function rateLimit(bucket: string, max = 12) {
  if (!hasDatabaseConfig) return;
  const { rows: [row] } = await pool.query(`
    INSERT INTO client_auth_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN client_auth_limits.expires_at<=NOW() THEN 1 ELSE client_auth_limits.attempts+1 END,
      expires_at=CASE WHEN client_auth_limits.expires_at<=NOW() THEN NOW()+INTERVAL '15 minutes' ELSE client_auth_limits.expires_at END
    RETURNING attempts`, [digest(bucket)]);
  if (row.attempts > max) throw new SecurityError(429, "Too many attempts. Please try again in 15 minutes.");
  // Expired buckets contain no identity data and need not accumulate indefinitely.
  await pool.query("DELETE FROM client_auth_limits WHERE expires_at < NOW()-INTERVAL '1 day'");
}

export async function consumeFactor(db: PoolClient, state: SecurityState, code: string) {
  if (!state.mfa_enabled || !state.secret) throw new SecurityError(409, "Two-factor authentication is not set up.");
  if (/^\d{6}$/.test(code)) {
    const step = await verifyTotp(decryptSecret(state.secret, state.user_id), code, Number(state.last_totp_step));
    if (step === null) throw new SecurityError(400, "Enter a new code from your authenticator app.");
    await db.query("UPDATE client_security SET last_totp_step=$2 WHERE user_id=$1", [state.user_id, step]);
  } else {
    if (!/^[a-f0-9]{20}$/i.test(code.replace(/-/g, ""))) throw new SecurityError(400, "Enter a valid security or recovery code.");
    const result = await db.query(
      "UPDATE client_security_recovery SET consumed_at=NOW() WHERE user_id=$1 AND digest=$2 AND consumed_at IS NULL RETURNING id",
      [state.user_id, recoveryDigest(state.user_id, code)],
    );
    if (result.rowCount !== 1) throw new SecurityError(400, "This recovery code is invalid or has already been used.");
  }
}

export async function upsertClientActiveSession(req: Request, userId: number, mfaVerified: boolean) {
  if (!req.sessionID) return;
  const ctx = extractRequestAuditContext(req);
  const sessionDigest = digest(req.sessionID);
  const sessionPrefix = sessionDigest.slice(0, 12);
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_MS);

  memoryRevokedSessionDigests.delete(sessionDigest);
  lastTouchBySession.set(sessionDigest, Date.now());

  if (!hasDatabaseConfig) {
    const nowIso = new Date().toISOString();
    memoryActiveSessions.set(sessionDigest, {
      sessionDigest,
      sessionPrefix,
      userId,
      deviceSummary: ctx.deviceSummary,
      deviceType: ctx.deviceType,
      os: ctx.os,
      browser: ctx.browser,
      ipAddress: ctx.ipAddress,
      location: ctx.location,
      mfaVerified,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    });
    return;
  }

  await pool.query(
    `INSERT INTO client_active_sessions (
       session_digest, session_prefix, session_sid, user_id,
       ip_address, location, device_type, os, browser, device_summary,
       user_agent, mfa_verified, created_at, last_seen_at, expires_at, revoked_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),$13,NULL)
     ON CONFLICT (session_digest) DO UPDATE SET
       session_sid = EXCLUDED.session_sid,
       ip_address = COALESCE(EXCLUDED.ip_address, client_active_sessions.ip_address),
       location = COALESCE(EXCLUDED.location, client_active_sessions.location),
       device_type = EXCLUDED.device_type,
       os = EXCLUDED.os,
       browser = EXCLUDED.browser,
       device_summary = EXCLUDED.device_summary,
       user_agent = COALESCE(EXCLUDED.user_agent, client_active_sessions.user_agent),
       mfa_verified = EXCLUDED.mfa_verified,
       last_seen_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       revoked_at = NULL`,
    [
      sessionDigest,
      sessionPrefix,
      req.sessionID,
      userId,
      ctx.ipAddress,
      ctx.location,
      ctx.deviceType,
      ctx.os,
      ctx.browser,
      ctx.deviceSummary,
      ctx.userAgent,
      mfaVerified,
      expiresAt,
    ],
  ).catch(() => {});
}

export async function touchClientActiveSession(req: Request, userId: number, mfaVerified?: boolean) {
  if (!req.sessionID) return;
  const sessionDigest = digest(req.sessionID);
  const lastTouch = lastTouchBySession.get(sessionDigest) || 0;
  if (Date.now() - lastTouch < SESSION_TOUCH_INTERVAL_MS) return;
  lastTouchBySession.set(sessionDigest, Date.now());

  const ctx = extractRequestAuditContext(req);
  if (!hasDatabaseConfig) {
    const existing = memoryActiveSessions.get(sessionDigest);
    if (existing && !existing.revokedAt) {
      existing.lastSeenAt = new Date().toISOString();
      if (ctx.ipAddress) existing.ipAddress = ctx.ipAddress;
      if (ctx.location) existing.location = ctx.location;
      if (typeof mfaVerified === "boolean") existing.mfaVerified = mfaVerified;
    } else if (!existing) {
      await upsertClientActiveSession(req, userId, Boolean(mfaVerified));
    }
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE client_active_sessions
     SET last_seen_at = NOW(),
         ip_address = COALESCE($2, ip_address),
         location = COALESCE($3, location)
     WHERE session_digest = $1 AND user_id = $4 AND revoked_at IS NULL`,
    [sessionDigest, ctx.ipAddress, ctx.location, userId],
  ).catch(() => ({ rowCount: 0 }));

  if (!rowCount) {
    await upsertClientActiveSession(req, userId, Boolean(mfaVerified));
  }
}

export async function isClientSessionRevoked(sessionId?: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const sessionDigest = digest(sessionId);
  const memRevoked = memoryRevokedSessionDigests.get(sessionDigest);
  if (memRevoked && Date.now() - memRevoked < CLIENT_SESSION_TTL_MS) {
    return true;
  }
  if (!hasDatabaseConfig) {
    const memSess = memoryActiveSessions.get(sessionDigest);
    return Boolean(memSess?.revokedAt);
  }
  const { rows } = await pool.query(
    `SELECT revoked_at FROM client_active_sessions WHERE session_digest = $1 LIMIT 1`,
    [sessionDigest],
  ).catch(() => ({ rows: [] as any[] }));
  return Boolean(rows[0]?.revoked_at);
}

export async function markSessionRevoked(sessionId?: string | null) {
  if (!sessionId) return;
  const sessionDigest = digest(sessionId);
  memoryRevokedSessionDigests.set(sessionDigest, Date.now());
  lastTouchBySession.delete(sessionDigest);
  if (!hasDatabaseConfig) {
    const mem = memoryActiveSessions.get(sessionDigest);
    if (mem) mem.revokedAt = Date.now();
    return;
  }
  await pool.query(
    `UPDATE client_active_sessions SET revoked_at = NOW() WHERE session_digest = $1`,
    [sessionDigest],
  ).catch(() => {});
}

export async function listClientActiveSessions(userId: number, currentSessionId?: string | null): Promise<ClientSessionItem[]> {
  const currentDigest = currentSessionId ? digest(currentSessionId) : null;
  if (!hasDatabaseConfig) {
    const now = Date.now();
    return Array.from(memoryActiveSessions.values())
      .filter((s) => s.userId === userId && !s.revokedAt && new Date(s.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .map(({ sessionDigest, userId: _uid, revokedAt: _revoked, ...item }) => ({
        ...item,
        current: currentDigest ? sessionDigest === currentDigest : false,
      }));
  }

  const { rows } = await pool.query(
    `SELECT session_digest AS "sessionDigest",
            session_prefix AS "sessionPrefix",
            device_summary AS "deviceSummary",
            device_type AS "deviceType",
            os,
            browser,
            ip_address AS "ipAddress",
            location,
            mfa_verified AS "mfaVerified",
            created_at AS "createdAt",
            last_seen_at AS "lastSeenAt",
            expires_at AS "expiresAt"
     FROM client_active_sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY last_seen_at DESC
     LIMIT 25`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));

  return rows.map((row) => ({
    sessionPrefix: row.sessionPrefix,
    deviceSummary: row.deviceSummary,
    deviceType: row.deviceType,
    os: row.os,
    browser: row.browser,
    ipAddress: row.ipAddress ?? null,
    location: row.location ?? null,
    mfaVerified: Boolean(row.mfaVerified),
    createdAt: new Date(row.createdAt).toISOString(),
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    current: currentDigest ? row.sessionDigest === currentDigest : false,
  }));
}

export async function revokeSingleClientSession(db: PoolClient | null, userId: number, sessionPrefix: string): Promise<boolean> {
  if (!/^[a-f0-9]{12}$/i.test(sessionPrefix)) return false;

  if (!hasDatabaseConfig || !db) {
    let found = false;
    for (const [key, sess] of Array.from(memoryActiveSessions.entries())) {
      if (sess.userId === userId && sess.sessionPrefix.toLowerCase() === sessionPrefix.toLowerCase() && !sess.revokedAt) {
        sess.revokedAt = Date.now();
        memoryRevokedSessionDigests.set(key, Date.now());
        found = true;
      }
    }
    return found;
  }

  const { rows } = await db.query(
    `UPDATE client_active_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND session_prefix = $2
       AND revoked_at IS NULL
     RETURNING session_digest AS "sessionDigest", session_sid AS "sessionSid"`,
    [userId, sessionPrefix.toLowerCase()],
  );
  if (rows.length === 0) return false;
  for (const row of rows) {
    memoryRevokedSessionDigests.set(row.sessionDigest, Date.now());
    await db.query(`DELETE FROM session WHERE sid = $1`, [row.sessionSid]).catch(() => {});
  }
  return true;
}

export async function revokeSessions(db: PoolClient, userId: number, keepSid?: string) {
  const keepDigest = keepSid ? digest(keepSid) : null;
  if (!hasDatabaseConfig) {
    for (const [key, sess] of Array.from(memoryActiveSessions.entries())) {
      if (sess.userId === userId && (!keepDigest || key !== keepDigest)) {
        sess.revokedAt = Date.now();
        memoryRevokedSessionDigests.set(key, Date.now());
      }
    }
    return;
  }
  await db.query(`DELETE FROM session WHERE
    (sess::jsonb->'passport'->>'user'=$1 OR sess::jsonb->'pendingMfa'->>'userId'=$1)
    AND ($2::TEXT IS NULL OR sid<>$2)`, [String(userId), keepSid || null]);
  const { rows: revokedRows } = await db.query(
    `UPDATE client_active_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND ($2::TEXT IS NULL OR session_digest <> $2)
     RETURNING session_digest AS "sessionDigest"`,
    [userId, keepDigest],
  ).catch(() => ({ rows: [] as any[] }));
  for (const row of revokedRows) {
    memoryRevokedSessionDigests.set(row.sessionDigest, Date.now());
  }
}

export async function recordComplianceAudit(input: ComplianceAuditInput) {
  const ctx = extractRequestAuditContext(input.req);
  const outcome: SecurityOutcome = input.outcome || "success";
  const severity: SecuritySeverity = input.severity || inferSeverityFromEvent(input.action, outcome);
  const metadata = sanitizeAuditMetadata(input.metadata);

  if (!hasDatabaseConfig) {
    memoryComplianceLogs.unshift({
      id: memoryComplianceNextId++,
      category: input.category,
      action: input.action,
      outcome,
      severity,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      targetUserId: input.targetUserId ?? null,
      targetClientRef: input.targetClientRef ?? null,
      ipAddress: ctx.ipAddress,
      location: ctx.location,
      deviceSummary: ctx.deviceSummary,
      userAgent: ctx.userAgent,
      requestMethod: ctx.requestMethod,
      requestPath: ctx.requestPath,
      sessionPrefix: ctx.sessionPrefix,
      metadata,
      createdAt: new Date().toISOString(),
    });
    if (memoryComplianceLogs.length > 1000) {
      memoryComplianceLogs.length = 1000;
    }
    return;
  }

  await pool.query(
    `INSERT INTO compliance_audit_logs (
       category, action, outcome, severity,
       actor_type, actor_id, actor_label,
       target_user_id, target_client_ref,
       ip_address, location, device_summary, user_agent,
       request_method, request_path, session_prefix, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      input.category,
      input.action,
      outcome,
      severity,
      input.actorType,
      input.actorId ?? null,
      input.actorLabel ?? null,
      input.targetUserId ?? null,
      input.targetClientRef ?? null,
      ctx.ipAddress,
      ctx.location,
      ctx.deviceSummary,
      ctx.userAgent,
      ctx.requestMethod,
      ctx.requestPath,
      ctx.sessionPrefix,
      JSON.stringify(metadata),
    ],
  ).catch(() => {});
}

export async function audit(db: PoolClient | typeof pool, userId: number, event: string, opts?: AuditOptions) {
  const ctx = extractRequestAuditContext(opts?.req);
  const category = opts?.category || inferCategoryFromEvent(event);
  const outcome: SecurityOutcome = opts?.outcome || "success";
  const severity: SecuritySeverity = opts?.severity || inferSeverityFromEvent(event, outcome);
  const actorType: SecurityActorType = opts?.actorType || (event.startsWith("admin_") ? "admin" : "client");
  const actorLabel = opts?.actorLabel ?? (opts?.req?.adminStaff ? `${opts.req.adminStaff.displayName} (@${opts.req.adminStaff.username})` : null);
  const metadata = sanitizeAuditMetadata(opts?.metadata);

  if (hasDatabaseConfig) {
    await db.query(
      `INSERT INTO client_security_events (
         user_id, event, category, outcome, actor_type, actor_label,
         ip_address, location, device_summary, os, browser, device_type,
         user_agent, session_prefix, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [
        userId,
        event,
        category,
        outcome,
        actorType,
        actorLabel,
        ctx.ipAddress,
        ctx.location,
        ctx.deviceSummary,
        ctx.os,
        ctx.browser,
        ctx.deviceType,
        ctx.userAgent,
        ctx.sessionPrefix,
        JSON.stringify(metadata),
      ],
    ).catch(() => {});
  }

  if (!opts?.skipComplianceLog) {
    await recordComplianceAudit({
      req: opts?.req,
      category,
      action: event,
      outcome,
      severity,
      actorType,
      actorId: opts?.actorId ?? (actorType === "client" ? String(userId) : opts?.req?.adminStaff ? String(opts.req.adminStaff.id) : null),
      actorLabel,
      targetUserId: userId,
      targetClientRef: opts?.targetClientRef ?? null,
      metadata,
    });
  }
}

export async function queryComplianceAuditLogs(filters: {
  category?: string;
  outcome?: string;
  severity?: string;
  search?: string;
  userId?: number;
  limit?: number;
}): Promise<{ logs: ComplianceAuditItem[]; summary: ComplianceAuditSummary }> {
  const limit = Math.min(Math.max(filters.limit || 150, 1), 500);
  const searchTerm = (filters.search || "").trim().toLowerCase();

  if (!hasDatabaseConfig) {
    const filtered = memoryComplianceLogs.filter((row) => {
      if (filters.category && filters.category !== "all" && row.category !== filters.category) return false;
      if (filters.outcome && filters.outcome !== "all" && row.outcome !== filters.outcome) return false;
      if (filters.severity && filters.severity !== "all" && row.severity !== filters.severity) return false;
      if (filters.userId && row.targetUserId !== filters.userId) return false;
      if (searchTerm) {
        const hay = `${row.action} ${row.actorLabel || ""} ${row.targetClientRef || ""} ${row.ipAddress || ""} ${row.deviceSummary || ""} ${row.location || ""} ${JSON.stringify(row.metadata)}`.toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    }).slice(0, limit);

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = memoryComplianceLogs.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
    const activeClientSessions = Array.from(memoryActiveSessions.values())
      .filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()).length;

    return {
      logs: filtered,
      summary: {
        total24h: recent.length,
        failedLogins24h: recent.filter((r) => /login_failed|mfa_challenge_failed|admin_login_failed/.test(r.action)).length,
        activeClientSessions,
        criticalEvents24h: recent.filter((r) => r.severity === "critical" || r.outcome === "denied").length,
      },
    };
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.category && filters.category !== "all") {
    params.push(filters.category);
    conditions.push(`l.category = $${params.length}`);
  }
  if (filters.outcome && filters.outcome !== "all") {
    params.push(filters.outcome);
    conditions.push(`l.outcome = $${params.length}`);
  }
  if (filters.severity && filters.severity !== "all") {
    params.push(filters.severity);
    conditions.push(`l.severity = $${params.length}`);
  }
  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`l.target_user_id = $${params.length}`);
  }
  if (searchTerm) {
    params.push(`%${searchTerm}%`);
    const idx = params.length;
    conditions.push(`(
      LOWER(l.action) LIKE $${idx}
      OR LOWER(COALESCE(l.actor_label, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.target_client_ref, u.client_ref, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.ip_address, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.device_summary, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.location, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.metadata::text, '')) LIKE $${idx}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT l.id,
            l.category,
            l.action,
            l.outcome,
            l.severity,
            l.actor_type AS "actorType",
            l.actor_id AS "actorId",
            COALESCE(l.actor_label, u.name) AS "actorLabel",
            l.target_user_id AS "targetUserId",
            COALESCE(l.target_client_ref, u.client_ref) AS "targetClientRef",
            l.ip_address AS "ipAddress",
            l.location,
            l.device_summary AS "deviceSummary",
            l.user_agent AS "userAgent",
            l.request_method AS "requestMethod",
            l.request_path AS "requestPath",
            l.session_prefix AS "sessionPrefix",
            l.metadata,
            l.created_at AS "createdAt"
     FROM compliance_audit_logs l
     LEFT JOIN users u ON u.id = l.target_user_id
     ${whereClause}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${params.length}`,
    params,
  );

  const [sumRes, sessRes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS "total24h",
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND action IN ('login_failed', 'mfa_challenge_failed', 'admin_login_failed'))::int AS "failedLogins24h",
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND (severity = 'critical' OR outcome = 'denied'))::int AS "criticalEvents24h"
      FROM compliance_audit_logs
    `),
    pool.query(`
      SELECT COUNT(*)::int AS "activeClientSessions"
      FROM client_active_sessions
      WHERE revoked_at IS NULL AND expires_at > NOW()
    `),
  ]);

  return {
    logs: rows.map((r) => ({
      id: Number(r.id),
      category: r.category,
      action: r.action,
      outcome: r.outcome,
      severity: r.severity,
      actorType: r.actorType,
      actorId: r.actorId ?? null,
      actorLabel: r.actorLabel ?? null,
      targetUserId: r.targetUserId ? Number(r.targetUserId) : null,
      targetClientRef: r.targetClientRef ?? null,
      ipAddress: r.ipAddress ?? null,
      location: r.location ?? null,
      deviceSummary: r.deviceSummary ?? null,
      userAgent: r.userAgent ?? null,
      requestMethod: r.requestMethod ?? null,
      requestPath: r.requestPath ?? null,
      sessionPrefix: r.sessionPrefix ?? null,
      metadata: r.metadata && typeof r.metadata === "object" ? r.metadata : {},
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    summary: {
      total24h: Number(sumRes.rows[0]?.total24h ?? 0),
      failedLogins24h: Number(sumRes.rows[0]?.failedLogins24h ?? 0),
      activeClientSessions: Number(sessRes.rows[0]?.activeClientSessions ?? 0),
      criticalEvents24h: Number(sumRes.rows[0]?.criticalEvents24h ?? 0),
    },
  };
}
