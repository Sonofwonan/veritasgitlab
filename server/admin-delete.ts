import type { Express, RequestHandler } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { hasDatabaseConfig } from "./db";
import { adminRecoveryRequestPath } from "@shared/client-settings";
import { deleteMemoryAuditEntry, deleteMemoryPostingRequest } from "./admin-ledger";

const positiveId = z.coerce.number().int().positive().max(2147483647);
const uuidParam = z.string().uuid("Invalid import ID");

class AdminDeleteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function withAdminDeleteTx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!hasDatabaseConfig) {
    throw new AdminDeleteError(503, "Database connection is required for this deletion");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL veritas.admin_delete = 'on'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function registerAdminDeleteRoutes(
  app: Express,
  pool: Pool,
  requireAdmin: RequestHandler,
) {
  const admin: RequestHandler = (req, res, next) => {
    requireAdmin(req, res, () => {
      if (!req.adminStaff && !process.env.ADMIN_PASSWORD) {
        return void res.status(503).json({ message: "Administrator authentication is not configured" });
      }
      next();
    });
  };

  const handle = (
    fn: (req: any) => Promise<unknown>,
    fallbackMessage: string,
  ): RequestHandler => async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const data = await fn(req);
      res.json(data);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return void res.status(400).json({ message: err.issues[0]?.message || "Invalid identifier" });
      }
      if (err instanceof AdminDeleteError) {
        return void res.status(err.status).json({ message: err.message });
      }
      console.error("[admin-delete] Delete operation failed:", err?.code || err?.name || "Unknown");
      const codeHint = typeof err?.code === "string" && /^[0-9A-Z_]{2,20}$/i.test(err.code)
        ? ` (DB ${err.code})`
        : "";
      res.status(500).json({ message: `${fallbackMessage}${codeHint}` });
    }
  };

  // 1. Delete client profile + every owned account, transaction, fee, security, and evidence record
  app.delete(
    "/api/admin/users/:id",
    admin,
    handle(async (req) => {
      const userId = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [user] } = await client.query(
          `SELECT id, name, email FROM users WHERE id = $1 FOR UPDATE`,
          [userId],
        );
        if (!user) throw new AdminDeleteError(404, "Client profile not found");

        const { rows: acctRows } = await client.query(
          `SELECT id FROM accounts WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        const accountIds: number[] = acctRows.map((r: any) => r.id);

        const { rows: payeeRows } = await client.query(
          `SELECT id FROM payees WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        const payeeIds: number[] = payeeRows.map((r: any) => r.id);

        const { rows: txnRows } = await client.query(
          `SELECT id FROM transactions
           WHERE from_account_id = ANY($1::int[])
              OR to_account_id = ANY($1::int[])
              OR payee_id = ANY($2::int[])
           FOR UPDATE`,
          [accountIds, payeeIds],
        );
        const txnIds: number[] = txnRows.map((r: any) => r.id);

        const { rows: contractRows } = await client.query(
          `SELECT id FROM management_contracts WHERE user_id = $1 OR account_id = ANY($2::int[]) FOR UPDATE`,
          [userId, accountIds],
        );
        const contractIds: number[] = contractRows.map((r: any) => r.id);

        const { rows: enrollmentRows } = await client.query(
          `SELECT id FROM fee_enrollments WHERE user_id = $1 OR account_id = ANY($2::int[]) FOR UPDATE`,
          [userId, accountIds],
        );
        const enrollmentIds: number[] = enrollmentRows.map((r: any) => r.id);

        const { rows: reqRows } = await client.query(
          `SELECT id FROM admin_posting_requests
           WHERE client_user_id = $1
              OR from_account_id = ANY($2::int[])
              OR to_account_id = ANY($2::int[])
              OR target_transaction_id = ANY($3::int[])
              OR posted_transaction_id = ANY($3::int[])
              OR reversal_transaction_id = ANY($3::int[])
              OR replacement_transaction_id = ANY($3::int[])
           FOR UPDATE`,
          [userId, accountIds, txnIds],
        );
        const postingRequestIds: number[] = reqRows.map((r: any) => r.id);

        const { rows: assessmentRows } = await client.query(
          `SELECT id FROM fee_assessments
           WHERE account_id = ANY($1::int[])
              OR contract_id = ANY($2::int[])
              OR enrollment_id = ANY($3::int[])
              OR transaction_id = ANY($4::int[])
              OR refund_transaction_id = ANY($4::int[])
           FOR UPDATE`,
          [accountIds, contractIds, enrollmentIds, txnIds],
        );
        const assessmentIds: number[] = assessmentRows.map((r: any) => r.id);

        await client.query(
          `DELETE FROM session WHERE sess::jsonb->'passport'->>'user' = $1 OR sess::jsonb->'pendingMfa'->>'userId' = $1`,
          [String(userId)],
        );
        await client.query(
          `DELETE FROM transaction_audit_trail WHERE transaction_id = ANY($1::int[]) OR posting_request_id = ANY($2::int[])`,
          [txnIds, postingRequestIds],
        );
        await client.query(`DELETE FROM admin_posting_requests WHERE id = ANY($1::int[])`, [postingRequestIds]);
        await client.query(
          `DELETE FROM transaction_date_corrections WHERE user_id = $1 OR account_id = ANY($2::int[]) OR transaction_id = ANY($3::int[])`,
          [userId, accountIds, txnIds],
        );
        await client.query(
          `DELETE FROM historical_balance_postings WHERE account_id = ANY($1::int[]) OR transaction_id = ANY($2::int[]) OR related_transaction_id = ANY($2::int[])`,
          [accountIds, txnIds],
        );
        await client.query(
          `DELETE FROM historical_balance_imports WHERE user_id = $1 OR account_id = ANY($2::int[])`,
          [userId, accountIds],
        );
        await client.query(`DELETE FROM historical_balance_previews WHERE account_id = ANY($1::int[])`, [accountIds]);
        await client.query(
          `DELETE FROM account_cash_changes WHERE account_id = ANY($1::int[]) OR transaction_id = ANY($2::int[])`,
          [accountIds, txnIds],
        );
        await client.query(
          `DELETE FROM fee_audit WHERE contract_id = ANY($1::int[]) OR enrollment_id = ANY($2::int[]) OR assessment_id = ANY($3::int[])`,
          [contractIds, enrollmentIds, assessmentIds],
        );
        await client.query(`DELETE FROM fee_assessments WHERE id = ANY($1::int[])`, [assessmentIds]);
        await client.query(`DELETE FROM management_valuations WHERE contract_id = ANY($1::int[])`, [contractIds]);
        await client.query(`DELETE FROM management_contracts WHERE id = ANY($1::int[])`, [contractIds]);
        await client.query(`DELETE FROM fee_enrollments WHERE id = ANY($1::int[])`, [enrollmentIds]);
        await client.query(
          `UPDATE transactions SET reversal_of_transaction_id = NULL WHERE reversal_of_transaction_id = ANY($1::int[])`,
          [txnIds],
        );
        await client.query(
          `UPDATE transactions SET replaces_transaction_id = NULL WHERE replaces_transaction_id = ANY($1::int[])`,
          [txnIds],
        );
        await client.query(`DELETE FROM transactions WHERE id = ANY($1::int[])`, [txnIds]);
        await client.query(`DELETE FROM investments WHERE account_id = ANY($1::int[])`, [accountIds]);
        await client.query(
          `DELETE FROM institutional_transfers WHERE user_id = $1 OR account_id = ANY($2::int[])`,
          [userId, accountIds],
        );
        await client.query(`DELETE FROM payees WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM account_setup_tokens WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_display_currency_audit WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_recovery_requests WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_security_recovery WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_security_events WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_security WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM client_contact_details WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM account_opening_requests WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM accounts WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

        return { ok: true, id: userId, deletedName: user.name };
      });
    }, "Failed to delete client profile"),
  );

  // 2. Delete an individual client account and its dependent records
  app.delete(
    "/api/admin/accounts/:id",
    admin,
    handle(async (req) => {
      const accountId = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [account] } = await client.query(
          `SELECT id, user_id, account_type, display_name FROM accounts WHERE id = $1 FOR UPDATE`,
          [accountId],
        );
        if (!account) throw new AdminDeleteError(404, "Account not found");

        const { rows: txnRows } = await client.query(
          `SELECT id FROM transactions WHERE from_account_id = $1 OR to_account_id = $1 FOR UPDATE`,
          [accountId],
        );
        const txnIds: number[] = txnRows.map((r: any) => r.id);

        const { rows: contractRows } = await client.query(
          `SELECT id FROM management_contracts WHERE account_id = $1 FOR UPDATE`,
          [accountId],
        );
        const contractIds: number[] = contractRows.map((r: any) => r.id);

        const { rows: enrollmentRows } = await client.query(
          `SELECT id FROM fee_enrollments WHERE account_id = $1 FOR UPDATE`,
          [accountId],
        );
        const enrollmentIds: number[] = enrollmentRows.map((r: any) => r.id);

        const { rows: reqRows } = await client.query(
          `SELECT id FROM admin_posting_requests
           WHERE from_account_id = $1
              OR to_account_id = $1
              OR target_transaction_id = ANY($2::int[])
              OR posted_transaction_id = ANY($2::int[])
              OR reversal_transaction_id = ANY($2::int[])
              OR replacement_transaction_id = ANY($2::int[])
           FOR UPDATE`,
          [accountId, txnIds],
        );
        const postingRequestIds: number[] = reqRows.map((r: any) => r.id);

        const { rows: assessmentRows } = await client.query(
          `SELECT id FROM fee_assessments
           WHERE account_id = $1
              OR contract_id = ANY($2::int[])
              OR enrollment_id = ANY($3::int[])
              OR transaction_id = ANY($4::int[])
              OR refund_transaction_id = ANY($4::int[])
           FOR UPDATE`,
          [accountId, contractIds, enrollmentIds, txnIds],
        );
        const assessmentIds: number[] = assessmentRows.map((r: any) => r.id);

        await client.query(`UPDATE users SET debt_payment_account_id = NULL WHERE debt_payment_account_id = $1`, [accountId]);
        await client.query(
          `DELETE FROM transaction_audit_trail WHERE transaction_id = ANY($1::int[]) OR posting_request_id = ANY($2::int[])`,
          [txnIds, postingRequestIds],
        );
        await client.query(`DELETE FROM admin_posting_requests WHERE id = ANY($1::int[])`, [postingRequestIds]);
        await client.query(
          `DELETE FROM transaction_date_corrections WHERE account_id = $1 OR transaction_id = ANY($2::int[])`,
          [accountId, txnIds],
        );
        await client.query(
          `DELETE FROM historical_balance_postings WHERE account_id = $1 OR transaction_id = ANY($2::int[]) OR related_transaction_id = ANY($2::int[])`,
          [accountId, txnIds],
        );
        await client.query(`DELETE FROM historical_balance_imports WHERE account_id = $1`, [accountId]);
        await client.query(`DELETE FROM historical_balance_previews WHERE account_id = $1`, [accountId]);
        await client.query(
          `DELETE FROM account_cash_changes WHERE account_id = $1 OR transaction_id = ANY($2::int[])`,
          [accountId, txnIds],
        );
        await client.query(
          `DELETE FROM fee_audit WHERE contract_id = ANY($1::int[]) OR enrollment_id = ANY($2::int[]) OR assessment_id = ANY($3::int[])`,
          [contractIds, enrollmentIds, assessmentIds],
        );
        await client.query(`DELETE FROM fee_assessments WHERE id = ANY($1::int[])`, [assessmentIds]);
        await client.query(`DELETE FROM management_valuations WHERE contract_id = ANY($1::int[])`, [contractIds]);
        await client.query(`DELETE FROM management_contracts WHERE id = ANY($1::int[])`, [contractIds]);
        await client.query(`DELETE FROM fee_enrollments WHERE id = ANY($1::int[])`, [enrollmentIds]);
        await client.query(
          `UPDATE transactions SET reversal_of_transaction_id = NULL WHERE reversal_of_transaction_id = ANY($1::int[])`,
          [txnIds],
        );
        await client.query(
          `UPDATE transactions SET replaces_transaction_id = NULL WHERE replaces_transaction_id = ANY($1::int[])`,
          [txnIds],
        );
        await client.query(`DELETE FROM transactions WHERE id = ANY($1::int[])`, [txnIds]);
        await client.query(`DELETE FROM investments WHERE account_id = $1`, [accountId]);
        await client.query(`DELETE FROM institutional_transfers WHERE account_id = $1`, [accountId]);
        await client.query(`UPDATE account_opening_requests SET created_account_id = NULL WHERE created_account_id = $1`, [accountId]);
        await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);

        return { ok: true, id: accountId };
      });
    }, "Failed to delete account"),
  );

  // 3. Delete any transaction (optionally reversing its completed balance impact)
  app.delete(
    "/api/admin/transactions/:id",
    admin,
    handle(async (req) => {
      const txnId = positiveId.parse(req.params.id);
      const reverseBalance =
        req.query.reverseBalance === "true" ||
        req.body?.reverseBalance === true;

      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [txn] } = await client.query(
          `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
          [txnId],
        );
        if (!txn) throw new AdminDeleteError(404, "Transaction not found");

        await client.query(`DELETE FROM transaction_audit_trail WHERE transaction_id = $1`, [txnId]);
        await client.query(`UPDATE admin_posting_requests SET target_transaction_id = NULL WHERE target_transaction_id = $1`, [txnId]);
        await client.query(`UPDATE admin_posting_requests SET posted_transaction_id = NULL WHERE posted_transaction_id = $1`, [txnId]);
        await client.query(`UPDATE admin_posting_requests SET reversal_transaction_id = NULL WHERE reversal_transaction_id = $1`, [txnId]);
        await client.query(`UPDATE admin_posting_requests SET replacement_transaction_id = NULL WHERE replacement_transaction_id = $1`, [txnId]);
        await client.query(`UPDATE transactions SET reversal_of_transaction_id = NULL WHERE reversal_of_transaction_id = $1`, [txnId]);
        await client.query(`UPDATE transactions SET replaces_transaction_id = NULL WHERE replaces_transaction_id = $1`, [txnId]);
        await client.query(`DELETE FROM transaction_date_corrections WHERE transaction_id = $1`, [txnId]);
        await client.query(`DELETE FROM historical_balance_postings WHERE transaction_id = $1 OR related_transaction_id = $1`, [txnId]);
        await client.query(`DELETE FROM account_cash_changes WHERE transaction_id = $1`, [txnId]);

        const { rows: linkedAssessments } = await client.query(
          `SELECT id FROM fee_assessments WHERE transaction_id = $1 OR refund_transaction_id = $1 FOR UPDATE`,
          [txnId],
        );
        const linkedAssessmentIds: number[] = linkedAssessments.map((r: any) => r.id);
        if (linkedAssessmentIds.length > 0) {
          await client.query(`DELETE FROM fee_audit WHERE assessment_id = ANY($1::int[])`, [linkedAssessmentIds]);
          await client.query(`DELETE FROM fee_assessments WHERE id = ANY($1::int[])`, [linkedAssessmentIds]);
        }

        await client.query(`DELETE FROM transactions WHERE id = $1`, [txnId]);

        let balanceReversed = false;
        if (reverseBalance && txn.status === "completed") {
          const acctIds = Array.from(
            new Set([txn.from_account_id, txn.to_account_id].filter((id): id is number => typeof id === "number")),
          ).sort((a, b) => a - b);

          if (acctIds.length > 0) {
            await client.query(
              `SELECT id FROM accounts WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE`,
              [acctIds],
            );
            if (txn.from_account_id != null && txn.from_account_id !== txn.to_account_id) {
              await client.query(
                `UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1`,
                [txn.from_account_id, txn.amount],
              );
            }
            if (txn.to_account_id != null && txn.to_account_id !== txn.from_account_id) {
              await client.query(
                `UPDATE accounts SET balance = balance - $2::numeric WHERE id = $1`,
                [txn.to_account_id, txn.amount],
              );
            }
            // Remove unlinked capture rows generated solely by this admin deletion reversal
            await client.query(
              `DELETE FROM account_cash_changes WHERE transaction_xid = txid_current() AND transaction_id IS NULL`,
            );
            balanceReversed = true;
          }
        }

        return { ok: true, id: txnId, balanceReversed };
      });
    }, "Failed to delete transaction"),
  );

  // 4. Delete an admin posting / reversal request
  app.delete(
    "/api/admin/postings/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      if (!hasDatabaseConfig) {
        if (!deleteMemoryPostingRequest(id)) throw new AdminDeleteError(404, "Posting request not found");
        return { ok: true, id };
      }
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(
          `SELECT id FROM admin_posting_requests WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!existing) throw new AdminDeleteError(404, "Posting request not found");
        await client.query(`DELETE FROM transaction_audit_trail WHERE posting_request_id = $1`, [id]);
        await client.query(`DELETE FROM admin_posting_requests WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete posting request"),
  );

  // 5. Delete an audit trail event
  app.delete(
    "/api/admin/audit-trail/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      if (!hasDatabaseConfig) {
        if (!deleteMemoryAuditEntry(id)) throw new AdminDeleteError(404, "Audit entry not found");
        return { ok: true, id };
      }
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM transaction_audit_trail WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Audit entry not found");
        return { ok: true, id };
      });
    }, "Failed to delete audit trail entry"),
  );

  // 6. Delete a client application
  app.delete(
    "/api/admin/applications/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM applications WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Application not found");
        return { ok: true, id };
      });
    }, "Failed to delete application"),
  );

  // 7. Delete an institutional transfer request
  app.delete(
    "/api/admin/institutional-transfers/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM institutional_transfers WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Institutional transfer not found");
        return { ok: true, id };
      });
    }, "Failed to delete institutional transfer"),
  );

  // 8. Delete a beneficiary / payee (detaches from any historical wire transactions)
  app.delete(
    "/api/admin/payees/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(`SELECT id FROM payees WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new AdminDeleteError(404, "Beneficiary not found");
        await client.query(`UPDATE transactions SET payee_id = NULL WHERE payee_id = $1`, [id]);
        await client.query(`DELETE FROM payees WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete beneficiary"),
  );

  // 9. Delete a recovery code request
  app.delete(
    `${adminRecoveryRequestPath}/:id`,
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM client_recovery_requests WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Recovery request not found");
        return { ok: true, id };
      });
    }, "Failed to delete recovery request"),
  );

  // 10. Delete a historical balance import (and its date corrections, postings, and preview)
  app.delete(
    "/api/admin/history/imports/:id",
    admin,
    handle(async (req) => {
      const importId = uuidParam.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [imp] } = await client.query(
          `SELECT id, preview_id FROM historical_balance_imports WHERE id = $1 FOR UPDATE`,
          [importId],
        );
        if (!imp) throw new AdminDeleteError(404, "Historical balance import not found");
        await client.query(`DELETE FROM transaction_date_corrections WHERE historical_import_id = $1`, [importId]);
        await client.query(`DELETE FROM historical_balance_postings WHERE import_id = $1`, [importId]);
        await client.query(`DELETE FROM historical_balance_imports WHERE id = $1`, [importId]);
        if (imp.preview_id) {
          await client.query(`DELETE FROM historical_balance_previews WHERE id = $1`, [imp.preview_id]);
        }
        return { ok: true, id: importId };
      });
    }, "Failed to delete historical balance import"),
  );

  // 11. Delete a display-currency audit entry
  app.delete(
    "/api/admin/display-currency/audit/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM client_display_currency_audit WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Display currency audit entry not found");
        return { ok: true, id };
      });
    }, "Failed to delete display currency audit entry"),
  );

  // 12. Delete a fee schedule version (and any dependent enrollments/assessments/audit)
  app.delete(
    "/api/admin/fees/schedules/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(`SELECT id FROM fee_schedules WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new AdminDeleteError(404, "Fee schedule not found");
        const { rows: enrollmentRows } = await client.query(
          `SELECT id FROM fee_enrollments WHERE schedule_id = $1 FOR UPDATE`,
          [id],
        );
        const enrollmentIds: number[] = enrollmentRows.map((r: any) => r.id);
        await client.query(
          `DELETE FROM fee_audit WHERE enrollment_id = ANY($1::int[])
              OR assessment_id IN (SELECT id FROM fee_assessments WHERE enrollment_id = ANY($1::int[]))`,
          [enrollmentIds],
        );
        await client.query(`DELETE FROM fee_assessments WHERE enrollment_id = ANY($1::int[])`, [enrollmentIds]);
        await client.query(`DELETE FROM fee_enrollments WHERE schedule_id = $1`, [id]);
        await client.query(`DELETE FROM fee_schedules WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete fee schedule"),
  );

  // 13. Delete a fee enrollment (and its assessments & audit rows)
  app.delete(
    "/api/admin/fees/enrollments/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(`SELECT id FROM fee_enrollments WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new AdminDeleteError(404, "Fee enrollment not found");
        await client.query(
          `DELETE FROM fee_audit WHERE enrollment_id = $1
              OR assessment_id IN (SELECT id FROM fee_assessments WHERE enrollment_id = $1)`,
          [id],
        );
        await client.query(`DELETE FROM fee_assessments WHERE enrollment_id = $1`, [id]);
        await client.query(`DELETE FROM fee_enrollments WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete fee enrollment"),
  );

  // 14. Delete a management contract (and its valuations, assessments & audit rows)
  app.delete(
    "/api/admin/fees/management/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(`SELECT id FROM management_contracts WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new AdminDeleteError(404, "Management contract not found");
        await client.query(
          `DELETE FROM fee_audit WHERE contract_id = $1
              OR assessment_id IN (SELECT id FROM fee_assessments WHERE contract_id = $1)`,
          [id],
        );
        await client.query(`DELETE FROM fee_assessments WHERE contract_id = $1`, [id]);
        await client.query(`DELETE FROM management_valuations WHERE contract_id = $1`, [id]);
        await client.query(`DELETE FROM management_contracts WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete management contract"),
  );

  // 15. Delete a fee assessment (and its linked fee audit rows)
  app.delete(
    "/api/admin/fees/assessments/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const { rows: [existing] } = await client.query(`SELECT id FROM fee_assessments WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new AdminDeleteError(404, "Fee assessment not found");
        await client.query(`DELETE FROM fee_audit WHERE assessment_id = $1`, [id]);
        await client.query(`DELETE FROM fee_assessments WHERE id = $1`, [id]);
        return { ok: true, id };
      });
    }, "Failed to delete fee assessment"),
  );

  // 16. Delete a fee audit entry
  app.delete(
    "/api/admin/fees/audit/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM fee_audit WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Fee audit entry not found");
        return { ok: true, id };
      });
    }, "Failed to delete fee audit entry"),
  );

  // 17. Delete an account opening request
  app.delete(
    "/api/admin/account-requests/:id",
    admin,
    handle(async (req) => {
      const id = positiveId.parse(req.params.id);
      return withAdminDeleteTx(pool, async (client) => {
        const result = await client.query(`DELETE FROM account_opening_requests WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount !== 1) throw new AdminDeleteError(404, "Account opening request not found");
        return { ok: true, id };
      });
    }, "Failed to delete account opening request"),
  );
}
