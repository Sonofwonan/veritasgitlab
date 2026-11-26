import type { Express, RequestHandler } from "express";
import type { Pool } from "pg";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import {
  type ClientCardRecord,
  type ClientFeatureFlags,
  type ClientNotice,
  type EffectiveClientControls,
  type PlatformSettings,
  DEFAULT_CLIENT_FEATURE_FLAGS,
  DEFAULT_CLIENT_NOTICE,
  DEFAULT_PLATFORM_SETTINGS,
  cardKindSchema,
  cardNetworkSchema,
  cardStatusSchema,
  clientControlsUpdateSchema,
  clientFeatureFlagsSchema,
  clientNoticeSchema,
  platformSettingsSchema,
  resolveEffectiveFeatures,
} from "@shared/client-controls";
import { BALANCE_CURRENCIES } from "@shared/balance-currency";
import {
  addressSchema,
  bankingPreferencesSchema,
  DEFAULT_BANKING_PREFERENCES,
  type BankingPreferences,
} from "@shared/client-settings";
import {
  accounts,
  investments,
  payees,
  users,
  type User,
} from "@shared/schema";
import { db, hasDatabaseConfig } from "./db";
import { hashPassword } from "./security/crypto";
import {
  audit,
  queryComplianceAuditLogs,
  recordComplianceAudit,
  revokeSessions,
  revokeSingleClientSession,
} from "./security/store";
import { formatComplianceAuditCsv } from "./security/audit-context";
import { accountLabel } from "@shared/account-display";

const ACCOUNT_TYPES = [
  "Brokerage Account",
  "Traditional IRA",
  "Roth IRA",
  "401(k) / 403(b)",
  "529 Savings Plan",
  "Trust Account",
] as const;

export const REFERENCE_MARKET_QUOTES: Record<string, { price: number; name: string }> = {
  AAPL: { price: 224.5, name: "Apple Inc." },
  MSFT: { price: 428.15, name: "Microsoft Corp." },
  GOOGL: { price: 178.4, name: "Alphabet Inc." },
  AMZN: { price: 205.8, name: "Amazon.com Inc." },
  NVDA: { price: 138.9, name: "NVIDIA Corp." },
  SPY: { price: 589.25, name: "SPDR S&P 500 ETF Trust" },
  VTI: { price: 291.6, name: "Vanguard Total Stock Market ETF" },
  QQQ: { price: 504.75, name: "Invesco QQQ Trust" },
  BND: { price: 73.1, name: "Vanguard Total Bond Market ETF" },
  GLD: { price: 246.3, name: "SPDR Gold Shares" },
  BRK: { price: 462.0, name: "Berkshire Hathaway Inc." },
  JPM: { price: 238.4, name: "JPMorgan Chase & Co." },
};

// In-memory store used seamlessly when DATABASE_URL is absent / unreachable in sandbox
let memoryPlatformSettings: PlatformSettings = { ...DEFAULT_PLATFORM_SETTINGS };
const memoryClientControls = new Map<number, { features: ClientFeatureFlags; notice: ClientNotice }>();
const memoryCards = new Map<number, ClientCardRecord>();
let memoryCardNextId = 1;
const memoryUsersFallback = new Map<number, any>();
let memoryFallbackUserNextId = 9001;
const memoryAccountsFallback = new Map<number, any>();
let memoryFallbackAccountNextId = 9501;
const memoryInvestmentsFallback = new Map<number, any>();
let memoryFallbackInvestmentNextId = 9701;
const memoryPayeesFallback = new Map<number, any>();
let memoryFallbackPayeeNextId = 9901;

