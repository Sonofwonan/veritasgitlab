import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeftRight,
  Building2,
  CheckCircle2,
  Clock,
  Globe2,
  Landmark,
  Loader2,
  Lock,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { FundsAccessNotice } from "@/components/fees/funds-access-notice";
import { InstitutionalTransferModal } from "@/components/institutional-transfer-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  useAccounts,
  useCreatePayee,
  useDeletePayee,
  usePayees,
  usePayment,
  usePortfolioTransactions,
  useTransfer,
} from "@/hooks/use-finances";
import { useFundsAccess } from "@/hooks/use-funds-access";
import { useActiveLiquidation } from "@/hooks/use-liquidation-status";
import { useToast } from "@/hooks/use-toast";
import { accountLabel, maskAccountNumber, transactionDate } from "@shared/account-display";
import {
  BALANCE_CURRENCIES,
  BALANCE_CURRENCY_INFO,
  clientBalanceCurrency,
  formatBalance,
  isBalanceCurrency,
  type BalanceCurrency,
} from "@shared/balance-currency";
import { destinationCountryName } from "@shared/institutional-destination";
import { formatOnboardingLabel, ONBOARDING_COUNTRIES } from "@shared/onboarding-options";

type TransferTab = "wire" | "deposit" | "internal" | "institutional";

const FUNDING_METHODS = [
  "Domestic Bank Wire",
  "International Wire (SWIFT)",
  "EFT / ACH Transfer",
  "Institutional Rollover",
];

function parseTabFromLocation(needsInitialDeposit: boolean): TransferTab {
  if (needsInitialDeposit) return "deposit";
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "wire" || tab === "internal" || tab === "institutional") {
    return tab;
  }
  return "wire";
}

function StatusLabel({ status }: { status: string }) {
  const tone =
    status === "completed" || status === "approved"
      ? "text-emerald-700 dark:text-emerald-400"
      : status === "failed" || status === "rejected"
        ? "text-rose-700 dark:text-rose-400"
        : "text-amber-700 dark:text-amber-400";
  const label =
    status === "pending_approval"
      ? "Pending Verification"
      : status === "failed"
        ? "Declined"
        : status === "under_review"
          ? "Under Review"
          : status.replace(/_/g, " ");
  return (
    <span className={`text-xs font-semibold capitalize whitespace-nowrap ${tone}`}>
      {label}
    </span>
  );
}

