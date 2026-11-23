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

type AccountType = 'Brokerage Account' | 'Traditional IRA' | 'Roth IRA' |
  '401(k) / 403(b)' | '529 Savings Plan' | 'Trust Account';

function categoryOf(type: string): keyof typeof CATEGORY_META {
  if (type === 'Trust Account') return 'business';
  return 'investment';
}

const CATEGORY_META = {
  cash:       { label: 'Cash & Deposits',        Icon: Landmark,   color: 'text-sky-800 dark:text-sky-300' },
  investment: { label: 'Brokerage & Retirement', Icon: TrendingUp, color: 'text-emerald-800 dark:text-emerald-300' },
  business:   { label: 'Business & Trust',        Icon: Briefcase,  color: 'text-amber-800 dark:text-amber-300' },
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
            title: 'Account Request Submitted',
            message: `Your request (#AR-${created.id}) to establish a ${created.accountType} has been logged for compliance and administrative review. Once approved, your new account number will appear in your portfolio.`,
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
        <DialogContent className="sm:max-w-sm border-primary/20 bg-zinc-950 text-white">
          <DialogHeader className="flex flex-col items-center gap-4 py-4">
            {feedback?.type === 'success'
              ? <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40"><CheckCircle2 className="w-7 h-7 text-emerald-400" /></div>
              : <div className="w-14 h-14 rounded-full bg-rose-500/20 flex items-center justify-center border border-rose-500/40"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
            }
            <DialogTitle className="text-lg font-serif text-center">{feedback?.title}</DialogTitle>
            <DialogDescription className="text-zinc-400 text-center text-sm leading-relaxed">{feedback?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center pt-2">
            <Button onClick={() => setFeedback(null)} className="bg-primary hover:bg-primary/90 text-white rounded-sm px-8">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Opening Request Form Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto bg-[#0B2218] wealth-panel border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-white">Account Opening Request</DialogTitle>
            <DialogDescription className="text-white/60 text-xs leading-relaxed">
              Submit a formal request to establish an additional investment or fiduciary account. All new accounts undergo institutional suitability and compliance review prior to activation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRequest} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="req-account-type" className="label-caps text-white/60 block">
                  Account Type
                </label>
                <Select
                  value={requestForm.accountType}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, accountType: v as AccountType }))}
                >
                  <SelectTrigger id="req-account-type" className="bg-white/5 border-white/15 text-white rounded-sm h-10" data-testid="select-request-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {ACCOUNT_TYPE_OPTIONS.map(group => (
                      <div key={group.group}>
                        <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/40 font-semibold">{group.group}</p>
                        {group.items.map(item => (
                          <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-display-name" className="label-caps text-white/60 block">
                  Account Designation <span className="normal-case text-white/40">(optional)</span>
                </label>
                <Input
                  id="req-display-name"
                  name="requestedDisplayName"
                  maxLength={80}
                  value={requestForm.requestedDisplayName}
                  onChange={e => setRequestForm(f => ({ ...f, requestedDisplayName: e.target.value }))}
                  placeholder="e.g. Family Education Trust"
                  className="bg-white/5 border-white/15 text-white placeholder:text-white/30 rounded-sm h-10"
                  data-testid="input-request-display-name"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-ownership-structure" className="label-caps text-white/60 block">
                  Ownership Structure
                </label>
                <Select
                  value={requestForm.ownershipStructure}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, ownershipStructure: v }))}
                >
                  <SelectTrigger id="req-ownership-structure" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {OWNERSHIP_STRUCTURES.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-jurisdiction" className="label-caps text-white/60 block">
                  Tax Residency / Jurisdiction
                </label>
                <Select
                  value={requestForm.jurisdiction}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, jurisdiction: v }))}
                >
                  <SelectTrigger id="req-jurisdiction" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {JURISDICTIONS.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-investment-objective" className="label-caps text-white/60 block">
                  Investment Objective
                </label>
                <Select
                  value={requestForm.investmentObjective}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, investmentObjective: v }))}
                >
                  <SelectTrigger id="req-investment-objective" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {INVESTMENT_OBJECTIVES.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-risk-tolerance" className="label-caps text-white/60 block">
                  Risk Tolerance
                </label>
                <Select
                  value={requestForm.riskTolerance}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, riskTolerance: v }))}
                >
                  <SelectTrigger id="req-risk-tolerance" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {RISK_TOLERANCES.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-funding-source" className="label-caps text-white/60 block">
                  Anticipated Funding Source
                </label>
                <Select
                  value={requestForm.fundingSource}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, fundingSource: v }))}
                >
                  <SelectTrigger id="req-funding-source" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {FUNDING_SOURCES.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-initial-funding" className="label-caps text-white/60 block">
                  Expected Initial Funding
                </label>
                <Select
                  value={requestForm.expectedInitialFunding}
                  onValueChange={(v) => setRequestForm(f => ({ ...f, expectedInitialFunding: v }))}
                >
                  <SelectTrigger id="req-initial-funding" className="bg-white/5 border-white/15 text-white rounded-sm h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0B2218] wealth-panel border-white/10 text-white">
                    {INITIAL_FUNDING_TIERS.map(item => (
                      <SelectItem key={item} value={item} className="text-white/85 focus:bg-white/10 focus:text-white rounded-sm">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="req-additional-notes" className="label-caps text-white/60 block">
                Instructions / Advisor Context <span className="normal-case text-white/40">(optional)</span>
              </label>
              <Textarea
                id="req-additional-notes"
                name="additionalNotes"
                maxLength={1000}
                value={requestForm.additionalNotes}
                onChange={e => setRequestForm(f => ({ ...f, additionalNotes: e.target.value }))}
                placeholder="Provide beneficiary details, rollover institution notes, or mandate instructions for your advisor."
                className="bg-white/5 border-white/15 text-white placeholder:text-white/30 rounded-sm min-h-[84px] resize-none"
                data-testid="input-request-notes"
              />
            </div>

            <label
              htmlFor="req-client-declaration"
              className="flex items-start gap-3 rounded-sm border border-white/15 bg-white/5 p-3 text-xs text-white/80 cursor-pointer"
            >
              <input
                id="req-client-declaration"
                name="clientDeclarationAccepted"
                type="checkbox"
                checked={requestForm.clientDeclarationAccepted}
                onChange={e => setRequestForm(f => ({ ...f, clientDeclarationAccepted: e.target.checked }))}
                className="mt-0.5 shrink-0"
                data-testid="checkbox-request-attestation"
              />
              <span className="leading-relaxed">
                I confirm the mandate and funding information above is accurate and acknowledge that this account will only be provisioned after compliance and administrative approval.
              </span>
            </label>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" className="text-white/50 hover:text-white" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createAccountRequest.isPending || !requestForm.clientDeclarationAccepted}
                className="bg-white text-[#0B2218] hover:bg-white/90 rounded-sm font-semibold whitespace-nowrap shrink-0"
                data-testid="button-submit-account-request"
              >
                {createAccountRequest.isPending ? 'Submitting Request…' : 'Submit Account Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Portfolio Summary Header ──────────────────────────────── */}
      <div data-testid="accounts-summary-panel" className="bg-[#0B2218] wealth-panel rounded-sm overflow-hidden [container-type:inline-size]">
        <div className="px-4 py-5 xl:px-8 xl:pt-8 xl:pb-6 border-b border-white/10">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
            <div className="min-w-0">
              <p className="label-caps text-white/40 mb-2">Total balance</p>
              <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-1">
                <span className={`min-w-0 max-w-full whitespace-nowrap font-sans font-bold not-italic tabular-nums [font-size:clamp(1.25rem,6cqi,3rem)] tracking-tight ${isTransmitting ? "text-violet-300" : "text-white"}`} data-testid="text-total-balance">
                  {balanceLoading ? "Loading…" : balanceUnavailable ? "Unavailable" : fmt(totalBalance)}
                </span>
              </div>
              {isTransmitting && <p className="text-violet-300/60 text-xs mt-1.5 font-mono">Funds in transit to {activeTransfer?.institutionName}</p>}
              {!balanceLoading && balanceUnavailable && <p role="alert" className="text-red-300 text-xs mt-2">
                Current balances could not be loaded.
                <button className="ml-2 underline" onClick={retryBalances}>Retry</button>
              </p>}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto xl:mt-1">
              <button
                onClick={() => setHideBalances(h => !h)}
                className="flex min-h-10 items-center gap-1.5 px-2 text-white/50 hover:text-white/80 transition-colors text-xs uppercase tracking-widest whitespace-nowrap shrink-0"
                data-testid="button-toggle-balances"
              >
                {hideBalances ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {hideBalances ? 'Show' : 'Hide'}
              </button>
              <div className="w-px h-4 bg-white/10" />
              <Button
                size="sm"
                onClick={() => setLocation("/transfers?tab=deposit")}
                className="min-h-10 bg-primary hover:bg-primary/90 text-white rounded-sm text-xs gap-1.5 whitespace-nowrap shrink-0"
                data-testid="button-initiate-deposit-accounts"
              >
                <Landmark className="w-3 h-3" /> Initiate Deposit
              </Button>
              <Button
                size="sm"
                onClick={() => setIsOpen(true)}
                className="min-h-10 bg-white/10 hover:bg-white/20 text-white border border-white/10 rounded-sm text-xs gap-1.5 whitespace-nowrap shrink-0"
                data-testid="button-request-account"
              >
                <Plus className="w-3 h-3" /> Request Account
              </Button>
            </div>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="grid grid-cols-1 divide-y divide-white/10 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          {[
            { cat: 'cash', label: 'Cash balances', value: cashTotal, Icon: Landmark, sub: 'Across your accounts', loading: isLoading, unavailable: cashUnavailable },
            { cat: 'investment', label: 'Recorded investments', value: investTotal, Icon: TrendingUp, sub: 'Holdings only', loading: investmentsLoading, unavailable: investmentsUnavailable },
          ].map(({ cat, label, value, Icon, sub, loading, unavailable }) => (
            <div key={label} data-testid={`account-summary-${cat}`} className="flex items-center justify-between gap-4 px-4 py-3 xl:block xl:px-6 xl:py-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 sm:mb-2">
                  <Icon className="w-3.5 h-3.5 shrink-0 text-white/30" />
                  <span className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">{label}</span>
                </div>
                <p className="hidden text-white/25 text-[10px] mt-0.5 xl:block">{sub}</p>
              </div>
              <p data-testid={`account-summary-balance-${cat}`} className="whitespace-nowrap font-sans font-bold text-sm xl:text-xl text-amber-300 tracking-tight tabular-nums">{loading ? "Loading…" : unavailable ? "Unavailable" : fmt(value)}</p>
              <p className="sr-only sm:hidden">{sub}</p>
            </div>
          ))}
        </div>

        <div className="accounts-debt-summary border-t border-white/10">
          <style>{`
            .accounts-debt-summary > section {
              border: 0 !important;
              border-radius: 0 !important;
              background: transparent !important;
              color: rgba(255, 255, 255, 0.92);
            }
            .accounts-debt-summary h2 {
              display: none !important;
            }
            .accounts-debt-summary > section > div.border-b {
              display: none !important;
            }
            .accounts-debt-summary article {
              grid-template-columns: minmax(0, 1fr) auto;
              align-items: center;
              padding: 0.75rem 1rem;
            }
            .accounts-debt-summary article + article {
              border-color: rgba(255, 255, 255, 0.1) !important;
            }
            .accounts-debt-summary article [data-testid^="debt-account-amount-"] {
              color: #fff !important;
              font-family: "DM Sans", sans-serif !important;
              font-style: normal !important;
              font-size: 1rem !important;
              font-weight: 700 !important;
              letter-spacing: -0.025em;
              font-variant-numeric: tabular-nums;
              white-space: nowrap !important;
            }
            .accounts-debt-summary .text-muted-foreground {
              color: rgba(255, 255, 255, 0.68) !important;
            }
            .accounts-debt-summary [role="alert"] {
              color: rgba(255, 255, 255, 0.88) !important;
            }
            .accounts-debt-summary [role="alert"] button {
              color: #f3d58a !important;
            }
            .accounts-debt-summary [role="status"] > div {
              background-color: rgba(255, 255, 255, 0.12) !important;
            }
          `}</style>
          <DebtAccountSummary summary={feeSummary.data} accounts={accounts} variant="accounts" loading={feeSummary.isLoading || isLoading}
            error={feeSummary.isError || accountsError} retry={() => { void feeSummary.refetch(); void refetchAccounts(); }}
            hidden={hideBalances} currency={currency} />
        </div>
      </div>

      {/* ── Transfer Lock Banner ──────────────────────────────────── */}
      {activeTransfer && (
        <div className={cn(
          "rounded-sm border px-4 py-3 flex items-start gap-3 mt-2",
          isTransmitting ? "bg-violet-950/30 border-violet-500/20"
          : isLocked     ? "bg-amber-950/30 border-amber-500/20"
          :                "bg-primary/5 border-primary/15"
        )}>
          <div className={cn(
            "w-8 h-8 rounded-sm flex items-center justify-center shrink-0 mt-0.5",
            isTransmitting ? "bg-violet-500/15" : isLocked ? "bg-amber-500/15" : "bg-primary/15"
          )}>
            {isTransmitting
              ? <Building2 className="w-4 h-4 text-violet-400" />
              : isLocked
              ? <Lock className="w-4 h-4 text-amber-400" />
              : <Building2 className="w-4 h-4 text-primary/60" />
            }
          </div>
          <div className="flex-1">
            <p className={cn(
              "text-xs font-bold uppercase tracking-widest mb-0.5",
              isTransmitting ? "text-violet-400" : isLocked ? "text-amber-400" : "text-primary"
            )}>
              {isTransmitting
                ? "Portfolio Transmission in Progress"
                : isLocked
                ? "Accounts Locked — Portfolio Liquidating"
                : xferStage === 1 ? "Transfer Under Advisor Review" : "Transfer Pending Advisor Review"
              }
            </p>
            <p className={cn("text-xs leading-relaxed", isTransmitting || isLocked ? "text-white/90" : "text-foreground/80")}>
              {isTransmitting
                ? <>Your liquidated portfolio is being transmitted to <strong className={isTransmitting || isLocked ? "text-white" : "text-foreground"}>{activeTransfer.institutionName}</strong>. Balances below reflect the pre-transfer holdings and will clear upon custodian confirmation.</>
                : isLocked
                ? <>Holdings are being liquidated for transfer. All accounts are read-only. Your portfolio is in transit to <strong className={isTransmitting || isLocked ? "text-white" : "text-foreground"}>{activeTransfer.institutionName}</strong>.</>
                : <>Your transfer request to <strong className={isTransmitting || isLocked ? "text-white" : "text-foreground"}>{activeTransfer.institutionName}</strong> is {xferStage === 1 ? "under advisor review" : "pending review"}. Accounts remain fully accessible until approved.</>
              }
            </p>
          </div>
        </div>
      )}

      {/* ── Account Groups ─────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2 mt-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-muted/40 rounded-sm" />
          ))}
        </div>
      ) : cashUnavailable ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Account balances could not be loaded. <button className="underline" onClick={() => void refetchAccounts()}>Retry</button>
        </p>
      ) : (
        <div className="space-y-6 mt-2">
          {grouped.map(({ cat, items }) => {
            const { label, Icon, color } = CATEGORY_META[cat as keyof typeof CATEGORY_META];
            return (
              <div key={cat} data-testid={`account-group-${cat}`}>
                <div className="flex flex-col gap-1 mb-1 pb-2 border-b border-border sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-3.5 h-3.5', color)} />
                    <span className="label-caps text-muted-foreground">{label}</span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono ml-1">({items.length})</span>
                  </div>
                </div>

                <div className="divide-y divide-border/50">
                  {items.map((account) => {
                    const isPending = account.id === primaryAccount?.id && pendingBalance !== 0;
                    const unpaidFees = Number(feeSummary.data?.accounts.find(item => item.accountId === account.id)?.unpaidTotal || 0);
                    return (
                      <div
                        key={account.id}
                        role="link"
                        tabIndex={0}
                        className="grid grid-cols-1 gap-2 items-center py-4 px-1 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors cursor-pointer group xl:grid-cols-[1fr_auto] xl:gap-4"
                        onClick={() => setLocation(`/accounts/${account.id}`)}
                        onKeyDown={event => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setLocation(`/accounts/${account.id}`);
                          }
                        }}
                        data-testid={`account-row-${account.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 xl:gap-4">
                          <div className={cn(
                            'w-9 h-9 rounded-sm flex items-center justify-center shrink-0',
                            cat === 'investment' ? 'bg-emerald-500/10' :
                            cat === 'business'   ? 'bg-amber-500/10' : 'bg-sky-500/10'
                          )}>
                            <Icon className={cn('w-4 h-4', color)} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{accountLabel(account)}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                              <span className="font-mono text-[10px] text-muted-foreground">{maskAccountNumber(account.accountNumber)}</span>
                              {isPending && (
                                <span className="text-[9px] text-amber-800 dark:text-amber-300 font-bold uppercase tracking-wide bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-sm border border-amber-200 dark:border-amber-800/40">
                                  Pending: {fmt(Math.abs(pendingBalance))}
                                </span>
                              )}
                              {isTransmitting && (
                                <span className="flex items-center gap-1 text-[9px] text-violet-400 font-bold uppercase tracking-wide bg-violet-500/10 px-1.5 py-0.5 rounded-sm border border-violet-500/20">
                                  <Building2 className="w-2.5 h-2.5" /> Transmitting
                                </span>
                              )}
                              {isLocked && !isTransmitting && (
                                <span className="flex items-center gap-1 text-[9px] text-amber-800 dark:text-amber-300 font-bold uppercase tracking-wide bg-amber-500/10 px-1.5 py-0.5 rounded-sm border border-amber-500/20">
                                  <Lock className="w-2.5 h-2.5" /> Liquidating
                                </span>
                              )}
                              {!isLocked && activeTransfer && (
                                <span className="text-[9px] text-primary/60 font-bold uppercase tracking-wide bg-primary/5 px-1.5 py-0.5 rounded-sm border border-primary/15">
                                  {xferStage === 1 ? "Under Review" : "Transfer Pending"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex min-w-0 items-center justify-between gap-3 xl:justify-end xl:gap-4 xl:shrink-0">
                          <div className="min-w-0 text-right xl:min-w-[140px]">
                            <p className={cn("whitespace-nowrap font-mono text-[clamp(.82rem,4vw,1rem)] font-semibold tabular-nums xl:text-base", Number(account.balance) < 0 ? "text-red-700 dark:text-red-300" : isTransmitting ? "text-violet-400" : "text-foreground")} data-testid={`balance-${account.id}`}>
                              {fmt(Number(account.balance))}
                            </p>
                            {unpaidFees > 0 && <p className="mt-1 text-xs text-rose-800 dark:text-rose-300">
                              Unpaid fees <span className="font-mono tabular-nums" data-testid={`account-unpaid-fees-${account.id}`}>{fmt(unpaidFees)}</span>
                            </p>}
                          </div>

                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Account Opening Requests Tracker ───────────────────────── */}
      <div className="mt-8" data-testid="account-opening-requests-section">
        <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span className="label-caps text-muted-foreground">Account Opening Requests</span>
            {accountRequests && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">({accountRequests.length})</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
          >
            + Submit Request
          </button>
        </div>

        {requestsLoading ? (
          <div className="py-4 text-xs text-muted-foreground">Loading account opening requests…</div>
        ) : !accountRequests || accountRequests.length === 0 ? (
          <div className="py-6 text-xs text-muted-foreground">
            No additional account opening requests submitted. Use <strong>Request Account</strong> above to apply for a new investment or fiduciary mandate.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {accountRequests.map((reqItem) => {
              const statusStyle =
                reqItem.status === "approved"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : reqItem.status === "rejected"
                    ? "border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
              const statusLabel =
                reqItem.status === "approved"
                  ? "Approved"
                  : reqItem.status === "rejected"
                    ? "Declined"
                    : "Pending Review";
              return (
                <div
                  key={reqItem.id}
                  className="py-4 px-1 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                  data-testid={`account-request-row-${reqItem.id}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">AR-{reqItem.id}</span>
                      <span className="text-sm font-semibold text-foreground">
                        {reqItem.requestedDisplayName || reqItem.accountType}
                      </span>
                      {reqItem.requestedDisplayName && (
                        <span className="text-xs text-muted-foreground">({reqItem.accountType})</span>
                      )}
                      <span className={cn("inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap", statusStyle)}>
                        {reqItem.status === "pending" && <Clock className="w-2.5 h-2.5" />}
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {reqItem.ownershipStructure} · {reqItem.investmentObjective} · {reqItem.riskTolerance} risk · {reqItem.expectedInitialFunding} ({reqItem.fundingSource}) · {reqItem.jurisdiction}
                    </p>
                    {reqItem.createdAccountNumber && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 font-mono">
                        Provisioned Account: {maskAccountNumber(reqItem.createdAccountNumber)}
                      </p>
                    )}
                    {reqItem.adminNotes && (
                      <p className="text-xs text-foreground/80 italic">
                        Review Note: {reqItem.adminNotes}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono whitespace-nowrap shrink-0">
                    {new Date(reqItem.createdAt).toLocaleDateString("en-CA")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer note ─────────────────────────────────────────────── */}
      <div className="mt-8 pt-4 border-t border-border/50 text-[10px] text-muted-foreground/40">
        <span>Veritas Wealth</span>
      </div>

    </LayoutShell>
  );
}
