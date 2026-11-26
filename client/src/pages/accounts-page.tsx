import { useClientFeeSummary } from "@/hooks/use-fees";
import { accountLabel, maskAccountNumber } from "@shared/account-display";
import { DebtAccountSummary } from "@/components/fees/debt-account-summary";
import { useState } from "react";
import {
  Plus, ChevronRight, TrendingUp,
  Landmark, Briefcase, Eye, EyeOff,
  CheckCircle2, AlertCircle, Lock, Building2, FileText, Clock
} from "lucide-react";
import {
  useAccounts,
  useInvestments,
  useAccountRequests,
  useCreateAccountRequest,
  useAccountTransactions,
} from "@/hooks/use-finances";
import { useActiveLiquidation } from "@/hooks/use-liquidation-status";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { InfoTip } from "@/components/ui/info-tip";

type AccountType = 'Brokerage Account' | 'Traditional IRA' | 'Roth IRA' |
  '401(k) / 403(b)' | '529 Savings Plan' | 'Trust Account';

function categoryOf(type: string): keyof typeof CATEGORY_META {
  if (type === 'Trust Account') return 'business';
  return 'investment';
}

const CATEGORY_META = {
  cash:       { label: 'Cash & Deposits',        Icon: Landmark,   color: 'text-slate-700 dark:text-slate-300' },
  investment: { label: 'Brokerage & Retirement', Icon: TrendingUp, color: 'text-emerald-800 dark:text-emerald-300' },
  business:   { label: 'Business & Trust',       Icon: Briefcase,  color: 'text-amber-800 dark:text-amber-300' },
};

const ACCOUNT_TYPE_OPTIONS = [
  { group: 'Investment & Retirement', items: ['Brokerage Account', 'Traditional IRA', 'Roth IRA', '401(k) / 403(b)', '529 Savings Plan'] },
  { group: 'Business & Trust', items: ['Trust Account'] },
];

const OWNERSHIP_STRUCTURES = [
  "Individual",
  "Joint Tenants with Rights of Survivorship",
  "Trust / Fiduciary",
  "Corporate / Entity",
];

const INVESTMENT_OBJECTIVES = [
  "Capital Preservation",
  "Balanced Income & Growth",
  "Long-Term Growth",
  "Aggressive Growth",
  "Tax-Advantaged Retirement",
];

const RISK_TOLERANCES = [
  "Conservative",
  "Moderate",
  "Growth",
  "Aggressive",
];

const FUNDING_SOURCES = [
  "Wire / Bank Transfer",
  "Internal Portfolio Transfer",
  "Institutional Rollover / ACAT",
  "Employment / Earned Income",
  "Business / Trust Distribution",
];

const INITIAL_FUNDING_TIERS = [
  "$1,000 – $10,000",
  "$10,000 – $50,000",
  "$50,000 – $250,000",
  "$250,000 – $1,000,000",
  "$1,000,000+",
];

const JURISDICTIONS = [
  "Canada",
  "United Kingdom",
  "United States",
  "European Union",
  "Other",
];

const INITIAL_FORM_STATE = {
  accountType: 'Brokerage Account' as AccountType,
  requestedDisplayName: '',
  ownershipStructure: 'Individual',
  investmentObjective: 'Long-Term Growth',
  riskTolerance: 'Moderate',
  fundingSource: 'Wire / Bank Transfer',
  expectedInitialFunding: '$50,000 – $250,000',
  jurisdiction: 'Canada',
  additionalNotes: '',
  clientDeclarationAccepted: false,
};

