import type { Express, NextFunction, Request, Response, RequestHandler } from "express";
import type { Pool } from "pg";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { hasDatabaseConfig } from "./db";
import { comparePasswords, digest, hashPassword } from "./security/crypto";

export interface AdminStaffIdentity {
  id: number;
  username: string;
  displayName: string;
}

declare global {
  namespace Express {
    interface Request {
      adminStaff?: AdminStaffIdentity | null;
      adminTokenDigest?: string;
    }
  }
}

type MemoryStaff = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  active: boolean;
  createdByStaffId: number | null;
  createdAt: Date;
};

type MemorySession = {
  tokenDigest: string;
  staffId: number;
  expiresAt: number;
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const memoryStaff: MemoryStaff[] = [];
const memorySessions = new Map<string, MemorySession>();
let memoryStaffNextId = 1;

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function constantTimeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(digest(provided), "hex");
  const b = Buffer.from(digest(expected), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractAdminCredential(req: Request): { bearer: string | null; headerKey: string | null } {
  const authHeader = req.headers.authorization;
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const rawKey = req.headers["x-admin-key"];
  const headerKey = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : null;
  return { bearer, headerKey };
}

export function getConfiguredAdminPassword(): string | null {
  const raw = process.env.ADMIN_PASSWORD;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

const staffCreateSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may contain only letters, numbers, dots, underscores, and hyphens"),
  displayName: z.string().trim().min(2, "Display name must be at least 2 characters").max(100),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
}).strict();

export async function initializeAdminTables(pool: Pool) {
  if (!hasDatabaseConfig) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_admins (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_staff_id INTEGER REFERENCES staff_admins(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_digest TEXT PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff_admins(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS entry_origin TEXT NOT NULL DEFAULT 'client',
      ADD COLUMN IF NOT EXISTS created_by_staff_id INTEGER,
      ADD COLUMN IF NOT EXISTS created_by_staff_name TEXT,
      ADD COLUMN IF NOT EXISTS approved_by_staff_id INTEGER,
      ADD COLUMN IF NOT EXISTS approved_by_staff_name TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS evidence_ref TEXT,
      ADD COLUMN IF NOT EXISTS audit_reason TEXT,
      ADD COLUMN IF NOT EXISTS reversal_of_transaction_id INTEGER,
      ADD COLUMN IF NOT EXISTS replaces_transaction_id INTEGER,
      ADD COLUMN IF NOT EXISTS admin_notes TEXT;

    CREATE TABLE IF NOT EXISTS admin_posting_requests (
      id SERIAL PRIMARY KEY,
      action_kind TEXT NOT NULL,
      posting_type TEXT NOT NULL,
      client_user_id INTEGER NOT NULL,
      from_account_id INTEGER,
      to_account_id INTEGER,
      amount NUMERIC NOT NULL,
      effective_date TIMESTAMPTZ NOT NULL,
      reason TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      description TEXT,
      target_transaction_id INTEGER,
      replacement_payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending_second_admin',
      created_by_staff_id INTEGER NOT NULL REFERENCES staff_admins(id),
      created_by_staff_username TEXT NOT NULL,
      created_by_staff_name TEXT NOT NULL,
      reviewed_by_staff_id INTEGER REFERENCES staff_admins(id),
      reviewed_by_staff_username TEXT,
      reviewed_by_staff_name TEXT,
      reviewed_at TIMESTAMPTZ,
      rejection_reason TEXT,
      posted_transaction_id INTEGER,
      reversal_transaction_id INTEGER,
      replacement_transaction_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_posting_requests_status_idx ON admin_posting_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS transaction_audit_trail (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER,
      posting_request_id INTEGER,
      entry_origin TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_staff_id INTEGER,
      actor_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_ref TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS transaction_audit_trail_txn_idx ON transaction_audit_trail(transaction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS transaction_audit_trail_req_idx ON transaction_audit_trail(posting_request_id, created_at DESC);
  `);
}

async function countStaffAdmins(pool: Pool): Promise<number> {
  if (!hasDatabaseConfig) return memoryStaff.length;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM staff_admins`);
  return rows[0]?.count ?? 0;
}

async function findStaffByUsername(pool: Pool, username: string): Promise<MemoryStaff | null> {
  const norm = normalizeUsername(username);
  if (!hasDatabaseConfig) {
    return memoryStaff.find(s => s.username === norm) ?? null;
  }
  const { rows } = await pool.query(
    `SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash",
       active, created_by_staff_id AS "createdByStaffId", created_at AS "createdAt"
     FROM staff_admins WHERE username = $1`,
    [norm],
  );
  return rows[0] ?? null;
}

async function createStaffRecord(
  pool: Pool,
  input: { username: string; displayName: string; password: string; createdByStaffId: number | null },
): Promise<AdminStaffIdentity> {
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  if (!hasDatabaseConfig) {
    if (memoryStaff.some(s => s.username === username)) {
      throw new Error("STAFF_EXISTS");
    }
    const staff: MemoryStaff = {
      id: memoryStaffNextId++,
      username,
      displayName: input.displayName.trim(),
      passwordHash,
      active: true,
      createdByStaffId: input.createdByStaffId,
      createdAt: new Date(),
    };
    memoryStaff.push(staff);
    return { id: staff.id, username: staff.username, displayName: staff.displayName };
  }
  const { rows } = await pool.query(
    `INSERT INTO staff_admins (username, display_name, password_hash, created_by_staff_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, display_name AS "displayName"`,
    [username, input.displayName.trim(), passwordHash, input.createdByStaffId],
  );
  return rows[0];
}

async function issueSessionToken(pool: Pool, staffId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenDigest = digest(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  if (!hasDatabaseConfig) {
    memorySessions.set(tokenDigest, { tokenDigest, staffId, expiresAt: expiresAt.getTime() });
    return token;
  }
  await pool.query(
    `DELETE FROM admin_sessions WHERE expires_at < NOW()`,
  );
  await pool.query(
    `INSERT INTO admin_sessions (token_digest, staff_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenDigest, staffId, expiresAt],
  );
  return token;
}

async function resolveSessionToken(pool: Pool, token: string): Promise<{ staff: AdminStaffIdentity; tokenDigest: string } | null> {
  const tokenDigest = digest(token);
  if (!hasDatabaseConfig) {
    const sess = memorySessions.get(tokenDigest);
    if (!sess) return null;
    if (sess.expiresAt < Date.now()) {
      memorySessions.delete(tokenDigest);
      return null;
    }
    const staff = memoryStaff.find(s => s.id === sess.staffId && s.active);
    if (!staff) return null;
    return {
      staff: { id: staff.id, username: staff.username, displayName: staff.displayName },
      tokenDigest,
    };
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.username, s.display_name AS "displayName", sess.expires_at AS "expiresAt"
     FROM admin_sessions sess
     JOIN staff_admins s ON s.id = sess.staff_id
     WHERE sess.token_digest = $1 AND sess.expires_at > NOW() AND s.active = TRUE`,
    [tokenDigest],
  );
  if (!rows[0]) return null;
  return {
    staff: { id: rows[0].id, username: rows[0].username, displayName: rows[0].displayName },
    tokenDigest,
  };
}

async function revokeSessionToken(pool: Pool, tokenDigest: string) {
  if (!hasDatabaseConfig) {
    memorySessions.delete(tokenDigest);
    return;
  }
  await pool.query(`DELETE FROM admin_sessions WHERE token_digest = $1`, [tokenDigest]);
}

export async function setupAdminAuth(app: Express, pool: Pool) {
  await initializeAdminTables(pool);

  const requireAdmin: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const configuredPassword = getConfiguredAdminPassword();
      const { bearer, headerKey } = extractAdminCredential(req);
      const tokenCandidate = bearer || headerKey;

      if (tokenCandidate) {
        const resolved = await resolveSessionToken(pool, tokenCandidate);
        if (resolved) {
          req.adminStaff = resolved.staff;
          req.adminTokenDigest = resolved.tokenDigest;
          return next();
        }
      }

      if (configuredPassword && headerKey && constantTimeMatch(headerKey, configuredPassword)) {
        req.adminStaff = null;
        return next();
      }

      const staffCount = await countStaffAdmins(pool);
      if (!configuredPassword && staffCount === 0) {
        return void res.status(503).json({
          message: "Administrator authentication is not configured. Complete initial staff administrator setup first.",
        });
      }

      return void res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("[admin-auth] Verification error:", error);
      return void res.status(503).json({ message: "Administrator authentication unavailable" });
    }
  };

  const requireIdentifiedStaff: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    requireAdmin(req, res, () => {
      if (!req.adminStaff) {
        return void res.status(403).json({
          message: "Individual staff administrator sign-in is required to review or post money movements.",
        });
      }
      next();
    });
  };

  // Public auth status (never leaks secrets or user lists)
  app.get("/api/admin/auth/status", async (_req, res) => {
    try {
      const envPasswordConfigured = Boolean(getConfiguredAdminPassword());
      const staffCount = await countStaffAdmins(pool);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        configured: envPasswordConfigured || staffCount > 0,
        bootstrapRequired: !envPasswordConfigured && staffCount === 0,
        envPasswordConfigured,
        staffCount,
      });
    } catch {
      res.status(503).json({ message: "Unable to check administrator configuration" });
    }
  });

  // One-time first-run bootstrap when ADMIN_PASSWORD is not set and 0 staff admins exist
  app.post("/api/admin/auth/bootstrap", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (getConfiguredAdminPassword()) {
        return void res.status(403).json({
          message: "Bootstrap is disabled when ADMIN_PASSWORD is configured. Sign in with your Admin Key to create staff accounts.",
        });
      }
      const parsed = staffCreateSchema.parse(req.body);
      if (!hasDatabaseConfig) {
        if (memoryStaff.length > 0) {
          return void res.status(409).json({ message: "Initial administrator has already been configured." });
        }
        const staff = await createStaffRecord(pool, { ...parsed, createdByStaffId: null });
        const token = await issueSessionToken(pool, staff.id);
        return void res.status(201).json({ ok: true, token, staff });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(8841, 17)");
        const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS count FROM staff_admins`);
        if ((countRows[0]?.count ?? 0) > 0) {
          await client.query("ROLLBACK");
          return void res.status(409).json({ message: "Initial administrator has already been configured." });
        }
        const passwordHash = await hashPassword(parsed.password);
        const { rows } = await client.query(
          `INSERT INTO staff_admins (username, display_name, password_hash, created_by_staff_id)
           VALUES ($1, $2, $3, NULL)
           RETURNING id, username, display_name AS "displayName"`,
          [normalizeUsername(parsed.username), parsed.displayName.trim(), passwordHash],
        );
        await client.query("COMMIT");
        const staff: AdminStaffIdentity = rows[0];
        const token = await issueSessionToken(pool, staff.id);
        return void res.status(201).json({ ok: true, token, staff });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({ message: error.issues[0]?.message || "Invalid input" });
      }
      return void res.status(500).json({ message: "Failed to initialize administrator account" });
    }
  });

  // Sign in (individual staff username + password, or configured ADMIN_PASSWORD for legacy callers)
  app.post("/api/admin/verify", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
      if (typeof password !== "string" || !password) {
        return void res.status(400).json({ message: "Password is required" });
      }

      if (typeof username === "string" && username.trim().length > 0) {
        const staff = await findStaffByUsername(pool, username);
        if (!staff || !staff.active) {
          return void res.status(401).json({ message: "Invalid staff credentials" });
        }
        const valid = await comparePasswords(password, staff.passwordHash);
        if (!valid) {
          return void res.status(401).json({ message: "Invalid staff credentials" });
        }
        const token = await issueSessionToken(pool, staff.id);
        return void res.json({
          ok: true,
          token,
          staff: { id: staff.id, username: staff.username, displayName: staff.displayName },
          legacyKeyMode: false,
        });
      }

      // Legacy key-only check: ONLY succeeds when ADMIN_PASSWORD env var is explicitly configured
      const configuredPassword = getConfiguredAdminPassword();
      if (!configuredPassword) {
        const staffCount = await countStaffAdmins(pool);
        return void res.status(staffCount === 0 ? 503 : 400).json({
          message: staffCount === 0
            ? "Administrator authentication is not configured."
            : "Staff username and password are required.",
        });
      }

      if (!constantTimeMatch(password, configuredPassword)) {
        return void res.status(401).json({ message: "Invalid password" });
      }

      return void res.json({ ok: true, staff: null, legacyKeyMode: true });
    } catch (error) {
      console.error("[admin-auth] Login error:", error);
      res.status(500).json({ message: "Sign in failed" });
    }
  });

  app.get("/api/admin/me", requireAdmin, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      staff: req.adminStaff ?? null,
      legacyKeyMode: !req.adminStaff,
    });
  });

  app.post("/api/admin/logout", requireAdmin, async (req, res) => {
    if (req.adminTokenDigest) {
      await revokeSessionToken(pool, req.adminTokenDigest);
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/staff", requireAdmin, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!hasDatabaseConfig) {
        return void res.json(
          memoryStaff.map(({ passwordHash: _p, ...rest }) => rest),
        );
      }
      const { rows } = await pool.query(
        `SELECT id, username, display_name AS "displayName", active,
           created_by_staff_id AS "createdByStaffId", created_at AS "createdAt"
         FROM staff_admins ORDER BY id ASC`,
      );
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Failed to load staff administrators" });
    }
  });

  app.post("/api/admin/staff", requireAdmin, async (req, res) => {
    try {
      // Require either an identified staff admin OR configured ADMIN_PASSWORD (never anonymous)
      if (!req.adminStaff && !getConfiguredAdminPassword()) {
        return void res.status(403).json({ message: "Staff administrator authorization required" });
      }
      const parsed = staffCreateSchema.parse(req.body);
      const existing = await findStaffByUsername(pool, parsed.username);
      if (existing) {
        return void res.status(409).json({ message: "That staff username already exists" });
      }
      const created = await createStaffRecord(pool, {
        username: parsed.username,
        displayName: parsed.displayName,
        password: parsed.password,
        createdByStaffId: req.adminStaff?.id ?? null,
      });
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({ message: error.issues[0]?.message || "Invalid input" });
      }
      if (error?.code === "23505" || error?.message === "STAFF_EXISTS") {
        return void res.status(409).json({ message: "That staff username already exists" });
      }
      res.status(500).json({ message: "Failed to create staff administrator" });
    }
  });

  app.patch("/api/admin/staff/:id", requireAdmin, async (req, res) => {
    try {
      if (!req.adminStaff && !getConfiguredAdminPassword()) {
        return void res.status(403).json({ message: "Administrator authorization required" });
      }
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
      if (req.adminStaff && id === req.adminStaff.id && !active) {
        return void res.status(400).json({ message: "You cannot deactivate your own active administrator account." });
      }
      if (!hasDatabaseConfig) {
        const staff = memoryStaff.find(s => s.id === id);
        if (!staff) return void res.status(404).json({ message: "Staff administrator not found" });
        staff.active = active;
        return void res.json({ id: staff.id, username: staff.username, displayName: staff.displayName, active: staff.active });
      }
      const { rows } = await pool.query(
        `UPDATE staff_admins SET active = $2 WHERE id = $1
         RETURNING id, username, display_name AS "displayName", active`,
        [id, active],
      );
      if (!rows[0]) return void res.status(404).json({ message: "Staff administrator not found" });
      if (!active) {
        await pool.query(`DELETE FROM admin_sessions WHERE staff_id = $1`, [id]);
      }
      res.json(rows[0]);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({ message: error.issues[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: "Failed to update staff administrator" });
    }
  });

  return { requireAdmin, requireIdentifiedStaff };
}
