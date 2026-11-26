import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { User } from "@shared/schema";
import {
  bankingPreferencesPath,
  bankingPreferencesSchema,
  contactDetailsPath,
  contactDetailsSchema,
  DEFAULT_BANKING_PREFERENCES,
} from "@shared/client-settings";
import { pool } from "./db";
import { securityHandler, securityOrigin } from "./security/routes";
import { audit, consumeFactor, rateLimit, withSecurity } from "./security/store";
import { comparePasswords, SecurityError } from "./security/crypto";
import { getEffectiveClientControls } from "./admin-controls";

export async function registerClientSettings(app: Express, authenticated: RequestHandler) {
  await pool.query(`CREATE TABLE IF NOT EXISTS client_contact_details (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    residential_address JSONB,
    mailing_address JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS client_banking_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    statement_delivery TEXT NOT NULL DEFAULT 'electronic',
    transaction_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    login_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    session_timeout_minutes INTEGER NOT NULL DEFAULT 25,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  app.get(contactDetailsPath, authenticated, securityHandler(async (req, res) => {
    const { rows: [row] } = await pool.query(`SELECT u.email,u.phone_number,
      c.residential_address,c.mailing_address FROM users u
      LEFT JOIN client_contact_details c ON c.user_id=u.id WHERE u.id=$1`, [(req.user as User).id]);
    res.json({ email: row.email, phoneNumber: row.phone_number || "",
      residentialAddress: row.residential_address || null, mailingAddress: row.mailing_address || null });
  }));
  app.patch(contactDetailsPath, authenticated, securityOrigin, securityHandler(async (req, res) => {
    const userId = (req.user as User).id;
    const controls = await getEffectiveClientControls(pool, userId);
    if (!controls.effective.canEditContactDetails) {
      throw new SecurityError(403, "Contact details updates are locked by your administrator.");
    }
    const input = contactDetailsSchema.extend({
      currentPassword: z.string().min(1, "Enter your current password.").max(128),
      code: z.string().trim().max(128).optional(),
    }).parse(req.body);
    await rateLimit(`contact-details:${userId}`);
    try {
      await withSecurity(userId, async (db, state, user) => {
        if (!await comparePasswords(input.currentPassword, user.password)) throw new SecurityError(400, "Your current password is incorrect.");
        if (state.mfa_enabled) await consumeFactor(db, state, input.code || "");
        await db.query("UPDATE users SET email=$2,phone_number=$3 WHERE id=$1", [userId, input.email, input.phoneNumber]);
        await db.query(`INSERT INTO client_contact_details(user_id,residential_address,mailing_address)
          VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET residential_address=$2,mailing_address=$3,updated_at=NOW()`,
          [userId, input.residentialAddress, input.mailingAddress]);
        await audit(db, userId, "contact_details_updated");
      });
    } catch (error) {
      if ((error as {code?: string}).code === "23505") throw new SecurityError(409, "This email address is already in use.");
      throw error;
    }
    const { currentPassword: _password, code: _code, ...details } = input;
    res.json(details);
  }));
  app.get(bankingPreferencesPath, authenticated, securityHandler(async (req, res) => {
    const userId = (req.user as User).id;
    const { rows: [row] } = await pool.query(
      `SELECT statement_delivery, transaction_alerts, login_alerts, session_timeout_minutes
       FROM client_banking_preferences WHERE user_id=$1`,
      [userId],
    );
    if (!row) {
      return void res.json(DEFAULT_BANKING_PREFERENCES);
    }
    res.json(bankingPreferencesSchema.parse({
      statementDelivery: row.statement_delivery,
      transactionAlerts: Boolean(row.transaction_alerts),
      loginAlerts: Boolean(row.login_alerts),
      sessionTimeoutMinutes: Number(row.session_timeout_minutes),
    }));
  }));
  app.patch(bankingPreferencesPath, authenticated, securityOrigin, securityHandler(async (req, res) => {
    const userId = (req.user as User).id;
    const controls = await getEffectiveClientControls(pool, userId);
    if (!controls.effective.canEditPreferences) {
      throw new SecurityError(403, "Banking preferences are locked by your administrator.");
    }
    const input = bankingPreferencesSchema.parse(req.body);
    await withSecurity(userId, async (db) => {
      await db.query(
        `INSERT INTO client_banking_preferences(user_id, statement_delivery, transaction_alerts, login_alerts, session_timeout_minutes)
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(user_id) DO UPDATE SET
           statement_delivery=$2,
           transaction_alerts=$3,
           login_alerts=$4,
           session_timeout_minutes=$5,
           updated_at=NOW()`,
        [userId, input.statementDelivery, input.transactionAlerts, input.loginAlerts, input.sessionTimeoutMinutes],
      );
      await audit(db, userId, "banking_preferences_updated");
    });
    res.json(input);
  }));
}
