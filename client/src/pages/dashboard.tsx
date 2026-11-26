import { useInvestments, useAccountTransactions, usePortfolioTransactions } from "@/hooks/use-finances";
import { useLocation } from "wouter";
import { LayoutShell } from "@/components/layout-shell";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useActiveLiquidation } from "@/hooks/use-liquidation-status";
import {
  TrendingUp, ArrowLeftRight, Clock, Info, ChevronRight, Landmark,
  BarChart3, Building2, Lock
} from "lucide-react";
import { transactionDescription, clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { useFundsAccess } from "@/hooks/use-funds-access";
import { useClientAccountSnapshot } from "@/hooks/use-fees";
import { DebtAccountSummary } from "@/components/fees/debt-account-summary";
import { DebtRestrictionStatus } from "@/components/fees/debt-restriction-status";
import { accountLabel, transactionDate, maskAccountNumber, TOTAL_OWED_LABEL, type CashPosting } from "@shared/account-display";
import { TransactionAmountBalance } from "@/components/transaction-amount-balance";
import { InitialDepositBanner } from "@/components/initial-deposit-banner";

const QUICK_ACTIONS = [
  { label: 'Transfer', icon: ArrowLeftRight, href: '/transfers' },
  { label: 'Invest',   icon: TrendingUp,     href: '/investments' },
  { label: 'Accounts', icon: Landmark,       href: '/accounts' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function categoryOf(type: string) {
  const investmentTypes = [
    'Brokerage Account',
    'Traditional IRA',
    'Roth IRA',
    '401(k) / 403(b)',
    '529 Savings Plan',
    'Trust Account',
  ];
  return investmentTypes.includes(type) ? 'investment' : 'banking';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const currency = clientBalanceCurrency(user);
  const initialDepositRequired = user?.initialDepositStatus === "required";
  const initialDepositPending = user?.initialDepositStatus === "pending_review";
  const needsInitialDeposit = initialDepositRequired || initialDepositPending;
  const access = useFundsAccess();
  const [, setLocation] = useLocation();
  const snapshot = useClientAccountSnapshot();
  const accounts = snapshot.data?.accounts;
  const accountsLoading = snapshot.isLoading;
  const accountsError = snapshot.isError;
  const refetchAccounts = snapshot.refetch;
  const feeSummary = { ...snapshot, data: snapshot.isError ? undefined : snapshot.data?.feeSummary };
  const { data: investments, isLoading: investmentsLoading, isError: investmentsError, refetch: refetchInvestments } = useInvestments();
  const [selectedTxn, setSelectedTxn] = useState<any>(null);
  const { transfers: instTransfers, statusUnavailable } = useActiveLiquidation();

  const activeTransfer = instTransfers.find((t: any) =>
    ["pending", "under_review", "approved", "liquidating", "transfer_out"].includes(t.status)
  );
  const isTransmitting = activeTransfer?.status === "transfer_out";

  const primaryAccount = accounts?.find(a => a.accountType === 'Brokerage Account') || accounts?.[0];
  const { data: primaryTransactions } = useAccountTransactions(primaryAccount?.id || 0);
  const { data: transactions, isLoading: txnLoading, isError: txnError } = usePortfolioTransactions();

  const fmt = (n: number | string) => formatBalance(n, currency);
  const investValue    = investments?.reduce((s, i) => s + Number(i.shares) * Number(i.currentPrice ?? i.purchasePrice), 0) ?? 0;
  const cashTotal      = accounts?.reduce((s, a) => s + Math.max(0, Number(a.balance)), 0) ?? 0;
  const overdraftTotal = accounts?.reduce((s, a) => s + Math.max(0, -Number(a.balance)), 0) ?? 0;
  const verifiedDebtAmount = (value: unknown): number | null => {
    if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const totalUnpaid = verifiedDebtAmount(feeSummary.data?.totalUnpaid);
  const totalOverdraft = feeSummary.data?.totalOverdraft === undefined
    ? accounts && accounts.every(account =>
      (typeof account.balance === "string" ? account.balance.trim() !== "" : typeof account.balance === "number") &&
      Number.isFinite(Number(account.balance)))
      ? accounts.reduce((sum, account) => sum + Math.max(0, -Number(account.balance)), 0)
      : null
    : verifiedDebtAmount(feeSummary.data.totalOverdraft);
  const proposedTotalOwed = feeSummary.data?.totalOwed === undefined
    ? totalUnpaid !== null && totalOverdraft !== null ? totalUnpaid + totalOverdraft : null
    : verifiedDebtAmount(feeSummary.data.totalOwed);
  const suppliedOverdraftInvalid = feeSummary.data?.totalOverdraft !== undefined && totalOverdraft === null;
  const totalsConsistent = totalUnpaid !== null && totalOverdraft !== null && proposedTotalOwed !== null
    ? Math.abs(proposedTotalOwed - totalUnpaid - totalOverdraft) < 0.01
    : true;
  const totalOwed = totalUnpaid === null || suppliedOverdraftInvalid || !totalsConsistent ? null : proposedTotalOwed;
  const totalOwedValue = totalOwed === null ? "Unavailable" : fmt(totalOwed === 0 ? 0 : -totalOwed);
  const totalBalance   = cashTotal + investValue;
  const cashUnavailable = accountsError || !accounts || accounts.some(a => !Number.isFinite(Number(a.balance)));
  const overdraftUnavailable = accountsError || !accounts || accounts.some(a =>
    (typeof a.balance === "string" && !a.balance.trim()) ||
    (typeof a.balance !== "string" && typeof a.balance !== "number") ||
    !Number.isFinite(Number(a.balance)));
  const investmentsUnavailable = investmentsError || !investments || !Number.isFinite(investValue);
  const balanceUnavailable = cashUnavailable || investmentsUnavailable || !Number.isFinite(totalBalance);
  const cashLocked = access.blocked || Boolean(activeTransfer && ["approved", "liquidating", "transfer_out"].includes(activeTransfer.status));
  const investTotal    = investValue;

  const pendingBalance = primaryTransactions?.filter(t => t.status === 'pending')
    .reduce((s, t) => t.toAccountId === primaryAccount?.id ? s + Number(t.amount) : s - Number(t.amount), 0) || 0;

  if (accountsLoading || investmentsLoading) {
    return (
      <LayoutShell>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64 rounded-md" />
          <Skeleton className="h-44 w-full rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
        </div>
      </LayoutShell>
    );
  }

  const firstName = user?.name?.split(' ')[0];
  const hasOverdraft = overdraftUnavailable || overdraftTotal > 0;
  const hasTotalOwed = feeSummary.isError || totalOwed === null || totalOwed > 0;

  return (
    <LayoutShell>
      <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
        <DebtRestrictionStatus requiresPayment={access.requiresPayment} data={access.data}
          error={access.isError} retry={() => void access.refetch()} />

        <InitialDepositBanner
          status={user?.initialDepositStatus}
          selectedInitialDeposit={user?.selectedInitialDeposit}
          onAction={() => setLocation("/transfers?tab=deposit")}
        />

        {/* ── Transaction Detail Dialog ───────────────────────────────────── */}
        <Dialog open={!!selectedTxn} onOpenChange={o => !o && setSelectedTxn(null)}>
          <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto border-slate-200 dark:border-border bg-white dark:bg-card text-slate-900 dark:text-foreground">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-serif text-xl">
                <Info className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                Transaction Detail
              </DialogTitle>
              <DialogDescription className="text-slate-500 font-mono text-xs">
                REF: TXN-{selectedTxn?.id?.toString().padStart(6, '0')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-0 divide-y divide-slate-100 dark:divide-border py-2">
              {[
                { label: 'Description', val: transactionDescription(selectedTxn?.description, currency, selectedTxn?.transactionType) },
                { label: 'Amount', val: fmt(Number(selectedTxn?.amount)), accent: true },
                { label: 'Status', val: selectedTxn?.status, statusText: true },
                { label: 'Type', val: selectedTxn?.transactionType },
                { label: 'Date', val: selectedTxn?.createdAt && transactionDate(selectedTxn.createdAt, true) },
              ].map(row => row.val !== undefined && (
                <div key={row.label} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <span className="text-slate-500 dark:text-muted-foreground text-xs font-medium shrink-0 pt-0.5">{row.label}</span>
                  {row.statusText ? (
                    <span className={cn(
                      'text-xs font-semibold capitalize shrink-0',
                      selectedTxn?.status === 'pending' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
                    )}>
                      {row.val}
                    </span>
                  ) : (
                    <span className={cn('min-w-0 text-right font-semibold [overflow-wrap:anywhere]', row.accent && 'font-sans text-slate-900 dark:text-foreground text-base tabular-nums')}>
                      {row.val}
                    </span>
                  )}
                </div>
              ))}
              {(selectedTxn?.cashPostings as CashPosting[] | undefined)?.map(posting => (
                <div key={posting.accountId} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 text-xs font-medium text-slate-500 dark:text-muted-foreground [overflow-wrap:anywhere]">
                    Balance after transaction · {posting.accountName}
                  </span>
                  <span className="shrink-0 font-sans font-semibold tabular-nums text-slate-900 dark:text-foreground">
                    {fmt(posting.balanceAfter)}
                  </span>
                </div>
              ))}
            </div>
            {selectedTxn?.status === 'pending' && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md mb-2">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-0.5">Compliance Review</p>
                <p className="text-xs text-amber-700/90 dark:text-amber-200/80 leading-relaxed">
                  This transaction is under review. Contact your advisor for an update.
                </p>
              </div>
            )}
            <Button onClick={() => setSelectedTxn(null)} className="w-full bg-[#0B2218] hover:bg-[#133526] text-white rounded-md font-medium">
              Close
            </Button>
          </DialogContent>
        </Dialog>

        {/* ── Greeting Header ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h1 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
              {getGreeting()}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-xs text-slate-500 dark:text-muted-foreground mt-1">
              Portfolio summary and account balances
            </p>
          </div>
        </div>

        {/* ── Portfolio Summary Card (Crisp White Private Bank) ───────────── */}
        <section
          aria-label="Portfolio summary"
          className="bg-white dark:bg-card border border-slate-200/90 dark:border-border border-t-2 border-t-[#C6A15B]/80 rounded-lg shadow-xs overflow-hidden"
        >
          <div className="px-5 sm:px-7 py-5 sm:py-6 border-b border-slate-100 dark:border-border space-y-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
              {/* Funded total balance */}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1.5">
                  Total balance · Funded accounts and holdings
                </p>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span
                    className={cn(
                      "font-sans font-semibold tabular-nums text-[clamp(1.85rem,4.5vw,2.75rem)] tracking-tight leading-none break-all",
                      isTransmitting ? "text-violet-700 dark:text-violet-300" : "text-slate-900 dark:text-foreground"
                    )}
                    data-testid="text-total-balance"
                  >
                    {balanceUnavailable ? "Unavailable" : fmt(totalBalance)}
                  </span>
                </div>
                {isTransmitting && (
                  <p className="text-violet-700 dark:text-violet-300 text-xs mt-2 font-medium">
                    Funds in transit to {activeTransfer?.institutionName}
                  </p>
                )}
                {balanceUnavailable && (
                  <p role="alert" className="text-rose-700 dark:text-rose-400 text-xs mt-2">
                    Current balances could not be loaded.
                    <button
                      type="button"
                      className="ml-2 font-medium underline underline-offset-2"
                      onClick={() => { void refetchAccounts(); void refetchInvestments(); }}
                    >
                      Retry
                    </button>
                  </p>
                )}
              </div>

              {/* Action bar */}
              <div className="grid grid-cols-3 gap-2 w-full md:w-auto md:flex md:items-center shrink-0">
                {QUICK_ACTIONS.map(({ label, icon: Icon, href }) => {
                  const isDepositLocked = needsInitialDeposit && href !== "/accounts";
                  const ActionIcon = isDepositLocked ? Lock : Icon;
                  const isPrimary = label === "Transfer" && !isDepositLocked;
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={isDepositLocked}
                      aria-disabled={isDepositLocked || undefined}
                      title={isDepositLocked ? "Complete initial deposit to unlock" : undefined}
                      onClick={() => {
                        if (!isDepositLocked) setLocation(href);
                      }}
                      data-funds-action={href !== "/accounts" ? "" : undefined}
                      className={cn(
                        "min-w-0 min-h-[40px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border text-xs font-medium transition-colors whitespace-nowrap shrink-0",
                        isDepositLocked
                          ? "bg-slate-100 dark:bg-muted/40 border-slate-200 dark:border-border text-slate-400 dark:text-muted-foreground cursor-not-allowed"
                          : isPrimary
                            ? "bg-[#0B2218] hover:bg-[#133526] border-[#0B2218] text-white"
                            : "bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted border-slate-200 dark:border-border text-slate-800 dark:text-foreground"
                      )}
                      data-testid={`button-quick-${label.toLowerCase()}`}
                    >
                      <ActionIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!balanceUnavailable && totalBalance > 0 && (() => {
              const cashPct = Math.round((cashTotal / totalBalance) * 100);
              const investPct = Math.max(0, 100 - cashPct);
              return (
                <div className="space-y-2 pt-1">
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-muted overflow-hidden flex">
                    {cashPct > 0 && (
                      <div
                        className="h-full bg-[#0B2218] dark:bg-emerald-500 transition-all"
                        style={{ width: `${cashPct}%` }}
                      />
                    )}
                    {investPct > 0 && (
                      <div
                        className="h-full bg-[#C6A15B] transition-all"
                        style={{ width: `${investPct}%` }}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <span className="w-2 h-2 rounded-xs bg-[#0B2218] dark:bg-emerald-500 shrink-0" aria-hidden="true" />
                      Liquid cash {cashPct}%
                    </span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <span className="w-2 h-2 rounded-xs bg-[#C6A15B] shrink-0" aria-hidden="true" />
                      Investments {investPct}%
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Summary KPI strip */}
          <div className="bg-slate-50/70 dark:bg-muted/20 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 [&>*]:border-slate-200/80 dark:[&>*]:border-border [&>*:not(:first-child)]:border-t sm:[&>*:nth-child(2)]:border-t-0 sm:[&>*:nth-child(even)]:border-l xl:[&>*:not(:first-child)]:border-t-0 xl:[&>*:not(:first-child)]:border-l">
            {[
              {
                label: 'Liquid Cash',
                val: cashUnavailable ? "Unavailable" : fmt(cashTotal),
                sub: statusUnavailable
                  ? 'Transfer status unavailable'
                  : access.blocked
                    ? 'Contact your advisor'
                    : pendingBalance !== 0
                      ? `${fmt(Math.abs(pendingBalance))} pending${cashLocked ? " · Transfer on hold" : ""}`
                      : cashLocked
                        ? 'Transfer on hold'
                        : 'Available now',
                debt: false,
                highlightDebt: false,
                testId: "text-liquid-cash",
              },
              {
                label: 'Investments',
                val: investmentsUnavailable ? "Unavailable" : fmt(investTotal),
                sub: 'Recorded investment value',
                debt: false,
                highlightDebt: false,
                testId: "text-investment-value",
              },
              {
                label: 'Overdraft',
                val: overdraftUnavailable ? "Unavailable" : fmt(overdraftTotal === 0 ? 0 : -overdraftTotal),
                sub: undefined,
                debt: true,
                highlightDebt: hasOverdraft,
                testId: "text-overdraft",
              },
              {
                label: TOTAL_OWED_LABEL,
                val: feeSummary.isLoading ? "Loading…" : feeSummary.isError ? "Unavailable" : totalOwedValue,
                sub: undefined,
                debt: true,
                highlightDebt: hasTotalOwed,
                testId: "text-unpaid-fees",
              },
            ].map(({ label, val, sub, highlightDebt, testId }) => (
              <div key={label} className="px-5 py-3.5 flex flex-col justify-center min-w-0">
                <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground mb-0.5">{label}</p>
                <p
                  className={cn(
                    "font-sans font-semibold tabular-nums text-sm [overflow-wrap:anywhere]",
                    highlightDebt ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-foreground"
                  )}
                  data-testid={testId}
                >
                  {val}
                </p>
                {sub && <p className="text-slate-500 dark:text-muted-foreground text-[11px] mt-0.5">{sub}</p>}
              </div>
            ))}
          </div>
        </section>

        <DebtAccountSummary summary={feeSummary.data} accounts={accounts} variant="dashboard" loading={feeSummary.isLoading}
          error={feeSummary.isError} retry={() => void feeSummary.refetch()} currency={currency} />

        {/* ── Portfolio in Transit Banner ─────────────────────────────────── */}
        {activeTransfer && (() => {
          const stage = activeTransfer.status === "pending" ? 0
            : activeTransfer.status === "under_review" ? 1
            : (activeTransfer.status === "liquidating" || activeTransfer.status === "approved") ? 2
            : activeTransfer.status === "transfer_out" ? 3
            : 0;
          const isCash = activeTransfer.transferType === "cash";

          const onDark = stage <= 1;
          const bannerBg = stage === 3
            ? "bg-violet-50 border-violet-300"
            : stage === 2
              ? "bg-amber-50 border-amber-300"
              : "bg-[#0B2218] border-[#163830]";
          const iconBg = stage === 3 ? "bg-violet-200" : stage === 2 ? "bg-amber-200" : "bg-white/10";
          const iconEl = stage >= 2
            ? <Lock className={`w-4 h-4 ${stage === 3 ? "text-violet-700" : "text-amber-700"}`} />
            : <Building2 className="w-4 h-4 text-white/85" />;
          const titleColor = stage === 3 ? "text-violet-900" : stage === 2 ? "text-amber-800" : "text-white";
          const statusColor = stage === 3 ? "text-violet-700" : stage === 2 ? "text-amber-700" : "text-[#DFBD76]";
          const badgeLabel = stage === 0 ? "Pending Review" : stage === 1 ? "Under Review" : stage === 2 ? (isCash ? "Liquidating" : "Processing") : "Portfolio Transmission";
          const bodyColor = stage === 3 ? "text-violet-800/85" : stage === 2 ? "text-amber-800/85" : "text-white/75";
          const strongColor = stage === 3 ? "text-violet-950" : stage === 2 ? "text-amber-950" : "text-white";
          const dotActive = stage === 3 ? "bg-violet-500" : stage === 2 ? "bg-amber-500" : "bg-[#DFBD76]";
          const dotInactive = onDark ? "bg-white/25" : stage === 3 ? "bg-violet-200" : "bg-amber-200";
          const labelActive = stage === 3 ? "text-violet-700" : stage === 2 ? "text-amber-700" : "text-[#DFBD76]";
          const labelInactive = onDark ? "text-white/45" : stage === 3 ? "text-violet-400" : "text-amber-500";
          const lineActive = stage === 3 ? "bg-violet-300" : stage === 2 ? "bg-amber-300" : "bg-[#DFBD76]/55";
          const lineInactive = onDark ? "bg-white/15" : stage === 3 ? "bg-violet-200/50" : "bg-amber-200/50";
          const completionBg = stage === 3 ? "bg-violet-100 border border-violet-300" : stage === 2 ? "bg-amber-100 border border-amber-300" : "bg-white/10 border border-white/15";
          const clockColor = stage === 3 ? "text-violet-600" : stage === 2 ? "text-amber-600" : "text-[#DFBD76]";
          const completionLabel = stage === 3 ? "text-violet-700" : stage === 2 ? "text-amber-700" : "text-white/65";
          const completionValue = stage === 3 ? "text-violet-900" : stage === 2 ? "text-amber-900" : "text-white";
          const viewColor = stage === 3 ? "text-violet-800 hover:text-violet-950" : stage === 2 ? "text-amber-800 hover:text-amber-950" : "text-white/70 hover:text-white";

          const titleText = stage === 0 ? "Portfolio Transfer — Pending Review"
            : stage === 1 ? "Portfolio Transfer — Under Advisor Review"
            : stage === 2 ? "Preparing Your Portfolio Transfer"
            : "Portfolio Transfer in Progress";

          const bodyText = stage === 0
            ? <>Your transfer request to <strong className={strongColor}>{activeTransfer.institutionName}</strong> has been submitted. An advisor will review it shortly.</>
            : stage === 1
            ? <>Your request is being reviewed by our advisory team. Transfer to <strong className={strongColor}>{activeTransfer.institutionName}</strong> will proceed once the advisory review is complete.</>
            : stage === 2
            ? <>We are preparing your transfer to <strong className={strongColor}>{activeTransfer.institutionName}</strong>. Contact your advisor for updates.</>
            : <>Your transfer to <strong className={strongColor}>{activeTransfer.institutionName}</strong> is in progress. Contact your advisor for updates.</>;

          const steps = [
            { label: "Submitted", done: stage >= 0 },
            { label: "Under Review", done: stage >= 1 },
            { label: "Liquidating", done: stage >= 2 },
            { label: "Transfer Out", done: stage >= 3 },
            { label: "Complete", done: false },
          ];

          return (
            <div className={cn("rounded-lg border px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4", bannerBg)}>
              <div className="flex items-start gap-3.5 flex-1 min-w-0">
                <div className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5", iconBg)}>
                  {iconEl}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className={cn("text-sm font-semibold", titleColor)}>{titleText}</p>
                    <span className={cn("text-xs font-medium", statusColor)}>· {badgeLabel}</span>
                  </div>
                  <p className={cn("text-xs leading-relaxed", bodyColor)}>{bodyText}</p>
                  <div className="flex items-center mt-3 w-full max-w-full overflow-x-auto pb-1">
                    {steps.map((step, i) => (
                      <div key={i} className="flex items-center shrink-0">
                        <div className="flex flex-col items-center gap-1">
                          <div className={cn("w-2 h-2 rounded-full", step.done ? dotActive : dotInactive)} />
                          <span className={cn("text-[10px] font-medium whitespace-nowrap", step.done ? labelActive : labelInactive)}>{step.label}</span>
                        </div>
                        {i < steps.length - 1 && (
                          <div className={cn("w-4 sm:w-8 h-px mb-3.5 mx-1.5", step.done ? lineActive : lineInactive)} />
                        )}
                      </div>
                    ))}
                  </div>
                  {activeTransfer.estimatedCompletionDate && (
                    <div className={cn("flex items-center gap-2 mt-3 px-3 py-2 rounded-md", completionBg)}>
                      <Clock className={cn("w-3.5 h-3.5 shrink-0", clockColor)} />
                      <div className="min-w-0">
                        <p className={cn("text-[11px] font-medium", completionLabel)}>Estimated Completion</p>
                        <p className={cn("text-sm font-semibold", completionValue)}>
                          {new Date(activeTransfer.estimatedCompletionDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLocation("/transfers")}
                className={cn("text-xs font-medium shrink-0 self-end sm:self-start mt-1 flex items-center gap-0.5 transition-colors", viewColor)}
              >
                View <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}

        {/* ── Your Accounts (Primary Banking Grid) ────────────────────────── */}
        <section aria-label="Your Accounts" className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="font-sans text-sm font-semibold text-slate-900 dark:text-foreground">Accounts</h2>
            <button
              type="button"
              className="text-xs font-medium text-[#0B2218] dark:text-primary hover:underline inline-flex items-center gap-0.5"
              onClick={() => setLocation('/accounts')}
            >
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {accountsError ? (
            <div role="alert" className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg px-4 py-6 text-center text-sm text-destructive">
              <p>Accounts could not be loaded.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void refetchAccounts()}>Retry accounts</Button>
            </div>
          ) : accounts?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {accounts.slice(0, 6).map(acc => {
                const cat = categoryOf(acc.accountType);
                const overdrawn = Number(acc.balance) < 0;
                const typeLabel = acc.accountType === "Trust Account"
                  ? "Fiduciary & Trust"
                  : cat === "investment"
                    ? "Investment Custody"
                    : "Cash & Banking";
                return (
                  <button
                    type="button"
                    key={acc.id}
                    className="w-full text-left bg-white dark:bg-card border border-slate-200/90 dark:border-border hover:border-[#0B2218]/35 dark:hover:border-primary/40 rounded-lg p-5 transition-colors group shadow-xs flex flex-col justify-between gap-4"
                    onClick={() => setLocation(`/accounts/${acc.id}`)}
                    data-testid={`dash-account-${acc.id}`}
                  >
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground mb-1">
                          {typeLabel}
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-foreground [overflow-wrap:anywhere]" data-testid={`dash-account-name-${acc.id}`}>
                          {accountLabel(acc)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-muted-foreground font-mono mt-1">
                          {maskAccountNumber(acc.accountNumber)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 text-slate-300 dark:text-muted-foreground/40 group-hover:text-[#0B2218] dark:group-hover:text-foreground transition-colors mt-0.5" />
                    </div>
                    <div className="pt-3 border-t border-slate-100 dark:border-border/60 flex items-baseline justify-between gap-3">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground">Balance</span>
                      <span
                        className={cn(
                          "font-sans text-base sm:text-lg font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]",
                          overdrawn ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-foreground"
                        )}
                        data-testid={`dash-account-balance-${acc.id}`}
                      >
                        {fmt(acc.balance)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg px-4 py-8 text-center text-sm text-slate-500 dark:text-muted-foreground">
              No accounts to display
            </div>
          )}
        </section>

        {/* ── Lower Split: Recent Transactions & Holdings ─────────────────── */}
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">

          {/* Left: Recent Transactions Ledger */}
          <div className="min-w-0 bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg overflow-hidden shadow-xs flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-border flex items-center justify-between">
              <div>
                <h2 className="font-sans font-semibold text-sm text-slate-900 dark:text-foreground">Transaction history</h2>
                <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">Recent transactions</p>
              </div>
              <button
                type="button"
                data-testid="view-transaction-history"
                className="text-xs font-medium text-[#0B2218] dark:text-primary hover:underline inline-flex items-center gap-0.5 shrink-0"
                onClick={() => setLocation('/transactions')}
              >
                View all <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="min-w-0 divide-y divide-slate-100 dark:divide-border/40 max-h-[380px] overflow-y-auto custom-scrollbar flex-1">
              {txnLoading ? (
                <div className="p-5 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : txnError ? (
                <p role="alert" className="p-5 text-sm text-rose-700">Transaction history could not be loaded.</p>
              ) : transactions && transactions.length > 0 ? transactions.map((txn: any) => {
                const incomingAccount = accounts?.find(a => a.id === txn.toAccountId);
                const outgoingAccount = accounts?.find(a => a.id === txn.fromAccountId);
                const internal = Boolean(incomingAccount && outgoingAccount);
                const isIn = Boolean(incomingAccount && !outgoingAccount);
                const isPending = txn.status === 'pending';
                const accountText = !internal
                  ? (incomingAccount || outgoingAccount ? accountLabel((incomingAccount || outgoingAccount)!) : "Account details unavailable")
                  : null;
                return (
                  <div
                    key={txn.id}
                    className="flex min-w-0 items-start justify-between gap-4 px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedTxn(txn)}
                    data-testid={`txn-row-${txn.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-foreground whitespace-normal [overflow-wrap:anywhere]">
                        {transactionDescription(txn.description, currency, txn.transactionType)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-muted-foreground whitespace-normal [overflow-wrap:anywhere] mt-1">
                        <span className="font-mono">{transactionDate(txn.createdAt)}</span>
                        {accountText && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{accountText}</span>
                          </>
                        )}
                        {isPending && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="font-semibold text-amber-700 dark:text-amber-300">Pending</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex min-w-0 max-w-[46%] shrink-0 flex-col items-end gap-0.5">
                      <TransactionAmountBalance
                        amount={`${internal ? "↔ " : isIn ? "+" : "−"}${fmt(Number(txn.amount))}`}
                        currency={currency}
                        postings={(txn.cashPostings as CashPosting[] | undefined) || []}
                        amountClassName={cn(
                          'font-semibold text-sm',
                          isPending
                            ? 'text-amber-700 dark:text-amber-300'
                            : internal
                              ? 'text-slate-600 dark:text-muted-foreground'
                              : isIn
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-foreground'
                        )}
                        showAccountNames={internal}
                      />
                    </div>
                  </div>
                );
              }) : (
                <div className="py-12 text-center">
                  <Clock className="w-7 h-7 text-slate-300 dark:text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 dark:text-muted-foreground">No transactions yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Holdings */}
          <div className="min-w-0 bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg overflow-hidden shadow-xs flex flex-col">
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-border flex items-center justify-between">
              <div>
                <h2 className="font-sans font-semibold text-sm text-slate-900 dark:text-foreground">Holdings</h2>
                <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">Your recorded investments</p>
              </div>
              {needsInitialDeposit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  className="text-xs text-slate-400 gap-1 cursor-not-allowed"
                  data-testid="button-manage-holdings-locked"
                >
                  <Lock className="w-3 h-3" /> Locked
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-[#0B2218] dark:text-primary hover:bg-slate-100 dark:hover:bg-primary/5 gap-1"
                  data-funds-action=""
                  onClick={() => setLocation('/investments')}
                >
                  Manage <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-2 px-4 sm:px-6 py-2.5 border-b border-slate-100 dark:border-border/40 bg-slate-50/70 dark:bg-muted/10">
              {['Security', 'Shares', 'Avg Cost', 'Stored Value'].map(h => (
                <p key={h} className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground text-right first:text-left">{h}</p>
              ))}
            </div>

            {investmentsLoading ? (
              <div className="p-4 space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : investmentsError ? (
              <div role="alert" className="px-4 py-6 text-center text-sm text-destructive">
                <p>Holdings could not be loaded.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void refetchInvestments()}>Retry holdings</Button>
              </div>
            ) : investments && investments.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-border/40 flex-1 flex flex-col">
                <div className="divide-y divide-slate-100 dark:divide-border/40">
                  {investments.map((inv: any) => {
                    const mktVal = Number(inv.shares) * Number(inv.currentPrice ?? inv.purchasePrice);
                    return (
                      <div
                        key={inv.id}
                        className="grid min-w-0 grid-cols-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-x-3 gap-y-2 px-4 sm:px-6 py-3.5 hover:bg-slate-50/80 dark:hover:bg-muted/30 transition-colors items-center"
                        data-testid={`holding-row-${inv.id}`}
                      >
                        <div className="col-span-2 sm:col-span-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-foreground [overflow-wrap:anywhere]">{inv.symbol}</p>
                        </div>
                        <div className="min-w-0 sm:text-right">
                          <p className="text-[11px] text-slate-500 sm:hidden mb-0.5">Shares</p>
                          <p className="font-sans text-xs tabular-nums text-slate-600 dark:text-muted-foreground [overflow-wrap:anywhere]">{Number(inv.shares).toFixed(4)}</p>
                        </div>
                        <div className="min-w-0 sm:text-right">
                          <p className="text-[11px] text-slate-500 sm:hidden mb-0.5">Avg Cost</p>
                          <p className="font-sans text-xs tabular-nums font-medium text-slate-900 dark:text-foreground [overflow-wrap:anywhere]">{fmt(Number(inv.purchasePrice))}</p>
                        </div>
                        <div className="min-w-0 sm:text-right">
                          <p className="text-[11px] text-slate-500 sm:hidden mb-0.5">Stored Value</p>
                          <p className="font-sans text-xs tabular-nums font-semibold text-slate-900 dark:text-foreground [overflow-wrap:anywhere]">{fmt(mktVal)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-auto grid min-w-0 grid-cols-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-2 px-4 sm:px-6 py-3 bg-slate-50/75 dark:bg-muted/20 items-center border-t border-slate-200/80 dark:border-border">
                  <p className="text-xs font-semibold text-slate-600 dark:text-muted-foreground">Total</p>
                  <p className="font-sans text-sm font-semibold tabular-nums text-right text-slate-900 dark:text-foreground [overflow-wrap:anywhere] sm:col-start-4">{fmt(investValue)}</p>
                </div>
              </div>
            ) : (
              <div className="py-12 px-4 text-center flex-1 flex flex-col items-center justify-center">
                <BarChart3 className="w-8 h-8 text-slate-300 dark:text-muted-foreground/30 mx-auto mb-2.5" />
                <p className="text-sm font-medium text-slate-600 dark:text-muted-foreground">No holdings yet</p>
                {needsInitialDeposit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="mt-3 rounded-md text-xs gap-1.5 opacity-60 cursor-not-allowed"
                    data-testid="button-holdings-invest-locked"
                  >
                    <Lock className="w-3 h-3" /> Investing Locked
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 rounded-md text-xs gap-1.5 border-slate-200 hover:bg-slate-50"
                    data-funds-action=""
                    onClick={() => setLocation('/investments')}
                  >
                    <TrendingUp className="w-3.5 h-3.5" /> Start Investing
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 pb-1 text-xs text-slate-400 dark:text-muted-foreground/60">
          <span>Veritas Wealth</span>
        </div>
      </div>
    </LayoutShell>
  );
}
