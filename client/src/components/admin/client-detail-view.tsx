import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  FileText,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Trash2,
  Unlock,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BALANCE_CURRENCY_INFO, clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { accountLabel } from "@shared/account-display";
import { formatCAD } from "@shared/fees";
import { destinationCountryName } from "@shared/institutional-destination";
import { formatOnboardingLabel } from "@shared/onboarding-options";

export type ResetLinkResult = {
  userId: number;
  userName: string;
  email: string;
  clientRef: string | null;
  resetUrl: string;
  expiresAt: string;
};

type ClientDetailsResponse = {
  user: any;
  contactDetails: {
    residentialAddress: Record<string, any> | null;
    mailingAddress: Record<string, any> | null;
    updatedAt: string;
  } | null;
  security: {
    mfaEnabled: boolean;
    version: number;
    events: Array<{ id: number; event: string; createdAt: string }>;
    recoveryRequests: Array<{ id: number; status: string; createdAt: string; reviewedAt: string | null }>;
    setupTokens: Array<{
      id: number;
      purpose: string;
      expiresAt: string;
      consumedAt: string | null;
      createdAt: string;
    }>;
  };
  application: any | null;
  accounts: any[];
  accountRequests?: any[];
  investments: any[];
  transactions: any[];
  payees: any[];
  institutionalTransfers: any[];
  displayCurrencyAudit: Array<{
    id: number;
    actor: string;
    previousCurrency: string;
    displayCurrency: string;
    reason: string;
    createdAt: string;
  }>;
  fees: {
    enrollments: any[];
    contracts: any[];
    assessments: any[];
  };
};

type ClientDetailViewProps = {
  userId: number;
  adminKey: string;
  onBack: () => void;
  onOpenCurrency: (user: any) => void;
  onOpenDebtNotice: (user: any) => void;
  onFreeze: (user: any) => void;
  onUnfreeze: (user: any) => void;
  onRestrict: (user: any) => void;
  onUnrestrict: (user: any) => void;
  onDeleteProfile: (user: any) => void;
  freezePending?: boolean;
  restrictPending?: boolean;
};

function formatAddress(addr: Record<string, any> | null | undefined): string[] {
  if (!addr || typeof addr !== "object") return [];
  const lines: string[] = [];
  const line1 = [addr.street, addr.line1, addr.addressLine1, addr.address].find(Boolean);
  const line2 = [addr.unit, addr.line2, addr.addressLine2].find(Boolean);
  const locality = [addr.city, addr.province || addr.state || addr.region, addr.postalCode || addr.zip]
    .filter(Boolean)
    .join(", ");
  const country = addr.country || "";
  if (line1) lines.push(String(line1));
  if (line2) lines.push(String(line2));
  if (locality) lines.push(locality);
  if (country) lines.push(String(country));
  if (lines.length === 0) {
    Object.entries(addr).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim()) {
        lines.push(`${k}: ${String(v)}`);
      }
    });
  }
  return lines;
}