function safeJsonParse<T>(raw: string | null | undefined, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

function generateLast4(): string {
  return String(randomInt(1000, 10000));
}

function generateExpiry(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String((now.getFullYear() + 4) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

function staffActorLabel(req: any): string {
  if (req.adminStaff) {
    return `${req.adminStaff.displayName} (@${req.adminStaff.username})`;
  }
  return "Configured Administrator";
}

export async function ensureAdminControlTables(pool: Pool): Promise<void> {
  if (!hasDatabaseConfig) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS advisor_notes TEXT;

    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      settings_json TEXT NOT NULL,
      updated_by_staff_name TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS client_controls (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      features_json TEXT NOT NULL,
      notice_json TEXT NOT NULL,
      updated_by_staff_name TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS client_cards (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      card_kind TEXT NOT NULL DEFAULT 'virtual',
      label TEXT NOT NULL,
      last4 TEXT NOT NULL,
      expiry TEXT NOT NULL,
      network TEXT NOT NULL DEFAULT 'Visa',
      status TEXT NOT NULL DEFAULT 'active',
      fraud_protection BOOLEAN NOT NULL DEFAULT TRUE,
      daily_limit NUMERIC NOT NULL DEFAULT 10000,
      online_payments BOOLEAN NOT NULL DEFAULT TRUE,
      international_spend BOOLEAN NOT NULL DEFAULT TRUE,
      admin_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS client_cards_user_idx ON client_cards(user_id, created_at DESC);
  `);
}

export async function getPlatformSettings(pool: Pool): Promise<PlatformSettings> {
  if (!hasDatabaseConfig) {
    return { ...memoryPlatformSettings };
  }
  try {
    const { rows } = await pool.query(`SELECT settings_json FROM platform_settings WHERE id = 1`);
    if (rows.length === 0) return { ...DEFAULT_PLATFORM_SETTINGS };
    return safeJsonParse(rows[0].settings_json, platformSettingsSchema, DEFAULT_PLATFORM_SETTINGS);
  } catch {
    return { ...memoryPlatformSettings };
  }
}

export async function updatePlatformSettings(
  pool: Pool,
  patch: Partial<PlatformSettings>,
  staffName: string,
): Promise<PlatformSettings> {
  const current = await getPlatformSettings(pool);
  const merged = platformSettingsSchema.parse({ ...current, ...patch });
  if (!hasDatabaseConfig) {
    memoryPlatformSettings = merged;
    return merged;
  }
  await pool.query(
    `INSERT INTO platform_settings (id, settings_json, updated_by_staff_name, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET settings_json = $1, updated_by_staff_name = $2, updated_at = NOW()`,
    [JSON.stringify(merged), staffName],
  );
  return merged;
}

export async function getClientControlRecord(
  pool: Pool,
  userId: number,
): Promise<{ features: ClientFeatureFlags; notice: ClientNotice }> {
  if (!hasDatabaseConfig) {
    return (
      memoryClientControls.get(userId) ?? {
        features: { ...DEFAULT_CLIENT_FEATURE_FLAGS },
        notice: { ...DEFAULT_CLIENT_NOTICE },
      }
    );
  }
  try {
    const { rows } = await pool.query(
      `SELECT features_json, notice_json FROM client_controls WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) {
      return {
        features: { ...DEFAULT_CLIENT_FEATURE_FLAGS },
        notice: { ...DEFAULT_CLIENT_NOTICE },
      };
    }
    return {
      features: safeJsonParse(rows[0].features_json, clientFeatureFlagsSchema, DEFAULT_CLIENT_FEATURE_FLAGS),
      notice: safeJsonParse(rows[0].notice_json, clientNoticeSchema, DEFAULT_CLIENT_NOTICE),
    };
  } catch {
    return (
      memoryClientControls.get(userId) ?? {
        features: { ...DEFAULT_CLIENT_FEATURE_FLAGS },
        notice: { ...DEFAULT_CLIENT_NOTICE },
      }
    );
  }
}

export async function updateClientControlRecord(
  pool: Pool,
  userId: number,
  input: z.infer<typeof clientControlsUpdateSchema>,
  staffName: string,
): Promise<{ features: ClientFeatureFlags; notice: ClientNotice }> {
  const existing = await getClientControlRecord(pool, userId);
  const nextFeatures = clientFeatureFlagsSchema.parse({
    ...existing.features,
    ...(input.features ?? {}),
  });
  const nextNotice = clientNoticeSchema.parse({
    ...existing.notice,
    ...(input.notice ?? {}),
  });
  if (!hasDatabaseConfig) {
    const record = { features: nextFeatures, notice: nextNotice };
    memoryClientControls.set(userId, record);
    return record;
  }
  await pool.query(
    `INSERT INTO client_controls (user_id, features_json, notice_json, updated_by_staff_name, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET features_json = $2, notice_json = $3, updated_by_staff_name = $4, updated_at = NOW()`,
    [userId, JSON.stringify(nextFeatures), JSON.stringify(nextNotice), staffName],
  );
  return { features: nextFeatures, notice: nextNotice };
}

export async function getEffectiveClientControls(
  pool: Pool,
  userId: number | null,
): Promise<EffectiveClientControls> {
  const platform = await getPlatformSettings(pool);
  const { features, notice } = userId
    ? await getClientControlRecord(pool, userId)
    : { features: { ...DEFAULT_CLIENT_FEATURE_FLAGS }, notice: { ...DEFAULT_CLIENT_NOTICE } };
  return {
    platform,
    features,
    notice,
    effective: resolveEffectiveFeatures(platform, features),
  };
}

export async function getCardsForUser(pool: Pool, userId: number): Promise<ClientCardRecord[]> {
  if (!hasDatabaseConfig) {
    return Array.from(memoryCards.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.id - a.id);
  }
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.user_id AS "userId", c.account_id AS "accountId",
              c.card_kind AS "cardKind", c.label, c.last4, c.expiry, c.network, c.status,
              c.fraud_protection AS "fraudProtection", c.daily_limit::text AS "dailyLimit",
              c.online_payments AS "onlinePayments", c.international_spend AS "internationalSpend",
              c.admin_notes AS "adminNotes", c.created_at AS "createdAt",
              COALESCE(NULLIF(a.display_name, ''), a.account_type) AS "accountLabel"
       FROM client_cards c
       LEFT JOIN accounts a ON a.id = c.account_id
       WHERE c.user_id = $1
       ORDER BY c.id DESC`,
      [userId],
    );
    return rows.map((r: any) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getAllCards(pool: Pool): Promise<ClientCardRecord[]> {
  if (!hasDatabaseConfig) {
    return Array.from(memoryCards.values()).sort((a, b) => b.id - a.id);
  }
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.user_id AS "userId", c.account_id AS "accountId",
              c.card_kind AS "cardKind", c.label, c.last4, c.expiry, c.network, c.status,
              c.fraud_protection AS "fraudProtection", c.daily_limit::text AS "dailyLimit",
              c.online_payments AS "onlinePayments", c.international_spend AS "internationalSpend",
              c.admin_notes AS "adminNotes", c.created_at AS "createdAt",
              u.name AS "userName", u.email AS "userEmail", u.client_ref AS "userClientRef",
              COALESCE(NULLIF(a.display_name, ''), a.account_type) AS "accountLabel"
       FROM client_cards c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN accounts a ON a.id = c.account_id
       ORDER BY c.id DESC`,
    );
    return rows.map((r: any) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getClientBankingPreferences(pool: Pool, userId: number): Promise<BankingPreferences> {
  if (!hasDatabaseConfig) {
    return { ...DEFAULT_BANKING_PREFERENCES };
  }
  try {
    const { rows } = await pool.query(
      `SELECT statement_delivery, transaction_alerts, login_alerts, session_timeout_minutes
       FROM client_banking_preferences WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]) return { ...DEFAULT_BANKING_PREFERENCES };
    return bankingPreferencesSchema.parse({
      statementDelivery: rows[0].statement_delivery,
      transactionAlerts: Boolean(rows[0].transaction_alerts),
      loginAlerts: Boolean(rows[0].login_alerts),
      sessionTimeoutMinutes: Number(rows[0].session_timeout_minutes),
    });
  } catch {
    return { ...DEFAULT_BANKING_PREFERENCES };
  }
}

export function getMemoryUsersForAdmin() {
  return Array.from(memoryUsersFallback.values()).map((u) => {
    const accs = Array.from(memoryAccountsFallback.values()).filter((a) => a.userId === u.id);
    const totalBalance = accs.reduce((sum, a) => sum + Number(a.balance || 0), 0);
    return {
      ...u,
      password: undefined,
      accountCount: accs.length,
      totalBalance,
      mfaEnabled: false,
    };
  });
}

export function getMemoryUserDetails(userId: number) {
  const userRow = memoryUsersFallback.get(userId);
  if (!userRow) return null;
  const userAccounts = Array.from(memoryAccountsFallback.values()).filter((a) => a.userId === userId);
  const accountIds = new Set(userAccounts.map((a) => a.id));
  const userInvestments = Array.from(memoryInvestmentsFallback.values()).filter((i) => accountIds.has(i.accountId));
  const userPayees = Array.from(memoryPayeesFallback.values()).filter((p) => p.userId === userId);
  const userCards = Array.from(memoryCards.values()).filter((c) => c.userId === userId);
  const controls = memoryClientControls.get(userId) ?? {
    features: { ...DEFAULT_CLIENT_FEATURE_FLAGS },
    notice: { ...DEFAULT_CLIENT_NOTICE },
  };
  const totalBalance = userAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  return {
    user: { ...userRow, password: undefined, accountCount: userAccounts.length, totalBalance },
    contactDetails: userRow.contactDetails ?? null,
    bankingPreferences: userRow.bankingPreferences ?? { ...DEFAULT_BANKING_PREFERENCES },
    controls,
    cards: userCards,
    security: {
      mfaEnabled: Boolean(userRow.twoFactorEnabled),
      version: 1,
      events: [],
      recoveryRequests: [],
      setupTokens: [],
    },
    application: null,
    accounts: userAccounts,
    accountRequests: [],
    investments: userInvestments,
    transactions: [],
    payees: userPayees,
    institutionalTransfers: [],
    displayCurrencyAudit: [],
    fees: { enrollments: [], contracts: [], assessments: [] },
  };
}

export function registerAdminControlRoutes(
  app: Express,
  pool: Pool,
  requireAdmin: RequestHandler,
  requireAuth: RequestHandler,
  guards: {
    requireActivatedClient: RequestHandler;
    requireFundsAccess: RequestHandler;
    requireNoLiquidation: RequestHandler;
  },
) {
  // ─── Public / Client Controls & Branding ────────────────────────────────────
  app.get("/api/client/controls", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = req.isAuthenticated() ? (req.user as User).id : null;
      const result = await getEffectiveClientControls(pool, userId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load client controls" });
    }
  });

  // ─── Client Cards API (Persisted + Feature-Enforced) ────────────────────────
  app.get("/api/cards", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as User).id;
      const controls = await getEffectiveClientControls(pool, userId);
      if (!controls.effective.canAccessCards) {
        return res.status(403).json({ message: "Cards access is disabled by your administrator." });
      }
      const list = await getCardsForUser(pool, userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load cards" });
    }
  });

  app.post(
    "/api/cards",
    requireAuth,
    guards.requireActivatedClient,
    guards.requireFundsAccess,
    guards.requireNoLiquidation,
    async (req, res) => {
      try {
        const user = req.user as User;
        const controls = await getEffectiveClientControls(pool, user.id);
        if (!controls.effective.canRequestNewCards) {
          return res.status(403).json({ message: "Card issuance is currently restricted by your advisor." });
        }
        const input = z
          .object({
            accountId: z.coerce.number().int().positive().nullable().optional(),
            cardKind: z.enum(["virtual", "one_time", "business_platinum"]).default("virtual"),
            label: z.string().trim().min(2, "Enter a card label").max(80),
            network: cardNetworkSchema.default("Visa"),
          })
          .strict()
          .parse(req.body);

        let accountLabelStr: string | null = null;
        if (input.accountId != null && hasDatabaseConfig) {
          const [acc] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
          if (!acc || acc.userId !== user.id) {
            return res.status(403).json({ message: "Selected account does not belong to you" });
          }
          accountLabelStr = accountLabel(acc);
        }

        const last4 = generateLast4();
        const expiry = generateExpiry();
        const defaultLimit = input.cardKind === "business_platinum" ? "25000" : input.cardKind === "one_time" ? "2500" : "10000";

        if (!hasDatabaseConfig) {
          const created: ClientCardRecord = {
            id: memoryCardNextId++,
            userId: user.id,
            accountId: input.accountId ?? null,
            cardKind: input.cardKind,
            label: input.label,
            last4,
            expiry,
            network: input.network,
            status: "active",
            fraudProtection: true,
            dailyLimit: defaultLimit,
            onlinePayments: true,
            internationalSpend: input.cardKind !== "one_time",
            adminNotes: null,
            createdAt: new Date().toISOString(),
            accountLabel: accountLabelStr,
          };
          memoryCards.set(created.id, created);
          return res.status(201).json(created);
        }

        const { rows: [row] } = await pool.query(
          `INSERT INTO client_cards
            (user_id, account_id, card_kind, label, last4, expiry, network, status, fraud_protection, daily_limit, online_payments, international_spend)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TRUE, $8, TRUE, $9)
           RETURNING id, user_id AS "userId", account_id AS "accountId", card_kind AS "cardKind",
                     label, last4, expiry, network, status, fraud_protection AS "fraudProtection",
                     daily_limit::text AS "dailyLimit", online_payments AS "onlinePayments",
                     international_spend AS "internationalSpend", admin_notes AS "adminNotes",
                     created_at AS "createdAt"`,
          [
            user.id,
            input.accountId ?? null,
            input.cardKind,
            input.label,
            last4,
            expiry,
            input.network,
            defaultLimit,
            input.cardKind !== "one_time",
          ],
        );
        return res.status(201).json({
          ...row,
          accountLabel: accountLabelStr,
          createdAt: new Date(row.createdAt).toISOString(),
        });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0]?.message || "Invalid card request" });
        }
        return res.status(500).json({ message: err?.message || "Failed to generate card" });
      }
    },
  );

  app.patch(
    "/api/cards/:id",
    requireAuth,
    guards.requireNoLiquidation,
    async (req, res) => {
      try {
        const userId = (req.user as User).id;
        const cardId = z.coerce.number().int().positive().parse(req.params.id);
        const controls = await getEffectiveClientControls(pool, userId);
        if (!controls.effective.canManageOwnCards) {
          return res.status(403).json({ message: "Self-service card controls are managed by your advisor." });
        }
        const input = z
          .object({
            status: z.enum(["active", "locked"]).optional(),
            fraudProtection: z.boolean().optional(),
            onlinePayments: z.boolean().optional(),
            internationalSpend: z.boolean().optional(),
          })
          .strict()
          .parse(req.body);

        if (!hasDatabaseConfig) {
          const card = memoryCards.get(cardId);
          if (!card || card.userId !== userId) {
            return res.status(404).json({ message: "Card not found" });
          }
          if (card.status === "frozen" || card.status === "cancelled") {
            return res.status(403).json({ message: "This card has been locked by compliance and cannot be modified here." });
          }
          const updated: ClientCardRecord = { ...card, ...input };
          memoryCards.set(cardId, updated);
          return res.json(updated);
        }

        const { rows: [existing] } = await pool.query(
          `SELECT * FROM client_cards WHERE id = $1 AND user_id = $2`,
          [cardId, userId],
        );
        if (!existing) {
          return res.status(404).json({ message: "Card not found" });
        }
        if (existing.status === "frozen" || existing.status === "cancelled") {
          return res.status(403).json({ message: "This card has been frozen or cancelled by your advisor." });
        }

        const { rows: [updated] } = await pool.query(
          `UPDATE client_cards
           SET status = COALESCE($3, status),
               fraud_protection = COALESCE($4, fraud_protection),
               online_payments = COALESCE($5, online_payments),
               international_spend = COALESCE($6, international_spend)
           WHERE id = $1 AND user_id = $2
           RETURNING id, user_id AS "userId", account_id AS "accountId", card_kind AS "cardKind",
                     label, last4, expiry, network, status, fraud_protection AS "fraudProtection",
                     daily_limit::text AS "dailyLimit", online_payments AS "onlinePayments",
                     international_spend AS "internationalSpend", admin_notes AS "adminNotes",
                     created_at AS "createdAt"`,
          [
            cardId,
            userId,
            input.status ?? null,
            input.fraudProtection ?? null,
            input.onlinePayments ?? null,
            input.internationalSpend ?? null,
          ],
        );
        return res.json({ ...updated, createdAt: new Date(updated.createdAt).toISOString() });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0]?.message || "Invalid card update" });
        }
        return res.status(500).json({ message: err?.message || "Failed to update card" });
      }
    },
  );

  // ─── Admin Platform Settings & Per-Client Feature Controls ──────────────────
  app.get("/api/admin/platform-settings", requireAdmin, async (_req, res) => {
    try {
      res.json(await getPlatformSettings(pool));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load platform settings" });
    }
  });

  app.patch("/api/admin/platform-settings", requireAdmin, async (req, res) => {
    try {
      const parsed = platformSettingsSchema.partial().strict().parse(req.body);
      const updated = await updatePlatformSettings(pool, parsed, staffActorLabel(req));
      await recordComplianceAudit({
        req,
        category: "admin_action",
        action: "admin_platform_settings_updated",
        severity: "warning",
        actorType: "admin",
        actorId: req.adminStaff ? String(req.adminStaff.id) : null,
        actorLabel: staffActorLabel(req),
        metadata: parsed as Record<string, unknown>,
      });
      res.json({ ok: true, settings: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid platform settings" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update platform settings" });
    }
  });

  app.get("/api/admin/users/:id/controls", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    try {
      res.json(await getClientControlRecord(pool, parsedId.data));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load client controls" });
    }
  });

  app.patch("/api/admin/users/:id/controls", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    try {
      const input = clientControlsUpdateSchema.parse(req.body);
      const updated = await updateClientControlRecord(pool, parsedId.data, input, staffActorLabel(req));
      await audit(pool, parsedId.data, "admin_controls_updated", {
        req,
        category: "admin_action",
        severity: "warning",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
        metadata: input as Record<string, unknown>,
      });
      res.json({ ok: true, ...updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid controls payload" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update client controls" });
    }
  });

  // ─── Admin Direct Client Onboarding & Profile / Contact / Prefs / Security ──
  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(160),
          email: z.string().trim().email().max(254),
          phoneNumber: z.string().trim().max(40).optional().nullable(),
          displayCurrency: z.enum(BALANCE_CURRENCIES).default("CAD"),
          accountType: z.enum(ACCOUNT_TYPES).default("Brokerage Account"),
          accountDisplayName: z.string().trim().max(100).optional().nullable(),
          initialDepositStatus: z.enum(["required", "pending_review", "completed"]).default("completed"),
          selectedInitialDeposit: z.string().trim().max(80).optional().nullable(),
          advisorNotes: z.string().trim().max(1000).optional().nullable(),
          password: z.string().min(12).max(128).optional().nullable(),
          issueSetupLink: z.boolean().default(true),
        })
        .strict()
        .parse(req.body);

      const normalizedEmail = input.email.toLowerCase();
      const rawPassword = input.password || randomBytes(32).toString("base64url");
      const passwordHash = await hashPassword(rawPassword);
      const clientRef = `VW-${randomBytes(4).toString("hex").toUpperCase()}`;

      if (!hasDatabaseConfig) {
        for (const existing of memoryUsersFallback.values()) {
          if (existing.email?.toLowerCase() === normalizedEmail) {
            return res.status(409).json({ message: "A client with this email already exists." });
          }
        }
        const userId = memoryFallbackUserNextId++;
        const accountId = memoryFallbackAccountNextId++;
        const now = new Date().toISOString();
        const createdUser = {
          id: userId,
          clientRef,
          name: input.name,
          email: normalizedEmail,
          phoneNumber: input.phoneNumber || null,
          displayCurrency: input.displayCurrency,
          initialDepositStatus: input.initialDepositStatus,
          selectedInitialDeposit: input.selectedInitialDeposit || null,
          advisorNotes: input.advisorNotes || null,
          loginRestricted: false,
          accountFrozen: false,
          debtClearanceRequired: false,
          twoFactorEnabled: false,
          theme: "light",
          marketingEmails: true,
          securityAlerts: true,
          createdAt: now,
        };
        const createdAccount = {
          id: accountId,
          userId,
          accountNumber: `VW-${randomBytes(8).toString("hex").toUpperCase()}`,
          accountType: input.accountType,
          displayName: input.accountDisplayName || null,
          balance: "0.00",
          isDemo: false,
          createdAt: now,
        };
        memoryUsersFallback.set(userId, createdUser);
        memoryAccountsFallback.set(accountId, createdAccount);
        const setupToken = input.issueSetupLink && !input.password ? randomBytes(32).toString("base64url") : null;
        return res.status(201).json({
          ok: true,
          user: createdUser,
          account: createdAccount,
          setupPath: setupToken ? `/activate#token=${setupToken}` : null,
        });
      }

      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail));
      if (existing) {
        return res.status(409).json({ message: "A client with this email already exists." });
      }

      const setupToken = input.issueSetupLink && !input.password ? randomBytes(32).toString("base64url") : null;
      const setupHash = setupToken ? createHash("sha256").update(setupToken).digest("hex") : null;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [createdUser] } = await client.query(
          `INSERT INTO users
            (client_ref, name, email, phone_number, password, display_currency, initial_deposit_status, selected_initial_deposit, advisor_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, client_ref AS "clientRef", name, email, phone_number AS "phoneNumber",
                     display_currency AS "displayCurrency", initial_deposit_status AS "initialDepositStatus",
                     selected_initial_deposit AS "selectedInitialDeposit", advisor_notes AS "advisorNotes",
                     created_at AS "createdAt"`,
          [
            clientRef,
            input.name,
            normalizedEmail,
            input.phoneNumber || null,
            passwordHash,
            input.displayCurrency,
            input.initialDepositStatus,
            input.selectedInitialDeposit || null,
            input.advisorNotes || null,
          ],
        );

        const { rows: [createdAccount] } = await client.query(
          `INSERT INTO accounts (user_id, account_type, display_name, balance, is_demo)
           VALUES ($1, $2, $3, '0', FALSE)
           RETURNING id, account_number AS "accountNumber", user_id AS "userId",
                     account_type AS "accountType", display_name AS "displayName",
                     balance::text AS balance, is_demo AS "isDemo", created_at AS "createdAt"`,
          [createdUser.id, input.accountType, input.accountDisplayName || null],
        );

        await client.query(`INSERT INTO client_security (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [createdUser.id]);
        if (setupHash) {
          await client.query(
            `INSERT INTO account_setup_tokens (user_id, token_hash, purpose, expires_at)
             VALUES ($1, $2, 'activation', $3)`,
            [createdUser.id, setupHash, expiresAt],
          );
        }
        await audit(client, createdUser.id, "client_created_by_admin", {
          req,
          category: "admin_action",
          actorType: "admin",
          actorLabel: staffActorLabel(req),
          targetClientRef: createdUser.clientRef,
          metadata: { accountType: input.accountType, displayCurrency: input.displayCurrency },
        });

        await client.query("COMMIT");
        return res.status(201).json({
          ok: true,
          user: createdUser,
          account: createdAccount,
          setupPath: setupToken ? `/activate#token=${setupToken}` : null,
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid client payload" });
      }
      return res.status(500).json({ message: err?.message || "Failed to create client" });
    }
  });

  app.patch("/api/admin/users/:id/profile", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(160).optional(),
          email: z.string().trim().email().max(254).optional(),
          phoneNumber: z.string().trim().max(40).nullable().optional(),
          clientRef: z.string().trim().min(3).max(40).nullable().optional(),
          initialDepositStatus: z.enum(["required", "pending_review", "completed"]).optional(),
          selectedInitialDeposit: z.string().trim().max(80).nullable().optional(),
          theme: z.enum(["light", "dark"]).optional(),
          marketingEmails: z.boolean().optional(),
          securityAlerts: z.boolean().optional(),
          advisorNotes: z.string().trim().max(1500).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryUsersFallback.get(userId);
        if (!existing) return res.status(404).json({ message: "Client not found" });
        const updated = {
          ...existing,
          ...input,
          email: input.email ? input.email.toLowerCase() : existing.email,
        };
        memoryUsersFallback.set(userId, updated);
        return res.json({ ok: true, user: updated });
      }

      const updates: Record<string, any> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.email !== undefined) updates.email = input.email.toLowerCase();
      if (input.phoneNumber !== undefined) updates.phoneNumber = input.phoneNumber;
      if (input.clientRef !== undefined) updates.clientRef = input.clientRef;
      if (input.initialDepositStatus !== undefined) updates.initialDepositStatus = input.initialDepositStatus;
      if (input.selectedInitialDeposit !== undefined) updates.selectedInitialDeposit = input.selectedInitialDeposit;
      if (input.theme !== undefined) updates.theme = input.theme;
      if (input.marketingEmails !== undefined) updates.marketingEmails = input.marketingEmails;
      if (input.securityAlerts !== undefined) updates.securityAlerts = input.securityAlerts;
      if (input.advisorNotes !== undefined) updates.advisorNotes = input.advisorNotes;

      const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
      if (!updated) return res.status(404).json({ message: "Client profile not found" });
      const { password: _pw, ...safeClient } = updated as any;
      await audit(pool, userId, "admin_profile_updated", {
        req,
        category: "kyc_profile",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
        targetClientRef: safeClient.clientRef ?? null,
        metadata: { updatedFields: Object.keys(updates) },
      });
      return res.json({ ok: true, user: safeClient });
    } catch (err: any) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ message: "Email or Client Reference is already assigned to another client." });
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid profile fields" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update client profile" });
    }
  });

  app.patch("/api/admin/users/:id/contact", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = z
        .object({
          email: z.string().trim().email().max(254).optional(),
          phoneNumber: z.string().trim().max(40).nullable().optional(),
          residentialAddress: addressSchema.nullable().optional(),
          mailingAddress: addressSchema.nullable().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryUsersFallback.get(userId);
        if (!existing) return res.status(404).json({ message: "Client not found" });
        const updated = {
          ...existing,
          email: input.email ? input.email.toLowerCase() : existing.email,
          phoneNumber: input.phoneNumber !== undefined ? input.phoneNumber : existing.phoneNumber,
          contactDetails: {
            residentialAddress: input.residentialAddress ?? existing.contactDetails?.residentialAddress ?? null,
            mailingAddress: input.mailingAddress ?? existing.contactDetails?.mailingAddress ?? null,
          },
        };
        memoryUsersFallback.set(userId, updated);
        return res.json({ ok: true, contactDetails: updated.contactDetails });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (input.email !== undefined || input.phoneNumber !== undefined) {
          await client.query(
            `UPDATE users
             SET email = COALESCE($2, email),
                 phone_number = COALESCE($3, phone_number)
             WHERE id = $1`,
            [userId, input.email ? input.email.toLowerCase() : null, input.phoneNumber ?? null],
          );
        }
        const { rows: [saved] } = await client.query(
          `INSERT INTO client_contact_details (user_id, residential_address, mailing_address, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE
             SET residential_address = $2,
                 mailing_address = $3,
                 updated_at = NOW()
           RETURNING residential_address AS "residentialAddress", mailing_address AS "mailingAddress", updated_at AS "updatedAt"`,
          [userId, input.residentialAddress ?? null, input.mailingAddress ?? null],
        );
        await audit(client, userId, "contact_details_updated", {
          req,
          category: "kyc_profile",
          actorType: "admin",
          actorLabel: staffActorLabel(req),
          metadata: { emailUpdated: input.email !== undefined, phoneUpdated: input.phoneNumber !== undefined },
        });
        await client.query("COMMIT");
        return res.json({ ok: true, contactDetails: saved });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ message: "This email address is already in use." });
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid contact fields" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update contact details" });
    }
  });

  app.patch("/api/admin/users/:id/banking-preferences", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = bankingPreferencesSchema.parse(req.body);
      if (!hasDatabaseConfig) {
        const existing = memoryUsersFallback.get(userId);
        if (!existing) return res.status(404).json({ message: "Client not found" });
        existing.bankingPreferences = input;
        return res.json({ ok: true, preferences: input });
      }
      await pool.query(
        `INSERT INTO client_banking_preferences (user_id, statement_delivery, transaction_alerts, login_alerts, session_timeout_minutes, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET statement_delivery = $2,
               transaction_alerts = $3,
               login_alerts = $4,
               session_timeout_minutes = $5,
               updated_at = NOW()`,
        [userId, input.statementDelivery, input.transactionAlerts, input.loginAlerts, input.sessionTimeoutMinutes],
      );
      await audit(pool, userId, "banking_preferences_updated", {
        req,
        category: "kyc_profile",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
        metadata: input as Record<string, unknown>,
      });
      return res.json({ ok: true, preferences: input });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid preferences" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update banking preferences" });
    }
  });

  app.post("/api/admin/users/:id/revoke-sessions", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    if (!hasDatabaseConfig) {
      const client = { query: async () => ({ rows: [], rowCount: 0 }) } as any;
      await revokeSessions(client, userId);
      await audit(pool, userId, "admin_sessions_revoked", {
        req,
        category: "session",
        severity: "warning",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
      });
      return res.json({ ok: true, message: "All client sessions terminated." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO client_security (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
      await client.query(`UPDATE client_security SET version = version + 1 WHERE user_id = $1`, [userId]);
      await revokeSessions(client, userId);
      await audit(client, userId, "admin_sessions_revoked", {
        req,
        category: "session",
        severity: "warning",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
      });
      await client.query("COMMIT");
      return res.json({ ok: true, message: "All client sessions terminated." });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to revoke client sessions" });
    } finally {
      client.release();
    }
  });

  app.post("/api/admin/users/:id/sessions/:prefix/revoke", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const parsedPrefix = z.string().regex(/^[a-f0-9]{12}$/i).safeParse(req.params.prefix);
    if (!parsedPrefix.success) return res.status(400).json({ message: "Invalid session identifier" });
    const userId = parsedId.data;
    const prefix = parsedPrefix.data.toLowerCase();

    if (!hasDatabaseConfig) {
      const ok = await revokeSingleClientSession(null, userId, prefix);
      if (!ok) return res.status(404).json({ message: "Active device session not found" });
      await audit(pool, userId, "admin_single_session_revoked", {
        req,
        category: "session",
        severity: "warning",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
        metadata: { revokedSessionPrefix: prefix },
      });
      return res.json({ ok: true });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ok = await revokeSingleClientSession(client, userId, prefix);
      if (!ok) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Active device session not found" });
      }
      await audit(client, userId, "admin_single_session_revoked", {
        req,
        category: "session",
        severity: "warning",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
        metadata: { revokedSessionPrefix: prefix },
      });
      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to revoke client session" });
    } finally {
      client.release();
    }
  });

  app.post("/api/admin/users/:id/disable-2fa", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    if (!hasDatabaseConfig) {
      const existing = memoryUsersFallback.get(userId);
      if (existing) existing.twoFactorEnabled = false;
      await audit(pool, userId, "mfa_disabled", {
        req,
        category: "mfa",
        severity: "critical",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
      });
      return res.json({ ok: true, message: "Two-factor authentication disabled for client." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO client_security (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
      await client.query(
        `UPDATE client_security
         SET mfa_enabled = FALSE,
             secret = NULL,
             last_totp_step = -1,
             version = version + 1,
             pending_secret = NULL,
             pending_expires = NULL,
             pending_session = NULL
         WHERE user_id = $1`,
        [userId],
      );
      await client.query(`DELETE FROM client_security_recovery WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE users SET two_factor_enabled = FALSE WHERE id = $1`, [userId]);
      await revokeSessions(client, userId);
      await audit(client, userId, "mfa_disabled", {
        req,
        category: "mfa",
        severity: "critical",
        actorType: "admin",
        actorLabel: staffActorLabel(req),
      });
      await client.query("COMMIT");
      return res.json({ ok: true, message: "Two-factor authentication disabled for client." });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to disable two-factor authentication" });
    } finally {
      client.release();
    }
  });

  // ─── Admin Direct Account Create & Edit ─────────────────────────────────────
  app.post("/api/admin/users/:id/accounts", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = z
        .object({
          accountType: z.enum(ACCOUNT_TYPES),
          displayName: z.string().trim().max(100).optional().nullable(),
          isDemo: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const account = {
          id: memoryFallbackAccountNextId++,
          userId,
          accountNumber: `VW-${randomBytes(8).toString("hex").toUpperCase()}`,
          accountType: input.accountType,
          displayName: input.displayName || null,
          balance: "0.00",
          isDemo: input.isDemo,
          createdAt: new Date().toISOString(),
        };
        memoryAccountsFallback.set(account.id, account);
        return res.status(201).json({ ok: true, account });
      }

      const [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!userRow) return res.status(404).json({ message: "Client profile not found" });

      const { rows: [account] } = await pool.query(
        `INSERT INTO accounts (user_id, account_type, display_name, balance, is_demo)
         VALUES ($1, $2, $3, '0', $4)
         RETURNING id, account_number AS "accountNumber", user_id AS "userId",
                   account_type AS "accountType", display_name AS "displayName",
                   balance::text AS balance, is_demo AS "isDemo", created_at AS "createdAt"`,
        [userId, input.accountType, input.displayName || null, input.isDemo],
      );
      return res.status(201).json({ ok: true, account });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid account parameters" });
      }
      return res.status(500).json({ message: err?.message || "Failed to create account" });
    }
  });

  app.patch("/api/admin/accounts/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid account ID" });
    const accountId = parsedId.data;
    try {
      const input = z
        .object({
          accountType: z.enum(ACCOUNT_TYPES).optional(),
          displayName: z.string().trim().max(100).nullable().optional(),
          isDemo: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryAccountsFallback.get(accountId);
        if (!existing) return res.status(404).json({ message: "Account not found" });
        const updated = { ...existing, ...input };
        memoryAccountsFallback.set(accountId, updated);
        return res.json({ ok: true, account: updated });
      }

      const updates: Record<string, any> = {};
      if (input.accountType !== undefined) updates.accountType = input.accountType;
      if (input.displayName !== undefined) updates.displayName = input.displayName || null;
      if (input.isDemo !== undefined) updates.isDemo = input.isDemo;

      const [updated] = await db.update(accounts).set(updates).where(eq(accounts.id, accountId)).returning();
      if (!updated) return res.status(404).json({ message: "Account not found" });
      return res.json({ ok: true, account: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid account updates" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update account" });
    }
  });

  // ─── Admin Investment Holdings CRUD ─────────────────────────────────────────
  app.get("/api/admin/investments", requireAdmin, async (_req, res) => {
    try {
      if (!hasDatabaseConfig) {
        return res.json(Array.from(memoryInvestmentsFallback.values()));
      }
      const { rows } = await pool.query(
        `SELECT i.id, i.account_id AS "accountId", i.symbol, i.shares::text AS shares,
                i.purchase_price::text AS "purchasePrice",
                COALESCE(i.current_price, i.purchase_price)::text AS "currentPrice",
                i.created_at AS "createdAt",
                COALESCE(NULLIF(a.display_name, ''), a.account_type) AS "accountLabel",
                a.user_id AS "userId",
                u.name AS "userName", u.email AS "userEmail", u.client_ref AS "userClientRef"
         FROM investments i
         JOIN accounts a ON a.id = i.account_id
         JOIN users u ON u.id = a.user_id
         ORDER BY i.id DESC`,
      );
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to load investments" });
    }
  });

  app.post("/api/admin/accounts/:accountId/investments", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.accountId);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid account ID" });
    const accountId = parsedId.data;
    try {
      const input = z
        .object({
          symbol: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()),
          shares: z.coerce.number().positive(),
          purchasePrice: z.coerce.number().positive(),
          currentPrice: z.coerce.number().positive().optional(),
        })
        .strict()
        .parse(req.body);

      const currentPrice = input.currentPrice ?? input.purchasePrice;
      if (!hasDatabaseConfig) {
        const created = {
          id: memoryFallbackInvestmentNextId++,
          accountId,
          symbol: input.symbol,
          shares: String(input.shares),
          purchasePrice: String(input.purchasePrice),
          currentPrice: String(currentPrice),
          createdAt: new Date().toISOString(),
        };
        memoryInvestmentsFallback.set(created.id, created);
        return res.status(201).json({ ok: true, investment: created });
      }

      const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
      if (!account) return res.status(404).json({ message: "Target account not found" });

      const [created] = await db
        .insert(investments)
        .values({
          accountId,
          symbol: input.symbol,
          shares: String(input.shares),
          purchasePrice: String(input.purchasePrice),
          currentPrice: String(currentPrice),
        })
        .returning();
      return res.status(201).json({ ok: true, investment: created });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid holding input" });
      }
      return res.status(500).json({ message: err?.message || "Failed to add investment holding" });
    }
  });

  app.patch("/api/admin/investments/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid holding ID" });
    const investmentId = parsedId.data;
    try {
      const input = z
        .object({
          symbol: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()).optional(),
          shares: z.coerce.number().positive().optional(),
          purchasePrice: z.coerce.number().positive().optional(),
          currentPrice: z.coerce.number().positive().optional(),
          accountId: z.coerce.number().int().positive().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryInvestmentsFallback.get(investmentId);
        if (!existing) return res.status(404).json({ message: "Holding not found" });
        const updated = {
          ...existing,
          ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
          ...(input.shares !== undefined ? { shares: String(input.shares) } : {}),
          ...(input.purchasePrice !== undefined ? { purchasePrice: String(input.purchasePrice) } : {}),
          ...(input.currentPrice !== undefined ? { currentPrice: String(input.currentPrice) } : {}),
          ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        };
        memoryInvestmentsFallback.set(investmentId, updated);
        return res.json({ ok: true, investment: updated });
      }

      const updates: Record<string, any> = {};
      if (input.symbol !== undefined) updates.symbol = input.symbol;
      if (input.shares !== undefined) updates.shares = String(input.shares);
      if (input.purchasePrice !== undefined) updates.purchasePrice = String(input.purchasePrice);
      if (input.currentPrice !== undefined) updates.currentPrice = String(input.currentPrice);
      if (input.accountId !== undefined) updates.accountId = input.accountId;

      const [updated] = await db.update(investments).set(updates).where(eq(investments.id, investmentId)).returning();
      if (!updated) return res.status(404).json({ message: "Holding not found" });
      return res.json({ ok: true, investment: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid holding update" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update holding" });
    }
  });

  app.delete("/api/admin/investments/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid holding ID" });
    const investmentId = parsedId.data;
    try {
      if (!hasDatabaseConfig) {
        memoryInvestmentsFallback.delete(investmentId);
        return res.json({ ok: true });
      }
      const [deleted] = await db.delete(investments).where(eq(investments.id, investmentId)).returning();
      if (!deleted) return res.status(404).json({ message: "Holding not found" });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to remove holding" });
    }
  });

  // ─── Admin Cards CRUD & Controls ────────────────────────────────────────────
  app.get("/api/admin/cards", requireAdmin, async (_req, res) => {
    try {
      res.json(await getAllCards(pool));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load cards" });
    }
  });

  app.get("/api/admin/users/:id/cards", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    try {
      res.json(await getCardsForUser(pool, parsedId.data));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load client cards" });
    }
  });

  app.post("/api/admin/users/:id/cards", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = z
        .object({
          accountId: z.coerce.number().int().positive().nullable().optional(),
          cardKind: cardKindSchema.default("virtual"),
          label: z.string().trim().min(2).max(80),
          network: cardNetworkSchema.default("Visa"),
          status: cardStatusSchema.default("active"),
          dailyLimit: z.coerce.number().min(100).max(5000000).default(10000),
          fraudProtection: z.boolean().default(true),
          onlinePayments: z.boolean().default(true),
          internationalSpend: z.boolean().default(true),
          adminNotes: z.string().trim().max(400).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      const last4 = generateLast4();
      const expiry = generateExpiry();

      if (!hasDatabaseConfig) {
        const userRow = memoryUsersFallback.get(userId);
        const created: ClientCardRecord = {
          id: memoryCardNextId++,
          userId,
          accountId: input.accountId ?? null,
          cardKind: input.cardKind,
          label: input.label,
          last4,
          expiry,
          network: input.network,
          status: input.status,
          fraudProtection: input.fraudProtection,
          dailyLimit: String(input.dailyLimit),
          onlinePayments: input.onlinePayments,
          internationalSpend: input.internationalSpend,
          adminNotes: input.adminNotes ?? null,
          createdAt: new Date().toISOString(),
          userName: userRow?.name,
          userEmail: userRow?.email,
          userClientRef: userRow?.clientRef,
        };
        memoryCards.set(created.id, created);
        return res.status(201).json({ ok: true, card: created });
      }

      const [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!userRow) return res.status(404).json({ message: "Client not found" });

      const { rows: [created] } = await pool.query(
        `INSERT INTO client_cards
          (user_id, account_id, card_kind, label, last4, expiry, network, status, fraud_protection, daily_limit, online_payments, international_spend, admin_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, user_id AS "userId", account_id AS "accountId", card_kind AS "cardKind",
                   label, last4, expiry, network, status, fraud_protection AS "fraudProtection",
                   daily_limit::text AS "dailyLimit", online_payments AS "onlinePayments",
                   international_spend AS "internationalSpend", admin_notes AS "adminNotes",
                   created_at AS "createdAt"`,
        [
          userId,
          input.accountId ?? null,
          input.cardKind,
          input.label,
          last4,
          expiry,
          input.network,
          input.status,
          input.fraudProtection,
          String(input.dailyLimit),
          input.onlinePayments,
          input.internationalSpend,
          input.adminNotes ?? null,
        ],
      );
      return res.status(201).json({
        ok: true,
        card: { ...created, createdAt: new Date(created.createdAt).toISOString() },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid card fields" });
      }
      return res.status(500).json({ message: err?.message || "Failed to issue card" });
    }
  });

  app.patch("/api/admin/cards/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid card ID" });
    const cardId = parsedId.data;
    try {
      const input = z
        .object({
          accountId: z.coerce.number().int().positive().nullable().optional(),
          cardKind: cardKindSchema.optional(),
          label: z.string().trim().min(2).max(80).optional(),
          network: cardNetworkSchema.optional(),
          status: cardStatusSchema.optional(),
          dailyLimit: z.coerce.number().min(100).max(5000000).optional(),
          fraudProtection: z.boolean().optional(),
          onlinePayments: z.boolean().optional(),
          internationalSpend: z.boolean().optional(),
          adminNotes: z.string().trim().max(400).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryCards.get(cardId);
        if (!existing) return res.status(404).json({ message: "Card not found" });
        const updated: ClientCardRecord = {
          ...existing,
          ...input,
          dailyLimit: input.dailyLimit !== undefined ? String(input.dailyLimit) : existing.dailyLimit,
        };
        memoryCards.set(cardId, updated);
        return res.json({ ok: true, card: updated });
      }

      const { rows: [existing] } = await pool.query(`SELECT * FROM client_cards WHERE id = $1`, [cardId]);
      if (!existing) return res.status(404).json({ message: "Card not found" });

      const { rows: [updated] } = await pool.query(
        `UPDATE client_cards
         SET account_id = $2,
             card_kind = COALESCE($3, card_kind),
             label = COALESCE($4, label),
             network = COALESCE($5, network),
             status = COALESCE($6, status),
             daily_limit = COALESCE($7, daily_limit),
             fraud_protection = COALESCE($8, fraud_protection),
             online_payments = COALESCE($9, online_payments),
             international_spend = COALESCE($10, international_spend),
             admin_notes = $11
         WHERE id = $1
         RETURNING id, user_id AS "userId", account_id AS "accountId", card_kind AS "cardKind",
                   label, last4, expiry, network, status, fraud_protection AS "fraudProtection",
                   daily_limit::text AS "dailyLimit", online_payments AS "onlinePayments",
                   international_spend AS "internationalSpend", admin_notes AS "adminNotes",
                   created_at AS "createdAt"`,
        [
          cardId,
          input.accountId !== undefined ? input.accountId : existing.account_id,
          input.cardKind ?? null,
          input.label ?? null,
          input.network ?? null,
          input.status ?? null,
          input.dailyLimit !== undefined ? String(input.dailyLimit) : null,
          input.fraudProtection ?? null,
          input.onlinePayments ?? null,
          input.internationalSpend ?? null,
          input.adminNotes !== undefined ? input.adminNotes : existing.admin_notes,
        ],
      );
      return res.json({
        ok: true,
        card: { ...updated, createdAt: new Date(updated.createdAt).toISOString() },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid card updates" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update card" });
    }
  });

  app.delete("/api/admin/cards/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid card ID" });
    const cardId = parsedId.data;
    try {
      if (!hasDatabaseConfig) {
        memoryCards.delete(cardId);
        return res.json({ ok: true });
      }
      const { rowCount } = await pool.query(`DELETE FROM client_cards WHERE id = $1`, [cardId]);
      if (!rowCount) return res.status(404).json({ message: "Card not found" });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to delete card" });
    }
  });

  // ─── Admin Beneficiary Direct Create & Edit ─────────────────────────────────
  app.post("/api/admin/users/:id/payees", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid client ID" });
    const userId = parsedId.data;
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(160),
          bankName: z.string().trim().min(2).max(160),
          accountNumber: z.string().trim().min(4).max(64),
          routingNumber: z.string().trim().min(4).max(64),
          country: z.string().trim().min(2).max(120).default("Canada"),
          currency: z.enum(BALANCE_CURRENCIES).default("CAD"),
          type: z.enum(["individual", "business"]).default("individual"),
          status: z.enum(["pending_approval", "approved", "rejected"]).default("approved"),
          adminNotes: z.string().trim().max(400).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const created = {
          id: memoryFallbackPayeeNextId++,
          userId,
          ...input,
          createdAt: new Date().toISOString(),
        };
        memoryPayeesFallback.set(created.id, created);
        return res.status(201).json({ ok: true, payee: created });
      }

      const [created] = await db
        .insert(payees)
        .values({
          userId,
          name: input.name,
          bankName: input.bankName,
          accountNumber: input.accountNumber,
          routingNumber: input.routingNumber,
          country: input.country,
          currency: input.currency,
          type: input.type,
          status: input.status,
          adminNotes: input.adminNotes ?? null,
        } as any)
        .returning();
      return res.status(201).json({ ok: true, payee: created });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid beneficiary details" });
      }
      return res.status(500).json({ message: err?.message || "Failed to add beneficiary" });
    }
  });

  app.patch("/api/admin/payees/:id", requireAdmin, async (req, res) => {
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "Invalid beneficiary ID" });
    const payeeId = parsedId.data;
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(160).optional(),
          bankName: z.string().trim().min(2).max(160).optional(),
          accountNumber: z.string().trim().min(4).max(64).optional(),
          routingNumber: z.string().trim().min(4).max(64).optional(),
          country: z.string().trim().min(2).max(120).optional(),
          currency: z.enum(BALANCE_CURRENCIES).optional(),
          type: z.enum(["individual", "business"]).optional(),
          status: z.enum(["pending_approval", "approved", "rejected"]).optional(),
          adminNotes: z.string().trim().max(400).nullable().optional(),
        })
        .strict()
        .parse(req.body);

      if (!hasDatabaseConfig) {
        const existing = memoryPayeesFallback.get(payeeId);
        if (!existing) return res.status(404).json({ message: "Beneficiary not found" });
        const updated = { ...existing, ...input };
        memoryPayeesFallback.set(payeeId, updated);
        return res.json({ ok: true, payee: updated });
      }

      const [updated] = await db.update(payees).set(input as any).where(eq(payees.id, payeeId)).returning();
      if (!updated) return res.status(404).json({ message: "Beneficiary not found" });
      return res.json({ ok: true, payee: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid beneficiary updates" });
      }
      return res.status(500).json({ message: err?.message || "Failed to update beneficiary" });
    }
  });

  // ─── Compliance & Security Audit Log Queries & CSV Export ───────────────────
  app.get("/api/admin/compliance-audit", requireAdmin, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const query = z.object({
        category: z.string().trim().max(40).optional(),
        outcome: z.string().trim().max(40).optional(),
        severity: z.string().trim().max(40).optional(),
        search: z.string().trim().max(120).optional(),
        userId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      }).parse(req.query);
      const data = await queryComplianceAuditLogs(query);
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to load compliance audit trail" });
    }
  });

  app.get("/api/admin/compliance-audit/export", requireAdmin, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const query = z.object({
        category: z.string().trim().max(40).optional(),
        outcome: z.string().trim().max(40).optional(),
        severity: z.string().trim().max(40).optional(),
        search: z.string().trim().max(120).optional(),
        userId: z.coerce.number().int().positive().optional(),
      }).parse(req.query);
      const data = await queryComplianceAuditLogs({ ...query, limit: 500 });
      await recordComplianceAudit({
        req,
        category: "admin_action",
        action: "admin_compliance_audit_exported",
        severity: "info",
        actorType: "admin",
        actorId: req.adminStaff ? String(req.adminStaff.id) : null,
        actorLabel: staffActorLabel(req),
        metadata: { exportedRows: data.logs.length, filters: query },
      });
      const csv = formatComplianceAuditCsv(data.logs as unknown as Array<Record<string, unknown>>);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="veritas-compliance-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to export compliance audit trail" });
    }
  });
}
