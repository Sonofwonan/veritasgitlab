import type { Express } from "express";
import { createServer, type Server } from "http";
import { createHash, randomBytes } from "crypto";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { api, errorSchemas, insertPayeeSchema } from "@shared/routes";
import { z } from "zod";
import { type User, accounts, transactions, payees, applications, users, institutionalTransfers, accountSetupTokens, accountOpeningRequests, investments } from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, desc, sql, inArray } from "drizzle-orm";
import twilio from "twilio";
import passport from "passport";
import { registerFeeRoutes } from "./fees/routes";
import { moneyToCents } from "@shared/fees";
import { approvePayment, FundsAccessError, fundsAccess, fundsAccessGuard, registerDebtRestrictionNoticeRoutes } from "./funds-access";
import { accountLabel } from "@shared/account-display";
import { registerDisplayCurrencyRoutes } from "./display-currency";
import { BALANCE_CURRENCIES, isBalanceCurrency } from "@shared/balance-currency";
import { MARKET_UNAVAILABLE } from "@shared/market";
import { LIQUIDATION_STATUS_UNAVAILABLE } from "@shared/liquidation";
import { ownedCashHistory } from "./account-history";
import { registerHistoricalBalanceRoutes } from "./historical-balances-routes";
import { audit, initializeSecurity, rateLimit, revokeSessions, safeUser, withSecurity } from "./security/store";
import { digest, encryptionConfigured, SecurityError } from "./security/crypto";
import { registerSecurityRoutes, securityHandler, securityOrigin } from "./security/routes";
import { registerRecoveryRequests } from "./security/recovery-requests";
import { registerClientSettings } from "./client-settings";
import { destroySession, finishLogin, regenerateSession, saveSession } from "./security/session";
import { institutionalDestinationSchema } from "@shared/institutional-destination";
import { setupAdminAuth } from "./admin-auth";
import {
  recordTransactionAudit,
  registerAdminLedgerRoutes,
  reviewApproveClientRequestSchema,
  reviewRejectSchema,
} from "./admin-ledger";
import { registerAdminDeleteRoutes } from "./admin-delete";

// Twilio Notification Setup (SMS/WhatsApp)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
const adminWhatsappNumber = "+1-478-416-5940";

const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

// Send notification for external transfers (not internal transfers between same user's accounts)
async function sendTransferNotification(transactionId: number, userName: string, amount: string, fromAccount: string, toAccountInfo: string) {
  if (!twilioClient || !whatsappNumber) {
    console.warn('Twilio not configured. Skipping notification.');
    return null;
  }

  try {
    const message = `Transfer Initiated\n\nUser: ${userName}\nAmount: $${amount}\nFrom: ${fromAccount}\nTo: ${toAccountInfo}\nRef: TXN-${transactionId}\n\nStatus: Pending (15-30 minutes to process)`;
    
    const result = await twilioClient.messages.create({
      from: `whatsapp:${whatsappNumber}`,
      to: `whatsapp:${adminWhatsappNumber}`,
      body: message,
    });
    
    console.log('Transfer notification sent:', result.sid);
    return result.sid;
  } catch (error: any) {
    console.error('Failed to send notification:', error.message);
    return null;
  }
}