function StatusTag({
  tone,
  children,
}: {
  tone: "emerald" | "amber" | "red" | "sky" | "neutral";
  children: React.ReactNode;
}) {
  const styles: Record<typeof tone, string> = {
    emerald: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/35 bg-amber-500/10 text-amber-300",
    red: "border-red-500/35 bg-red-500/10 text-red-300",
    sky: "border-sky-500/35 bg-sky-500/10 text-sky-300",
    neutral: "border-slate-600 bg-slate-800 text-slate-300",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function ClientDetailView({
  userId,
  adminKey,
  onBack,
  onOpenCurrency,
  onOpenDebtNotice,
  onFreeze,
  onUnfreeze,
  onRestrict,
  onUnrestrict,
  onDeleteProfile,
  freezePending,
  restrictPending,
}: ClientDetailViewProps) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"overview" | "accounts" | "activity" | "security" | "fees">("overview");
  const [copiedRef, setCopiedRef] = useState(false);
  const [resetResult, setResetResult] = useState<ResetLinkResult | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [resetCopyFailed, setResetCopyFailed] = useState(false);

  useEffect(() => {
    setSection("overview");
    setResetResult(null);
    setResetCopied(false);
    setResetCopyFailed(false);
  }, [userId]);

  const detailsQuery = useQuery<ClientDetailsResponse>({
    queryKey: ["/api/admin/users", userId, "details"],
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/details`, {
        headers: {
          "Authorization": `Bearer ${adminKey}`,
          "x-admin-key": adminKey,
        },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to load client details");
      return data;
    },
  });

  const generateResetLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/password-reset-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminKey}`,
          "x-admin-key": adminKey,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Could not generate password reset link");
      return data;
    },
    onSuccess: (data) => {
      const resetUrl = new URL(data.resetPath, window.location.origin).toString();
      setResetResult({
        userId: data.userId,
        userName: data.userName,
        email: data.email,
        clientRef: data.clientRef ?? null,
        resetUrl,
        expiresAt: data.expiresAt,
      });
      setResetCopied(false);
      setResetCopyFailed(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "details"] });
    },
  });

  const activateAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/activate-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminKey}`,
          "x-admin-key": adminKey,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Could not activate client account");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "details"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const handleCopyRef = async (refText: string) => {
    try {
      await navigator.clipboard.writeText(refText);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      setCopiedRef(false);
    }
  };

  if (detailsQuery.isLoading) {
    return (
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-10 text-center text-sm text-slate-400">
        <RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
        Loading complete client profile…
      </div>
    );
  }

  if (detailsQuery.isError || !detailsQuery.data) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-red-300">
            {detailsQuery.error instanceof Error ? detailsQuery.error.message : "Client profile could not be loaded."}
          </p>
          <Button variant="outline" size="sm" onClick={onBack} className="border-slate-600 text-slate-200 whitespace-nowrap shrink-0">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Clients
          </Button>
        </div>
        <Button size="sm" variant="outline" onClick={() => void detailsQuery.refetch()} className="border-slate-600 text-slate-200">
          Retry
        </Button>
      </div>
    );
  }

  const { user, contactDetails, security, application, accounts, accountRequests = [], investments, transactions, payees, institutionalTransfers, displayCurrencyAudit, fees } =
    detailsQuery.data;
  const currency = clientBalanceCurrency(user);
  const resAddress = formatAddress(contactDetails?.residentialAddress);
  const mailAddress = formatAddress(contactDetails?.mailingAddress);
  const accountMap = new Map(accounts.map((a: any) => [a.id, a]));

  const subTabs: Array<{ id: typeof section; label: string; count?: number }> = [
    { id: "overview", label: "Overview & KYC" },
    { id: "accounts", label: "Accounts & Holdings", count: accounts.length + investments.length + accountRequests.length },
    { id: "activity", label: "Transactions & Transfers", count: transactions.length + payees.length + institutionalTransfers.length },
    { id: "security", label: "Security & Reset History", count: security.setupTokens.length + security.recoveryRequests.length },
    { id: "fees", label: "Fees & Contracts", count: fees.enrollments.length + fees.contracts.length },
  ];

  return (
    <div className="space-y-6" data-testid={`client-detail-view-${user.id}`}>
      {/* Top breadcrumb + primary profile header */}
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            data-testid="button-back-to-clients"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Client Directory
          </button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void detailsQuery.refetch()}
              className="h-8 text-xs text-slate-400 hover:text-white whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${detailsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="space-y-2.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-semibold tracking-tight text-white">{user.name}</h2>
              {user.accountFrozen && <StatusTag tone="sky"><Snowflake className="h-3 w-3" /> Frozen</StatusTag>}
              {user.loginRestricted && !user.accountFrozen && <StatusTag tone="red"><Lock className="h-3 w-3" /> Login Restricted</StatusTag>}
              {!user.accountFrozen && !user.loginRestricted && <StatusTag tone="emerald">Active Standing</StatusTag>}
              {user.initialDepositStatus === "required" && (
                <StatusTag tone="amber">Awaiting Initial Deposit</StatusTag>
              )}
              {user.initialDepositStatus === "pending_review" && (
                <StatusTag tone="amber">Initial Deposit Pending Review</StatusTag>
              )}
              {(!user.initialDepositStatus || user.initialDepositStatus === "completed") && (
                <StatusTag tone="emerald">Activated</StatusTag>
              )}
              {user.debtClearanceRequired && <StatusTag tone="amber">Debt Clearance Lock</StatusTag>}
              <StatusTag tone={security.mfaEnabled ? "emerald" : "neutral"}>
                {security.mfaEnabled ? "2FA Enabled" : "2FA Disabled"}
              </StatusTag>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-slate-400">Client Ref:</span>
                <code
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300"
                  data-testid="detail-client-ref"
                >
                  {user.clientRef || "Unassigned"}
                </code>
                {user.clientRef && (
                  <button
                    type="button"
                    onClick={() => void handleCopyRef(user.clientRef)}
                    className="text-slate-400 hover:text-white"
                    title="Copy Client Reference"
                  >
                    {copiedRef ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-400">User #{user.id}</span>
              <span className="text-slate-600">·</span>
              <span className="break-all">{user.email}</span>
              <span className="text-slate-600">·</span>
              <span>{user.phoneNumber || "No phone on file"}</span>
              <span className="text-slate-600">·</span>
              <span>Joined {new Date(user.createdAt).toLocaleDateString("en-CA")}</span>
            </div>

            {(user.accountFrozen && user.freezeReason) && (
              <p className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded px-3 py-2">
                Freeze reason: {user.freezeReason}
              </p>
            )}
            {(user.loginRestricted && !user.accountFrozen && user.loginRestrictionMessage) && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded px-3 py-2">
                Login restriction notice: {user.loginRestrictionMessage}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              size="sm"
              disabled={generateResetLinkMutation.isPending}
              onClick={() => generateResetLinkMutation.mutate()}
              className="h-8 bg-primary hover:bg-primary/90 text-white text-xs whitespace-nowrap shrink-0"
              data-testid="button-generate-password-reset"
            >
              {generateResetLinkMutation.isPending ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generate Password Reset Link
            </Button>

            {(user.initialDepositStatus === "required" || user.initialDepositStatus === "pending_review") && (
              <Button
                size="sm"
                variant="outline"
                disabled={activateAccountMutation.isPending}
                onClick={() => activateAccountMutation.mutate()}
                className="h-8 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs whitespace-nowrap shrink-0"
                data-testid="button-admin-activate-account"
              >
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                {activateAccountMutation.isPending ? "Activating…" : "Activate Account"}
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenCurrency(user)}
              className="h-8 border-slate-600 text-slate-200 hover:bg-slate-800 text-xs whitespace-nowrap shrink-0"
            >
              <Wallet className="mr-1.5 h-3.5 w-3.5" />
              Display &amp; Accounts
            </Button>

            {user.debtClearanceRequired && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenDebtNotice(user)}
                className="h-8 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs whitespace-nowrap shrink-0"
                data-testid={`debt-notice-detail-${user.id}`}
              >
                Debt Notice
              </Button>
            )}

            {user.accountFrozen ? (
              <Button
                size="sm"
                variant="outline"
                disabled={freezePending}
                onClick={() => onUnfreeze(user)}
                className="h-8 border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-xs whitespace-nowrap shrink-0"
              >
                <Snowflake className="mr-1.5 h-3.5 w-3.5" />
                Unfreeze
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFreeze(user)}
                className="h-8 border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-xs whitespace-nowrap shrink-0"
              >
                <Snowflake className="mr-1.5 h-3.5 w-3.5" />
                Freeze
              </Button>
            )}

            {user.loginRestricted ? (
              <Button
                size="sm"
                variant="outline"
                disabled={restrictPending}
                onClick={() => onUnrestrict(user)}
                className="h-8 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs whitespace-nowrap shrink-0"
              >
                <Unlock className="mr-1.5 h-3.5 w-3.5" />
                Restore Login
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRestrict(user)}
                className="h-8 border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs whitespace-nowrap shrink-0"
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Restrict Login
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() => onDeleteProfile(user)}
              className="h-8 border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs whitespace-nowrap shrink-0"
              data-testid={`button-detail-delete-user-${user.id}`}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete Profile
            </Button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
          <div className="rounded border border-slate-800 bg-slate-950/60 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Total Cash Balance</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-300">
              {formatBalance(user.totalBalance, currency)}
              <span className="ml-1.5 text-[11px] font-sans text-slate-400">{currency}</span>
            </p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Owned Accounts</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-white">{accounts.length}</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Transactions</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-white">{transactions.length}</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Inst. Transfers / Wires</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-white">
              {institutionalTransfers.length} <span className="text-slate-500 text-xs">transfers</span> · {payees.length} <span className="text-slate-500 text-xs">payees</span>
            </p>
          </div>
        </div>
      </div>

      {/* Password Reset Error */}
      {generateResetLinkMutation.isError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200">
          {generateResetLinkMutation.error instanceof Error
            ? generateResetLinkMutation.error.message
            : "Failed to generate password reset link."}
        </div>
      )}

      {/* One-Time Password Reset Link Output */}
      {resetResult && (
        <div
          className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-4 space-y-3"
          data-testid="client-password-reset-result"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                One-Time Password Reset Link Generated
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {resetResult.userName} · Client Ref: <strong className="font-mono text-white">{resetResult.clientRef || "Unassigned"}</strong>
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Expires {new Date(resetResult.expiresAt).toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Verify the client through an established channel before sharing this link. It can be used once within 24 hours, replaces any previous unused reset link for this profile, ends active client sessions upon completion, and preserves existing two-factor authentication.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              readOnly
              value={resetResult.resetUrl}
              aria-label="One-time password reset link"
              onFocus={(e) => e.currentTarget.select()}
              className="border-slate-600 bg-slate-950 font-mono text-xs text-slate-100"
              data-testid="input-password-reset-link"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 whitespace-nowrap shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetResult.resetUrl);
                  setResetCopied(true);
                  setResetCopyFailed(false);
                } catch {
                  setResetCopied(false);
                  setResetCopyFailed(true);
                }
              }}
              data-testid="button-copy-password-reset-link"
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {resetCopied ? "Copied" : "Copy Reset Link"}
            </Button>
          </div>
          {resetCopyFailed && (
            <p className="text-xs text-amber-300">Clipboard copy was blocked. Select the URL above and copy manually.</p>
          )}
        </div>
      )}

      {/* Detail Section Tabs */}
      <div className="border-b border-slate-700/80 flex items-center gap-1 overflow-x-auto">
        {subTabs.map((tab) => {
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? "border-primary text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
              data-testid={`client-detail-tab-${tab.id}`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 font-mono text-[11px] text-slate-400">({tab.count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Section: Overview & KYC */}
      {section === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Identity & Contact */}
          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Identity &amp; Contact Details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Full Name</dt>
                <dd className="mt-0.5 text-slate-100 font-medium">{user.name}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Client Reference</dt>
                <dd className="mt-0.5 font-mono text-emerald-300 font-semibold">{user.clientRef || "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Email Address</dt>
                <dd className="mt-0.5 text-slate-200 break-all">{user.email}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Phone Number</dt>
                <dd className="mt-0.5 text-slate-200">{user.phoneNumber || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Display Currency</dt>
                <dd className="mt-0.5 text-slate-200">
                  {BALANCE_CURRENCY_INFO[currency].name} ({currency} · Presentation only)
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Account Activation</dt>
                <dd className="mt-0.5 text-slate-200">
                  {user.initialDepositStatus === "required"
                    ? "Awaiting Initial Deposit"
                    : user.initialDepositStatus === "pending_review"
                      ? "Initial Deposit Pending Verification"
                      : "Activated"}
                </dd>
              </div>
              {user.selectedInitialDeposit && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Selected Initial Deposit</dt>
                  <dd className="mt-0.5 text-emerald-300 font-medium">
                    {formatOnboardingLabel(user.selectedInitialDeposit)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-slate-400">Registered On</dt>
                <dd className="mt-0.5 font-mono text-slate-300">{new Date(user.createdAt).toLocaleString()}</dd>
              </div>
              <div className="sm:col-span-2 pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Residential Address</dt>
                  <dd className="mt-1 text-slate-200 space-y-0.5">
                    {resAddress.length > 0 ? resAddress.map((l, i) => <p key={i}>{l}</p>) : <p className="text-slate-500">Not supplied in client settings</p>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Mailing Address</dt>
                  <dd className="mt-1 text-slate-200 space-y-0.5">
                    {mailAddress.length > 0 ? mailAddress.map((l, i) => <p key={i}>{l}</p>) : <p className="text-slate-500">Same as residential / not supplied</p>}
                  </dd>
                </div>
              </div>
            </dl>
          </div>

          {/* Onboarding Application / KYC */}
          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Onboarding &amp; KYC Record
              </h3>
              {application && (
                <span className="font-mono text-[11px] text-slate-400">App #{application.id} · {application.status}</span>
              )}
            </div>
            {!application ? (
              <p className="text-xs text-slate-400">No matching onboarding application record found for {user.email}.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
                {[
                  ["Date of Birth", application.dateOfBirth],
                  ["Nationality", application.nationality],
                  ["Address", application.address],
                  ["City / Country", [application.city, application.country].filter(Boolean).join(", ")],
                  ["Employment", formatOnboardingLabel(application.employmentStatus)],
                  ["Annual Income", formatOnboardingLabel(application.annualIncome)],
                  ["Experience", formatOnboardingLabel(application.investmentExperience)],
                  ["Risk Tolerance", formatOnboardingLabel(application.riskTolerance)],
                  ["Investment Goal", formatOnboardingLabel(application.investmentGoal)],
                  ["Initial Deposit", formatOnboardingLabel(application.initialDeposit)],
                  ["Preferred Currency", application.preferredCurrency || "CAD"],
                  ["Source of Funds", formatOnboardingLabel(application.sourceOfFunds)],
                  ["Submitted", application.createdAt ? new Date(application.createdAt).toLocaleDateString("en-CA") : null],
                ].map(([label, val]) => (
                  <div key={String(label)}>
                    <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
                    <dd className="mt-0.5 text-slate-200">{val ? String(val) : "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Display Currency Audit History */}
          <div className="lg:col-span-2 rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Display Currency Audit Trail</h3>
            {displayCurrencyAudit.length === 0 ? (
              <p className="text-xs text-slate-400">No display preference changes logged for this client.</p>
            ) : (
              <div className="divide-y divide-slate-800 text-xs">
                {displayCurrencyAudit.map((entry) => (
                  <div key={entry.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-slate-200">
                        {entry.previousCurrency} → {entry.displayCurrency}
                      </span>
                      <span className="mx-2 text-slate-600">·</span>
                      <span className="text-slate-300">{entry.reason}</span>
                    </div>
                    <div className="text-slate-400 font-mono text-[11px] shrink-0">
                      {entry.actor} · {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section: Accounts & Holdings */}
      {section === "accounts" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Client Accounts ({accounts.length})</h3>
              <Button size="sm" variant="outline" onClick={() => onOpenCurrency(user)} className="h-7 text-xs border-slate-600 text-slate-200">
                Manage Accounts &amp; Currency
              </Button>
            </div>
            {accounts.length === 0 ? (
              <p className="p-5 text-xs text-slate-400">No accounts belong to this client.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Account ID</th>
                      <th className="px-4 py-2.5">Label / Type</th>
                      <th className="px-4 py-2.5">Account Number</th>
                      <th className="px-4 py-2.5 text-right">Cash Balance ({currency})</th>
                      <th className="px-4 py-2.5">Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {accounts.map((acc: any) => (
                      <tr key={acc.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-mono text-slate-400">#{acc.id}</td>
                        <td className="px-4 py-3 text-white font-medium">
                          {accountLabel(acc)}
                          {acc.displayName && acc.displayName !== acc.accountType && (
                            <span className="ml-2 text-slate-400 font-normal">({acc.accountType})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300">{acc.accountNumber}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-emerald-300">
                          {formatBalance(acc.balance, currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">{acc.isDemo ? "Demo" : "Live"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Portfolio Holdings ({investments.length})</h3>
            </div>
            {investments.length === 0 ? (
              <p className="p-5 text-xs text-slate-400">No recorded investment positions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Symbol</th>
                      <th className="px-4 py-2.5">Asset</th>
                      <th className="px-4 py-2.5">Account</th>
                      <th className="px-4 py-2.5 text-right">Shares</th>
                      <th className="px-4 py-2.5 text-right">Purchase Price</th>
                      <th className="px-4 py-2.5 text-right">Current Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {investments.map((inv: any) => {
                      const acct = accountMap.get(inv.accountId);
                      return (
                        <tr key={inv.id} className="hover:bg-slate-800/30">
                          <td className="px-4 py-3 font-mono font-semibold text-white">{inv.symbol}</td>
                          <td className="px-4 py-3 text-slate-200">{inv.name}</td>
                          <td className="px-4 py-3 text-slate-400 font-mono">
                            #{inv.accountId} {acct ? `· ${accountLabel(acct)}` : ""}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">{inv.shares}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{formatCAD(inv.purchasePrice)}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-300">{formatCAD(inv.currentPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Account Opening Requests ({accountRequests.length})</h3>
            </div>
            {accountRequests.length === 0 ? (
              <p className="p-5 text-xs text-slate-400">No additional account opening requests submitted by this client.</p>
            ) : (
              <div className="divide-y divide-slate-800 text-xs">
                {accountRequests.map((reqItem: any) => (
                  <div key={reqItem.id} className="p-4 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-slate-400">AR-{reqItem.id}</span>
                        <span className="font-semibold text-white">
                          {reqItem.requestedDisplayName || reqItem.accountType}
                        </span>
                        {reqItem.requestedDisplayName && (
                          <span className="text-slate-400">({reqItem.accountType})</span>
                        )}
                      </div>
                      <StatusTag
                        tone={reqItem.status === "approved" ? "emerald" : reqItem.status === "rejected" ? "red" : "amber"}
                      >
                        {reqItem.status}
                      </StatusTag>
                    </div>
                    <p className="text-slate-300">
                      {reqItem.ownershipStructure} · {reqItem.investmentObjective} · {reqItem.riskTolerance} risk · {reqItem.expectedInitialFunding} ({reqItem.fundingSource}) · {reqItem.jurisdiction}
                    </p>
                    {reqItem.createdAccountNumber && (
                      <p className="font-mono text-emerald-300">Opened Account: {reqItem.createdAccountNumber}</p>
                    )}
                    {reqItem.adminNotes && (
                      <p className="italic text-slate-400">Review note: {reqItem.adminNotes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section: Transactions, Beneficiaries & Institutional Transfers */}
      {section === "activity" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Transactions ({transactions.length})</h3>
            </div>
            {transactions.length === 0 ? (
              <p className="p-5 text-xs text-slate-400">No ledger transactions recorded for this client.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Ref</th>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Accounts / Payee</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Audit / Origin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {transactions.map((t: any) => (
                      <tr key={t.id} className="hover:bg-slate-800/30 align-top">
                        <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">TXN-{t.id}</td>
                        <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                          {new Date(t.createdAt).toLocaleDateString("en-CA")}
                        </td>
                        <td className="px-4 py-3 text-slate-200 capitalize whitespace-nowrap">{String(t.transactionType || "").replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-slate-300 space-y-0.5">
                          {t.fromAccountLabel && <p>From: {t.fromAccountLabel} ({t.fromAccountNumber})</p>}
                          {t.toAccountLabel && <p>To: {t.toAccountLabel} ({t.toAccountNumber})</p>}
                          {t.payeeName && <p>Beneficiary: {t.payeeName}</p>}
                          {t.description && <p className="text-slate-400">{t.description}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-white whitespace-nowrap">
                          {formatCAD(t.amount)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusTag tone={t.status === "completed" ? "emerald" : t.status === "pending" ? "amber" : "red"}>
                            {t.status}
                          </StatusTag>
                        </td>
                        <td className="px-4 py-3 text-slate-400 space-y-0.5">
                          <p className="capitalize">{t.entryOrigin || "client"}</p>
                          {t.evidenceRef && <p className="font-mono text-[11px] text-slate-300">Ref: {t.evidenceRef}</p>}
                          {t.approvedByStaffName && <p className="text-[11px] text-slate-500">Approved: {t.approvedByStaffName}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Payees */}
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">Saved Beneficiaries ({payees.length})</h3>
              {payees.length === 0 ? (
                <p className="text-xs text-slate-400">No beneficiaries registered.</p>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {payees.map((p: any) => (
                    <div key={p.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{p.name}</p>
                        <p className="text-slate-400 mt-0.5">
                          {p.bankName || "—"} · Acct {p.accountNumber} · Routing {p.routingNumber || "—"}
                        </p>
                      </div>
                      <StatusTag tone={p.status === "approved" ? "emerald" : p.status === "pending_approval" ? "amber" : "red"}>
                        {p.status}
                      </StatusTag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Institutional Transfers */}
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Institutional Transfers ({institutionalTransfers.length})
              </h3>
              {institutionalTransfers.length === 0 ? (
                <p className="text-xs text-slate-400">No institutional transfers requested.</p>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {institutionalTransfers.map((t: any) => (
                    <div key={t.id} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-white">IT-{t.id} · {t.institutionName}</span>
                        <StatusTag tone={t.status === "completed" || t.status === "approved" ? "emerald" : t.status === "rejected" ? "red" : "amber"}>
                          {t.status}
                        </StatusTag>
                      </div>
                      <p className="text-slate-400">
                        {t.transferType} · {t.transferScope} {t.partialAmount ? `(${formatCAD(t.partialAmount)})` : ""} ·{" "}
                        {t.institutionCountry ? destinationCountryName(t.institutionCountry) : "Country unspecified"}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">Receiving ID: {t.institutionAccountNumber}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section: Security & Link History */}
      {section === "security" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Setup &amp; Password Reset Link History ({security.setupTokens.length})
            </h3>
            {security.setupTokens.length === 0 ? (
              <p className="text-xs text-slate-400">No setup or reset links recorded.</p>
            ) : (
              <div className="divide-y divide-slate-800 text-xs">
                {security.setupTokens.map((tok) => {
                  const expired = new Date(tok.expiresAt).getTime() <= Date.now();
                  const statusLabel = tok.consumedAt ? "Used / Replaced" : expired ? "Expired" : "Active (Unconsumed)";
                  const tone = tok.consumedAt ? "neutral" : expired ? "amber" : "emerald";
                  return (
                    <div key={tok.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-slate-100 font-medium capitalize">
                          {tok.purpose === "admin_reset" ? "Admin Password Reset Link" : "Initial Onboarding Activation"}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          Issued {new Date(tok.createdAt).toLocaleString()} · Expires {new Date(tok.expiresAt).toLocaleString()}
                        </p>
                      </div>
                      <StatusTag tone={tone}>{statusLabel}</StatusTag>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Security Posture &amp; Audit Events
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Two-Factor Auth</p>
                <p className="mt-1 font-medium text-white">{security.mfaEnabled ? "Authenticator Enabled" : "Not Enrolled"}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Security Version</p>
                <p className="mt-1 font-mono text-white">v{security.version}</p>
              </div>
            </div>

            {security.recoveryRequests.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Recovery Code Requests</p>
                {security.recoveryRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1">
                    <span className="font-mono text-slate-300">Request #{r.id} · {new Date(r.createdAt).toLocaleDateString("en-CA")}</span>
                    <StatusTag tone={r.status === "issued" ? "emerald" : r.status === "pending" ? "amber" : "red"}>{r.status}</StatusTag>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5 border-t border-slate-800 pt-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Recent Security Events</p>
              {security.events.length === 0 ? (
                <p className="text-xs text-slate-500">No recorded security events.</p>
              ) : (
                <div className="divide-y divide-slate-800 text-xs max-h-56 overflow-y-auto">
                  {security.events.map((ev) => (
                    <div key={ev.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-200 capitalize">{ev.event.replace(/_/g, " ")}</span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">{new Date(ev.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section: Fees & Contracts */}
      {section === "fees" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">Monthly Fee Enrollments ({fees.enrollments.length})</h3>
              {fees.enrollments.length === 0 ? (
                <p className="text-xs text-slate-400">No monthly fee enrollments.</p>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {fees.enrollments.map((e: any) => (
                    <div key={e.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{e.scheduleName || `Schedule #${e.scheduleId}`} (v{e.scheduleVersion ?? "—"})</p>
                        <p className="text-slate-400 mt-0.5 font-mono">
                          Acct #{e.accountId} · {formatCAD(e.scheduleTotal || 0)} · First charge {e.firstChargeDate}
                        </p>
                      </div>
                      <StatusTag tone={e.state === "active" ? "emerald" : e.state === "offered" ? "amber" : "neutral"}>{e.state}</StatusTag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">Management Contracts ({fees.contracts.length})</h3>
              {fees.contracts.length === 0 ? (
                <p className="text-xs text-slate-400">No management contracts.</p>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {fees.contracts.map((c: any) => (
                    <div key={c.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">Acct #{c.accountId} · Rate {c.annualRatePercent}%</p>
                        <p className="text-slate-400 mt-0.5 font-mono">
                          Annual min {formatCAD(c.annualMinimum)} · Opened {c.openingDate}
                        </p>
                      </div>
                      <StatusTag tone={c.state === "active" ? "emerald" : c.state === "offered" ? "amber" : "neutral"}>{c.state}</StatusTag>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Recent Fee Assessments ({fees.assessments.length})</h3>
            </div>
            {fees.assessments.length === 0 ? (
              <p className="p-5 text-xs text-slate-400">No fee assessments recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">ID</th>
                      <th className="px-4 py-2.5">Account</th>
                      <th className="px-4 py-2.5">Kind / Period</th>
                      <th className="px-4 py-2.5">Due Date</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {fees.assessments.map((a: any) => (
                      <tr key={a.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-mono text-slate-400">#{a.id}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">#{a.accountId}</td>
                        <td className="px-4 py-2.5 capitalize text-slate-200">{a.kind} · P{a.period}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{a.dueDate}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-white">{formatCAD(a.total)}</td>
                        <td className="px-4 py-2.5">
                          <StatusTag tone={a.status === "paid" ? "emerald" : a.status === "unpaid" ? "amber" : "neutral"}>
                            {a.status}
                          </StatusTag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