export default function AccountsPage() {
  const { data: accounts, isLoading, isError: accountsError, refetch: refetchAccounts } = useAccounts();
  const { data: investments, isLoading: investmentsLoading, isError: investmentsError, refetch: refetchInvestments } = useInvestments();
  const { data: accountRequests, isLoading: requestsLoading } = useAccountRequests();
  const primaryAccount = accounts?.find(a => a.accountType === 'Brokerage Account') || accounts?.[0];
  const { data: transactions } = useAccountTransactions(primaryAccount?.id || 0);
  const createAccountRequest = useCreateAccountRequest();
  const { user } = useAuth();
  const currency = clientBalanceCurrency(user);
  const money = (value: string | number) => formatBalance(value, currency);
  const feeSummary = useClientFeeSummary();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const initialDepositRequired = user?.initialDepositStatus === "required";
  const initialDepositPending = user?.initialDepositStatus === "pending_review";
  const needsInitialDeposit = initialDepositRequired || initialDepositPending;
  const { transfers: instTransfers } = useActiveLiquidation();
  const activeTransfer = (instTransfers as any[]).find((t: any) =>
    ["pending", "under_review", "approved", "liquidating", "transfer_out"].includes(t.status)
  );
  const xferStage = activeTransfer?.status === "pending" ? 0
    : activeTransfer?.status === "under_review" ? 1
    : (activeTransfer?.status === "liquidating" || activeTransfer?.status === "approved") ? 2
    : activeTransfer?.status === "transfer_out" ? 3
    : -1;
  const isLocked = xferStage >= 2;
  const isTransmitting = xferStage === 3;

  const [hideBalances, setHideBalances] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; type: 'success' | 'error' } | null>(null);
  const [requestForm, setRequestForm] = useState(INITIAL_FORM_STATE);

  const pendingBalance = transactions
    ?.filter(t => t.status === 'pending')
    .reduce((sum, t) => {
      const amt = Number(t.amount);
      return t.toAccountId === primaryAccount?.id ? sum + amt : sum - amt;
    }, 0) || 0;

  const cashTotal = accounts?.reduce((sum, account) => sum + Math.max(0, Number(account.balance)), 0) ?? 0;
  const investTotal = investments?.reduce((sum, holding) =>
    sum + Number(holding.shares) * Number(holding.currentPrice ?? holding.purchasePrice), 0) ?? 0;
  const cashUnavailable = accountsError || !accounts || accounts.some(account => !Number.isFinite(Number(account.balance)));
  const investmentsUnavailable = investmentsError || !investments || investments.some(holding =>
    !Number.isFinite(Number(holding.shares)) || Number(holding.shares) < 0 ||
    !Number.isFinite(Number(holding.currentPrice ?? holding.purchasePrice)) ||
    Number(holding.currentPrice ?? holding.purchasePrice) < 0) || !Number.isFinite(investTotal);
  const totalBalance = cashTotal + investTotal;
  const balanceLoading = isLoading || investmentsLoading;
  const balanceUnavailable = cashUnavailable || investmentsUnavailable || !Number.isFinite(totalBalance);
  const retryBalances = () => { void refetchAccounts(); void refetchInvestments(); };

  const fmt = (n: number) => hideBalances ? '••••••' : money(n);

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!requestForm.clientDeclarationAccepted) {
      toast({
        title: 'Attestation Required',
        description: 'Please confirm the institutional account opening attestation before submitting.',
        variant: 'destructive',
      });
      return;
    }

    createAccountRequest.mutate(
      {
        accountType: requestForm.accountType,
        requestedDisplayName: requestForm.requestedDisplayName.trim() || undefined,
        ownershipStructure: requestForm.ownershipStructure,
        investmentObjective: requestForm.investmentObjective,
        riskTolerance: requestForm.riskTolerance,
        fundingSource: requestForm.fundingSource,
        expectedInitialFunding: requestForm.expectedInitialFunding,
        jurisdiction: requestForm.jurisdiction,
        additionalNotes: requestForm.additionalNotes.trim() || undefined,
        clientDeclarationAccepted: true,
      },
      {
        onSuccess: (created: any) => {
          setIsOpen(false);
          setRequestForm(INITIAL_FORM_STATE);
          setFeedback({
            title: 'Application Submitted',
            message: `Reference #AR-${created.id} (${created.accountType}) is pending review.`,
            type: 'success',
          });
        },
        onError: (err: any) => {
          toast({
            title: 'Submission Failed',
            description: err.message || 'Unable to submit account opening request.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const grouped = (Object.keys(CATEGORY_META) as (keyof typeof CATEGORY_META)[]).map(cat => ({
    cat,
    items: (accounts || []).filter(a => categoryOf(a.accountType) === cat),
  })).filter(g => g.items.length > 0);

  return (
    <LayoutShell>

      {/* Feedback dialog */}
      <Dialog open={!!feedback} onOpenChange={o => !o && setFeedback(null)}>
        <DialogContent className="sm:max-w-sm border-slate-200 dark:border-border bg-white dark:bg-card text-slate-900 dark:text-foreground">
          <DialogHeader className="flex flex-col items-center gap-4 py-4">
            {feedback?.type === 'success'
              ? <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center border border-emerald-200 dark:border-emerald-800/40"><CheckCircle2 className="w-6 h-6 text-emerald-700 dark:text-emerald-400" /></div>
              : <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center border border-rose-200 dark:border-rose-800/40"><AlertCircle className="w-6 h-6 text-rose-700 dark:text-rose-400" /></div>
            }
            <DialogTitle className="text-xl font-serif text-center">{feedback?.title}</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-muted-foreground text-center text-sm leading-relaxed">{feedback?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center pt-1">
            <Button onClick={() => setFeedback(null)} className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md px-8">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open Account Form Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto bg-white dark:bg-card border-slate-200 dark:border-border text-slate-900 dark:text-foreground">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-slate-900 dark:text-foreground flex items-center gap-2">
              Open Account
              <InfoTip
                label="Account opening review details"
                content="Additional accounts undergo compliance and administrative review before provisioning."
              />
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-muted-foreground">
              Submit an account application for administrative review.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRequest} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="req-account-type" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Account Type
                </label>
                <Select
                  value={requestForm.accountType}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, accountType: v as AccountType }))}
                >
                  <SelectTrigger id="req-account-type" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background" data-testid="select-request-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPE_OPTIONS.map(group => (
                      <div key={group.group}>
                        <p className="px-2 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">{group.group}</p>
                        {group.items.map(item => (
                          <SelectItem key={item} value={item}>{item}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-display-name" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Nickname <span className="text-slate-400 dark:text-muted-foreground/70">(optional)</span>
                </label>
                <Input
                  id="req-display-name"
                  name="requestedDisplayName"
                  maxLength={80}
                  value={requestForm.requestedDisplayName}
                  onChange={e => setRequestForm(f => ({ ...f, requestedDisplayName: e.target.value }))}
                  placeholder="e.g. Family Trust"
                  className="rounded-md h-10 border-slate-200 dark:border-border"
                  data-testid="input-request-display-name"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-ownership-structure" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Ownership
                </label>
                <Select
                  value={requestForm.ownershipStructure}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, ownershipStructure: v }))}
                >
                  <SelectTrigger id="req-ownership-structure" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OWNERSHIP_STRUCTURES.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-jurisdiction" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Jurisdiction
                </label>
                <Select
                  value={requestForm.jurisdiction}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, jurisdiction: v }))}
                >
                  <SelectTrigger id="req-jurisdiction" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JURISDICTIONS.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-investment-objective" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Objective
                </label>
                <Select
                  value={requestForm.investmentObjective}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, investmentObjective: v }))}
                >
                  <SelectTrigger id="req-investment-objective" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVESTMENT_OBJECTIVES.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-risk-tolerance" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Risk Level
                </label>
                <Select
                  value={requestForm.riskTolerance}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, riskTolerance: v }))}
                >
                  <SelectTrigger id="req-risk-tolerance" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_TOLERANCES.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-funding-source" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Funding Source
                </label>
                <Select
                  value={requestForm.fundingSource}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, fundingSource: v }))}
                >
                  <SelectTrigger id="req-funding-source" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNDING_SOURCES.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-initial-funding" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                  Initial Funding
                </label>
                <Select
                  value={requestForm.expectedInitialFunding}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, expectedInitialFunding: v }))}
                >
                  <SelectTrigger id="req-initial-funding" className="rounded-md h-10 border-slate-200 dark:border-border bg-white dark:bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INITIAL_FUNDING_TIERS.map(item => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="req-additional-notes" className="text-xs font-medium text-slate-600 dark:text-muted-foreground block">
                Notes <span className="text-slate-400 dark:text-muted-foreground/70">(optional)</span>
              </label>
              <Textarea
                id="req-additional-notes"
                name="additionalNotes"
                maxLength={1000}
                value={requestForm.additionalNotes}
                onChange={e => setRequestForm(f => ({ ...f, additionalNotes: e.target.value }))}
                placeholder="Optional advisor instructions"
                className="rounded-md border-slate-200 dark:border-border min-h-[72px] resize-none"
                data-testid="input-request-notes"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-border bg-slate-50/75 dark:bg-muted/20 px-3.5 py-2.5 text-xs text-slate-700 dark:text-foreground">
              <label htmlFor="req-client-declaration" className="flex items-center gap-2.5 cursor-pointer">
                <input
                  id="req-client-declaration"
                  name="clientDeclarationAccepted"
                  type="checkbox"
                  checked={requestForm.clientDeclarationAccepted}
                  onChange={e => setRequestForm(f => ({ ...f, clientDeclarationAccepted: e.target.checked }))}
                  className="shrink-0"
                  data-testid="checkbox-request-attestation"
                />
                <span>Confirm application details</span>
              </label>
              <InfoTip
                label="Account opening attestation"
                content="I confirm the mandate and funding information above is accurate and acknowledge that this account will only be provisioned after compliance and administrative approval."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="rounded-md border-slate-200 dark:border-border" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createAccountRequest.isPending || !requestForm.clientDeclarationAccepted}
                className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md font-medium whitespace-nowrap shrink-0"
                data-testid="button-submit-account-request"
              >
                {createAccountRequest.isPending ? 'Submitting…' : 'Open Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div className="px-0.5">
        <h1 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
          Accounts &amp; Custody
        </h1>
        <p className="text-xs text-slate-500 dark:text-muted-foreground mt-1">
          Overview of your funded balances, holdings, and account applications
        </p>
      </div>

      {/* ── Portfolio Summary Header (Crisp White Private Bank) ───── */}
      <section
        data-testid="accounts-summary-panel"
        aria-label="Accounts summary"
        className="bg-white dark:bg-card border border-slate-200/90 dark:border-border border-t-2 border-t-[#C6A15B]/80 rounded-lg shadow-xs overflow-hidden [container-type:inline-size]"
      >
        <div className="px-5 sm:px-7 py-5 sm:py-6 border-b border-slate-100 dark:border-border">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1.5">Total balance</p>
              <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-1">
                <span
                  className={cn(
                    "min-w-0 max-w-full whitespace-nowrap font-sans font-semibold tabular-nums [font-size:clamp(1.6rem,4.5cqi,2.75rem)] tracking-tight leading-none",
                    isTransmitting ? "text-violet-700 dark:text-violet-300" : "text-slate-900 dark:text-foreground"
                  )}
                  data-testid="text-total-balance"
                >
                  {balanceLoading ? "Loading…" : balanceUnavailable ? "Unavailable" : fmt(totalBalance)}
                </span>
              </div>
              {isTransmitting && (
                <p className="text-violet-700 dark:text-violet-300 text-xs mt-2 font-medium">
                  Funds in transit to {activeTransfer?.institutionName}
                </p>
              )}
              {!balanceLoading && balanceUnavailable && (
                <p role="alert" className="text-rose-700 dark:text-rose-400 text-xs mt-2">
                  Current balances could not be loaded.
                  <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={retryBalances}>Retry</button>
                </p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2.5 xl:w-auto xl:mt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHideBalances(h => !h)}
                className="min-h-9 rounded-md border-slate-200 dark:border-border bg-white dark:bg-card text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-muted text-xs gap-1.5 whitespace-nowrap shrink-0"
                data-testid="button-toggle-balances"
              >
                {hideBalances ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {hideBalances ? 'Show' : 'Hide'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={needsInitialDeposit}
                onClick={() => setIsOpen(true)}
                className="min-h-9 bg-[#0B2218] hover:bg-[#133526] text-white rounded-md text-xs font-medium gap-1.5 whitespace-nowrap shrink-0"
                data-testid="button-request-account"
              >
                <Plus className="w-3.5 h-3.5" /> Open Account
              </Button>
            </div>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="bg-slate-50/70 dark:bg-muted/20 grid grid-cols-1 divide-y divide-slate-200/80 dark:divide-border xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          {[
            { cat: 'cash', label: 'Cash balances', value: cashTotal, Icon: Landmark, sub: 'Across your accounts', loading: isLoading, unavailable: cashUnavailable },
            { cat: 'investment', label: 'Recorded investments', value: investTotal, Icon: TrendingUp, sub: 'Holdings only', loading: investmentsLoading, unavailable: investmentsUnavailable },
          ].map(({ cat, label, value, Icon, sub, loading, unavailable }) => (
            <div key={label} data-testid={`account-summary-${cat}`} className="flex items-center justify-between gap-4 px-5 py-4 xl:block xl:px-7 xl:py-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 xl:mb-1">
                  <Icon className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-muted-foreground" />
                  <span className="text-slate-600 dark:text-muted-foreground text-xs font-medium">{label}</span>
                </div>
                <p className="hidden text-slate-500 dark:text-muted-foreground/80 text-[11px] xl:block">{sub}</p>
              </div>
              <p
                data-testid={`account-summary-balance-${cat}`}
                className="whitespace-nowrap font-sans font-semibold text-base xl:text-xl text-slate-900 dark:text-foreground tracking-tight tabular-nums xl:mt-1"
              >
                {loading ? "Loading…" : unavailable ? "Unavailable" : fmt(value)}
              </p>
              <p className="sr-only sm:hidden">{sub}</p>
            </div>
          ))}
        </div>

        <div className="accounts-debt-summary border-t border-slate-200/80 dark:border-border [&>section]:border-0 [&>section]:rounded-none [&>section]:shadow-none [&>section]:bg-transparent [&>section>div.border-b]:hidden">
          <DebtAccountSummary
            summary={feeSummary.data}
            accounts={accounts}
            variant="accounts"
            loading={feeSummary.isLoading || isLoading}
            error={feeSummary.isError || accountsError}
            retry={() => { void feeSummary.refetch(); void refetchAccounts(); }}
            hidden={hideBalances}
            currency={currency}
          />
        </div>
      </section>

      {/* ── Activation Notice (only when initial deposit required/pending) ── */}
      {needsInitialDeposit && (
        <div
          className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
          data-testid="accounts-activation-notice"
        >
          <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-foreground">
            <Lock className="w-3.5 h-3.5 text-[#0B2218] dark:text-primary shrink-0" />
            <span>
              {initialDepositPending
                ? "Initial deposit pending review — additional accounts unlock after verification."
                : "Complete your initial deposit to unlock additional accounts."}
            </span>
            <InfoTip
              label="Account activation notice"
              content="Your primary brokerage account is ready to receive your initial deposit. Once an administrator verifies it, opening additional accounts will unlock."
            />
          </div>
          <Button
            size="sm"
            onClick={() => setLocation("/transfers?tab=deposit")}
            className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md text-xs whitespace-nowrap shrink-0"
          >
            {initialDepositPending ? "View Deposit" : "Make Initial Deposit"}
          </Button>
        </div>
      )}

      {/* ── Transfer Lock Banner ──────────────────────────────────── */}
      {activeTransfer && (
        <div className={cn(
          "rounded-lg border px-5 py-4 flex items-start gap-3.5 shadow-xs",
          isTransmitting ? "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800/40"
          : isLocked     ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/40"
          :                "bg-white border-slate-200/90 dark:bg-card dark:border-border"
        )}>
          <div className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5",
            isTransmitting ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
              : isLocked ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              : "bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground"
          )}>
            {isTransmitting
              ? <Building2 className="w-4 h-4" />
              : isLocked
              ? <Lock className="w-4 h-4" />
              : <Building2 className="w-4 h-4" />
            }
          </div>
          <div className="flex-1">
            <p className={cn(
              "text-xs font-semibold mb-1",
              isTransmitting ? "text-violet-900 dark:text-violet-300" : isLocked ? "text-amber-900 dark:text-amber-300" : "text-slate-900 dark:text-foreground"
            )}>
              {isTransmitting
                ? "Portfolio Transmission in Progress"
                : isLocked
                ? "Accounts Locked — Portfolio Liquidating"
                : xferStage === 1 ? "Transfer Under Advisor Review" : "Transfer Pending Advisor Review"
              }
            </p>
            <p className={cn(
              "text-xs leading-relaxed",
              isTransmitting ? "text-violet-800/85 dark:text-violet-200/85" : isLocked ? "text-amber-800/85 dark:text-amber-200/85" : "text-slate-600 dark:text-muted-foreground"
            )}>
              {isTransmitting
                ? <>Your liquidated portfolio is being transmitted to <strong>{activeTransfer.institutionName}</strong>. Balances below reflect the pre-transfer holdings and will clear upon custodian confirmation.</>
                : isLocked
                ? <>Holdings are being liquidated for transfer. All accounts are read-only. Your portfolio is in transit to <strong>{activeTransfer.institutionName}</strong>.</>
                : <>Your transfer request to <strong>{activeTransfer.institutionName}</strong> is {xferStage === 1 ? "under advisor review" : "pending review"}. Accounts remain fully accessible until approved.</>
              }
            </p>
          </div>
        </div>
      )}

      {/* ── Account Groups ─────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-white dark:bg-card border border-slate-200/80 dark:border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : cashUnavailable ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
          Account balances could not be loaded. <button type="button" className="ml-2 font-medium underline" onClick={() => void refetchAccounts()}>Retry</button>
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ cat, items }) => {
            const { label, Icon, color } = CATEGORY_META[cat as keyof typeof CATEGORY_META];
            return (
              <section
                key={cat}
                data-testid={`account-group-${cat}`}
                className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg shadow-xs overflow-hidden"
              >
                <div className="bg-slate-50/70 dark:bg-muted/20 px-5 py-3 border-b border-slate-100 dark:border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-4 h-4', color)} />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">{label}</h2>
                    <span className="text-xs text-slate-500 dark:text-muted-foreground font-mono">· {items.length}</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-border/50">
                  {items.map((account) => {
                    const isPending = account.id === primaryAccount?.id && pendingBalance !== 0;
                    const unpaidFees = Number(feeSummary.data?.accounts.find(item => item.accountId === account.id)?.unpaidTotal || 0);
                    return (
                      <div
                        key={account.id}
                        role="link"
                        tabIndex={0}
                        className="grid grid-cols-1 gap-2 items-center py-4 px-5 hover:bg-slate-50/80 dark:hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors cursor-pointer group xl:grid-cols-[1fr_auto] xl:gap-4"
                        onClick={() => setLocation(`/accounts/${account.id}`)}
                        onKeyDown={event => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setLocation(`/accounts/${account.id}`);
                          }
                        }}
                        data-testid={`account-row-${account.id}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-foreground [overflow-wrap:anywhere]">{accountLabel(account)}</p>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                            <span className="font-mono">{maskAccountNumber(account.accountNumber)}</span>
                            {isPending && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-800 dark:text-amber-300 font-medium">
                                  Pending: {fmt(Math.abs(pendingBalance))}
                                </span>
                              </>
                            )}
                            {isTransmitting && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-violet-700 dark:text-violet-300 font-medium">Transmitting</span>
                              </>
                            )}
                            {isLocked && !isTransmitting && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-800 dark:text-amber-300 font-medium">Liquidating</span>
                              </>
                            )}
                            {!isLocked && activeTransfer && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-700 dark:text-foreground font-medium">
                                  {xferStage === 1 ? "Under Review" : "Transfer Pending"}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex min-w-0 items-center justify-between gap-3 xl:justify-end xl:gap-4 xl:shrink-0">
                          <div className="min-w-0 text-right xl:min-w-[140px]">
                            <p
                              className={cn(
                                "whitespace-nowrap font-sans text-base font-semibold tabular-nums",
                                Number(account.balance) < 0 ? "text-rose-700 dark:text-rose-400" : isTransmitting ? "text-violet-700 dark:text-violet-300" : "text-slate-900 dark:text-foreground"
                              )}
                              data-testid={`balance-${account.id}`}
                            >
                              {fmt(Number(account.balance))}
                            </p>
                            {unpaidFees > 0 && (
                              <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                                Unpaid fees <span className="font-sans font-medium tabular-nums" data-testid={`account-unpaid-fees-${account.id}`}>{fmt(unpaidFees)}</span>
                              </p>
                            )}
                          </div>

                          <ChevronRight className="w-4 h-4 shrink-0 text-slate-300 dark:text-muted-foreground/40 group-hover:text-[#0B2218] dark:group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ── Account Opening Requests Tracker ───────────────────────── */}
      <section
        className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg shadow-xs overflow-hidden"
        data-testid="account-opening-requests-section"
      >
        <div className="bg-slate-50/70 dark:bg-muted/20 px-5 py-3 border-b border-slate-100 dark:border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500 dark:text-muted-foreground" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">Account Requests</h2>
            {accountRequests && (
              <span className="text-xs text-slate-500 dark:text-muted-foreground font-mono">· {accountRequests.length}</span>
            )}
            <InfoTip
              label="Account requests status"
              content="New account applications appear here while under administrative review."
            />
          </div>
          {!needsInitialDeposit && (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="text-xs font-medium text-[#0B2218] dark:text-primary hover:underline whitespace-nowrap shrink-0"
            >
              + Open Account
            </button>
          )}
        </div>

        {requestsLoading ? (
          <div className="px-5 py-5 text-xs text-muted-foreground">Loading…</div>
        ) : !accountRequests || accountRequests.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-muted-foreground">
            No account requests yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-border/50">
            {accountRequests.map((reqItem) => {
              const statusTone =
                reqItem.status === "approved"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : reqItem.status === "rejected"
                    ? "text-rose-700 dark:text-rose-400"
                    : "text-amber-700 dark:text-amber-400";
              const statusLabel =
                reqItem.status === "approved"
                  ? "Approved"
                  : reqItem.status === "rejected"
                    ? "Declined"
                    : "Pending Review";
              return (
                <div
                  key={reqItem.id}
                  className="py-4 px-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                  data-testid={`account-request-row-${reqItem.id}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-xs text-slate-500 dark:text-muted-foreground">AR-{reqItem.id}</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-foreground">
                        {reqItem.requestedDisplayName || reqItem.accountType}
                      </span>
                      {reqItem.requestedDisplayName && (
                        <span className="text-xs text-slate-500 dark:text-muted-foreground">({reqItem.accountType})</span>
                      )}
                      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap", statusTone)}>
                        {reqItem.status === "pending" && <Clock className="w-3 h-3" />}
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-muted-foreground">
                      {reqItem.ownershipStructure} · {reqItem.investmentObjective} · {reqItem.riskTolerance} risk · {reqItem.expectedInitialFunding} ({reqItem.fundingSource}) · {reqItem.jurisdiction}
                    </p>
                    {reqItem.createdAccountNumber && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 font-mono">
                        Provisioned Account: {maskAccountNumber(reqItem.createdAccountNumber)}
                      </p>
                    )}
                    {reqItem.adminNotes && (
                      <p className="text-xs text-slate-600 dark:text-foreground/80">
                        Review Note: {reqItem.adminNotes}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-muted-foreground font-mono whitespace-nowrap shrink-0">
                    {new Date(reqItem.createdAt).toLocaleDateString("en-CA")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Footer note ─────────────────────────────────────────────── */}
      <div className="pt-2 pb-1 text-xs text-slate-400 dark:text-muted-foreground/60">
        <span>Veritas Wealth</span>
      </div>

    </LayoutShell>
  );
}