export default function TransfersPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const access = useFundsAccess();
  const displayCurrency = clientBalanceCurrency(user);

  const initialDepositRequired = user?.initialDepositStatus === "required";
  const initialDepositPending = user?.initialDepositStatus === "pending_review";
  const needsInitialDeposit = initialDepositRequired || initialDepositPending;

  const { data: accounts, isLoading: loadingAccounts } = useAccounts();
  const { data: payees = [], isLoading: loadingPayees } = usePayees();
  const { data: portfolioTxns = [], isLoading: loadingTxns } = usePortfolioTransactions();
  const createPayee = useCreatePayee();
  const deletePayee = useDeletePayee();
  const paymentMutation = usePayment();
  const transferMutation = useTransfer();

  const { transfers: _institutionalTransferRaw, statusUnavailable } = useActiveLiquidation();
  const institutionalTransfersList = _institutionalTransferRaw.filter((t: any) => t.status !== "rejected");

  const [activeTab, setActiveTab] = useState<TransferTab>(() => parseTabFromLocation(needsInitialDeposit));
  const [showInstTransferModal, setShowInstTransferModal] = useState(false);

  useEffect(() => {
    setActiveTab(parseTabFromLocation(needsInitialDeposit));
  }, [location, needsInitialDeposit]);

  // Wire & International Transfer form state
  const [wireSourceId, setWireSourceId] = useState<string>("");
  const [wireType, setWireType] = useState<"domestic" | "international">("domestic");
  const [wirePayeeId, setWirePayeeId] = useState<string>("");
  const [wireTargetCurrency, setWireTargetCurrency] = useState<BalanceCurrency>(displayCurrency);
  const [wireAmount, setWireAmount] = useState<string>("");
  const [wireReference, setWireReference] = useState<string>("");
  const [wireDescription, setWireDescription] = useState<string>("");

  // Add Beneficiary modal state
  const [payeeModalOpen, setPayeeModalOpen] = useState(false);
  const [payeeScope, setPayeeScope] = useState<"domestic" | "international">("domestic");
  const [payeeName, setPayeeName] = useState("");
  const [payeeType, setPayeeType] = useState<"individual" | "business">("individual");
  const [payeeCountry, setPayeeCountry] = useState("United States");
  const [payeeCurrency, setPayeeCurrency] = useState<BalanceCurrency>("USD");
  const [payeeBankName, setPayeeBankName] = useState("");
  const [payeeAccountNumber, setPayeeAccountNumber] = useState("");
  const [payeeRoutingNumber, setPayeeRoutingNumber] = useState("");

  // Initial Deposit form state
  const [depositAccountId, setDepositAccountId] = useState<string>("");
  const [depositMethod, setDepositMethod] = useState<string>(FUNDING_METHODS[0]);
  const [depositBankName, setDepositBankName] = useState<string>("");
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositReference, setDepositReference] = useState<string>("");

  // Internal Account Transfer form state
  const [internalFromId, setInternalFromId] = useState<string>("");
  const [internalToId, setInternalToId] = useState<string>("");
  const [internalAmount, setInternalAmount] = useState<string>("");

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;
    const primaryId = String(accounts[0].id);
    if (!wireSourceId) setWireSourceId(primaryId);
    if (!depositAccountId) setDepositAccountId(primaryId);
    if (!internalFromId) setInternalFromId(primaryId);
    if (!internalToId && accounts.length > 1) setInternalToId(String(accounts[1].id));
  }, [accounts, wireSourceId, depositAccountId, internalFromId, internalToId]);

  const selectedPayee = useMemo(
    () => payees.find((p: any) => String(p.id) === wirePayeeId) || null,
    [payees, wirePayeeId],
  );

  // Sync wire settlement currency only for international wires
  useEffect(() => {
    if (wireType === "domestic") {
      setWireTargetCurrency(displayCurrency);
    } else if (selectedPayee && isBalanceCurrency(selectedPayee.currency)) {
      setWireTargetCurrency(selectedPayee.currency);
    }
  }, [wireType, selectedPayee, displayCurrency]);

  const wireHistory = useMemo(
    () =>
      (portfolioTxns || []).filter(
        (t: any) => t.transactionType === "payment" || t.transactionType === "withdrawal",
      ),
    [portfolioTxns],
  );

  const depositHistory = useMemo(
    () =>
      (portfolioTxns || []).filter(
        (t: any) => t.transactionType === "transfer" && (t.fromAccountId === null || t.fromAccountId === undefined),
      ),
    [portfolioTxns],
  );

  const internalHistory = useMemo(
    () =>
      (portfolioTxns || []).filter(
        (t: any) => t.transactionType === "transfer" && t.fromAccountId !== null && t.fromAccountId !== undefined,
      ),
    [portfolioTxns],
  );

  const accountById = useMemo(() => {
    const map = new Map<number, any>();
    (accounts || []).forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);

  const selectTab = (tab: TransferTab) => {
    if (needsInitialDeposit && tab !== "deposit") {
      toast({
        title: "Activation Required",
        description: "Complete your initial deposit first to unlock transfers.",
      });
      return;
    }
    setActiveTab(tab);
    window.history.replaceState({}, "", `/transfers?tab=${tab}`);
  };

  const openAddBeneficiaryModal = () => {
    setPayeeScope(wireType);
    setPayeeModalOpen(true);
  };

  const handleCreatePayee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createPayee.mutateAsync({
        name: payeeName.trim(),
        type: payeeType,
        country: payeeScope === "domestic" ? "Domestic" : payeeCountry,
        currency: payeeScope === "domestic" ? displayCurrency : payeeCurrency,
        bankName: payeeBankName.trim(),
        accountNumber: payeeAccountNumber.trim(),
        routingNumber: payeeRoutingNumber.trim(),
      });
      setPayeeModalOpen(false);
      setWirePayeeId(String(created.id));
      setPayeeName("");
      setPayeeBankName("");
      setPayeeAccountNumber("");
      setPayeeRoutingNumber("");
      toast({
        title: "Beneficiary Saved",
        description: `${created.name} added and queued for review.`,
      });
    } catch (err: any) {
      toast({
        title: "Could Not Save Beneficiary",
        description: err?.message || "Please verify all bank and routing details.",
        variant: "destructive",
      });
    }
  };

  const handleSubmitWire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wireSourceId || !wirePayeeId) {
      toast({
        title: "Missing Wire Details",
        description: "Select a source account and destination beneficiary.",
        variant: "destructive",
      });
      return;
    }
    if (selectedPayee?.status === "rejected") {
      toast({
        title: "Beneficiary Declined",
        description: "This beneficiary cannot receive wire transfers.",
        variant: "destructive",
      });
      return;
    }
    try {
      await paymentMutation.mutateAsync({
        fromAccountId: Number(wireSourceId),
        payeeId: Number(wirePayeeId),
        amount: wireAmount.trim(),
        wireType,
        targetCurrency: wireType === "domestic" ? displayCurrency : wireTargetCurrency,
        reference: wireReference.trim() || undefined,
        description: wireDescription.trim() || undefined,
      });
      setWireAmount("");
      setWireReference("");
      setWireDescription("");
      toast({
        title: "Wire Request Submitted",
        description: "Pending administrative verification.",
      });
    } catch (err: any) {
      toast({
        title: "Wire Request Failed",
        description: err?.message || "Unable to submit wire transfer.",
        variant: "destructive",
      });
    }
  };

  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = depositAccountId || (accounts?.[0] ? String(accounts[0].id) : "");
    if (!targetId) {
      toast({
        title: "Account Unavailable",
        description: "No destination account found.",
        variant: "destructive",
      });
      return;
    }
    try {
      await transferMutation.mutateAsync({
        fromAccountId: -1,
        toAccountId: Number(targetId),
        amount: depositAmount.trim(),
        fundingMethod: depositMethod,
        senderBankName: depositBankName.trim() || undefined,
        senderReference: depositReference.trim() || undefined,
      });
      setDepositAmount("");
      setDepositBankName("");
      setDepositReference("");
      toast({
        title: "Initial Deposit Submitted",
        description: "Pending administrative verification.",
      });
    } catch (err: any) {
      toast({
        title: "Deposit Failed",
        description: err?.message || "Enter a valid deposit amount.",
        variant: "destructive",
      });
    }
  };

  const handleSubmitInternalTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalFromId || !internalToId || internalFromId === internalToId) {
      toast({
        title: "Select Two Distinct Accounts",
        description: "Choose different source and destination accounts.",
        variant: "destructive",
      });
      return;
    }
    try {
      await transferMutation.mutateAsync({
        fromAccountId: Number(internalFromId),
        toAccountId: Number(internalToId),
        amount: internalAmount.trim(),
      });
      setInternalAmount("");
      toast({
        title: "Internal Transfer Recorded",
        description: "Account balances updated.",
      });
    } catch (err: any) {
      toast({
        title: "Internal Transfer Failed",
        description: err?.message || "Could not complete internal transfer.",
        variant: "destructive",
      });
    }
  };

  if (loadingAccounts) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </LayoutShell>
    );
  }

  const tabs: Array<{ id: TransferTab; label: string; icon: any }> = needsInitialDeposit
    ? [
        { id: "deposit", label: "Initial Deposit", icon: Landmark },
        { id: "wire", label: "Wire & International", icon: Globe2 },
        { id: "internal", label: "Internal Transfer", icon: ArrowLeftRight },
        { id: "institutional", label: "Institutional", icon: Building2 },
      ]
    : [
        { id: "wire", label: "Wire & International", icon: Globe2 },
        { id: "internal", label: "Internal Transfer", icon: ArrowLeftRight },
        { id: "institutional", label: "Institutional", icon: Building2 },
      ];

  const fieldClass = "w-full h-10 rounded-md border border-slate-200 dark:border-border bg-white dark:bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const labelClass = "text-xs font-medium text-slate-600 dark:text-muted-foreground block";

  return (
    <LayoutShell>
      <FundsAccessNotice />
      <div className="space-y-5">
        <header className="px-0.5">
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
              {needsInitialDeposit ? "Account Activation" : "Transfers & Wires"}
            </h1>
            <InfoTip
              label="Transfer overview"
              content={
                needsInitialDeposit
                  ? "Submit your initial funding deposit for administrative verification to unlock wires, additional accounts, and investing."
                  : "Initiate domestic or international SWIFT wires, transfer funds between accounts, or request an institutional portfolio transfer."
              }
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
            {needsInitialDeposit
              ? "Complete your initial funding deposit to unlock external wires and investing"
              : "Domestic and SWIFT wire payments, internal transfers, and institutional custody movements"}
          </p>
        </header>

        {/* Segmented Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-border" role="tablist" aria-label="Transfer channels">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            const lockedTab = needsInitialDeposit && id !== "deposit";
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-disabled={lockedTab}
                onClick={() => selectTab(id)}
                data-testid={`tab-transfer-${id}`}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? "border-[#0B2218] dark:border-primary text-slate-900 dark:text-foreground"
                    : lockedTab
                      ? "border-transparent text-slate-400 dark:text-muted-foreground/45 cursor-not-allowed"
                      : "border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
                }`}
              >
                {lockedTab ? <Lock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                {label}
              </button>
            );
          })}
        </div>

        {/* ── TAB 1: WIRE & INTERNATIONAL TRANSFERS (Activated clients only) ── */}
        {!needsInitialDeposit && activeTab === "wire" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)] gap-5 items-start">
              <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                <CardHeader className="pb-4 border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                  <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                    Wire Transfer
                    <InfoTip
                      label="Wire transfer policy"
                      content="Domestic wires settle in your account currency. International SWIFT wires allow currency selection. Funds are only debited after administrative verification."
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 sm:p-6">
                  <form onSubmit={handleSubmitWire} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="wire-source-account" className={labelClass}>
                          From Account
                        </label>
                        <select
                          id="wire-source-account"
                          value={wireSourceId}
                          onChange={e => setWireSourceId(e.target.value)}
                          className={fieldClass}
                          data-testid="select-wire-source"
                          required
                        >
                          <option value="">Select account</option>
                          {(accounts || []).map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {accountLabel(acc)} ({formatBalance(acc.balance, displayCurrency)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="wire-channel" className={labelClass}>
                          Channel
                        </label>
                        <select
                          id="wire-channel"
                          value={wireType}
                          onChange={e => setWireType(e.target.value === "international" ? "international" : "domestic")}
                          className={fieldClass}
                          data-testid="select-wire-channel"
                        >
                          <option value="domestic">Domestic Wire</option>
                          <option value="international">International Wire (SWIFT)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="wire-beneficiary" className={labelClass}>
                          Beneficiary
                        </label>
                        <button
                          type="button"
                          onClick={openAddBeneficiaryModal}
                          className="text-xs font-medium text-[#0B2218] dark:text-primary hover:underline whitespace-nowrap shrink-0"
                          data-testid="button-open-add-beneficiary"
                        >
                          + Add Beneficiary
                        </button>
                      </div>
                      <select
                        id="wire-beneficiary"
                        value={wirePayeeId}
                        onChange={e => setWirePayeeId(e.target.value)}
                        className={fieldClass}
                        data-testid="select-wire-beneficiary"
                        required
                      >
                        <option value="">Select beneficiary</option>
                        {payees.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.bankName || "Bank"}
                            {p.country && p.country !== "Domestic" ? ` (${p.country} · ${p.currency || displayCurrency})` : ""}
                            {" · "}
                            {p.status === "approved" ? "Verified" : p.status === "rejected" ? "Declined" : "Pending"}
                          </option>
                        ))}
                      </select>
                      {selectedPayee?.status === "pending_approval" && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Beneficiary pending verification.
                        </p>
                      )}
                      {selectedPayee?.status === "rejected" && (
                        <p className="text-xs text-destructive">
                          Beneficiary declined.
                        </p>
                      )}
                    </div>

                    <div className={wireType === "international" ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : ""}>
                      {wireType === "international" && (
                        <div className="space-y-1.5">
                          <label htmlFor="wire-currency" className={labelClass}>
                            Settlement Currency
                          </label>
                          <select
                            id="wire-currency"
                            value={wireTargetCurrency}
                            onChange={e => {
                              if (isBalanceCurrency(e.target.value)) setWireTargetCurrency(e.target.value);
                            }}
                            className={fieldClass}
                            data-testid="select-wire-currency"
                          >
                            {BALANCE_CURRENCIES.map(code => (
                              <option key={code} value={code}>
                                {code} — {BALANCE_CURRENCY_INFO[code].name} ({BALANCE_CURRENCY_INFO[code].symbol})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label htmlFor="wire-amount" className={labelClass}>
                          Amount ({displayCurrency})
                        </label>
                        <Input
                          id="wire-amount"
                          type="text"
                          inputMode="decimal"
                          value={wireAmount}
                          onChange={e => setWireAmount(e.target.value)}
                          placeholder="0.00"
                          className="h-10 rounded-md border-slate-200 dark:border-border font-sans tabular-nums"
                          data-testid="input-wire-amount"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="wire-reference" className={labelClass}>
                          Reference <span className="text-slate-400 dark:text-muted-foreground/70">(optional)</span>
                        </label>
                        <Input
                          id="wire-reference"
                          maxLength={120}
                          value={wireReference}
                          onChange={e => setWireReference(e.target.value)}
                          placeholder="INV-2026-041"
                          className="h-10 rounded-md border-slate-200 dark:border-border font-mono text-xs"
                          data-testid="input-wire-reference"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="wire-purpose" className={labelClass}>
                          Purpose <span className="text-slate-400 dark:text-muted-foreground/70">(optional)</span>
                        </label>
                        <Input
                          id="wire-purpose"
                          maxLength={200}
                          value={wireDescription}
                          onChange={e => setWireDescription(e.target.value)}
                          placeholder="Optional memo"
                          className="h-10 rounded-md border-slate-200 dark:border-border"
                          data-testid="input-wire-description"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <Button
                        type="submit"
                        data-funds-action=""
                        disabled={access.blocked || paymentMutation.isPending || !wireSourceId || !wirePayeeId || selectedPayee?.status === "rejected"}
                        className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md whitespace-nowrap shrink-0"
                        data-testid="button-submit-wire"
                      >
                        {paymentMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Submit Wire
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {/* Saved Beneficiaries Sidebar */}
              <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-3.5 flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Beneficiaries</CardTitle>
                    <InfoTip
                      label="Beneficiary review"
                      content="Recipients undergo compliance review before outgoing wires can be released."
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={openAddBeneficiaryModal}
                    className="rounded-md border-slate-200 dark:border-border bg-white dark:bg-card whitespace-nowrap shrink-0 text-xs gap-1"
                    data-testid="button-add-beneficiary-card"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingPayees ? (
                    <p className="text-xs text-slate-500 dark:text-muted-foreground p-5">Loading…</p>
                  ) : payees.length === 0 ? (
                    <div className="py-10 px-5 text-center space-y-2">
                      <Globe2 className="w-6 h-6 text-slate-300 dark:text-muted-foreground/40 mx-auto" />
                      <p className="text-xs text-slate-500 dark:text-muted-foreground">No beneficiaries saved.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-border/60">
                      {payees.map((p: any) => (
                        <div key={p.id} className="px-5 py-3.5 flex items-start justify-between gap-3" data-testid={`beneficiary-row-${p.id}`}>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                              <span className="text-sm font-semibold text-slate-900 dark:text-foreground">{p.name}</span>
                              <StatusLabel status={p.status} />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-muted-foreground">
                              {p.bankName || "—"}
                              {p.country && p.country !== "Domestic" ? ` · ${p.country} (${p.currency || displayCurrency})` : " · Domestic"}
                            </p>
                            <p className="text-xs font-mono text-slate-500 dark:text-muted-foreground">
                              Acct {maskAccountNumber(p.accountNumber || "")} {p.routingNumber ? `· ${p.routingNumber}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => deletePayee.mutate(p.id)}
                            disabled={deletePayee.isPending}
                            aria-label={`Remove beneficiary ${p.name}`}
                            className="text-slate-400 hover:text-destructive p-1.5 transition-colors shrink-0"
                            data-testid={`button-delete-beneficiary-${p.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Wire Request History */}
            <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
              <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-3.5">
                <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground flex items-center gap-2">
                  Wire Activity
                  <InfoTip label="Wire activity details" content="Submitted domestic and international wire requests." />
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingTxns ? (
                  <p className="text-xs text-slate-500 dark:text-muted-foreground p-5">Loading…</p>
                ) : wireHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-muted-foreground py-8 text-center">No wire transfers yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-border/60">
                    {wireHistory.map((t: any) => (
                      <div key={t.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2" data-testid={`wire-history-row-${t.id}`}>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                            <span className="font-mono text-xs text-slate-500 dark:text-muted-foreground">WT-{t.id}</span>
                            <span className="text-sm font-medium text-slate-900 dark:text-foreground">{t.description || "Wire Transfer"}</span>
                            <StatusLabel status={t.status} />
                          </div>
                          <p className="text-xs text-slate-500 dark:text-muted-foreground font-mono">
                            {transactionDate(t.createdAt, true)}
                            {t.evidenceRef ? ` · Ref: ${t.evidenceRef}` : ""}
                          </p>
                        </div>
                        <p className="font-sans text-sm font-semibold tabular-nums text-slate-900 dark:text-foreground whitespace-nowrap shrink-0">
                          {formatBalance(t.amount, displayCurrency)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── TAB 2: INITIAL DEPOSIT ACTIVATION (Unactivated clients only) ───── */}
        {needsInitialDeposit && activeTab === "deposit" && (
          <div className="space-y-5">
            <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
              <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground flex items-center gap-2">
                    <Landmark className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                    {initialDepositPending ? "Initial Deposit Under Review" : "Initial Deposit"}
                    <InfoTip
                      label="Initial deposit rules"
                      content="Send your initial funding deposit to activate your account. Once verified by an administrator, full transfers, additional accounts, and investing unlock."
                    />
                  </CardTitle>
                  {user?.selectedInitialDeposit && (
                    <span className="text-xs text-slate-500 dark:text-muted-foreground">
                      Selected:{" "}
                      <span className="font-sans font-semibold tabular-nums text-slate-900 dark:text-foreground">
                        {formatOnboardingLabel(user.selectedInitialDeposit)}
                      </span>
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-5 sm:p-6">
                {initialDepositPending ? (
                  <div className="py-3 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>Pending administrative verification. Your account unlocks automatically once confirmed.</span>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitDeposit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(accounts?.length ?? 0) > 1 && (
                        <div className="space-y-1.5">
                          <label htmlFor="deposit-destination" className={labelClass}>
                            Account
                          </label>
                          <select
                            id="deposit-destination"
                            value={depositAccountId}
                            onChange={e => setDepositAccountId(e.target.value)}
                            className={fieldClass}
                            data-testid="select-deposit-account"
                            required
                          >
                            {(accounts || []).map(acc => (
                              <option key={acc.id} value={acc.id}>
                                {accountLabel(acc)} ({formatBalance(acc.balance, displayCurrency)})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label htmlFor="deposit-method" className={labelClass}>
                          Method
                        </label>
                        <select
                          id="deposit-method"
                          value={depositMethod}
                          onChange={e => setDepositMethod(e.target.value)}
                          className={fieldClass}
                          data-testid="select-deposit-method"
                        >
                          {FUNDING_METHODS.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="deposit-bank" className={labelClass}>
                          Originating Bank
                        </label>
                        <Input
                          id="deposit-bank"
                          maxLength={140}
                          value={depositBankName}
                          onChange={e => setDepositBankName(e.target.value)}
                          placeholder="e.g. RBC, HSBC, Chase"
                          className="h-10 rounded-md border-slate-200 dark:border-border"
                          data-testid="input-deposit-bank"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="deposit-amount" className={labelClass}>
                          Amount ({displayCurrency})
                        </label>
                        <Input
                          id="deposit-amount"
                          type="text"
                          inputMode="decimal"
                          value={depositAmount}
                          onChange={e => setDepositAmount(e.target.value)}
                          placeholder="0.00"
                          className="h-10 rounded-md border-slate-200 dark:border-border font-sans tabular-nums"
                          data-testid="input-deposit-amount"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="deposit-ref" className={labelClass}>
                          Reference <span className="text-slate-400 dark:text-muted-foreground/70">(optional)</span>
                        </label>
                        <Input
                          id="deposit-ref"
                          maxLength={100}
                          value={depositReference}
                          onChange={e => setDepositReference(e.target.value)}
                          placeholder="Trace or wire reference"
                          className="h-10 rounded-md border-slate-200 dark:border-border font-mono text-xs"
                          data-testid="input-deposit-reference"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={transferMutation.isPending || !depositAmount.trim()}
                        className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md whitespace-nowrap shrink-0"
                        data-testid="button-submit-deposit"
                      >
                        {transferMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Submit Deposit
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            {depositHistory.length > 0 && (
              <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-3.5">
                  <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Deposit Status</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100 dark:divide-border/60">
                    {depositHistory.map((t: any) => {
                      const dest = accountById.get(t.toAccountId);
                      return (
                        <div key={t.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2" data-testid={`deposit-history-row-${t.id}`}>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                              <span className="font-mono text-xs text-slate-500 dark:text-muted-foreground">DEP-{t.id}</span>
                              <span className="text-sm font-medium text-slate-900 dark:text-foreground">{t.description || "Initial Deposit"}</span>
                              <StatusLabel status={t.status} />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-muted-foreground">
                              {dest ? accountLabel(dest) : "Account"} ·{" "}
                              <span className="font-mono">{transactionDate(t.createdAt, true)}</span>
                            </p>
                          </div>
                          <p className="font-sans text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
                            +{formatBalance(t.amount, displayCurrency)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 3: INTERNAL TRANSFER (Activated clients only) ───────────────── */}
        {!needsInitialDeposit && activeTab === "internal" && (
          <div className="space-y-5">
            <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
              <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                  Internal Transfer
                  <InfoTip
                    label="Internal transfer info"
                    content="Move available cash directly between your active Veritas Wealth accounts."
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 sm:p-6">
                {!accounts || accounts.length < 2 ? (
                  <p className="text-sm text-slate-500 dark:text-muted-foreground py-4">
                    At least two active accounts are required for internal transfers.
                  </p>
                ) : (
                  <form onSubmit={handleSubmitInternalTransfer} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="internal-from" className={labelClass}>
                          From Account
                        </label>
                        <select
                          id="internal-from"
                          value={internalFromId}
                          onChange={e => setInternalFromId(e.target.value)}
                          className={fieldClass}
                          data-testid="select-internal-from"
                          required
                        >
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {accountLabel(acc)} ({formatBalance(acc.balance, displayCurrency)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="internal-to" className={labelClass}>
                          To Account
                        </label>
                        <select
                          id="internal-to"
                          value={internalToId}
                          onChange={e => setInternalToId(e.target.value)}
                          className={fieldClass}
                          data-testid="select-internal-to"
                          required
                        >
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {accountLabel(acc)} ({formatBalance(acc.balance, displayCurrency)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="internal-amount" className={labelClass}>
                          Amount ({displayCurrency})
                        </label>
                        <Input
                          id="internal-amount"
                          type="text"
                          inputMode="decimal"
                          value={internalAmount}
                          onChange={e => setInternalAmount(e.target.value)}
                          placeholder="0.00"
                          className="h-10 rounded-md border-slate-200 dark:border-border font-sans tabular-nums"
                          data-testid="input-internal-amount"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        data-funds-action=""
                        disabled={access.blocked || transferMutation.isPending || !internalAmount.trim()}
                        className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md whitespace-nowrap shrink-0"
                        data-testid="button-submit-internal-transfer"
                      >
                        {transferMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Transfer Cash
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
              <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-3.5">
                <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Recent Internal Transfers</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {internalHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-muted-foreground py-8 text-center">No internal transfers yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-border/60">
                    {internalHistory.map((t: any) => {
                      const fromAcc = accountById.get(t.fromAccountId);
                      const toAcc = accountById.get(t.toAccountId);
                      return (
                        <div key={t.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                              <span className="font-mono text-xs text-slate-500 dark:text-muted-foreground">TXN-{t.id}</span>
                              <span className="text-sm font-medium text-slate-900 dark:text-foreground">
                                {fromAcc ? accountLabel(fromAcc) : `Account #${t.fromAccountId}`} → {toAcc ? accountLabel(toAcc) : `Account #${t.toAccountId}`}
                              </span>
                              <StatusLabel status={t.status} />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-muted-foreground font-mono">{transactionDate(t.createdAt, true)}</p>
                          </div>
                          <p className="font-sans text-sm font-semibold tabular-nums text-slate-900 dark:text-foreground whitespace-nowrap shrink-0">
                            {formatBalance(t.amount, displayCurrency)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── TAB 4: INSTITUTIONAL TRANSFER (Activated clients only) ───────────── */}
        {!needsInitialDeposit && activeTab === "institutional" && (
          <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-foreground">
                    <Building2 className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                    Institutional Transfer
                  </CardTitle>
                  <InfoTip
                    label="Institutional transfer info"
                    content="Request a transfer in-kind or as cash to an external institution. Destination support is verified and administrative approval is required."
                  />
                </div>
                <Button
                  data-funds-action=""
                  size="sm"
                  onClick={() => setShowInstTransferModal(true)}
                  className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md gap-1.5 shrink-0 whitespace-nowrap"
                  data-testid="button-new-institutional-transfer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              {statusUnavailable ? (
                <p className="text-sm text-slate-500 dark:text-muted-foreground">Transfer status is unavailable right now. Please retry.</p>
              ) : institutionalTransfersList.length === 0 ? (
                <div className="text-center py-10 space-y-3">
                  <Building2 className="w-6 h-6 text-slate-300 dark:text-muted-foreground/40 mx-auto" />
                  <p className="text-xs text-slate-500 dark:text-muted-foreground">No institutional transfers yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {institutionalTransfersList.map((t: any) => {
                    const stage = t.status === "pending" ? 0
                      : t.status === "under_review" ? 1
                      : (t.status === "liquidating" || t.status === "approved") ? 2
                      : t.status === "transfer_out" ? 3
                      : t.status === "completed" ? 4
                      : -1;
                    const isRejected = t.status === "rejected";
                    const isCash = t.transferType === "cash";

                    const LABELS: Record<string, string> = {
                      pending: "Pending",
                      under_review: "Under Review",
                      liquidating: "Liquidating",
                      approved: "Liquidating",
                      transfer_out: "Portfolio Transmission",
                      completed: "Transfer Complete",
                      rejected: "Rejected",
                    };
                    const cardBorder = stage === 4
                      ? "border-emerald-200 dark:border-emerald-800/40"
                      : isRejected
                      ? "border-rose-200 dark:border-rose-800/40"
                      : stage === 3
                      ? "border-violet-200 dark:border-violet-800/30"
                      : stage === 2
                      ? "border-orange-200 dark:border-orange-800/30"
                      : "border-amber-200 dark:border-amber-800/30";
                    const statusTextColor = stage === 4 ? "text-emerald-700 dark:text-emerald-400" : isRejected ? "text-rose-700 dark:text-rose-400" : stage === 3 ? "text-violet-700 dark:text-violet-400" : stage === 2 ? "text-orange-700 dark:text-orange-400" : "text-amber-700 dark:text-amber-400";
                    const statusBg = stage === 4 ? "bg-emerald-50/70 dark:bg-emerald-900/10" : isRejected ? "bg-rose-50/70 dark:bg-rose-900/10" : stage === 3 ? "bg-violet-50/70 dark:bg-violet-900/10" : stage === 2 ? "bg-orange-50/70 dark:bg-orange-900/10" : "bg-amber-50/70 dark:bg-amber-900/10";

                    const steps = [
                      { label: "Submitted", done: stage >= 0 },
                      { label: "Under Review", done: stage >= 1 },
                      { label: "Liquidating", done: stage >= 2 },
                      { label: "Transfer Out", done: stage >= 3 },
                      { label: "Complete", done: stage >= 4 },
                    ];
                    const stepColor = stage === 4 ? "bg-emerald-500" : stage === 3 ? "bg-violet-500" : stage === 2 ? "bg-orange-500" : "bg-amber-500";
                    const stepTextColor = stage === 4 ? "text-emerald-800 dark:text-emerald-300" : stage === 3 ? "text-violet-800 dark:text-violet-300" : stage === 2 ? "text-orange-800 dark:text-orange-300" : "text-amber-800 dark:text-amber-300";

                    return (
                      <div key={t.id} className={`rounded-lg border ${cardBorder} overflow-hidden`} data-testid={`inst-transfer-${t.id}`}>
                        <div className={`${statusBg} px-4 py-2.5 flex items-center justify-between border-b ${cardBorder}`}>
                          <span className={`text-xs font-semibold ${statusTextColor}`}>{LABELS[t.status] ?? t.status}</span>
                          <span className="text-xs font-mono text-slate-500 dark:text-muted-foreground">Submitted {new Date(t.createdAt).toLocaleDateString("en-CA")}</span>
                        </div>

                        <div className="p-4 sm:p-5 space-y-3">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{t.institutionName}</p>
                                <span className="text-xs font-medium text-slate-500 dark:text-muted-foreground">· Full Portfolio</span>
                              </div>
                              {t.institutionCountry && <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">{destinationCountryName(t.institutionCountry)}</p>}
                              {t.destinationDetails && <p className="text-xs text-slate-500 dark:text-muted-foreground whitespace-pre-wrap break-words mt-1">{t.destinationDetails}</p>}
                              <p className="text-xs text-slate-600 dark:text-muted-foreground mt-1 tabular-nums">
                                {isCash ? "Cash Transfer" : "In-Kind Transfer"} · {formatBalance(t.partialAmount, displayCurrency)}
                              </p>
                            </div>
                            {stage === 4 ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            ) : isRejected ? (
                              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            ) : (
                              <Clock className={`w-4 h-4 shrink-0 mt-0.5 ${stage === 2 ? "text-orange-600" : "text-amber-600"}`} />
                            )}
                          </div>

                          {!isRejected && (
                            <div className="grid grid-cols-5 gap-1.5 pt-1">
                              {steps.map((step, i) => (
                                <div key={i} className="flex flex-col items-center gap-1">
                                  <div className={`w-full h-1 rounded-full ${step.done ? stepColor : "bg-slate-200 dark:bg-muted"}`} />
                                  <span className={`text-[10px] font-medium text-center leading-tight ${step.done ? stepTextColor : "text-slate-400 dark:text-muted-foreground"}`}>{step.label}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {t.estimatedCompletionDate && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40">
                              <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <div>
                                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Estimated Completion</p>
                                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">{new Date(t.estimatedCompletionDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</p>
                              </div>
                            </div>
                          )}
                          {t.adminNotes && t.adminNotes.toLowerCase().includes("estimated completion date") === false && (
                            <div className="border-t border-slate-100 dark:border-border/40 pt-2">
                              <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground mb-0.5">Advisor Note</p>
                              <p className="text-xs text-slate-700 dark:text-foreground/80">{t.adminNotes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Beneficiary Dialog */}
      <Dialog open={payeeModalOpen} onOpenChange={setPayeeModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-card border-slate-200 dark:border-border text-slate-900 dark:text-foreground">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-slate-900 dark:text-foreground flex items-center gap-2">
              Add Beneficiary
              <InfoTip
                label="Beneficiary review policy"
                content="New wire beneficiaries undergo compliance verification before funds can be released."
              />
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-muted-foreground">
              Register a domestic or international bank beneficiary.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreatePayee} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="payee-scope" className={labelClass}>Transfer Scope</label>
                <select
                  id="payee-scope"
                  value={payeeScope}
                  onChange={e => setPayeeScope(e.target.value === "international" ? "international" : "domestic")}
                  className={fieldClass}
                  data-testid="select-payee-scope"
                >
                  <option value="domestic">Domestic ({displayCurrency})</option>
                  <option value="international">International (SWIFT)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="payee-name" className={labelClass}>Beneficiary Name</label>
                <Input
                  id="payee-name"
                  value={payeeName}
                  onChange={e => setPayeeName(e.target.value)}
                  placeholder="Full legal or entity name"
                  className="h-10 rounded-md border-slate-200 dark:border-border"
                  data-testid="input-payee-name"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="payee-type" className={labelClass}>Type</label>
                <select
                  id="payee-type"
                  value={payeeType}
                  onChange={e => setPayeeType(e.target.value === "business" ? "business" : "individual")}
                  className={fieldClass}
                  data-testid="select-payee-type"
                >
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                </select>
              </div>

              {payeeScope === "international" && (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="payee-country" className={labelClass}>Country</label>
                    <select
                      id="payee-country"
                      value={payeeCountry}
                      onChange={e => setPayeeCountry(e.target.value)}
                      className={fieldClass}
                      data-testid="select-payee-country"
                    >
                      {ONBOARDING_COUNTRIES.map(c => (
                        <option key={c.v} value={c.v}>{c.l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="payee-currency" className={labelClass}>Currency</label>
                    <select
                      id="payee-currency"
                      value={payeeCurrency}
                      onChange={e => {
                        if (isBalanceCurrency(e.target.value)) setPayeeCurrency(e.target.value);
                      }}
                      className={fieldClass}
                      data-testid="select-payee-currency"
                    >
                      {BALANCE_CURRENCIES.map(code => (
                        <option key={code} value={code}>
                          {code} — {BALANCE_CURRENCY_INFO[code].name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="payee-bank" className={labelClass}>Bank Name</label>
                <Input
                  id="payee-bank"
                  value={payeeBankName}
                  onChange={e => setPayeeBankName(e.target.value)}
                  placeholder={payeeScope === "domestic" ? "e.g. RBC Royal Bank" : "e.g. Barclays Bank PLC"}
                  className="h-10 rounded-md border-slate-200 dark:border-border"
                  data-testid="input-payee-bank"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="payee-account" className={labelClass}>
                  {payeeScope === "international" ? "IBAN / Account Number" : "Account Number"}
                </label>
                <Input
                  id="payee-account"
                  value={payeeAccountNumber}
                  onChange={e => setPayeeAccountNumber(e.target.value)}
                  placeholder={payeeScope === "international" ? "IBAN or account" : "Account number"}
                  className="h-10 rounded-md border-slate-200 dark:border-border font-mono"
                  data-testid="input-payee-account"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="payee-swift" className={labelClass}>
                  {payeeScope === "international" ? "SWIFT / BIC" : "Routing / Transit"}
                </label>
                <Input
                  id="payee-swift"
                  value={payeeRoutingNumber}
                  onChange={e => setPayeeRoutingNumber(e.target.value)}
                  placeholder={payeeScope === "international" ? "e.g. BARCGB22" : "Routing number"}
                  className="h-10 rounded-md border-slate-200 dark:border-border font-mono"
                  data-testid="input-payee-routing"
                  required
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="rounded-md border-slate-200 dark:border-border" onClick={() => setPayeeModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createPayee.isPending}
                className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md font-medium whitespace-nowrap shrink-0"
                data-testid="button-save-beneficiary"
              >
                {createPayee.isPending ? "Saving…" : "Save Beneficiary"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InstitutionalTransferModal
        open={showInstTransferModal}
        onClose={() => setShowInstTransferModal(false)}
        accounts={accounts || []}
        userId={user?.id || 0}
      />
    </LayoutShell>
  );
}
