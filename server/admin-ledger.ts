import type { Express, RequestHandler } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { hasDatabaseConfig } from "./db";
import { moneyToCents } from "@shared/fees";
import { accountLabel } from "@shared/account-display";
import type { AdminStaffIdentity } from "./admin-auth";

export class AdminLedgerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function centsToMoney(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

function parseDecimalScaled(raw: string): { scaled: bigint; scale: number } {
  const trimmed = String(raw ?? "0").trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(trimmed);
  if (!match || (!match[2] && !match[3])) {
    throw new AdminLedgerError(400, `Unsupported monetary value: ${trimmed}`);
  }
  const neg = Boolean(match[1]);
  const intPart = match[2] || "0";
  const fracPart = match[3] || "";
  const exp = match[4] ? Number(match[4]) : 0;
  const digits = BigInt(intPart + fracPart);
  const signedDigits = neg ? -digits : digits;
  const rawScale = fracPart.length - exp;
  if (rawScale >= 0) {
    return { scaled: signedDigits, scale: rawScale };
  }
  return { scaled: signedDigits * 10n ** BigInt(-rawScale), scale: 0 };
}

function compareDecimalStrings(a: string, b: string): number {
  const pa = parseDecimalScaled(a);
  const pb = parseDecimalScaled(b);
  const scale = Math.max(pa.scale, pb.scale);
  const va = pa.scaled * 10n ** BigInt(scale - pa.scale);
  const vb = pb.scaled * 10n ** BigInt(scale - pb.scale);
  return va < vb ? -1 : va > vb ? 1 : 0;
}

function addDecimalStrings(a: string, b: string): string {
  const pa = parseDecimalScaled(a);
  const pb = parseDecimalScaled(b);
  const scale = Math.max(2, pa.scale, pb.scale);
  const va = pa.scaled * 10n ** BigInt(scale - pa.scale);
  const vb = pb.scaled * 10n ** BigInt(scale - pb.scale);
  const sum = va + vb;
  const neg = sum < 0n;
  const abs = neg ? -sum : sum;
  const factor = 10n ** BigInt(scale);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(scale, "0");
  const trimmedFrac = frac.length > 2 ? frac.replace(/0+$/, "").padEnd(2, "0") : frac;
  return `${neg ? "-" : ""}${whole.toString()}.${trimmedFrac}`;
}

function subtractDecimalStrings(a: string, b: string): string {
  const normalizedB = String(b).trim();
  const negatedB = normalizedB.startsWith("-") ? normalizedB.slice(1) : `-${normalizedB}`;
  return addDecimalStrings(a, negatedB);
}

const positiveAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid positive amount with up to 2 decimal places")
  .refine((val) => moneyToCents(val) > 0n, "Amount must be greater than 0");

const effectiveDateSchema = z
  .string()
  .trim()
  .min(1, "Effective date is required")
  .refine((val) => {
    const ms = Date.parse(val);
    return Number.isFinite(ms);
  }, "Enter a valid date")
  .refine((val) => {
    const ms = Date.parse(val);
    return ms <= Date.now() + 5 * 60 * 1000;
  }, "Posting date cannot be in the future");

export const createPostingSchema = z
  .object({
    postingType: z.enum(["deposit", "transfer"]),
    clientUserId: z.coerce.number().int().positive(),
    fromAccountId: z.coerce.number().int().positive().nullable().optional(),
    toAccountId: z.coerce.number().int().positive(),
    amount: positiveAmountSchema,
    effectiveDate: effectiveDateSchema,
    reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
    evidenceRef: z.string().trim().min(3, "Evidence or reference is required (min 3 characters)").max(250),
    description: z.string().trim().max(250).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.postingType === "deposit" && val.fromAccountId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromAccountId"],
        message: "Deposits must not specify a source account",
      });
    }
    if (val.postingType === "transfer") {
      if (!val.fromAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fromAccountId"],
          message: "Select a source account for the transfer",
        });
      } else if (val.fromAccountId === val.toAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toAccountId"],
          message: "Source and destination accounts must be different",
        });
      }
    }
  });

const replacementSchema = z
  .object({
    postingType: z.enum(["deposit", "transfer"]),
    fromAccountId: z.coerce.number().int().positive().nullable().optional(),
    toAccountId: z.coerce.number().int().positive(),
    amount: positiveAmountSchema,
    effectiveDate: effectiveDateSchema,
    description: z.string().trim().max(250).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.postingType === "deposit" && val.fromAccountId != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Deposits cannot have a source account" });
    }
    if (val.postingType === "transfer" && (!val.fromAccountId || val.fromAccountId === val.toAccountId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer requires distinct source and destination accounts" });
    }
  });

export const createReversalSchema = z
  .object({
    reason: z.string().trim().min(5, "Correction reason must be at least 5 characters").max(500),
    evidenceRef: z.string().trim().min(3, "Evidence or reference is required (min 3 characters)").max(250),
    replacement: replacementSchema.optional(),
  })
  .strict();

export const reviewApproveClientRequestSchema = z
  .object({
    verifiedRealWorldMovement: z.literal(true, {
      errorMap: () => ({ message: "Confirm real-world funds movement verification before approving" }),
    }),
    verificationNote: z.string().trim().max(500).optional(),
  })
  .strict();

export const reviewRejectSchema = z
  .object({
    reason: z.string().trim().min(5, "Rejection reason must be at least 5 characters").max(500),
  })
  .strict();

export const approvePostingRequestSchema = z
  .object({
    confirmSummary: z.literal(true, {
      errorMap: () => ({ message: "Confirm the before-and-after summary before posting" }),
    }),
    reviewNote: z.string().trim().max(500).optional(),
  })
  .strict();