// Manual completion required for external transfers
async function initializeTransferAutoCompletion() {
  // Auto-completion disabled as per requirements. 
  // External transfers now stay 'pending' until manual intervention.
  console.log('Transfer auto-completion scheduler is disabled. External transfers require manual approval.');
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await initializeSecurity();
  console.log(encryptionConfigured() ? "Authenticator encryption is configured." :
    "Authenticator setup is disabled until MFA_ENCRYPTION_KEY is configured.");
  const { hashPassword } = setupAuth(app);

  // Ensure new columns exist (safe on every startup)
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS login_restricted BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS login_restriction_message TEXT,
        ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'CAD',
        ADD COLUMN IF NOT EXISTS debt_clearance_required BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS debt_payment_account_id INTEGER,
        ADD COLUMN IF NOT EXISTS debt_payment_confirmed_at TIMESTAMP;
      ALTER TABLE payees
        ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending_approval',
        ADD COLUMN IF NOT EXISTS admin_notes TEXT,
        ADD COLUMN IF NOT EXISTS country TEXT,
        ADD COLUMN IF NOT EXISTS currency TEXT;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS admin_notes TEXT;
      ALTER TABLE institutional_transfers
        ADD COLUMN IF NOT EXISTS portfolio_snapshot TEXT;
      ALTER TABLE institutional_transfers
        ALTER COLUMN account_id DROP NOT NULL;
      ALTER TABLE institutional_transfers
        ADD COLUMN IF NOT EXISTS account_holder_type TEXT;
      ALTER TABLE institutional_transfers
        ADD COLUMN IF NOT EXISTS account_holder_name TEXT;
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS account_frozen BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS freeze_reason TEXT,
        ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMP;
      ALTER TABLE applications
        ADD COLUMN IF NOT EXISTS preferred_currency TEXT DEFAULT 'CAD';
      ALTER TABLE applications ALTER COLUMN password DROP NOT NULL;
      CREATE TABLE IF NOT EXISTS account_setup_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL DEFAULT 'activation',
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE account_setup_tokens
        ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'activation';
      CREATE INDEX IF NOT EXISTS account_setup_tokens_user_id_idx ON account_setup_tokens(user_id);
      CREATE TABLE IF NOT EXISTS account_opening_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        account_type TEXT NOT NULL,
        requested_display_name TEXT,
        ownership_structure TEXT NOT NULL,
        investment_objective TEXT NOT NULL,
        risk_tolerance TEXT NOT NULL,
        funding_source TEXT NOT NULL,
        expected_initial_funding TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        additional_notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_notes TEXT,
        created_account_id INTEGER,
        reviewed_by_staff_name TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS account_opening_requests_user_id_idx ON account_opening_requests(user_id);
    `);
  } catch (_) { /* columns likely already exist */ }
  // New request fields must be available; do not silently start with a schema
  // that cannot persist or read international destinations.
  await pool.query(`ALTER TABLE institutional_transfers
    ADD COLUMN IF NOT EXISTS institution_country TEXT,
    ADD COLUMN IF NOT EXISTS destination_details TEXT`);

  const INACTIVITY_LIMIT_MS = 25 * 60 * 1000;

  // Middleware to protect routes — enforces 25-minute inactivity timeout + freeze check
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).send();
    const lastActivity = req.session?.lastActivity;
    if (lastActivity && Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Session expired due to inactivity" });
    }
    if ((req.user as any)?.accountFrozen) {
      return res.status(423).json({ message: "ACCOUNT_FROZEN", freezeReason: (req.user as any).freezeReason });
    }
    return next();
  };

  // Existing protected writes also block on active liquidation. Request-only
  // institutional submissions must verify status without changing their existing
  // rules for a successfully verified status.
  const LIQUIDATION_ACTIVE_STATUSES = ["liquidating", "approved", "transfer_out"];
  const liquidationGuard = (blockActive: boolean) => async (req: any, res: any, next: any) => {
    try {
      const userId = (req.user as User).id;
      const transfers = await db
        .select({ status: institutionalTransfers.status })
        .from(institutionalTransfers)
        .where(eq(institutionalTransfers.userId, userId));
      const hasActive = transfers.some(t => LIQUIDATION_ACTIVE_STATUSES.includes(t.status ?? ""));
      if (blockActive && hasActive) {
        return res.status(423).json({
          message: "LIQUIDATION_IN_PROGRESS",
          detail: "This account is currently under an active portfolio liquidation. All transactions, investments, and account changes are suspended until the transfer is complete.",
        });
      }
    } catch (_) {
      return res.set("Cache-Control", "no-store").status(503).json(LIQUIDATION_STATUS_UNAVAILABLE);
    }
    return next();
  };
  const requireNoLiquidation = liquidationGuard(true);
  const requireLiquidationVerification = liquidationGuard(false);

  const INVESTMENT_ACCOUNT_TYPES = new Set([
    "Brokerage Account",
    "Traditional IRA",
    "Roth IRA",
    "401(k) / 403(b)",
    "529 Savings Plan",
    "Trust Account",
  ]);
  const requireFundsAccess = fundsAccessGuard(pool);
  const requireFundsAccessOrDeposit = fundsAccessGuard(pool, true);

  const { requireAdmin, requireIdentifiedStaff } = await setupAdminAuth(app, pool);
  registerAdminLedgerRoutes(app, pool, requireAdmin, requireIdentifiedStaff);

  await registerFeeRoutes(app, pool, requireAdmin, requireAuth);
  await registerHistoricalBalanceRoutes(app, pool, requireAdmin);
  await registerDisplayCurrencyRoutes(app, pool, requireAdmin);
  registerDebtRestrictionNoticeRoutes(app, pool, requireAdmin);

  // Auth Routes
  registerSecurityRoutes(app);
  await registerRecoveryRequests(app, requireAuth, requireAdmin);
  await registerClientSettings(app, requireAuth);
  registerAdminDeleteRoutes(app, pool, requireAdmin);
  app.post(api.auth.register.path, (_req, res) => {
    res.status(410).json({
      message: "Direct registration is disabled. Submit an application and wait for approval.",
    });
  });

  app.post(api.auth.login.path, securityOrigin, securityHandler(async (req, res) => {
    const credentials = api.auth.login.input.parse(req.body);
    await rateLimit(`password-login-ip:${req.ip}`, 300);
    await rateLimit(`password-login-user:${credentials.userId.trim().toLowerCase()}`, 10);
    const user = await new Promise<User>((resolve, reject) => {
      passport.authenticate("local", (error: unknown, found: User | false, info: { message?: string }) => {
        if (error) return reject(error);
        if (!found) return reject(new SecurityError(401, info?.message || "Invalid credentials"));
        resolve(found);
      })(req, res, (error: unknown) => reject(error || new Error("Authentication failed")));
    });
    const state = await withSecurity(user.id, async (client, security, current) => {
      if (user.password !== current.password) throw new SecurityError(401, "Please sign in again.");
      await audit(client, user.id, security.mfa_enabled ? "password_verified_for_mfa" : "password_sign_in");
      return security;
    });
    if (state.mfa_enabled) {
      await regenerateSession(req);
      req.session.pendingMfa = {
        userId: user.id, version: state.version, passwordStamp: digest(user.password),
        expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0,
      };
      await saveSession(req);
      return void res.status(202).json({ mfaRequired: true });
    }
    await finishLogin(req, user, state.version, false);
    res.json(await safeUser(user));
  }));

  app.post(api.auth.logout.path, securityHandler(async (req, res) => {
    await destroySession(req);
    res.clearCookie("connect.sid", { path: "/" });
    res.status(200).send();
  }));

  app.get(api.auth.me.path, securityHandler(async (req, res) => {
    if (req.isAuthenticated()) {
      res.status(200).json(await safeUser(req.user as User));
    } else {
      res.status(401).send();
    }
  }));

  app.patch("/api/user", requireAuth, requireNoLiquidation, async (req, res) => {
    if (Object.keys(req.body).some(key => /password|two.?factor|mfa|secret|recovery|authVersion/i.test(key))) {
      return res.status(403).json({ message: "Use Security settings to change your password or two-factor authentication." });
    }
    if (["debtClearanceRequired", "debtPaymentAccountId", "debtPaymentConfirmedAt"].some(key => key in req.body)) {
      return res.status(403).json({ message: "Funds access policy cannot be changed by the client" });
    }
    // Currency is an explicitly authorized designation, not a self-service
    // preference: changing a symbol does not convert the underlying ledger.
    if (Object.prototype.hasOwnProperty.call(req.body, "displayCurrency")) {
      return res.status(403).json({ message: "Balance display currency cannot be changed through client profile settings" });
    }
    if (["email", "phoneNumber", "name"].some(key => key in req.body)) {
      return res.status(403).json({ message: "Use Personal details to update contact information. Contact your advisor for a legal-name change." });
    }
    try {
      const profile = z.object({
        marketingEmails: z.boolean().optional(),
        securityAlerts: z.boolean().optional(),
        theme: z.enum(["light", "dark", "system"]).optional(),
      }).strict().parse(req.body);
      const user = await storage.updateUser((req.user as User).id, profile);
      res.json(await safeUser(user));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update profile" });
    }
  });

  // Account Routes
  app.get("/api/transactions", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as User).id;
      const ledger = await db.select().from(transactions)
        .where(sql`EXISTS (SELECT 1 FROM accounts a WHERE a.user_id=${userId}
          AND (a.id=${transactions.fromAccountId} OR a.id=${transactions.toAccountId}))`)
        .orderBy(desc(transactions.createdAt),desc(transactions.id));
      res.json(await ownedCashHistory(pool, userId, ledger));
    } catch {
      res.status(500).json({ message:"Failed to fetch portfolio transactions" });
    }
  });

  app.get("/api/accounts/:id/transactions", requireAuth, async (req, res) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getAccount(accountId);
      if (!account || account.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const allTransactions = await db.select()
        .from(transactions)
        .where(
          or(
            eq(transactions.fromAccountId, accountId),
            eq(transactions.toAccountId, accountId)
          )
        )
        .orderBy(desc(transactions.createdAt), desc(transactions.id));
      
      res.json(await ownedCashHistory(pool, (req.user as User).id, allTransactions, accountId));
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch transactions" });
    }
  });

  app.get(api.accounts.list.path, requireAuth, async (req, res) => {
    const accounts = await storage.getAccounts((req.user as User).id);
    res.json(accounts);
  });
  app.get("/api/funds-access", requireAuth, async (req, res) => {
    try { res.json(await fundsAccess(pool, (req.user as User).id)); }
    catch { res.status(503).json({ message: "Funds access status unavailable" }); }
  });

  app.post(api.accounts.create.path, requireAuth, (_req, res) => {
    return res.status(403).json({
      message: "Direct account creation is disabled. Please submit a formal Account Opening Request for compliance and administrative review.",
    });
  });

  const OWNERSHIP_STRUCTURES = [
    "Individual",
    "Joint Tenants with Rights of Survivorship",
    "Trust / Fiduciary",
    "Corporate / Entity",
  ] as const;
  const INVESTMENT_OBJECTIVES = [
    "Capital Preservation",
    "Balanced Income & Growth",
    "Long-Term Growth",
    "Aggressive Growth",
    "Tax-Advantaged Retirement",
  ] as const;
  const RISK_TOLERANCES = ["Conservative", "Moderate", "Growth", "Aggressive"] as const;
  const FUNDING_SOURCES = [
    "Wire / Bank Transfer",
    "Internal Portfolio Transfer",
    "Institutional Rollover / ACAT",
    "Employment / Earned Income",
    "Business / Trust Distribution",
  ] as const;
  const EXPECTED_INITIAL_FUNDING_TIERS = [
    "$1,000 – $10,000",
    "$10,000 – $50,000",
    "$50,000 – $250,000",
    "$250,000 – $1,000,000",
    "$1,000,000+",
  ] as const;
  const JURISDICTIONS = [
    "Canada",
    "United Kingdom",
    "United States",
    "European Union",
    "Other",
  ] as const;

  const clientAccountOpeningRequestSchema = z.object({
    accountType: z.string().refine((val) => INVESTMENT_ACCOUNT_TYPES.has(val), {
      message: "Please select a valid investment or retirement account type.",
    }),
    requestedDisplayName: z.string().trim().max(80, "Account designation must be 80 characters or fewer").optional().or(z.literal("")),
    ownershipStructure: z.enum(OWNERSHIP_STRUCTURES),
    investmentObjective: z.enum(INVESTMENT_OBJECTIVES),
    riskTolerance: z.enum(RISK_TOLERANCES),
    fundingSource: z.enum(FUNDING_SOURCES),
    expectedInitialFunding: z.enum(EXPECTED_INITIAL_FUNDING_TIERS),
    jurisdiction: z.enum(JURISDICTIONS),
    additionalNotes: z.string().trim().max(1000, "Additional notes must be 1000 characters or fewer").optional().or(z.literal("")),
    clientDeclarationAccepted: z.literal(true, {
      errorMap: () => ({ message: "Please confirm the institutional account opening attestation." }),
    }),
  });

  app.get("/api/account-requests", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = (req.user as User).id;
      const { rows } = await pool.query(
        `SELECT r.id,
                r.user_id AS "userId",
                r.account_type AS "accountType",
                r.requested_display_name AS "requestedDisplayName",
                r.ownership_structure AS "ownershipStructure",
                r.investment_objective AS "investmentObjective",
                r.risk_tolerance AS "riskTolerance",
                r.funding_source AS "fundingSource",
                r.expected_initial_funding AS "expectedInitialFunding",
                r.jurisdiction,
                r.additional_notes AS "additionalNotes",
                r.status,
                r.admin_notes AS "adminNotes",
                r.created_account_id AS "createdAccountId",
                a.account_number AS "createdAccountNumber",
                COALESCE(NULLIF(a.display_name, ''), a.account_type) AS "createdAccountLabel",
                r.reviewed_at AS "reviewedAt",
                r.created_at AS "createdAt"
         FROM account_opening_requests r
         LEFT JOIN accounts a ON a.id = r.created_account_id AND a.user_id = r.user_id
         WHERE r.user_id = $1
         ORDER BY r.id DESC`,
        [userId],
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load account opening requests" });
    }
  });

  app.post("/api/account-requests", requireAuth, requireFundsAccess, requireNoLiquidation, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const input = clientAccountOpeningRequestSchema.parse(req.body);
      const userId = (req.user as User).id;
      const [created] = await db
        .insert(accountOpeningRequests)
        .values({
          userId,
          accountType: input.accountType,
          requestedDisplayName: input.requestedDisplayName?.trim() || null,
          ownershipStructure: input.ownershipStructure,
          investmentObjective: input.investmentObjective,
          riskTolerance: input.riskTolerance,
          fundingSource: input.fundingSource,
          expectedInitialFunding: input.expectedInitialFunding,
          jurisdiction: input.jurisdiction,
          additionalNotes: input.additionalNotes?.trim() || null,
          status: "pending",
        })
        .returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid account opening request" });
      }
      res.status(400).json({ message: err?.message || "Failed to submit account opening request" });
    }
  });

  app.delete(`${api.accounts.get.path}`, requireAuth, requireFundsAccess, requireNoLiquidation, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteAccount(id, (req.user as User).id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // Transaction Routes
  app.post(api.transactions.transfer.path, requireAuth, requireFundsAccessOrDeposit, requireNoLiquidation, async (req, res) => {
    try {
      const { fromAccountId, toAccountId, amount, fundingMethod, senderBankName, senderReference, notes } =
        api.transactions.transfer.input.parse(req.body);

      if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || moneyToCents(amount.trim()) <= 0n) {
        return res.status(400).json({ message: "Enter a valid positive amount with up to 2 decimal places" });
      }
      const cleanAmount = amount.trim();

      // Handle special case for external / initial deposit (requires admin verification before crediting balance)
      if (fromAccountId === -1) {
        const toAccount = await storage.getAccount(toAccountId);
        if (!toAccount || toAccount.userId !== (req.user as User).id) {
          return res.status(403).json({ message: "Unauthorized destination account" });
        }

        const methodLabel = fundingMethod?.trim() || "Bank Wire / External Funding";
        const bankPart = senderBankName?.trim() ? ` from ${senderBankName.trim()}` : "";
        const refPart = senderReference?.trim() ? ` · Ref: ${senderReference.trim()}` : "";
        const notesPart = notes?.trim() ? ` · ${notes.trim()}` : "";
        const depositDescription = `Initial / Funding Deposit (${methodLabel}${bankPart}) to ${accountLabel(toAccount)}${refPart}${notesPart}`.slice(0, 250);

        const transaction = await db.transaction(async (tx) => {
          const [t] = await tx.insert(transactions).values({
            toAccountId,
            amount: cleanAmount,
            description: depositDescription,
            transactionType: 'transfer',
            status: 'pending',
            entryOrigin: 'client',
            evidenceRef: senderReference?.trim() || null,
            isDemo: false,
          }).returning();

          return t;
        });
        await recordTransactionAudit(pool, {
          transactionId: transaction?.id ?? null,
          entryOrigin: "client",
          action: "client_submitted",
          actorType: "client",
          actorName: (req.user as User).name,
          evidenceRef: senderReference?.trim() || null,
          reason: `Client initiated deposit (${methodLabel}) to ${accountLabel(toAccount)}`,
        });
        return res.status(201).json(transaction);
      }

      // Verify ownership of fromAccount
      const fromAccount = await storage.getAccount(fromAccountId);
      if (!fromAccount || fromAccount.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "Unauthorized source account" });
      }
      
      const transaction = await storage.transferFunds(fromAccountId, toAccountId, amount);
      
      // Get destination account info and check if it's an external transfer
      const toAccount = await storage.getAccount(toAccountId);
      const isInternalTransfer = toAccount && toAccount.userId === (req.user as User).id;
      
      // Only send notifications for external transfers, and set status to pending
      if (!isInternalTransfer && toAccount) {
        // Update status to pending for external transfers
        await db.update(transactions)
          .set({ status: 'pending' })
          .where(eq(transactions.id, transaction.id));

        const toAccountInfo = `${toAccount.accountType} (ID: ${toAccountId})`;
        await sendTransferNotification(
          transaction.id,
          (req.user as User).name,
          amount,
          `${fromAccount.accountType} (ID: ${fromAccount.id})`,
          toAccountInfo
        );
      }
      
      await recordTransactionAudit(pool, {
        transactionId: transaction?.id ?? null,
        entryOrigin: "client",
        action: "client_submitted",
        actorType: "client",
        actorName: (req.user as User).name,
        reason: isInternalTransfer ? "Client internal account transfer" : "Client transfer request",
      });

      res.status(201).json({ 
        ...transaction,
        note: "Transfer Security Protocol Initiated. Status: PENDING. This transaction requires administrative verification and your subsequent attention to finalize. Please monitor your secure notifications for completion instructions."
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Transfer failed" });
    }
  });

  // Initialize auto-completion scheduler for pending transfers
  initializeTransferAutoCompletion();

  // Investment Routes
  app.get(api.investments.list.path, requireAuth, async (req, res) => {
    // Return all investments for all user accounts
    // For simplicity, just get accounts then get investments
    const accounts = await storage.getAccounts((req.user as User).id);
    const allInvestments = [];
    for (const acc of accounts) {
      const invs = await storage.getInvestments(acc.id);
      allInvestments.push(...invs);
    }
    res.json(allInvestments);
  });

  app.post(api.investments.buy.path, requireAuth, requireFundsAccess, requireNoLiquidation, async (req, res) => {
    try {
      const { accountId } = api.investments.buy.input.parse(req.body);
       // Verify ownership
      const account = await storage.getAccount(accountId);
      if (!account || account.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "Unauthorized account" });
      }

      // No approved pricing source: stop before any storage/ledger mutation.
      res.set("Cache-Control", "no-store").status(503).json(MARKET_UNAVAILABLE);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Buy failed" });
    }
  });

  app.post(api.investments.sell.path, requireAuth, requireFundsAccess, requireNoLiquidation, async (req, res) => {
    try {
      const { accountId } = api.investments.sell.input.parse(req.body);
       // Verify ownership
      const account = await storage.getAccount(accountId);
      if (!account || account.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "Unauthorized account" });
      }

      res.set("Cache-Control", "no-store").status(503).json(MARKET_UNAVAILABLE);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Sell failed" });
    }
  });

  // Payee Routes
  app.get('/api/payees', requireAuth, async (req, res) => {
    try {
      const payeesList = await storage.getPayees((req.user as User).id);
      res.json(payeesList);
    } catch (err: any) {
      console.error('Get payees error:', err);
      res.status(500).json({ message: "Failed to fetch payees" });
    }
  });

  // Admin: list all payees across all users
  app.get('/api/admin/payees', requireAdmin, async (req, res) => {
    try {
      const all = await db.select().from(payees).orderBy(desc(payees.createdAt));
      const enriched = await Promise.all(all.map(async (p) => {
        const [user] = await db.select({ name: users.name, email: users.email, clientRef: users.clientRef }).from(users).where(eq(users.id, p.userId));
        return { ...p, userName: user?.name || "Unknown", userEmail: user?.email || "", userClientRef: user?.clientRef || null };
      }));
      res.json(enriched);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Admin: approve a beneficiary
  app.post('/api/admin/payees/:id/approve', requireAdmin, async (req, res) => {
    try {
      const [updated] = await db.update(payees)
        .set({ status: 'approved', adminNotes: req.body.notes || null })
        .where(eq(payees.id, parseInt(req.params.id)))
        .returning();
      res.json({ ok: true, payee: updated });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Admin: reject a beneficiary
  app.post('/api/admin/payees/:id/reject', requireAdmin, async (req, res) => {
    try {
      const [updated] = await db.update(payees)
        .set({ status: 'rejected', adminNotes: req.body.notes || null })
        .where(eq(payees.id, parseInt(req.params.id)))
        .returning();
      res.json({ ok: true, payee: updated });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Admin: list all wire disbursement transactions (payment type)
  app.get('/api/admin/wire-transfers', requireAdmin, async (req, res) => {
    try {
      const all = await db.select().from(transactions)
        .where(eq(transactions.transactionType, 'payment'))
        .orderBy(desc(transactions.createdAt));
      const enriched = await Promise.all(all.map(async (t) => {
        let userName = "Unknown", userEmail = "", userClientRef: string | null = null, displayCurrency = "CAD";
        if (t.fromAccountId) {
          const [acc] = await db.select().from(accounts).where(eq(accounts.id, t.fromAccountId));
          if (acc) {
            const [u] = await db.select({
              name: users.name,
              email: users.email,
              clientRef: users.clientRef,
              displayCurrency: users.displayCurrency,
            }).from(users).where(eq(users.id, acc.userId));
            if (u) {
              userName = u.name;
              userEmail = u.email;
              userClientRef = u.clientRef ?? null;
              displayCurrency = u.displayCurrency || "CAD";
            }
          }
        }
        let payeeName = "Unknown";
        let payeeCountry: string | null = null;
        let payeeCurrency: string | null = null;
        let payeeRoutingNumber: string | null = null;
        if (t.payeeId) {
          const [p] = await db.select({
            name: payees.name,
            bankName: payees.bankName,
            country: payees.country,
            currency: payees.currency,
            routingNumber: payees.routingNumber,
          }).from(payees).where(eq(payees.id, t.payeeId));
          if (p) {
            payeeName = `${p.name} (${p.bankName || "—"})`;
            payeeCountry = p.country ?? null;
            payeeCurrency = p.currency ?? null;
            payeeRoutingNumber = p.routingNumber ?? null;
          }
        }
        return { ...t, userName, userEmail, userClientRef, displayCurrency, payeeName, payeeCountry, payeeCurrency, payeeRoutingNumber };
      }));
      res.json(enriched);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Admin: update wire transfer status / notes
  app.patch('/api/admin/wire-transfers/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid wire transfer ID" });
      }
      const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };
      const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
      if (!existing) return res.status(404).json({ message: "Wire transfer not found" });

      // Route pending -> completed via atomic approvePayment so deferred cash debits apply properly
      if (status === "completed" && existing.status === "pending") {
        await approvePayment(pool, id);
      }

      const updates: any = {};
      if (status && !(status === "completed" && existing.status === "pending")) {
        updates.status = status;
      }
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;

      let updated = existing;
      if (Object.keys(updates).length > 0) {
        [updated] = await db.update(transactions)
          .set(updates)
          .where(eq(transactions.id, id))
          .returning();
      } else {
        [updated] = await db.select().from(transactions).where(eq(transactions.id, id));
      }
      res.json({ ok: true, transaction: updated });
    } catch (err: any) {
      res.status(err instanceof FundsAccessError ? err.status : 500).json({ message: err.message });
    }
  });

  app.post('/api/payees', requireAuth, requireNoLiquidation, async (req, res) => {
    try {
      const payeeInput = z.object({
        name: z.string().trim().min(2, "Beneficiary name is required").max(160),
        bankName: z.string().trim().min(2, "Bank name is required").max(160),
        accountNumber: z.string().trim().min(4, "IBAN or account number is required").max(64),
        routingNumber: z.string().trim().min(4, "SWIFT / BIC or routing number is required").max(64),
        country: z.string().trim().min(2, "Country is required").max(120).optional().default("Canada"),
        currency: z.enum(BALANCE_CURRENCIES).optional().default("USD"),
        type: z.enum(["individual", "business"]).optional().default("individual"),
      }).parse(req.body);
      const payee = await storage.createPayee({
        ...payeeInput,
        userId: (req.user as User).id,
        status: "pending_approval",
      } as any);
      res.status(201).json(payee);
    } catch (err) {
      console.error('Payee creation error:', err);
      if (err instanceof z.ZodError) {
        const message = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return res.status(400).json({ message: `Validation Error: ${message}` });
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ message: `Failed to create payee: ${errorMessage}` });
    }
  });

  app.delete('/api/payees/:id', requireAuth, requireNoLiquidation, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deletePayee(id, (req.user as User).id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete payee" });
    }
  });

  // External Wire / International Payment Route
  app.post('/api/transactions/payment', requireAuth, requireFundsAccess, requireNoLiquidation, async (req, res) => {
    try {
      const { fromAccountId, payeeId, amount, description, wireType, targetCurrency, reference } = z.object({
        fromAccountId: z.coerce.number().int().positive(),
        payeeId: z.coerce.number().int().positive(),
        amount: z.string().trim().refine(
          (val) => /^\d+(\.\d{1,2})?$/.test(val) && moneyToCents(val) > 0n,
          "Enter a valid positive amount with up to 2 decimal places",
        ),
        description: z.string().trim().max(240).optional(),
        wireType: z.enum(["domestic", "international"]).optional().default("international"),
        targetCurrency: z.enum(BALANCE_CURRENCIES).optional(),
        reference: z.string().trim().max(120).optional(),
      }).parse(req.body);

      const currentUserId = (req.user as User).id;

      // Verify ownership of source account
      const account = await storage.getAccount(fromAccountId);
      if (!account || account.userId !== currentUserId) {
        return res.status(403).json({ message: "Unauthorized account" });
      }

      // A request is not a posting. Cash moves only after trusted approval.
      if (moneyToCents(amount) <= 0n) throw new Error("Amount must be positive");
      const transaction = await db.transaction(async (tx) => {
        const [acc] = await tx.select().from(accounts).where(eq(accounts.id, fromAccountId)).for("update");
        if (!acc || Number(acc.balance) < Number(amount)) {
          throw new Error("Insufficient funds in selected account");
        }

        const [payee] = await tx.select().from(payees).where(eq(payees.id, payeeId));
        if (!payee || payee.userId !== currentUserId) {
          throw new Error("Unauthorized or missing beneficiary");
        }
        if (payee.status === "rejected") {
          throw new Error("This beneficiary was declined and cannot receive wire transfers");
        }

        const scopeLabel = wireType === "international" ? "International SWIFT Wire" : "Domestic Wire";
        const currLabel = targetCurrency || payee.currency || "";
        const countryLabel = payee.country ? ` · ${payee.country}` : "";
        const refSuffix = reference ? ` · Ref: ${reference}` : "";
        const descSuffix = description ? ` — ${description}` : "";
        const finalDescription = `${scopeLabel} to ${payee.name}${countryLabel}${currLabel ? ` (${currLabel})` : ""}${descSuffix}${refSuffix}`.slice(0, 250);

        const [t] = await tx.insert(transactions).values({
          fromAccountId,
          payeeId,
          amount,
          description: finalDescription,
          transactionType: 'payment',
          status: 'pending',
          cashDebitDeferred: true,
          entryOrigin: 'client',
          evidenceRef: reference || null,
          isDemo: false,
        }).returning();

        return t;
      });

      await recordTransactionAudit(pool, {
        transactionId: transaction?.id ?? null,
        entryOrigin: "client",
        action: "client_submitted",
        actorType: "client",
        actorName: (req.user as User).name,
        evidenceRef: reference || null,
        reason: `Client submitted ${wireType} wire transfer request`,
      });

      res.status(201).json(transaction);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Payment failed" });
    }
  });
  // ─── Client Applications (public) ────────────────────────────────────────────

  app.post("/api/applications", async (req, res) => {
    try {
      const applicationInput = z.object({
        fullName: z.string().trim().min(2).max(200),
        email: z.string().trim().email().max(254),
        phone: z.string().trim().min(7).max(32),
        dateOfBirth: z.string().min(1).max(32),
        nationality: z.string().min(1, "Nationality is required").max(100),
        address: z.string().max(300).optional().nullable(),
        city: z.string().max(120).optional().nullable(),
        country: z.string().min(1, "Country is required").max(120),
        employmentStatus: z.string().min(1).max(80),
        annualIncome: z.string().min(1).max(80),
        investmentExperience: z.string().min(1).max(80),
        riskTolerance: z.string().min(1).max(80),
        investmentGoal: z.string().min(1).max(120),
        initialDeposit: z.string().min(1).max(80),
        sourceOfFunds: z.string().min(1).max(120),
        preferredCurrency: z.enum(BALANCE_CURRENCIES).optional().default("CAD"),
      }).parse(req.body);

      const [app] = await db.insert(applications).values({
        ...applicationInput,
        password: null,
        status: "pending",
      }).returning();
      res.status(201).json({ id: app.id, message: "Application submitted successfully" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid application details" });
      }
      res.status(500).json({ message: err.message || "Failed to submit application" });
    }
  });

  app.post("/api/account-activation/inspect", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { token } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const { rows } = await pool.query(
        `SELECT COALESCE(t.purpose, 'activation') AS purpose, u.display_currency AS "displayCurrency"
           FROM account_setup_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1
            AND t.consumed_at IS NULL
            AND t.expires_at > NOW()
          LIMIT 1`,
        [tokenHash],
      );
      if (rows.length !== 1) {
        return res.status(400).json({ message: "This setup link is invalid, expired, or already used." });
      }
      return res.json({
        ok: true,
        purpose: rows[0].purpose || "activation",
        displayCurrency: isBalanceCurrency(rows[0].displayCurrency) ? rows[0].displayCurrency : "CAD",
      });
    } catch {
      return res.status(400).json({ message: "Invalid setup token" });
    }
  });

  app.post("/api/account-activation/complete", async (req, res) => {
    const inputSchema = z.object({
      token: z.string().min(32).max(256),
      password: z.string()
        .min(12, "Password must be at least 12 characters")
        .max(128, "Password must be no more than 128 characters")
        .regex(/[a-z]/, "Password must include a lowercase letter")
        .regex(/[A-Z]/, "Password must include an uppercase letter")
        .regex(/[0-9]/, "Password must include a number")
        .regex(/[^A-Za-z0-9]/, "Password must include a symbol"),
      displayCurrency: z.enum(BALANCE_CURRENCIES).optional(),
    });

    let client;
    try {
      const { token, password, displayCurrency } = inputSchema.parse(req.body);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const passwordHash = await hashPassword(password);
      client = await pool.connect();
      await client.query("BEGIN");

      const tokenResult = await client.query(
        `SELECT id, user_id, COALESCE(purpose, 'activation') AS purpose
           FROM account_setup_tokens
          WHERE token_hash = $1
            AND consumed_at IS NULL
            AND expires_at > NOW()
          FOR UPDATE`,
        [tokenHash],
      );
      if (tokenResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This setup link is invalid, expired, or already used. Contact support for a new link." });
      }

      const userId = tokenResult.rows[0].user_id;
      const purpose: string = tokenResult.rows[0].purpose || "activation";
      await client.query("INSERT INTO client_security(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
      const securityResult = await client.query("SELECT mfa_enabled FROM client_security WHERE user_id=$1 FOR UPDATE", [userId]);
      if (purpose !== "admin_reset" && securityResult.rows[0].mfa_enabled) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Please sign in and use Security settings to change your password." });
      }
      const { rows: [currentUser] } = await client.query(
        "SELECT display_currency FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!currentUser) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This setup link is invalid, expired, or already used. Contact support for a new link." });
      }

      const applySetupCurrency = purpose === "activation" && displayCurrency !== undefined;
      const nextCurrency = applySetupCurrency ? displayCurrency : currentUser.display_currency;

      const updateResult = await client.query(
        "UPDATE users SET password = $1, display_currency = $2 WHERE id = $3 RETURNING client_ref, display_currency",
        [passwordHash, nextCurrency, userId],
      );
      if (updateResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This setup link is invalid, expired, or already used. Contact support for a new link." });
      }

      if (applySetupCurrency && currentUser.display_currency !== nextCurrency) {
        await client.query(
          `INSERT INTO client_display_currency_audit
             (user_id, actor, previous_currency, display_currency, reason, confirmed)
           VALUES ($1, 'client_setup', $2, $3, 'Selected during initial account activation setup', TRUE)`,
          [userId, currentUser.display_currency, nextCurrency],
        );
      }

      await client.query(
        "UPDATE account_setup_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL",
        [userId],
      );
      await client.query("INSERT INTO client_security(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
      await client.query("UPDATE client_security SET version=version+1,pending_secret=NULL,pending_expires=NULL,pending_session=NULL WHERE user_id=$1", [userId]);
      if (purpose === "admin_reset") {
        await client.query("INSERT INTO client_security_events(user_id, event) VALUES($1, $2)", [userId, "password_reset_by_admin_link"]);
      }
      await revokeSessions(client, userId);
      await client.query("COMMIT");
      return res.json({
        ok: true,
        clientRef: updateResult.rows[0].client_ref,
        displayCurrency: updateResult.rows[0].display_currency,
        purpose,
      });
    } catch (err: any) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid password" });
      }
      console.error("Account activation failed.");
      return res.status(500).json({ message: "Unable to complete account setup right now." });
    } finally {
      client?.release();
    }
  });

  // ─── Admin Routes ────────────────────────────────────────────────────────────

  // All applications (enriched with matched clientRef when approved/registered)
  app.get("/api/admin/applications", requireAdmin, async (req, res) => {
    try {
      const all = await db.select().from(applications).orderBy(desc(applications.createdAt));
      const allUsersRef = await db.select({ email: users.email, clientRef: users.clientRef, id: users.id }).from(users);
      const refByEmail = new Map(allUsersRef.map(u => [u.email.toLowerCase(), { clientRef: u.clientRef, userId: u.id }]));
      res.json(all.map(({ password: _password, ...application }) => {
        const match = refByEmail.get((application.email || "").toLowerCase());
        return {
          ...application,
          clientRef: match?.clientRef ?? null,
          userId: match?.userId ?? null,
        };
      }));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Approve application → create user account
  app.post("/api/admin/applications/:id/approve", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [app] = await db.select().from(applications).where(eq(applications.id, id));
      if (!app) return res.status(404).json({ message: "Application not found" });
      if (app.status !== "pending") return res.status(400).json({ message: "Application already processed" });

      // Check if email already registered
      const existing = await storage.getUserByEmail(app.email);
      if (existing) {
        await db.update(applications).set({ status: "rejected", notes: "Email already registered" }).where(eq(applications.id, id));
        return res.status(400).json({ message: "Email already has an account" });
      }

      const setupToken = randomBytes(32).toString("base64url");
      const setupTokenHash = createHash("sha256").update(setupToken).digest("hex");
      const setupExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const unavailablePasswordHash = await hashPassword(randomBytes(48).toString("base64url"));
      let assignedClientRef = "";

      const user = await db.transaction(async (tx) => {
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `VW-${randomBytes(5).toString("hex").toUpperCase()}`;
          const [existingRef] = await tx.select({ id: users.id })
            .from(users)
            .where(eq(users.clientRef, candidate))
            .limit(1);
          if (!existingRef) {
            assignedClientRef = candidate;
            break;
          }
        }
        if (!assignedClientRef) throw new Error("Unable to assign a unique Client ID");

        const initialDisplayCurrency = isBalanceCurrency(app.preferredCurrency) ? app.preferredCurrency : "CAD";
        const [newUser] = await tx.insert(users).values({
          clientRef: assignedClientRef,
          name: app.fullName,
          email: app.email,
          password: unavailablePasswordHash,
          phoneNumber: app.phone,
          displayCurrency: initialDisplayCurrency,
        }).returning();

        // Create an investment-only brokerage account with no liquid cash.
        await tx.insert(accounts).values({
          userId: newUser.id,
          accountType: "Brokerage Account",
          balance: "0.00",
          isDemo: false,
        });

        await tx.insert(accountSetupTokens).values({
          userId: newUser.id,
          tokenHash: setupTokenHash,
          expiresAt: setupExpiresAt,
        });

        await tx.update(applications)
        .set({ status: "approved", notes: req.body.notes || null })
          .where(eq(applications.id, id));
        return newUser;
      });

      res.json({
        ok: true,
        message: "Application approved",
        userId: user.id,
        userName: user.name,
        clientRef: user.clientRef,
        activationPath: `/activate#token=${setupToken}`,
        activationExpiresAt: setupExpiresAt.toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Reject application
  app.post("/api/admin/applications/:id/reject", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [app] = await db.select().from(applications).where(eq(applications.id, id));
      if (!app) return res.status(404).json({ message: "Application not found" });
      if (app.status !== "pending") return res.status(400).json({ message: "Application already processed" });

      await db.update(applications)
        .set({ status: "rejected", notes: req.body.notes || null })
        .where(eq(applications.id, id));
      res.json({ ok: true, message: "Application rejected" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Platform stats
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
      const [txCount] = await db.select({ count: sql<number>`count(*)` }).from(transactions);
      const [pendingCount] = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(eq(transactions.status, "pending"));
      const [totalVolume] = await db.select({ sum: sql<string>`coalesce(sum(amount), 0)` }).from(transactions).where(eq(transactions.status, "completed"));
      const [totalAssets] = await db.select({ sum: sql<string>`coalesce(sum(balance), 0)` }).from(accounts);
      let pendingSecondAdminCount = 0;
      let pendingAccountRequestsCount = 0;
      try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM admin_posting_requests WHERE status = 'pending_second_admin'`);
        pendingSecondAdminCount = rows[0]?.count ?? 0;
      } catch { /* ignore when DB mock */ }
      try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM account_opening_requests WHERE status = 'pending'`);
        pendingAccountRequestsCount = rows[0]?.count ?? 0;
      } catch { /* ignore when DB mock */ }
      res.json({
        userCount: Number(userCount?.count ?? 0),
        txCount: Number(txCount?.count ?? 0),
        pendingCount: Number(pendingCount?.count ?? 0),
        pendingSecondAdminCount,
        pendingAccountRequestsCount,
        totalVolume: totalVolume?.sum ?? "0",
        totalAssets: totalAssets?.sum ?? "0",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: list all client account opening requests
  app.get("/api/admin/account-requests", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { rows } = await pool.query(
        `SELECT r.id,
                r.user_id AS "userId",
                u.name AS "userName",
                u.email AS "userEmail",
                u.client_ref AS "userClientRef",
                r.account_type AS "accountType",
                r.requested_display_name AS "requestedDisplayName",
                r.ownership_structure AS "ownershipStructure",
                r.investment_objective AS "investmentObjective",
                r.risk_tolerance AS "riskTolerance",
                r.funding_source AS "fundingSource",
                r.expected_initial_funding AS "expectedInitialFunding",
                r.jurisdiction,
                r.additional_notes AS "additionalNotes",
                r.status,
                r.admin_notes AS "adminNotes",
                r.created_account_id AS "createdAccountId",
                a.account_number AS "createdAccountNumber",
                COALESCE(NULLIF(a.display_name, ''), a.account_type) AS "createdAccountLabel",
                r.reviewed_by_staff_name AS "reviewedByStaffName",
                r.reviewed_at AS "reviewedAt",
                r.created_at AS "createdAt"
         FROM account_opening_requests r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN accounts a ON a.id = r.created_account_id
         ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC`,
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load account opening requests" });
    }
  });

  // Admin: approve a pending account opening request and provision the real account
  app.post("/api/admin/account-requests/:id/approve", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ message: "Invalid account opening request ID" });
    }
    const requestId = parsedId.data;
    const bodySchema = z.object({
      adminNotes: z.string().trim().max(1000).optional(),
      displayName: z.string().trim().max(80).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ message: parsedBody.error.issues[0]?.message || "Invalid approval details" });
    }

    const staffName = req.adminStaff
      ? `${req.adminStaff.displayName} (@${req.adminStaff.username})`
      : "Configured administrator";

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const { rows: [reqRow] } = await client.query(
        `SELECT * FROM account_opening_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (!reqRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Account opening request not found" });
      }
      if (reqRow.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Request has already been ${reqRow.status}` });
      }
      if (!INVESTMENT_ACCOUNT_TYPES.has(reqRow.account_type)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Unsupported investment account type on request" });
      }

      const { rows: [userRow] } = await client.query(
        `SELECT id, name, email, client_ref AS "clientRef" FROM users WHERE id = $1 FOR UPDATE`,
        [reqRow.user_id],
      );
      if (!userRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Client profile no longer exists" });
      }

      const finalDisplayName =
        parsedBody.data.displayName?.trim() ||
        (reqRow.requested_display_name ? String(reqRow.requested_display_name).trim() : null) ||
        null;

      const { rows: [newAccount] } = await client.query(
        `INSERT INTO accounts (user_id, account_type, display_name, balance, is_demo)
         VALUES ($1, $2, $3, '0.00', FALSE)
         RETURNING id, account_number AS "accountNumber", user_id AS "userId",
                   account_type AS "accountType", display_name AS "displayName",
                   balance::text AS balance, is_demo AS "isDemo", created_at AS "createdAt"`,
        [reqRow.user_id, reqRow.account_type, finalDisplayName],
      );

      const notesValue = parsedBody.data.adminNotes?.trim() || null;
      const { rows: [updatedRequest] } = await client.query(
        `UPDATE account_opening_requests
         SET status = 'approved',
             created_account_id = $2,
             admin_notes = $3,
             reviewed_by_staff_name = $4,
             reviewed_at = NOW()
         WHERE id = $1
         RETURNING id, status, created_account_id AS "createdAccountId",
                   admin_notes AS "adminNotes", reviewed_by_staff_name AS "reviewedByStaffName",
                   reviewed_at AS "reviewedAt"`,
        [requestId, newAccount.id, notesValue, staffName],
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "Account opening request approved and account opened",
        request: updatedRequest,
        account: newAccount,
      });
    } catch (err: any) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to approve account opening request" });
    } finally {
      client?.release();
    }
  });

  // Admin: reject a pending account opening request
  app.post("/api/admin/account-requests/:id/reject", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ message: "Invalid account opening request ID" });
    }
    const requestId = parsedId.data;
    const bodySchema = z.object({
      adminNotes: z.string().trim().max(1000).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ message: parsedBody.error.issues[0]?.message || "Invalid rejection note" });
    }

    const staffName = req.adminStaff
      ? `${req.adminStaff.displayName} (@${req.adminStaff.username})`
      : "Configured administrator";
    const notesValue = parsedBody.data.adminNotes?.trim() || "Declined following compliance review.";

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const { rows: [reqRow] } = await client.query(
        `SELECT id, status FROM account_opening_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (!reqRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Account opening request not found" });
      }
      if (reqRow.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Request has already been ${reqRow.status}` });
      }
      const { rows: [updatedRequest] } = await client.query(
        `UPDATE account_opening_requests
         SET status = 'rejected',
             admin_notes = $2,
             reviewed_by_staff_name = $3,
             reviewed_at = NOW()
         WHERE id = $1
         RETURNING id, status, admin_notes AS "adminNotes",
                   reviewed_by_staff_name AS "reviewedByStaffName",
                   reviewed_at AS "reviewedAt"`,
        [requestId, notesValue, staffName],
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "Account opening request rejected",
        request: updatedRequest,
      });
    } catch (err: any) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to reject account opening request" });
    } finally {
      client?.release();
    }
  });

  // All users with account summary and security posture
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
      let mfaByUser = new Map<number, boolean>();
      try {
        const { rows: secRows } = await pool.query(`SELECT user_id, mfa_enabled FROM client_security`);
        mfaByUser = new Map(secRows.map((r: any) => [Number(r.user_id), Boolean(r.mfa_enabled)]));
      } catch { /* ignore when table unavailable */ }
      const result = await Promise.all(allUsers.map(async (u) => {
        const accs = await db.select().from(accounts).where(eq(accounts.userId, u.id));
        const totalBalance = accs.reduce((sum, a) => sum + Number(a.balance), 0);
        return {
          ...u,
          password: undefined,
          accountCount: accs.length,
          totalBalance,
          mfaEnabled: mfaByUser.get(u.id) ?? false,
        };
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Dedicated full client profile details for Admin Client Profile page
  app.get("/api/admin/users/:id/details", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ message: "Invalid client user ID" });
    }
    const userId = parsedId.data;
    try {
      const [userRow] = await db.select().from(users).where(eq(users.id, userId));
      if (!userRow) return res.status(404).json({ message: "Client profile not found" });
      const { password: _password, ...safeClient } = userRow as any;

      const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.id);
      const accountIds = userAccounts.map(a => a.id);

      const userPayees = await db.select().from(payees).where(eq(payees.userId, userId)).orderBy(desc(payees.createdAt));
      const payeeIds = userPayees.map(p => p.id);

      const userTransfers = await db
        .select()
        .from(institutionalTransfers)
        .where(eq(institutionalTransfers.userId, userId))
        .orderBy(desc(institutionalTransfers.createdAt));

      const userInvestments = accountIds.length > 0
        ? await db.select().from(investments).where(inArray(investments.accountId, accountIds))
        : [];

      const safeQuery = async <T = any>(sqlText: string, params: unknown[]): Promise<T[]> => {
        try {
          const { rows } = await pool.query(sqlText, params);
          return rows as T[];
        } catch {
          return [];
        }
      };

      const [
        contactRows,
        securityRows,
        securityEvents,
        recoveryRequests,
        setupTokens,
        applicationRows,
        currencyAuditRows,
        clientTransactions,
        feeEnrollmentsRows,
        managementContractRows,
        feeAssessmentsRows,
        accountRequestRows,
      ] = await Promise.all([
        safeQuery(
          `SELECT residential_address AS "residentialAddress", mailing_address AS "mailingAddress", updated_at AS "updatedAt"
           FROM client_contact_details WHERE user_id = $1`,
          [userId],
        ),
        safeQuery(
          `SELECT mfa_enabled AS "mfaEnabled", version FROM client_security WHERE user_id = $1`,
          [userId],
        ),
        safeQuery(
          `SELECT id, event, created_at AS "createdAt"
           FROM client_security_events WHERE user_id = $1 ORDER BY id DESC LIMIT 25`,
          [userId],
        ),
        safeQuery(
          `SELECT id, status, created_at AS "createdAt", reviewed_at AS "reviewedAt"
           FROM client_recovery_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
          [userId],
        ),
        safeQuery(
          `SELECT id, COALESCE(purpose, 'activation') AS purpose, expires_at AS "expiresAt",
                  consumed_at AS "consumedAt", created_at AS "createdAt"
           FROM account_setup_tokens WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
          [userId],
        ),
        safeQuery(
          `SELECT id, full_name AS "fullName", email, phone, date_of_birth AS "dateOfBirth",
                  nationality, address, city, country, employment_status AS "employmentStatus",
                  annual_income AS "annualIncome", investment_experience AS "investmentExperience",
                  risk_tolerance AS "riskTolerance", investment_goal AS "investmentGoal",
                  initial_deposit AS "initialDeposit", source_of_funds AS "sourceOfFunds",
                  status, notes, created_at AS "createdAt"
           FROM applications
           WHERE LOWER(email) = LOWER($1)
           ORDER BY id DESC LIMIT 1`,
          [userRow.email],
        ),
        safeQuery(
          `SELECT id, actor, previous_currency AS "previousCurrency", display_currency AS "displayCurrency",
                  reason, created_at AS "createdAt"
           FROM client_display_currency_audit WHERE user_id = $1 ORDER BY id DESC LIMIT 25`,
          [userId],
        ),
        (accountIds.length > 0 || payeeIds.length > 0)
          ? safeQuery(
              `SELECT t.id, t.from_account_id AS "fromAccountId", t.to_account_id AS "toAccountId",
                      t.payee_id AS "payeeId", t.amount::text AS amount, t.description,
                      t.transaction_type AS "transactionType", t.status,
                      t.entry_origin AS "entryOrigin", t.evidence_ref AS "evidenceRef",
                      t.audit_reason AS "auditReason", t.admin_notes AS "adminNotes",
                      t.created_by_staff_name AS "createdByStaffName",
                      t.approved_by_staff_name AS "approvedByStaffName",
                      t.created_at AS "createdAt",
                      COALESCE(NULLIF(fa.display_name, ''), fa.account_type) AS "fromAccountLabel",
                      fa.account_number AS "fromAccountNumber",
                      COALESCE(NULLIF(ta.display_name, ''), ta.account_type) AS "toAccountLabel",
                      ta.account_number AS "toAccountNumber",
                      p.name AS "payeeName"
               FROM transactions t
               LEFT JOIN accounts fa ON fa.id = t.from_account_id
               LEFT JOIN accounts ta ON ta.id = t.to_account_id
               LEFT JOIN payees p ON p.id = t.payee_id
               WHERE t.from_account_id = ANY($1::int[])
                  OR t.to_account_id = ANY($1::int[])
                  OR t.payee_id = ANY($2::int[])
               ORDER BY t.created_at DESC, t.id DESC
               LIMIT 150`,
              [accountIds, payeeIds],
            )
          : Promise.resolve([]),
        safeQuery(
          `SELECT e.id, e.account_id AS "accountId", e.schedule_id AS "scheduleId", e.state,
                  e.first_charge_date AS "firstChargeDate", e.next_period AS "nextPeriod",
                  e.accepted_at AS "acceptedAt", e.created_at AS "createdAt",
                  s.name AS "scheduleName", s.version AS "scheduleVersion",
                  s.total::text AS "scheduleTotal", s.currency AS "scheduleCurrency"
           FROM fee_enrollments e
           LEFT JOIN fee_schedules s ON s.id = e.schedule_id
           WHERE e.user_id = $1
           ORDER BY e.id DESC`,
          [userId],
        ),
        safeQuery(
          `SELECT id, account_id AS "accountId", opening_date AS "openingDate",
                  annual_minimum::text AS "annualMinimum", annual_rate_percent::text AS "annualRatePercent",
                  state, next_period AS "nextPeriod", accepted_at AS "acceptedAt", created_at AS "createdAt"
           FROM management_contracts WHERE user_id = $1 ORDER BY id DESC`,
          [userId],
        ),
        accountIds.length > 0
          ? safeQuery(
              `SELECT id, account_id AS "accountId", kind, period, due_date AS "dueDate",
                      total::text AS total, status, reason, created_at AS "createdAt"
               FROM fee_assessments
               WHERE account_id = ANY($1::int[])
               ORDER BY id DESC LIMIT 50`,
              [accountIds],
            )
          : Promise.resolve([]),
        safeQuery(
          `SELECT r.id, r.account_type AS "accountType", r.requested_display_name AS "requestedDisplayName",
                  r.ownership_structure AS "ownershipStructure", r.investment_objective AS "investmentObjective",
                  r.risk_tolerance AS "riskTolerance", r.funding_source AS "fundingSource",
                  r.expected_initial_funding AS "expectedInitialFunding", r.jurisdiction,
                  r.additional_notes AS "additionalNotes", r.status, r.admin_notes AS "adminNotes",
                  r.created_account_id AS "createdAccountId", a.account_number AS "createdAccountNumber",
                  r.reviewed_by_staff_name AS "reviewedByStaffName", r.reviewed_at AS "reviewedAt",
                  r.created_at AS "createdAt"
           FROM account_opening_requests r
           LEFT JOIN accounts a ON a.id = r.created_account_id
           WHERE r.user_id = $1
           ORDER BY r.id DESC`,
          [userId],
        ),
      ]);

      const totalBalance = userAccounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);

      res.json({
        user: {
          ...safeClient,
          accountCount: userAccounts.length,
          totalBalance,
        },
        contactDetails: contactRows[0] ?? null,
        security: {
          mfaEnabled: Boolean(securityRows[0]?.mfaEnabled),
          version: Number(securityRows[0]?.version ?? 0),
          events: securityEvents,
          recoveryRequests,
          setupTokens,
        },
        application: applicationRows[0] ?? null,
        accounts: userAccounts,
        accountRequests: accountRequestRows,
        investments: userInvestments,
        transactions: clientTransactions,
        payees: userPayees,
        institutionalTransfers: userTransfers,
        displayCurrencyAudit: currencyAuditRows,
        fees: {
          enrollments: feeEnrollmentsRows,
          contracts: managementContractRows,
          assessments: feeAssessmentsRows,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load client details" });
    }
  });

  // Admin: generate a one-time password reset link for any client at any time
  app.post("/api/admin/users/:id/password-reset-link", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ message: "Invalid client user ID" });
    }
    const userId = parsedId.data;
    const resetToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(resetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const { rows: [userRow] } = await client.query(
        `SELECT id, name, email, client_ref AS "clientRef" FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!userRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Client profile not found" });
      }

      // Invalidate any previously issued unused admin reset tokens for this user
      await client.query(
        `UPDATE account_setup_tokens
         SET consumed_at = NOW()
         WHERE user_id = $1 AND purpose = 'admin_reset' AND consumed_at IS NULL`,
        [userId],
      );

      await client.query(
        `INSERT INTO account_setup_tokens (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'admin_reset', $3)`,
        [userId, tokenHash, expiresAt],
      );

      await client.query(
        `INSERT INTO client_security_events (user_id, event) VALUES ($1, $2)`,
        [userId, "password_reset_link_issued"],
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        userId: userRow.id,
        userName: userRow.name,
        email: userRow.email,
        clientRef: userRow.clientRef,
        resetPath: `/activate#token=${resetToken}&mode=reset`,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err: any) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ message: err?.message || "Failed to generate password reset link" });
    } finally {
      client?.release();
    }
  });

  // Restrict / unrestrict a user login
  app.post("/api/admin/users/:id/restrict", requireAdmin, async (req, res) => {
    try {
      const { restricted, message } = req.body as { restricted: boolean; message?: string };
      const updated = await storage.updateUser(parseInt(req.params.id), {
        loginRestricted: restricted,
        loginRestrictionMessage: restricted ? (message || null) : null,
      });
      res.json({ success: true, loginRestricted: updated.loginRestricted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Freeze / unfreeze an account (compliance / fraud)
  app.post("/api/admin/users/:id/freeze", requireAdmin, async (req, res) => {
    try {
      const { frozen, reason } = req.body as { frozen: boolean; reason?: string };
      const updated = await storage.updateUser(parseInt(req.params.id), {
        accountFrozen: frozen,
        freezeReason: frozen ? (reason || null) : null,
        frozenAt: frozen ? new Date() : null,
      } as any);
      // Destroy all active sessions for this user so they are immediately logged out
      if (frozen) {
        await pool.query(`DELETE FROM session WHERE sess::jsonb->'passport'->>'user' = $1`, [String(req.params.id)]);
      }
      res.json({ success: true, accountFrozen: (updated as any).accountFrozen });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Approve a pending client transaction (after verifying real-world movement)
  app.post("/api/admin/transactions/:id/approve", requireAdmin, async (req, res) => {
    try {
      if (!req.adminStaff && !process.env.ADMIN_PASSWORD) {
        return res.status(503).json({ message: "Payment verification is not configured" });
      }
      const id = parseInt(req.params.id);
      let verificationNote: string | undefined;
      if (req.adminStaff) {
        const parsed = reviewApproveClientRequestSchema.parse(req.body);
        verificationNote = parsed.verificationNote?.trim() || undefined;
      } else if (req.body && typeof req.body.verificationNote === "string") {
        verificationNote = req.body.verificationNote.trim() || undefined;
      }

      await approvePayment(pool, id);

      const staffName = req.adminStaff
        ? `${req.adminStaff.displayName} (@${req.adminStaff.username})`
        : "Configured administrator";
      const reasonText = verificationNote || "Real-world funds movement verified";

      await pool.query(
        `UPDATE transactions
         SET approved_by_staff_id = $2,
             approved_by_staff_name = $3,
             approved_at = NOW(),
             audit_reason = COALESCE(audit_reason, $4)
         WHERE id = $1`,
        [id, req.adminStaff?.id ?? null, staffName, reasonText],
      );

      await recordTransactionAudit(pool, {
        transactionId: id,
        entryOrigin: "client",
        action: "request_approved",
        actorType: "staff",
        actorStaffId: req.adminStaff?.id ?? null,
        actorName: staffName,
        reason: reasonText,
      });

      res.json({ ok: true, message: "Transaction approved" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Verification confirmation is required" });
      }
      res.status(err instanceof FundsAccessError ? err.status : 500).json({ message: err instanceof FundsAccessError ? err.message : "Payment approval failed" });
    }
  });

  // Reject a pending client transaction (requires rejection reason for staff reviews)
  app.post("/api/admin/transactions/:id/reject", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      let reason = "Rejected by administrator";
      if (req.adminStaff) {
        const parsed = reviewRejectSchema.parse(req.body);
        reason = parsed.reason;
      } else if (req.body && typeof req.body.reason === "string" && req.body.reason.trim()) {
        reason = req.body.reason.trim().slice(0, 500);
      }

      const staffName = req.adminStaff
        ? `${req.adminStaff.displayName} (@${req.adminStaff.username})`
        : "Configured administrator";

      await db.transaction(async (tx) => {
        const [txn] = await tx.select().from(transactions).where(eq(transactions.id, id)).for("update");
        if (!txn) throw new FundsAccessError("Transaction not found",404);
        if (txn.status !== "pending") throw new FundsAccessError("Only pending transactions can be rejected",400);
        // Refund source account if balance was deducted
        if (txn.fromAccountId && !txn.cashDebitDeferred) {
          await tx.update(accounts)
            .set({ balance: sql`${accounts.balance} + ${txn.amount}` })
            .where(eq(accounts.id, txn.fromAccountId));
        }
        await tx.update(transactions)
          .set({
            status: "failed",
            adminNotes: reason,
            approvedByStaffId: req.adminStaff?.id ?? null,
            approvedByStaffName: staffName,
            approvedAt: new Date(),
            auditReason: reason,
          } as any)
          .where(eq(transactions.id, id));
      });

      await recordTransactionAudit(pool, {
        transactionId: id,
        entryOrigin: "client",
        action: "request_rejected",
        actorType: "staff",
        actorStaffId: req.adminStaff?.id ?? null,
        actorName: staffName,
        reason,
      });

      res.json({ ok: true, message: "Transaction rejected" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Rejection reason is required" });
      }
      res.status(err instanceof FundsAccessError ? err.status : 500).json({ message: err.message });
    }
  });

  // ─── Institutional Transfer Routes ────────────────────────────────────────────

  // Client: submit a new institutional transfer request
  app.post("/api/institutional-transfers", requireAuth, requireFundsAccess, requireLiquidationVerification, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const destination = institutionalDestinationSchema.safeParse(req.body);
      if (!destination.success) {
        return res.status(400).json({ message: destination.error.issues[0].message });
      }
      const { institutionName, institutionAccountNumber, institutionCountry, destinationDetails, accountHolderType, accountHolderName } = destination.data;
      const { accountType, transferType, transferScope, partialAmount, accountId, portfolioSnapshot } = req.body;
      const isFullPortfolio = transferScope === "full-portfolio";
      if (!institutionName || !institutionAccountNumber || !accountType || !transferType || !transferScope) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      if (!isFullPortfolio && !accountId) {
        return res.status(400).json({ message: "Account ID required for single-account transfers" });
      }
      const user = req.user as any;
      const record = await storage.createInstitutionalTransfer({
        userId: user.id,
        accountId: isFullPortfolio ? null : parseInt(accountId),
        institutionName,
        institutionAccountNumber,
        institutionCountry,
        destinationDetails: destinationDetails || null,
        accountType,
        transferType,
        transferScope,
        partialAmount: partialAmount ? String(partialAmount) : null,
        portfolioSnapshot: portfolioSnapshot ? JSON.stringify(portfolioSnapshot) : null,
        accountHolderType: accountHolderType || "own",
        accountHolderName: accountHolderName || null,
      } as any);
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Client: list own institutional transfers
  app.get("/api/institutional-transfers", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = req.user as any;
      const records = await storage.getInstitutionalTransfers(user.id);
      res.json(records);
    } catch (_) {
      res.set("Cache-Control", "no-store").status(503).json(LIQUIDATION_STATUS_UNAVAILABLE);
    }
  });

  // Admin: list all institutional transfers (enriched with user info)
  app.get("/api/admin/institutional-transfers", requireAdmin, async (req, res) => {
    try {
      const records = await storage.getAllInstitutionalTransfers();
      const enriched = await Promise.all(records.map(async (r) => {
        const [user] = await db.select().from(users).where(eq(users.id, r.userId));
        const account = r.accountId
          ? (await db.select().from(accounts).where(eq(accounts.id, r.accountId)))[0]
          : null;
        return {
          ...r,
          userName: user?.name || "Unknown",
          userEmail: user?.email || "",
          userClientRef: user?.clientRef || null,
          accountType2: account?.accountType || (r.transferScope === "full-portfolio" ? "Full Portfolio" : ""),
          accountBalance: account?.balance || "0",
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: approve an institutional transfer (legacy, kept for compatibility)
  app.post("/api/admin/institutional-transfers/:id/approve", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [record] = await db.select().from(institutionalTransfers).where(eq(institutionalTransfers.id, id));
      if (!record) return res.status(404).json({ message: "Transfer not found" });
      if ((await fundsAccess(pool,record.userId)).locked) return res.status(423).json({ message: "DEBT_PAYMENT_REQUIRED" });
      const now = new Date();
      const weeksToAdd = record.transferType === "cash" ? 15 : 12;
      const completionDate = new Date(now.getTime() + weeksToAdd * 7 * 24 * 60 * 60 * 1000);
      const updated = await storage.updateInstitutionalTransferStatus(id, "approved", completionDate, req.body.notes || "");
      res.json({ ok: true, message: `Transfer approved.`, transfer: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: reject an institutional transfer (legacy, kept for compatibility)
  app.post("/api/admin/institutional-transfers/:id/reject", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [record] = await db.select().from(institutionalTransfers).where(eq(institutionalTransfers.id, id));
      if (!record) return res.status(404).json({ message: "Transfer not found" });
      const updated = await storage.updateInstitutionalTransferStatus(id, "rejected", undefined, req.body.notes || "");
      res.json({ ok: true, message: "Transfer rejected", transfer: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: full monitor update — set status, completion date, notes freely
  app.patch("/api/admin/institutional-transfers/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [record] = await db.select().from(institutionalTransfers).where(eq(institutionalTransfers.id, id));
      if (!record) return res.status(404).json({ message: "Transfer not found" });
      if (req.body.status && !["pending","under_review","rejected"].includes(req.body.status) &&
          (await fundsAccess(pool,record.userId)).locked) return res.status(423).json({ message: "DEBT_PAYMENT_REQUIRED" });

      const { status, estimatedCompletionDate, adminNotes } = req.body as {
        status?: string;
        estimatedCompletionDate?: string | null;
        adminNotes?: string;
      };

      const validStatuses = ["pending", "under_review", "liquidating", "transfer_out", "completed", "rejected", "approved"];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const completionDate = estimatedCompletionDate ? new Date(estimatedCompletionDate) : undefined;
      const updated = await storage.updateInstitutionalTransferStatus(
        id,
        status || record.status,
        completionDate,
        adminNotes !== undefined ? adminNotes : record.adminNotes || ""
      );
      res.json({ ok: true, transfer: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Market Routes ────────────────────────────────────────────────────────────
  app.get(api.market.quote.path, requireAuth, (_req, res) => {
    res.set("Cache-Control", "no-store").status(503).json(MARKET_UNAVAILABLE);
  });

  return httpServer;
}
