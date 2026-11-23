import { pgTable, text, serial, integer, boolean, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
import { BALANCE_CURRENCIES } from "./balance-currency";

export const accountTypeEnum = pgEnum('account_type', [
  // Investment/Retirement accounts only
  'Brokerage Account',
  'Traditional IRA',
  'Roth IRA',
  '401(k) / 403(b)',
  '529 Savings Plan',
  'Trust Account',
]);
export const transactionTypeEnum = pgEnum('transaction_type', ['transfer', 'buy', 'sell', 'payment', 'withdrawal', 'fee', 'fee_refund']);
export const transactionStatusEnum = pgEnum('transaction_status', ['completed', 'pending', 'failed']);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  clientRef: text("client_ref").unique(),
  displayCurrency: text("display_currency", { enum: BALANCE_CURRENCIES }).notNull().default("CAD"),
  debtClearanceRequired: boolean("debt_clearance_required").notNull().default(false),
  debtPaymentAccountId: integer("debt_payment_account_id"),
  debtPaymentConfirmedAt: timestamp("debt_payment_confirmed_at"),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  password: text("password").notNull(),
  phoneNumber: text("phone_number"),
  avatarUrl: text("avatar_url"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  marketingEmails: boolean("marketing_emails").default(true),
  securityAlerts: boolean("security_alerts").default(true),
  theme: text("theme").default("light"),
  loginRestricted: boolean("login_restricted").default(false),
  loginRestrictionMessage: text("login_restriction_message"),
  accountFrozen: boolean("account_frozen").default(false),
  freezeReason: text("freeze_reason"),
  frozenAt: timestamp("frozen_at"),
  initialDepositStatus: text("initial_deposit_status", { enum: ["required", "pending_review", "completed"] }).notNull().default("completed"),
  selectedInitialDeposit: text("selected_initial_deposit"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Presentation designations are independent of financial and fee-plan records.
export const clientDisplayCurrencyAudit = pgTable("client_display_currency_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  actor: text("actor").notNull(),
  previousCurrency: text("previous_currency", { enum: BALANCE_CURRENCIES }).notNull(),
  displayCurrency: text("display_currency", { enum: BALANCE_CURRENCIES }).notNull(),
  reason: text("reason").notNull(),
  confirmed: boolean("confirmed").notNull(),
  presentationOnly: boolean("presentation_only").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  accountNumber: text("account_number").notNull().unique().default(sql`'VW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))`),
  userId: integer("user_id").notNull(),
  accountType: text("account_type").notNull(),
  displayName: text("display_name"),
  balance: numeric("balance").notNull().default("0"),
  isDemo: boolean("is_demo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  fromAccountId: integer("from_account_id"),
  toAccountId: integer("to_account_id"),
  payeeId: integer("payee_id"),
  amount: numeric("amount").notNull(),
  description: text("description"),
  transactionType: transactionTypeEnum("transaction_type").notNull(),
  status: transactionStatusEnum("status").notNull().default('completed'),
  cashDebitDeferred: boolean("cash_debit_deferred").notNull().default(false),
  entryOrigin: text("entry_origin").notNull().default('client'),
  createdByStaffId: integer("created_by_staff_id"),
  createdByStaffName: text("created_by_staff_name"),
  approvedByStaffId: integer("approved_by_staff_id"),
  approvedByStaffName: text("approved_by_staff_name"),
  approvedAt: timestamp("approved_at"),
  evidenceRef: text("evidence_ref"),
  auditReason: text("audit_reason"),
  reversalOfTransactionId: integer("reversal_of_transaction_id"),
  replacesTransactionId: integer("replaces_transaction_id"),
  adminNotes: text("admin_notes"),
  isDemo: boolean("is_demo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const staffAdmins = pgTable("staff_admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdByStaffId: integer("created_by_staff_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adminPostingRequests = pgTable("admin_posting_requests", {
  id: serial("id").primaryKey(),
  actionKind: text("action_kind").notNull(), // 'posting' | 'reversal'
  postingType: text("posting_type").notNull(), // 'deposit' | 'transfer' | 'reversal' | 'reversal_and_replacement'
  clientUserId: integer("client_user_id").notNull(),
  fromAccountId: integer("from_account_id"),
  toAccountId: integer("to_account_id"),
  amount: numeric("amount").notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  reason: text("reason").notNull(),
  evidenceRef: text("evidence_ref").notNull(),
  description: text("description"),
  targetTransactionId: integer("target_transaction_id"),
  replacementPayload: text("replacement_payload"),
  status: text("status").notNull().default("pending_second_admin"), // pending_second_admin | approved | rejected
  createdByStaffId: integer("created_by_staff_id").notNull(),
  createdByStaffUsername: text("created_by_staff_username").notNull(),
  createdByStaffName: text("created_by_staff_name").notNull(),
  reviewedByStaffId: integer("reviewed_by_staff_id"),
  reviewedByStaffUsername: text("reviewed_by_staff_username"),
  reviewedByStaffName: text("reviewed_by_staff_name"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  postedTransactionId: integer("posted_transaction_id"),
  reversalTransactionId: integer("reversal_transaction_id"),
  replacementTransactionId: integer("replacement_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transactionAuditTrail = pgTable("transaction_audit_trail", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id"),
  postingRequestId: integer("posting_request_id"),
  entryOrigin: text("entry_origin").notNull(), // 'client' | 'staff'
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(), // 'client' | 'staff' | 'system'
  actorStaffId: integer("actor_staff_id"),
  actorName: text("actor_name").notNull(),
  reason: text("reason").notNull(),
  evidenceRef: text("evidence_ref"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payees = pgTable("payees", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  accountNumber: text("account_number"),
  routingNumber: text("routing_number"),
  bankName: text("bank_name"),
  country: text("country"),
  currency: text("currency"),
  type: text("type").notNull().default("individual"), // individual, business
  status: text("status").notNull().default("pending_approval"), // pending_approval | approved | rejected
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  symbol: text("symbol").notNull(),
  shares: numeric("shares").notNull(),
  purchasePrice: numeric("purchase_price").notNull(),
  currentPrice: numeric("current_price"), // For tracking current value
  createdAt: timestamp("created_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
  investments: many(investments),
  outgoingTransactions: many(transactions, { relationName: 'fromAccount' }),
  incomingTransactions: many(transactions, { relationName: 'toAccount' }),
}));

export const payeesRelations = relations(payees, ({ one, many }) => ({
  user: one(users, {
    fields: [payees.userId],
    references: [users.id],
  }),
  transactions: many(transactions, { relationName: 'payee' }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  fromAccount: one(accounts, {
    fields: [transactions.fromAccountId],
    references: [accounts.id],
    relationName: 'fromAccount'
  }),
  toAccount: one(accounts, {
    fields: [transactions.toAccountId],
    references: [accounts.id],
    relationName: 'toAccount'
  }),
  payee: one(payees, {
    fields: [transactions.payeeId],
    references: [payees.id],
    relationName: 'payee'
  }),
}));

export const investmentsRelations = relations(investments, ({ one }) => ({
  account: one(accounts, {
    fields: [investments.accountId],
    references: [accounts.id],
  }),
}));

export const institutionalTransfers = pgTable("institutional_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  accountId: integer("account_id"),
  institutionName: text("institution_name").notNull(),
  institutionCountry: text("institution_country"), // nullable for legacy requests
  destinationDetails: text("destination_details"),
  institutionAccountNumber: text("institution_account_number").notNull(),
  accountType: text("account_type").notNull(),
  transferType: text("transfer_type").notNull(), // "cash" | "in-kind"
  transferScope: text("transfer_scope").notNull(), // "full" | "partial" | "full-portfolio"
  partialAmount: numeric("partial_amount"),
  portfolioSnapshot: text("portfolio_snapshot"), // JSON array of accounts for full-portfolio transfers
  accountHolderType: text("account_holder_type"), // "own" | "other"
  accountHolderName: text("account_holder_name"), // name if "other"
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  estimatedCompletionDate: timestamp("estimated_completion_date"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type InstitutionalTransfer = typeof institutionalTransfers.$inferSelect;
export const insertInstitutionalTransferSchema = createInsertSchema(institutionalTransfers).omit({
  id: true, createdAt: true, status: true, estimatedCompletionDate: true, adminNotes: true,
});
export type InsertInstitutionalTransfer = z.infer<typeof insertInstitutionalTransferSchema>;

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  nationality: text("nationality"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  employmentStatus: text("employment_status"),
  annualIncome: text("annual_income"),
  investmentExperience: text("investment_experience"),
  riskTolerance: text("risk_tolerance"),
  investmentGoal: text("investment_goal"),
  initialDeposit: text("initial_deposit"),
  sourceOfFunds: text("source_of_funds"),
  preferredCurrency: text("preferred_currency").default("CAD"),
  password: text("password"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Application = typeof applications.$inferSelect;
export const insertApplicationSchema = createInsertSchema(applications).omit({ id: true, createdAt: true, status: true, notes: true });
export type InsertApplication = z.infer<typeof insertApplicationSchema>;

export const accountSetupTokens = pgTable("account_setup_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").notNull().default("activation"),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accountOpeningRequests = pgTable("account_opening_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  accountType: text("account_type").notNull(),
  requestedDisplayName: text("requested_display_name"),
  ownershipStructure: text("ownership_structure").notNull(),
  investmentObjective: text("investment_objective").notNull(),
  riskTolerance: text("risk_tolerance").notNull(),
  fundingSource: text("funding_source").notNull(),
  expectedInitialFunding: text("expected_initial_funding").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  additionalNotes: text("additional_notes"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  adminNotes: text("admin_notes"),
  createdAccountId: integer("created_account_id"),
  reviewedByStaffName: text("reviewed_by_staff_name"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AccountOpeningRequest = typeof accountOpeningRequests.$inferSelect;
export const insertAccountOpeningRequestSchema = createInsertSchema(accountOpeningRequests).omit({
  id: true,
  userId: true,
  status: true,
  adminNotes: true,
  createdAccountId: true,
  reviewedByStaffName: true,
  reviewedAt: true,
  createdAt: true,
});
export type InsertAccountOpeningRequest = z.infer<typeof insertAccountOpeningRequestSchema>;

export const insertUserSchema = createInsertSchema(users, {
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
}).omit({ id: true, createdAt: true });
export const insertAccountSchema = createInsertSchema(accounts, {
  userId: z.number().optional(),
  balance: z.string().min(1, "Initial deposit is required").refine((val) => Number.isFinite(Number(val)) && Number(val) >= 0, "Initial deposit must be a finite amount of at least 0"),
}).omit({ id: true, createdAt: true, accountNumber: true });
export const insertPayeeSchema = createInsertSchema(payees).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true, cashDebitDeferred: true });
export const insertInvestmentSchema = createInsertSchema(investments).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Payee = typeof payees.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Investment = typeof investments.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type InsertPayee = z.infer<typeof insertPayeeSchema>;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type InsertInvestment = z.infer<typeof insertInvestmentSchema>;

export * from "./fee-schema";