type AuditInput = {
  transactionId?: number | null;
  postingRequestId?: number | null;
  entryOrigin: "client" | "staff";
  action: string;
  actorType: "client" | "staff" | "system";
  actorStaffId?: number | null;
  actorName: string;
  reason: string;
  evidenceRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

type MemoryPostingRequest = {
  id: number;
  actionKind: string;
  postingType: string;
  clientUserId: number;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: string;
  effectiveDate: string;
  reason: string;
  evidenceRef: string;
  description: string | null;
  targetTransactionId: number | null;
  replacementPayload: string | null;
  status: string;
  createdByStaffId: number;
  createdByStaffUsername: string;
  createdByStaffName: string;
  reviewedByStaffId: number | null;
  reviewedByStaffUsername: string | null;
  reviewedByStaffName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  postedTransactionId: number | null;
  reversalTransactionId: number | null;
  replacementTransactionId: number | null;
  createdAt: string;
};

type MemoryAuditEntry = {
  id: number;
  transactionId: number | null;
  postingRequestId: number | null;
  entryOrigin: string;
  action: string;
  actorType: string;
  actorStaffId: number | null;
  actorName: string;
  reason: string;
  evidenceRef: string | null;
  metadata: string | null;
  createdAt: string;
};

const memoryPostingRequests: MemoryPostingRequest[] = [];
const memoryAuditTrail: MemoryAuditEntry[] = [];
let memoryAuditSeq = 1;

export async function recordTransactionAudit(
  dbClient: Pick<Pool, "query"> | PoolClient,
  entry: AuditInput,
) {
  const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;
  if (!hasDatabaseConfig) {
    memoryAuditTrail.unshift({
      id: memoryAuditSeq++,
      transactionId: entry.transactionId ?? null,
      postingRequestId: entry.postingRequestId ?? null,
      entryOrigin: entry.entryOrigin,
      action: entry.action,
      actorType: entry.actorType,
      actorStaffId: entry.actorStaffId ?? null,
      actorName: entry.actorName,
      reason: entry.reason,
      evidenceRef: entry.evidenceRef ?? null,
      metadata: metadataJson,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  await dbClient.query(
    `INSERT INTO transaction_audit_trail
       (transaction_id, posting_request_id, entry_origin, action, actor_type, actor_staff_id, actor_name, reason, evidence_ref, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.transactionId ?? null,
      entry.postingRequestId ?? null,
      entry.entryOrigin,
      entry.action,
      entry.actorType,
      entry.actorStaffId ?? null,
      entry.actorName,
      entry.reason,
      entry.evidenceRef ?? null,
      metadataJson,
    ],
  );
}

function deriveDirection(row: {
  fromAccountId: number | null;
  toAccountId: number | null;
  fromUserId: number | null;
  toUserId: number | null;
  payeeId: number | null;
  transactionType: string;
  reversalOfTransactionId?: number | null;
}): string {
  if (row.reversalOfTransactionId) return "reversal";
  if (row.transactionType === "buy") return "investment_buy";
  if (row.transactionType === "sell") return "investment_sell";
  if (row.transactionType === "fee") return "fee";
  if (row.transactionType === "fee_refund") return "fee_refund";
  if (row.payeeId || row.transactionType === "payment" || row.transactionType === "withdrawal") {
    return "wire_outgoing";
  }
  if (row.fromAccountId == null && row.toAccountId != null) return "deposit";
  if (row.fromAccountId != null && row.toAccountId != null) {
    if (row.fromUserId && row.toUserId && row.fromUserId === row.toUserId) {
      return "internal_transfer";
    }
    return "transfer_outgoing";
  }
  if (row.fromAccountId != null && row.toAccountId == null) return "debit";
  return "transfer";
}

function staffLabel(staff: AdminStaffIdentity): string {
  return `${staff.displayName} (@${staff.username})`;
}

async function computePostingPreview(
  client: Pick<Pool, "query"> | PoolClient,
  input: z.infer<typeof createPostingSchema>,
) {
  const { rows: clientRows } = await client.query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [input.clientUserId],
  );
  const clientUser = clientRows[0];
  if (!clientUser) throw new AdminLedgerError(404, "Selected client was not found");

  const accountIds = [input.fromAccountId, input.toAccountId].filter((id): id is number => id != null);
  const { rows: accountRows } = await client.query(
    `SELECT a.id, a.user_id AS "userId", a.account_number AS "accountNumber", a.account_type AS "accountType",
       a.display_name AS "displayName", COALESCE(a.balance::text, '0') AS "balance", u.name AS "ownerName", u.email AS "ownerEmail"
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.id = ANY($1::int[])`,
    [accountIds],
  );

  const byId = new Map<number, any>(accountRows.map(r => [r.id, r]));
  const toAcc = byId.get(input.toAccountId);
  if (!toAcc) throw new AdminLedgerError(404, "Destination account not found");

  const amountCents = moneyToCents(input.amount);
  const amountStr = centsToMoney(amountCents);
  const affectedAccounts: any[] = [];
  const warnings: string[] = [];
  let canSubmit = true;

  if (input.postingType === "deposit") {
    if (toAcc.userId !== input.clientUserId) {
      throw new AdminLedgerError(400, "Destination account does not belong to the selected client");
    }
    const beforeFormatted = addDecimalStrings(toAcc.balance, "0");
    const afterFormatted = addDecimalStrings(toAcc.balance, amountStr);
    affectedAccounts.push({
      accountId: toAcc.id,
      accountLabel: accountLabel(toAcc),
      accountNumber: toAcc.accountNumber,
      ownerName: toAcc.ownerName,
      role: "destination",
      balanceBefore: beforeFormatted,
      delta: `+${amountStr}`,
      balanceAfter: afterFormatted,
    });
  } else {
    const fromAcc = byId.get(input.fromAccountId!);
    if (!fromAcc) throw new AdminLedgerError(404, "Source account not found");
    if (fromAcc.userId !== input.clientUserId) {
      throw new AdminLedgerError(400, "Source account does not belong to the selected client");
    }
    const fromBeforeFormatted = addDecimalStrings(fromAcc.balance, "0");
    const fromAfterFormatted = subtractDecimalStrings(fromAcc.balance, amountStr);
    if (compareDecimalStrings(fromAcc.balance, amountStr) < 0) {
      canSubmit = false;
      warnings.push(
        `Insufficient balance in ${accountLabel(fromAcc)} (${fromBeforeFormatted} available, ${amountStr} required).`,
      );
    }
    affectedAccounts.push({
      accountId: fromAcc.id,
      accountLabel: accountLabel(fromAcc),
      accountNumber: fromAcc.accountNumber,
      ownerName: fromAcc.ownerName,
      role: "source",
      balanceBefore: fromBeforeFormatted,
      delta: `-${amountStr}`,
      balanceAfter: fromAfterFormatted,
    });

    const toBeforeFormatted = addDecimalStrings(toAcc.balance, "0");
    const toAfterFormatted = addDecimalStrings(toAcc.balance, amountStr);
    if (toAcc.userId !== input.clientUserId) {
      warnings.push(`Cross-client transfer: destination account belongs to ${toAcc.ownerName} (${toAcc.ownerEmail}).`);
    }
    affectedAccounts.push({
      accountId: toAcc.id,
      accountLabel: accountLabel(toAcc),
      accountNumber: toAcc.accountNumber,
      ownerName: toAcc.ownerName,
      role: "destination",
      balanceBefore: toBeforeFormatted,
      delta: `+${amountStr}`,
      balanceAfter: toAfterFormatted,
    });
  }

  return {
    canSubmit,
    warnings,
    postingType: input.postingType,
    client: clientUser,
    affectedAccounts,
    amount: centsToMoney(amountCents),
    effectiveDate: new Date(input.effectiveDate).toISOString(),
    reason: input.reason,
    evidenceRef: input.evidenceRef,
    description:
      input.description?.trim() ||
      (input.postingType === "deposit"
        ? `Staff-posted deposit to ${accountLabel(toAcc)}`
        : `Staff-posted transfer`),
  };
}

export function registerAdminLedgerRoutes(
  app: Express,
  pool: Pool,
  requireAdmin: RequestHandler,
  requireIdentifiedStaff: RequestHandler,
) {
  const handleError = (res: any, err: any, fallbackMessage: string) => {
    if (err instanceof z.ZodError) {
      return void res.status(400).json({ message: err.issues[0]?.message || "Invalid input" });
    }
    if (err instanceof AdminLedgerError) {
      return void res.status(err.status).json({ message: err.message });
    }
    console.error("[admin-ledger]", err);
    const codeHint = typeof err?.code === "string" && /^[0-9A-Z_]{2,20}$/i.test(err.code)
      ? ` (DB ${err.code})`
      : (typeof err?.name === "string" && err.name !== "Error" ? ` (${err.name})` : "");
    return void res.status(500).json({ message: `${fallbackMessage}${codeHint}` });
  };

  // List accounts for a client (used by Create Posting form)
  app.get("/api/admin/clients/:userId/accounts", requireAdmin, async (req, res) => {
    try {
      const userId = z.coerce.number().int().positive().parse(req.params.userId);
      if (!hasDatabaseConfig) return void res.json([]);
      const { rows } = await pool.query(
        `SELECT id, user_id AS "userId", account_number AS "accountNumber", account_type AS "accountType",
           display_name AS "displayName", balance::text AS "balance", is_demo AS "isDemo"
         FROM accounts WHERE user_id = $1 ORDER BY id ASC`,
        [userId],
      );
      res.json(rows);
    } catch (err) {
      handleError(res, err, "Failed to load client accounts");
    }
  });

  // List all accounts across clients (for transfer destination selection)
  app.get("/api/admin/accounts", requireAdmin, async (_req, res) => {
    try {
      if (!hasDatabaseConfig) return void res.json([]);
      const { rows } = await pool.query(
        `SELECT a.id, a.user_id AS "userId", a.account_number AS "accountNumber",
           a.account_type AS "accountType", a.display_name AS "displayName",
           a.balance::text AS "balance", u.name AS "userName", u.email AS "userEmail"
         FROM accounts a
         JOIN users u ON u.id = a.user_id
         ORDER BY u.name ASC, a.id ASC`,
      );
      res.json(rows);
    } catch (err) {
      handleError(res, err, "Failed to load accounts");
    }
  });

  // Enriched transaction list with provenance, direction, account details, and reversal links
  app.get("/api/admin/transactions", requireAdmin, async (req, res) => {
    try {
      if (!hasDatabaseConfig) return void res.json([]);
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
      const originFilter = typeof req.query.origin === "string" ? req.query.origin : undefined;

      const { rows } = await pool.query(
        `SELECT
           t.id,
           t.from_account_id AS "fromAccountId",
           t.to_account_id AS "toAccountId",
           t.payee_id AS "payeeId",
           t.amount::text AS "amount",
           t.description,
           t.transaction_type AS "transactionType",
           t.status,
           t.cash_debit_deferred AS "cashDebitDeferred",
           t.entry_origin AS "entryOrigin",
           t.created_by_staff_id AS "createdByStaffId",
           t.created_by_staff_name AS "createdByStaffName",
           t.approved_by_staff_id AS "approvedByStaffId",
           t.approved_by_staff_name AS "approvedByStaffName",
           t.approved_at AS "approvedAt",
           t.evidence_ref AS "evidenceRef",
           t.audit_reason AS "auditReason",
           t.reversal_of_transaction_id AS "reversalOfTransactionId",
           t.replaces_transaction_id AS "replacesTransactionId",
           t.admin_notes AS "adminNotes",
           t.is_demo AS "isDemo",
           t.created_at AS "createdAt",
           fa.account_number AS "fromAccountNumber",
           COALESCE(NULLIF(fa.display_name, ''), fa.account_type) AS "fromAccountLabel",
           fa.user_id AS "fromUserId",
           fu.name AS "fromUserName",
           fu.email AS "fromUserEmail",
           ta.account_number AS "toAccountNumber",
           COALESCE(NULLIF(ta.display_name, ''), ta.account_type) AS "toAccountLabel",
           ta.user_id AS "toUserId",
           tu.name AS "toUserName",
           tu.email AS "toUserEmail",
           p.name AS "payeeName",
           rev.id AS "reversedByTransactionId",
           (SELECT apr.id FROM admin_posting_requests apr
              WHERE apr.target_transaction_id = t.id AND apr.status = 'pending_second_admin'
              ORDER BY apr.id DESC LIMIT 1) AS "pendingReversalRequestId"
         FROM transactions t
         LEFT JOIN accounts fa ON fa.id = t.from_account_id
         LEFT JOIN users fu ON fu.id = fa.user_id
         LEFT JOIN accounts ta ON ta.id = t.to_account_id
         LEFT JOIN users tu ON tu.id = ta.user_id
         LEFT JOIN payees p ON p.id = t.payee_id
         LEFT JOIN transactions rev ON rev.reversal_of_transaction_id = t.id
         ORDER BY t.created_at DESC, t.id DESC`,
      );

      let result = rows.map((r) => {
        const clientUserId = r.fromUserId ?? r.toUserId ?? null;
        const userName = r.fromUserName ?? r.toUserName ?? "Unknown";
        const userEmail = r.fromUserEmail ?? r.toUserEmail ?? "";
        const direction = deriveDirection(r);
        return {
          ...r,
          clientUserId,
          userName,
          userEmail,
          direction,
        };
      });

      if (statusFilter) {
        result = result.filter((r) => r.status === statusFilter);
      }
      if (originFilter) {
        result = result.filter((r) => r.entryOrigin === originFilter);
      }
      res.json(result);
    } catch (err) {
      handleError(res, err, "Failed to fetch transactions");
    }
  });

  // Per-transaction audit trail
  app.get("/api/admin/transactions/:id/audit", requireAdmin, async (req, res) => {
    try {
      const txnId = z.coerce.number().int().positive().parse(req.params.id);
      if (!hasDatabaseConfig) {
        return void res.json(memoryAuditTrail.filter(a => a.transactionId === txnId));
      }
      const { rows } = await pool.query(
        `SELECT id, transaction_id AS "transactionId", posting_request_id AS "postingRequestId",
           entry_origin AS "entryOrigin", action, actor_type AS "actorType",
           actor_staff_id AS "actorStaffId", actor_name AS "actorName",
           reason, evidence_ref AS "evidenceRef", metadata, created_at AS "createdAt"
         FROM transaction_audit_trail
         WHERE transaction_id = $1
            OR posting_request_id IN (
              SELECT id FROM admin_posting_requests
              WHERE posted_transaction_id = $1 OR reversal_transaction_id = $1 OR replacement_transaction_id = $1 OR target_transaction_id = $1
            )
         ORDER BY created_at ASC, id ASC`,
        [txnId],
      );
      res.json(rows);
    } catch (err) {
      handleError(res, err, "Failed to load transaction audit trail");
    }
  });

  // Global recent audit trail
  app.get("/api/admin/audit-trail", requireAdmin, async (_req, res) => {
    try {
      if (!hasDatabaseConfig) {
        return void res.json(memoryAuditTrail.slice(0, 200));
      }
      const { rows } = await pool.query(
        `SELECT id, transaction_id AS "transactionId", posting_request_id AS "postingRequestId",
           entry_origin AS "entryOrigin", action, actor_type AS "actorType",
           actor_staff_id AS "actorStaffId", actor_name AS "actorName",
           reason, evidence_ref AS "evidenceRef", metadata, created_at AS "createdAt"
         FROM transaction_audit_trail
         ORDER BY created_at DESC, id DESC
         LIMIT 200`,
      );
      res.json(rows);
    } catch (err) {
      handleError(res, err, "Failed to load audit trail");
    }
  });

  // Preview before-and-after impact before queuing an admin-created posting
  app.post("/api/admin/postings/preview", requireIdentifiedStaff, async (req, res) => {
    try {
      if (!hasDatabaseConfig) {
        throw new AdminLedgerError(503, "Database connection is required to preview account postings");
      }
      const input = createPostingSchema.parse(req.body);
      const preview = await computePostingPreview(pool, input);
      res.json(preview);
    } catch (err) {
      handleError(res, err, "Failed to generate posting preview");
    }
  });

  // Create a staff-initiated posting request (queued for second-admin approval)
  app.post("/api/admin/postings", requireIdentifiedStaff, async (req, res) => {
    try {
      const staff = req.adminStaff!;
      const input = createPostingSchema.parse(req.body);

      if (!hasDatabaseConfig) {
        throw new AdminLedgerError(503, "Database connection is required to queue account postings");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const preview = await computePostingPreview(client, input);
        if (!preview.canSubmit) {
          throw new AdminLedgerError(400, preview.warnings[0] || "Cannot queue posting due to account constraints");
        }

        const { rows: [created] } = await client.query(
          `INSERT INTO admin_posting_requests
             (action_kind, posting_type, client_user_id, from_account_id, to_account_id,
              amount, effective_date, reason, evidence_ref, description, status,
              created_by_staff_id, created_by_staff_username, created_by_staff_name)
           VALUES ('posting', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_second_admin', $10, $11, $12)
           RETURNING id, action_kind AS "actionKind", posting_type AS "postingType",
             client_user_id AS "clientUserId", from_account_id AS "fromAccountId", to_account_id AS "toAccountId",
             amount::text AS "amount", effective_date AS "effectiveDate", reason, evidence_ref AS "evidenceRef",
             description, status, created_by_staff_id AS "createdByStaffId",
             created_by_staff_username AS "createdByStaffUsername", created_by_staff_name AS "createdByStaffName",
             created_at AS "createdAt"`,
          [
            input.postingType,
            input.clientUserId,
            input.fromAccountId ?? null,
            input.toAccountId,
            preview.amount,
            preview.effectiveDate,
            input.reason,
            input.evidenceRef,
            preview.description,
            staff.id,
            staff.username,
            staff.displayName,
          ],
        );

        await recordTransactionAudit(client, {
          postingRequestId: created.id,
          entryOrigin: "staff",
          action: "posting_created",
          actorType: "staff",
          actorStaffId: staff.id,
          actorName: staffLabel(staff),
          reason: input.reason,
          evidenceRef: input.evidenceRef,
          metadata: {
            postingType: input.postingType,
            amount: preview.amount,
            effectiveDate: preview.effectiveDate,
            affectedAccounts: preview.affectedAccounts,
          },
        });

        await client.query("COMMIT");
        res.status(201).json(created);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      handleError(res, err, "Failed to create posting request");
    }
  });

  // List admin-created posting & reversal requests (enriched with live balances)
  app.get("/api/admin/postings", requireAdmin, async (_req, res) => {
    try {
      if (!hasDatabaseConfig) {
        return void res.json(memoryPostingRequests);
      }
      const { rows } = await pool.query(
        `SELECT
           r.id,
           r.action_kind AS "actionKind",
           r.posting_type AS "postingType",
           r.client_user_id AS "clientUserId",
           r.from_account_id AS "fromAccountId",
           r.to_account_id AS "toAccountId",
           r.amount::text AS "amount",
           r.effective_date AS "effectiveDate",
           r.reason,
           r.evidence_ref AS "evidenceRef",
           r.description,
           r.target_transaction_id AS "targetTransactionId",
           r.replacement_payload AS "replacementPayload",
           r.status,
           r.created_by_staff_id AS "createdByStaffId",
           r.created_by_staff_username AS "createdByStaffUsername",
           r.created_by_staff_name AS "createdByStaffName",
           r.reviewed_by_staff_id AS "reviewedByStaffId",
           r.reviewed_by_staff_username AS "reviewedByStaffUsername",
           r.reviewed_by_staff_name AS "reviewedByStaffName",
           r.reviewed_at AS "reviewedAt",
           r.rejection_reason AS "rejectionReason",
           r.posted_transaction_id AS "postedTransactionId",
           r.reversal_transaction_id AS "reversalTransactionId",
           r.replacement_transaction_id AS "replacementTransactionId",
           r.created_at AS "createdAt",
           u.name AS "clientName",
           u.email AS "clientEmail",
           fa.account_number AS "fromAccountNumber",
           COALESCE(NULLIF(fa.display_name, ''), fa.account_type) AS "fromAccountLabel",
           fa.balance::text AS "fromAccountBalance",
           ta.account_number AS "toAccountNumber",
           COALESCE(NULLIF(ta.display_name, ''), ta.account_type) AS "toAccountLabel",
           ta.balance::text AS "toAccountBalance"
         FROM admin_posting_requests r
         LEFT JOIN users u ON u.id = r.client_user_id
         LEFT JOIN accounts fa ON fa.id = r.from_account_id
         LEFT JOIN accounts ta ON ta.id = r.to_account_id
         ORDER BY (CASE WHEN r.status = 'pending_second_admin' THEN 0 ELSE 1 END), r.created_at DESC, r.id DESC`,
      );
      res.json(rows);
    } catch (err) {
      handleError(res, err, "Failed to load admin posting requests");
    }
  });

  // Queue a linked reversal (and optional replacement posting) for a completed transaction
  app.post("/api/admin/transactions/:id/reverse", requireIdentifiedStaff, async (req, res) => {
    try {
      const staff = req.adminStaff!;
      const txnId = z.coerce.number().int().positive().parse(req.params.id);
      const input = createReversalSchema.parse(req.body);

      if (!hasDatabaseConfig) {
        throw new AdminLedgerError(503, "Database connection is required to reverse posted transactions");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [txn] } = await client.query(
          `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
          [txnId],
        );
        if (!txn) throw new AdminLedgerError(404, "Transaction not found");
        if (txn.status !== "completed") {
          throw new AdminLedgerError(400, "Only completed transactions can be reversed");
        }
        if (txn.reversal_of_transaction_id != null) {
          throw new AdminLedgerError(400, "A reversal entry cannot itself be reversed");
        }
        const { rows: alreadyReversed } = await client.query(
          `SELECT id FROM transactions WHERE reversal_of_transaction_id = $1 LIMIT 1`,
          [txnId],
        );
        if (alreadyReversed.length > 0) {
          throw new AdminLedgerError(409, `Transaction TXN-${txnId} has already been reversed by TXN-${alreadyReversed[0].id}`);
        }
        const { rows: pendingReversal } = await client.query(
          `SELECT id FROM admin_posting_requests WHERE target_transaction_id = $1 AND status = 'pending_second_admin' LIMIT 1`,
          [txnId],
        );
        if (pendingReversal.length > 0) {
          throw new AdminLedgerError(409, "A reversal request for this transaction is already pending second-admin approval");
        }

        const acctIds = [txn.from_account_id, txn.to_account_id].filter((id): id is number => id != null);
        if (acctIds.length === 0) {
          throw new AdminLedgerError(400, "Transaction has no linked accounts to reverse");
        }
        const { rows: acctRows } = await client.query(
          `SELECT id, user_id FROM accounts WHERE id = ANY($1::int[]) ORDER BY id ASC`,
          [acctIds],
        );
        const ownerUserId = acctRows[0]?.user_id;
        if (!ownerUserId) throw new AdminLedgerError(404, "Owner account not found");

        // Validate replacement accounts if provided
        let replacementJson: string | null = null;
        if (input.replacement) {
          const repIds = [input.replacement.fromAccountId, input.replacement.toAccountId].filter((id): id is number => id != null);
          const { rows: repAccts } = await client.query(
            `SELECT id, user_id FROM accounts WHERE id = ANY($1::int[])`,
            [repIds],
          );
          if (repAccts.length !== new Set(repIds).size) {
            throw new AdminLedgerError(404, "Replacement account not found");
          }
          if (input.replacement.postingType === "deposit") {
            const dest = repAccts.find(a => a.id === input.replacement!.toAccountId);
            if (!dest || dest.user_id !== ownerUserId) {
              throw new AdminLedgerError(400, "Replacement deposit account must belong to the same client");
            }
          } else {
            const src = repAccts.find(a => a.id === input.replacement!.fromAccountId);
            if (!src || src.user_id !== ownerUserId) {
              throw new AdminLedgerError(400, "Replacement source account must belong to the same client");
            }
          }
          replacementJson = JSON.stringify({
            ...input.replacement,
            amount: centsToMoney(moneyToCents(input.replacement.amount)),
            effectiveDate: new Date(input.replacement.effectiveDate).toISOString(),
          });
        }

        // Swapped accounts represent the reversal movement
        const revFromId = txn.to_account_id ?? null;
        const revToId = txn.from_account_id ?? null;
        const postingType = input.replacement ? "reversal_and_replacement" : "reversal";

        const { rows: [created] } = await client.query(
          `INSERT INTO admin_posting_requests
             (action_kind, posting_type, client_user_id, from_account_id, to_account_id,
              amount, effective_date, reason, evidence_ref, description,
              target_transaction_id, replacement_payload, status,
              created_by_staff_id, created_by_staff_username, created_by_staff_name)
           VALUES ('reversal', $1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, 'pending_second_admin', $11, $12, $13)
           RETURNING id, action_kind AS "actionKind", posting_type AS "postingType",
             target_transaction_id AS "targetTransactionId", status, created_at AS "createdAt"`,
          [
            postingType,
            ownerUserId,
            revFromId,
            revToId,
            txn.amount,
            input.reason,
            input.evidenceRef,
            `Reversal of TXN-${txnId}: ${input.reason}`,
            txnId,
            replacementJson,
            staff.id,
            staff.username,
            staff.displayName,
          ],
        );

        await recordTransactionAudit(client, {
          transactionId: txnId,
          postingRequestId: created.id,
          entryOrigin: "staff",
          action: "reversal_created",
          actorType: "staff",
          actorStaffId: staff.id,
          actorName: staffLabel(staff),
          reason: input.reason,
          evidenceRef: input.evidenceRef,
          metadata: {
            targetTransactionId: txnId,
            includesReplacement: Boolean(input.replacement),
          },
        });

        await client.query("COMMIT");
        res.status(201).json(created);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      handleError(res, err, "Failed to queue reversal request");
    }
  });

  // Second-admin approval for admin-created postings & reversals
  app.post("/api/admin/postings/:id/approve", requireIdentifiedStaff, async (req, res) => {
    try {
      const checker = req.adminStaff!;
      const requestId = z.coerce.number().int().positive().parse(req.params.id);
      const parsed = approvePostingRequestSchema.parse(req.body);

      if (!hasDatabaseConfig) {
        throw new AdminLedgerError(503, "Database connection is required to execute postings");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [request] } = await client.query(
          `SELECT * FROM admin_posting_requests WHERE id = $1 FOR UPDATE`,
          [requestId],
        );
        if (!request) throw new AdminLedgerError(404, "Posting request not found");
        if (request.status !== "pending_second_admin") {
          throw new AdminLedgerError(400, "Only pending posting requests can be approved");
        }
        // Dual control: require another admin
        if (request.created_by_staff_id === checker.id) {
          throw new AdminLedgerError(403, "Dual control required: a different administrator must approve this entry.");
        }

        if (request.action_kind === "posting") {
          const accountIds = [request.from_account_id, request.to_account_id]
            .filter((id): id is number => id != null)
            .sort((a, b) => a - b);
          const { rows: lockedAccounts } = await client.query(
            `SELECT id, user_id, account_number, account_type, display_name, balance::text
             FROM accounts WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE`,
            [accountIds],
          );
          const byId = new Map<number, any>(lockedAccounts.map(a => [a.id, a]));

          if (request.from_account_id != null) {
            const fromAcc = byId.get(request.from_account_id);
            if (!fromAcc) throw new AdminLedgerError(404, "Source account unavailable");
            if (compareDecimalStrings(fromAcc.balance, request.amount) < 0) {
              throw new AdminLedgerError(400, "Insufficient funds in source account to execute transfer");
            }
            await client.query(
              `UPDATE accounts SET balance = balance - $2::numeric WHERE id = $1`,
              [request.from_account_id, request.amount],
            );
          }

          if (request.to_account_id != null) {
            const toAcc = byId.get(request.to_account_id);
            if (!toAcc) throw new AdminLedgerError(404, "Destination account unavailable");
            await client.query(
              `UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1`,
              [request.to_account_id, request.amount],
            );
          }

          const { rows: [postedTxn] } = await client.query(
            `INSERT INTO transactions
               (from_account_id, to_account_id, amount, description, transaction_type, status,
                cash_debit_deferred, entry_origin, created_by_staff_id, created_by_staff_name,
                approved_by_staff_id, approved_by_staff_name, approved_at, evidence_ref, audit_reason,
                is_demo, created_at)
             VALUES ($1, $2, $3, $4, 'transfer', 'completed',
                     FALSE, 'staff', $5, $6, $7, $8, NOW(), $9, $10, FALSE, $11)
             RETURNING id`,
            [
              request.from_account_id ?? null,
              request.to_account_id,
              request.amount,
              request.description || `Staff-posted ${request.posting_type}`,
              request.created_by_staff_id,
              `${request.created_by_staff_name} (@${request.created_by_staff_username})`,
              checker.id,
              staffLabel(checker),
              request.evidence_ref,
              request.reason,
              request.effective_date,
            ],
          );

          if (request.from_account_id != null) {
            await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [postedTxn.id, request.from_account_id]);
          }
          if (request.to_account_id != null) {
            await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [postedTxn.id, request.to_account_id]);
          }

          await client.query(
            `UPDATE admin_posting_requests
             SET status = 'approved',
                 reviewed_by_staff_id = $2,
                 reviewed_by_staff_username = $3,
                 reviewed_by_staff_name = $4,
                 reviewed_at = NOW(),
                 posted_transaction_id = $5
             WHERE id = $1`,
            [requestId, checker.id, checker.username, checker.displayName, postedTxn.id],
          );

          await recordTransactionAudit(client, {
            transactionId: postedTxn.id,
            postingRequestId: requestId,
            entryOrigin: "staff",
            action: "posting_approved",
            actorType: "staff",
            actorStaffId: checker.id,
            actorName: staffLabel(checker),
            reason: parsed.reviewNote?.trim() || request.reason,
            evidenceRef: request.evidence_ref,
            metadata: {
              createdBy: `${request.created_by_staff_name} (@${request.created_by_staff_username})`,
              amount: request.amount,
              effectiveDate: request.effective_date,
            },
          });

          await client.query("COMMIT");
          return void res.json({
            ok: true,
            message: `Posting approved and recorded as TXN-${postedTxn.id}`,
            transactionId: postedTxn.id,
          });
        }

        // Reversal (and optional replacement)
        const targetId = request.target_transaction_id;
        if (!targetId) throw new AdminLedgerError(400, "Missing target transaction for reversal");
        const { rows: [targetTxn] } = await client.query(
          `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
          [targetId],
        );
        if (!targetTxn || targetTxn.status !== "completed") {
          throw new AdminLedgerError(409, "Target transaction is no longer eligible for reversal");
        }
        const { rows: alreadyRev } = await client.query(
          `SELECT id FROM transactions WHERE reversal_of_transaction_id = $1 LIMIT 1`,
          [targetId],
        );
        if (alreadyRev.length > 0) {
          throw new AdminLedgerError(409, "Target transaction has already been reversed");
        }

        const replacement = request.replacement_payload ? JSON.parse(request.replacement_payload) : null;
        const lockIds = Array.from(
          new Set(
            [
              targetTxn.from_account_id,
              targetTxn.to_account_id,
              replacement?.fromAccountId,
              replacement?.toAccountId,
            ].filter((id): id is number => typeof id === "number"),
          ),
        ).sort((a, b) => a - b);

        await client.query(
          `SELECT id FROM accounts WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE`,
          [lockIds],
        );

        // Step 1: Execute Reversal (must record_cash_posting before any replacement updates same account!)
        const revFromId = targetTxn.to_account_id ?? null;
        const revToId = targetTxn.from_account_id ?? null;

        if (revFromId != null) {
          const { rows: [revFrom] } = await client.query(`SELECT COALESCE(balance, 0)::text AS balance FROM accounts WHERE id = $1`, [revFromId]);
          if (!revFrom || compareDecimalStrings(revFrom.balance, targetTxn.amount) < 0) {
            throw new AdminLedgerError(400, "Insufficient balance to reverse the previously credited account");
          }
          await client.query(`UPDATE accounts SET balance = balance - $2::numeric WHERE id = $1`, [revFromId, targetTxn.amount]);
        }
        if (revToId != null) {
          await client.query(`UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1`, [revToId, targetTxn.amount]);
        }

        const { rows: [revTxn] } = await client.query(
          `INSERT INTO transactions
             (from_account_id, to_account_id, amount, description, transaction_type, status,
              cash_debit_deferred, entry_origin, created_by_staff_id, created_by_staff_name,
              approved_by_staff_id, approved_by_staff_name, approved_at, evidence_ref, audit_reason,
              reversal_of_transaction_id, is_demo, created_at)
           VALUES ($1, $2, $3, $4, 'transfer', 'completed',
                   FALSE, 'staff', $5, $6, $7, $8, NOW(), $9, $10, $11, FALSE, NOW())
           RETURNING id`,
          [
            revFromId,
            revToId,
            targetTxn.amount,
            `Reversal of TXN-${targetId}: ${request.reason}`,
            request.created_by_staff_id,
            `${request.created_by_staff_name} (@${request.created_by_staff_username})`,
            checker.id,
            staffLabel(checker),
            request.evidence_ref,
            request.reason,
            targetId,
          ],
        );

        if (revFromId != null) {
          await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [revTxn.id, revFromId]);
        }
        if (revToId != null) {
          await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [revTxn.id, revToId]);
        }

        // Step 2: Optional Replacement Posting
        let replacementTxnId: number | null = null;
        if (replacement) {
          if (replacement.fromAccountId != null) {
            const { rows: [repFrom] } = await client.query(`SELECT COALESCE(balance, 0)::text AS balance FROM accounts WHERE id = $1`, [replacement.fromAccountId]);
            if (!repFrom || compareDecimalStrings(repFrom.balance, replacement.amount) < 0) {
              throw new AdminLedgerError(400, "Insufficient balance to post replacement transfer after reversal");
            }
            await client.query(`UPDATE accounts SET balance = balance - $2::numeric WHERE id = $1`, [replacement.fromAccountId, replacement.amount]);
          }
          if (replacement.toAccountId != null) {
            await client.query(`UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1`, [replacement.toAccountId, replacement.amount]);
          }

          const { rows: [repTxn] } = await client.query(
            `INSERT INTO transactions
               (from_account_id, to_account_id, amount, description, transaction_type, status,
                cash_debit_deferred, entry_origin, created_by_staff_id, created_by_staff_name,
                approved_by_staff_id, approved_by_staff_name, approved_at, evidence_ref, audit_reason,
                replaces_transaction_id, is_demo, created_at)
             VALUES ($1, $2, $3, $4, 'transfer', 'completed',
                     FALSE, 'staff', $5, $6, $7, $8, NOW(), $9, $10, $11, FALSE, $12)
             RETURNING id`,
            [
              replacement.fromAccountId ?? null,
              replacement.toAccountId,
              replacement.amount,
              replacement.description?.trim() || `Replacement for TXN-${targetId}`,
              request.created_by_staff_id,
              `${request.created_by_staff_name} (@${request.created_by_staff_username})`,
              checker.id,
              staffLabel(checker),
              request.evidence_ref,
              request.reason,
              targetId,
              replacement.effectiveDate,
            ],
          );
          replacementTxnId = repTxn.id;

          if (replacement.fromAccountId != null) {
            await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [repTxn.id, replacement.fromAccountId]);
          }
          if (replacement.toAccountId != null) {
            await client.query(`SELECT record_cash_posting($1::integer, $2::integer)`, [repTxn.id, replacement.toAccountId]);
          }
        }

        await client.query(
          `UPDATE admin_posting_requests
           SET status = 'approved',
               reviewed_by_staff_id = $2,
               reviewed_by_staff_username = $3,
               reviewed_by_staff_name = $4,
               reviewed_at = NOW(),
               reversal_transaction_id = $5,
               replacement_transaction_id = $6
           WHERE id = $1`,
          [requestId, checker.id, checker.username, checker.displayName, revTxn.id, replacementTxnId],
        );

        await recordTransactionAudit(client, {
          transactionId: targetId,
          postingRequestId: requestId,
          entryOrigin: "staff",
          action: "reversal_approved",
          actorType: "staff",
          actorStaffId: checker.id,
          actorName: staffLabel(checker),
          reason: parsed.reviewNote?.trim() || request.reason,
          evidenceRef: request.evidence_ref,
          metadata: {
            reversalTransactionId: revTxn.id,
            replacementTransactionId: replacementTxnId,
          },
        });

        await recordTransactionAudit(client, {
          transactionId: revTxn.id,
          postingRequestId: requestId,
          entryOrigin: "staff",
          action: "reversal_posted",
          actorType: "staff",
          actorStaffId: checker.id,
          actorName: staffLabel(checker),
          reason: request.reason,
          evidenceRef: request.evidence_ref,
          metadata: { reversalOfTransactionId: targetId },
        });

        if (replacementTxnId != null) {
          await recordTransactionAudit(client, {
            transactionId: replacementTxnId,
            postingRequestId: requestId,
            entryOrigin: "staff",
            action: "replacement_posted",
            actorType: "staff",
            actorStaffId: checker.id,
            actorName: staffLabel(checker),
            reason: request.reason,
            evidenceRef: request.evidence_ref,
            metadata: { replacesTransactionId: targetId },
          });
        }

        await client.query("COMMIT");
        res.json({
          ok: true,
          message: replacementTxnId
            ? `Reversed TXN-${targetId} (TXN-${revTxn.id}) and posted replacement TXN-${replacementTxnId}`
            : `Reversed TXN-${targetId} via linked entry TXN-${revTxn.id}`,
          reversalTransactionId: revTxn.id,
          replacementTransactionId: replacementTxnId,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      handleError(res, err, "Failed to approve posting request");
    }
  });

  // Reject a pending admin posting/reversal request (requires reason)
  app.post("/api/admin/postings/:id/reject", requireIdentifiedStaff, async (req, res) => {
    try {
      const reviewer = req.adminStaff!;
      const requestId = z.coerce.number().int().positive().parse(req.params.id);
      const { reason } = reviewRejectSchema.parse(req.body);

      if (!hasDatabaseConfig) {
        throw new AdminLedgerError(503, "Database connection is required");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [request] } = await client.query(
          `SELECT * FROM admin_posting_requests WHERE id = $1 FOR UPDATE`,
          [requestId],
        );
        if (!request) throw new AdminLedgerError(404, "Posting request not found");
        if (request.status !== "pending_second_admin") {
          throw new AdminLedgerError(400, "Only pending posting requests can be rejected");
        }

        await client.query(
          `UPDATE admin_posting_requests
           SET status = 'rejected',
               reviewed_by_staff_id = $2,
               reviewed_by_staff_username = $3,
               reviewed_by_staff_name = $4,
               reviewed_at = NOW(),
               rejection_reason = $5
           WHERE id = $1`,
          [requestId, reviewer.id, reviewer.username, reviewer.displayName, reason],
        );

        await recordTransactionAudit(client, {
          transactionId: request.target_transaction_id ?? null,
          postingRequestId: requestId,
          entryOrigin: "staff",
          action: request.action_kind === "reversal" ? "reversal_rejected" : "posting_rejected",
          actorType: "staff",
          actorStaffId: reviewer.id,
          actorName: staffLabel(reviewer),
          reason,
          evidenceRef: request.evidence_ref,
        });

        await client.query("COMMIT");
        res.json({ ok: true, message: "Posting request rejected" });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      handleError(res, err, "Failed to reject posting request");
    }
  });
}
