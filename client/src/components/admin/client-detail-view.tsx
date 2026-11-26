import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  CreditCard,
  FileText,
  KeyRound,
  Lock,
  Megaphone,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Snowflake,
  Trash2,
  TrendingUp,
  Unlock,
  UserCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BALANCE_CURRENCY_INFO, clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { accountLabel } from "@shared/account-display";
import { formatCAD } from "@shared/fees";
import { destinationCountryName } from "@shared/institutional-destination";
import { formatOnboardingLabel } from "@shared/onboarding-options";
import {
  DEFAULT_CLIENT_FEATURE_FLAGS,
  DEFAULT_CLIENT_NOTICE,
  type CardKind,
  type CardNetwork,
  type CardStatus,
  type ClientCardRecord,
  type ClientFeatureFlags,
  type ClientNotice,
  type NoticeSeverity,
} from "@shared/client-controls";
import { DEFAULT_BANKING_PREFERENCES, type BankingPreferences } from "@shared/client-settings";
import { adminFetch, StatusLabel } from "./admin-status";

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
    updatedAt?: string;
  } | null;
  bankingPreferences?: BankingPreferences;
  controls?: {
    features: ClientFeatureFlags;
    notice: ClientNotice;
  };
  cards?: ClientCardRecord[];
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

type DetailTab = "overview" | "controls" | "accounts" | "cards" | "activity" | "security" | "fees";

const ACCOUNT_TYPES = [
  "Brokerage Account",
  "Traditional IRA",
  "Roth IRA",
  "401(k) / 403(b)",
  "529 Savings Plan",
  "Trust Account",
] as const;

const FEATURE_CONTROL_ROWS: Array<{
  key: keyof ClientFeatureFlags;
  label: string;
  description: string;
}> = [
  { key: "canViewAccounts", label: "Accounts Workspace", description: "View account cards, balances, and individual ledgers." },
  { key: "canOpenAccounts", label: "Open Account Requests", description: "Submit requests to open new investment or trust accounts." },
  { key: "canTransferInternal", label: "Internal Transfers", description: "Move cash between client-owned accounts." },
  { key: "canWireExternal", label: "External & SWIFT Wires", description: "Submit domestic and international wire disbursements." },
  { key: "canAddBeneficiaries", label: "Beneficiary Management", description: "Add new wire payees and beneficiaries." },
  { key: "canInstitutionalTransfer", label: "Institutional Transfers", description: "Submit ACAT / full-portfolio custody rollover requests." },
  { key: "canViewInvestments", label: "Investments & Holdings", description: "Access Wealth & Custody portfolio views and holdings table." },
  { key: "canTradeInvestments", label: "Live Order Execution", description: "Execute buys/sells when global platform trading is enabled." },
  { key: "canAccessCards", label: "Wealth Cards Access", description: "Show Wealth Cards navigation and card details." },
  { key: "canRequestNewCards", label: "Generate Virtual Cards", description: "Allow client to issue virtual or one-time cards." },
  { key: "canManageOwnCards", label: "Self-Service Card Controls", description: "Allow client to toggle card lock, fraud shield, and online/intl spend." },
  { key: "canExportStatements", label: "CSV Statement Export", description: "Download transaction CSV statements from account detail pages." },
  { key: "canEditContactDetails", label: "Self-Edit Contact & Address", description: "Allow client to update email, phone, and mailing/residential addresses." },
  { key: "canEditPreferences", label: "Self-Edit Preferences", description: "Allow client to modify alert preferences, delivery mode, and session timeout." },
];

function formatAddressLines(addr: Record<string, any> | null | undefined): string[] {
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
  return lines;
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
  freezePending = false,
  restrictPending = false,
}: ClientDetailViewProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [resetResult, setResetResult] = useState<ResetLinkResult | null>(null);
  const [copiedReset, setCopiedReset] = useState(false);

  useEffect(() => {
    setActiveTab("overview");
    setResetResult(null);
    setCopiedReset(false);
  }, [userId]);

  const { data, isLoading, isError, error, refetch } = useQuery<ClientDetailsResponse>({
    queryKey: ["/api/admin/users", userId, "details"],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/details`, adminKey);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed to load client (${res.status})`);
      return body;
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "details"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/cards"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/investments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/client/controls"] });
  };

  // ── Profile / Contact / Preferences State ───────────────────────────────────
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phoneNumber: "",
    clientRef: "",
    initialDepositStatus: "completed" as "required" | "pending_review" | "completed",
    selectedInitialDeposit: "",
    advisorNotes: "",
  });
  const [contactForm, setContactForm] = useState({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
  });
  const [prefsForm, setPrefsForm] = useState<BankingPreferences>(DEFAULT_BANKING_PREFERENCES);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  // ── Feature Controls & Notice State ─────────────────────────────────────────
  const [featuresDraft, setFeaturesDraft] = useState<ClientFeatureFlags>(DEFAULT_CLIENT_FEATURE_FLAGS);
  const [noticeDraft, setNoticeDraft] = useState<ClientNotice>(DEFAULT_CLIENT_NOTICE);
  const [controlsDirty, setControlsDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setProfileForm({
      name: data.user.name || "",
      email: data.user.email || "",
      phoneNumber: data.user.phoneNumber || "",
      clientRef: data.user.clientRef || "",
      initialDepositStatus: data.user.initialDepositStatus || "completed",
      selectedInitialDeposit: data.user.selectedInitialDeposit || "",
      advisorNotes: data.user.advisorNotes || "",
    });
    const resAddr = data.contactDetails?.residentialAddress || {};
    setContactForm({
      line1: String(resAddr.line1 || resAddr.street || ""),
      line2: String(resAddr.line2 || ""),
      city: String(resAddr.city || ""),
      region: String(resAddr.region || resAddr.province || ""),
      postalCode: String(resAddr.postalCode || ""),
      country: String(resAddr.country || ""),
    });
    if (data.bankingPreferences) {
      setPrefsForm(data.bankingPreferences);
    }
    if (data.controls && !controlsDirty) {
      setFeaturesDraft(data.controls.features);
      setNoticeDraft(data.controls.notice);
    }
  }, [data, controlsDirty]);

  // ── Profile & Controls Mutations ────────────────────────────────────────────
  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/profile`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({
          name: profileForm.name.trim(),
          email: profileForm.email.trim(),
          phoneNumber: profileForm.phoneNumber.trim() || null,
          clientRef: profileForm.clientRef.trim() || null,
          initialDepositStatus: profileForm.initialDepositStatus,
          selectedInitialDeposit: profileForm.selectedInitialDeposit.trim() || null,
          advisorNotes: profileForm.advisorNotes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to save profile");
      if (contactForm.line1.trim() && contactForm.city.trim() && contactForm.postalCode.trim() && contactForm.country.trim()) {
        await adminFetch(`/api/admin/users/${userId}/contact`, adminKey, {
          method: "PATCH",
          body: JSON.stringify({
            email: profileForm.email.trim(),
            phoneNumber: profileForm.phoneNumber.trim(),
            residentialAddress: {
              line1: contactForm.line1.trim(),
              line2: contactForm.line2.trim(),
              city: contactForm.city.trim(),
              region: contactForm.region.trim(),
              postalCode: contactForm.postalCode.trim(),
              country: contactForm.country.trim(),
            },
            mailingAddress: null,
          }),
        });
      }
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      setEditProfileOpen(false);
      toast({ title: "Client profile updated" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const savePrefsMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/banking-preferences`, adminKey, {
        method: "PATCH",
        body: JSON.stringify(prefsForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to update preferences");
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Client banking preferences saved" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const saveControlsMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/controls`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ features: featuresDraft, notice: noticeDraft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to save controls");
      return body;
    },
    onSuccess: () => {
      setControlsDirty(false);
      invalidateAll();
      toast({ title: "Client feature controls updated" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // ── Security Actions ────────────────────────────────────────────────────────
  const resetLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/password-reset-link`, adminKey, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to generate password reset link");
      return body;
    },
    onSuccess: (body) => {
      setResetResult({
        userId: body.userId,
        userName: body.userName,
        email: body.email,
        clientRef: body.clientRef ?? null,
        resetUrl: new URL(body.resetPath, window.location.origin).toString(),
        expiresAt: body.expiresAt,
      });
      setCopiedReset(false);
      invalidateAll();
      toast({ title: "Password Reset Link Generated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const activateAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/activate-account`, adminKey, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to activate client account");
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Account Activated", description: "Client initial deposit marked as completed." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/revoke-sessions`, adminKey, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to revoke sessions");
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Sessions Revoked", description: "All active client sessions have been terminated." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const disable2faMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/disable-2fa`, adminKey, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to reset 2FA");
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "2FA Disabled", description: "Authenticator cleared and recovery codes invalidated." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // ── Accounts & Holdings CRUD ────────────────────────────────────────────────
  const [newAccType, setNewAccType] = useState<(typeof ACCOUNT_TYPES)[number]>("Brokerage Account");
  const [newAccDisplayName, setNewAccDisplayName] = useState("");
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [editAccType, setEditAccType] = useState<(typeof ACCOUNT_TYPES)[number]>("Brokerage Account");
  const [editAccDisplayName, setEditAccDisplayName] = useState("");
  const [editAccDemo, setEditAccDemo] = useState(false);

  const createAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/accounts`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          accountType: newAccType,
          displayName: newAccDisplayName.trim() || null,
          isDemo: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to create account");
      return body;
    },
    onSuccess: () => {
      setNewAccDisplayName("");
      invalidateAll();
      toast({ title: "Account provisioned" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateAccountMutation = useMutation({
    mutationFn: async () => {
      if (!editingAccount) return;
      const res = await adminFetch(`/api/admin/accounts/${editingAccount.id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({
          accountType: editAccType,
          displayName: editAccDisplayName.trim() || null,
          isDemo: editAccDemo,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to update account");
      return body;
    },
    onSuccess: () => {
      setEditingAccount(null);
      invalidateAll();
      toast({ title: "Account updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (accountId: number) => {
      const res = await adminFetch(`/api/admin/accounts/${accountId}`, adminKey, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to delete account");
      return body;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const [holdingAccId, setHoldingAccId] = useState<string>("");
  const [holdingSymbol, setHoldingSymbol] = useState("");
  const [holdingShares, setHoldingShares] = useState("");
  const [holdingBuyPrice, setHoldingBuyPrice] = useState("");
  const [holdingCurPrice, setHoldingCurPrice] = useState("");

  const addHoldingMutation = useMutation({
    mutationFn: async () => {
      const targetAccId = Number(holdingAccId || data?.accounts?.[0]?.id);
      if (!targetAccId) throw new Error("Select an account first");
      const res = await adminFetch(`/api/admin/accounts/${targetAccId}/investments`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          symbol: holdingSymbol.trim().toUpperCase(),
          shares: Number(holdingShares),
          purchasePrice: Number(holdingBuyPrice),
          currentPrice: holdingCurPrice ? Number(holdingCurPrice) : Number(holdingBuyPrice),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to add holding");
      return body;
    },
    onSuccess: () => {
      setHoldingSymbol("");
      setHoldingShares("");
      setHoldingBuyPrice("");
      setHoldingCurPrice("");
      invalidateAll();
      toast({ title: "Holding added to account" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteHoldingMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/investments/${id}`, adminKey, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove holding");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Holding removed" });
    },
  });

  // ── Cards CRUD ──────────────────────────────────────────────────────────────
  const [cardLabel, setCardLabel] = useState("");
  const [cardKind, setCardKind] = useState<CardKind>("virtual");
  const [cardNetwork, setCardNetwork] = useState<CardNetwork>("Visa");
  const [cardLimit, setCardLimit] = useState("15000");
  const [cardAccountId, setCardAccountId] = useState("");

  const issueCardMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/cards`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          accountId: cardAccountId ? Number(cardAccountId) : null,
          cardKind,
          label: cardLabel.trim(),
          network: cardNetwork,
          dailyLimit: Number(cardLimit || 10000),
          status: "active",
          fraudProtection: true,
          onlinePayments: true,
          internationalSpend: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to issue card");
      return body;
    },
    onSuccess: () => {
      setCardLabel("");
      invalidateAll();
      toast({ title: "Card issued for client" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateCardMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, any> }) => {
      const res = await adminFetch(`/api/admin/cards/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update card");
    },
    onSuccess: invalidateAll,
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/cards/${id}`, adminKey, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete card");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Card revoked" });
    },
  });

  // ── Beneficiary Direct Add ──────────────────────────────────────────────────
  const [newPayeeName, setNewPayeeName] = useState("");
  const [newPayeeBank, setNewPayeeBank] = useState("");
  const [newPayeeAcct, setNewPayeeAcct] = useState("");
  const [newPayeeRouting, setNewPayeeRouting] = useState("");
  const [newPayeeCountry, setNewPayeeCountry] = useState("Canada");

  const addPayeeMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/payees`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          name: newPayeeName.trim(),
          bankName: newPayeeBank.trim(),
          accountNumber: newPayeeAcct.trim(),
          routingNumber: newPayeeRouting.trim(),
          country: newPayeeCountry.trim() || "Canada",
          currency: clientBalanceCurrency(data?.user),
          type: "individual",
          status: "approved",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to add beneficiary");
      return body;
    },
    onSuccess: () => {
      setNewPayeeName("");
      setNewPayeeBank("");
      setNewPayeeAcct("");
      setNewPayeeRouting("");
      invalidateAll();
      toast({ title: "Beneficiary added & pre-approved" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const copyResetLink = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.resetUrl);
      setCopiedReset(true);
      setTimeout(() => setCopiedReset(false), 2500);
    } catch {
      toast({ title: "Copy manually from box below" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading client control center…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-[#0E1623] p-6 space-y-3">
        <p className="text-sm font-semibold text-rose-300">Unable to load client profile</p>
        <p className="text-xs text-slate-400">{(error as Error)?.message || "Record unavailable."}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onBack} className="border-slate-700 text-slate-200">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
          </Button>
          <Button size="sm" onClick={() => void refetch()} className="bg-emerald-600 text-white">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { user, contactDetails, security, application, accounts, accountRequests = [], investments, transactions, payees, institutionalTransfers, displayCurrencyAudit, fees } = data;
  const cards = data.cards ?? [];
  const currency = clientBalanceCurrency(user);
  const resLines = formatAddressLines(contactDetails?.residentialAddress);
  const mailLines = formatAddressLines(contactDetails?.mailingAddress);

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "overview", label: "Overview & Profile" },
    { id: "controls", label: "UI Controls & Banner" },
    { id: "accounts", label: `Accounts & Holdings (${accounts.length})` },
    { id: "cards", label: `Cards (${cards.length})` },
    { id: "activity", label: `Activity & Wires (${transactions.length})` },
    { id: "security", label: "Security & Access" },
    { id: "fees", label: "Fees & Contracts" },
  ];

  return (
    <div className="space-y-5" data-testid={`client-detail-view-${user.id}`}>
      {/* Header */}
      <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <button
              type="button"
              onClick={onBack}
              data-testid="button-back-to-clients"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Client Directory
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-white">{user.name}</h2>
              <span className="font-mono text-xs text-slate-400">{user.clientRef || `ID #${user.id}`}</span>
              {user.accountFrozen ? (
                <StatusLabel tone="red">Account Frozen</StatusLabel>
              ) : user.loginRestricted ? (
                <StatusLabel tone="amber">Sign-In Restricted</StatusLabel>
              ) : (
                <StatusLabel tone="emerald">Active</StatusLabel>
              )}
              {user.debtClearanceRequired && <StatusLabel tone="red">Debt Hold</StatusLabel>}
              {(user.initialDepositStatus === "required" || user.initialDepositStatus === "pending_review") && (
                <StatusLabel tone="amber">Awaiting Activation</StatusLabel>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono">
              {user.email} · {user.phoneNumber || "No phone"} · {currency}
            </p>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditProfileOpen(true)}
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs gap-1.5"
            >
              <PencilLine className="w-3.5 h-3.5" /> Edit Profile
            </Button>
            {(user.initialDepositStatus === "required" || user.initialDepositStatus === "pending_review") && (
              <Button
                size="sm"
                onClick={() => activateAccountMutation.mutate()}
                disabled={activateAccountMutation.isPending}
                data-testid="button-admin-activate-account"
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" /> Activate Account
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => resetLinkMutation.mutate()}
              disabled={resetLinkMutation.isPending}
              data-testid="button-generate-password-reset"
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" /> Reset Link
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenDebtNotice(user)}
              data-testid={`debt-notice-detail-${user.id}`}
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5" /> Debt Hold
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (user.accountFrozen ? onUnfreeze(user) : onFreeze(user))}
              disabled={freezePending}
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs gap-1.5"
            >
              <Snowflake className="w-3.5 h-3.5" /> {user.accountFrozen ? "Unfreeze" : "Freeze"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (user.loginRestricted ? onUnrestrict(user) : onRestrict(user))}
              disabled={restrictPending}
              className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs gap-1.5"
            >
              {user.loginRestricted ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {user.loginRestricted ? "Unrestrict" : "Restrict"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDeleteProfile(user)}
              data-testid={`button-detail-delete-user-${user.id}`}
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-800">
          <div className="rounded-md bg-slate-950/60 border border-slate-800/80 px-3.5 py-2.5">
            <p className="text-[11px] text-slate-400">Cash Balance</p>
            <p className="text-base font-semibold font-mono tabular-nums text-white mt-0.5">
              {formatBalance(user.totalBalance ?? 0, currency)}
            </p>
          </div>
          <div className="rounded-md bg-slate-950/60 border border-slate-800/80 px-3.5 py-2.5">
            <p className="text-[11px] text-slate-400">Custody Accounts</p>
            <p className="text-base font-semibold font-mono tabular-nums text-white mt-0.5">
              {accounts.length} <span className="text-xs font-normal text-slate-400">({investments.length} holdings)</span>
            </p>
          </div>
          <div className="rounded-md bg-slate-950/60 border border-slate-800/80 px-3.5 py-2.5">
            <p className="text-[11px] text-slate-400">Wealth Cards</p>
            <p className="text-base font-semibold font-mono tabular-nums text-white mt-0.5">
              {cards.filter((c) => c.status === "active").length} active{" "}
              <span className="text-xs font-normal text-slate-400">/ {cards.length} total</span>
            </p>
          </div>
          <div className="rounded-md bg-slate-950/60 border border-slate-800/80 px-3.5 py-2.5">
            <p className="text-[11px] text-slate-400">Security Posture</p>
            <p className="text-sm font-medium text-white mt-0.5">
              {security.mfaEnabled ? "2FA Enforced" : "Password Only"} · v{security.version}
            </p>
          </div>
        </div>

        {resetResult && (
          <div className="rounded-md border border-emerald-500/35 bg-emerald-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-emerald-300">One-Time Password Reset Link Ready: </span>
              <span className="font-mono text-slate-200 break-all">{resetResult.resetUrl}</span>
            </div>
            <Button size="sm" variant="outline" onClick={copyResetLink} className="h-7 text-xs border-emerald-500/40 text-emerald-300">
              {copiedReset ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              {copiedReset ? "Copied" : "Copy Link"}
            </Button>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 pb-0">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-testid={`client-detail-tab-${tab.id}`}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── TAB: OVERVIEW & PROFILE ────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Identity, Contact &amp; Currency</h3>
              <Button size="sm" variant="outline" onClick={() => onOpenCurrency(user)} className="h-7 text-xs border-slate-700 text-slate-200">
                Change Currency ({currency})
              </Button>
            </div>
            <dl className="divide-y divide-slate-800/80 text-xs">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-400">Display Currency</dt>
                <dd className="text-white font-medium">{currency} — {BALANCE_CURRENCY_INFO[currency]?.name || currency}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-400">Activation Status</dt>
                <dd className="text-white capitalize font-mono">{user.initialDepositStatus}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-400">Residential Address</dt>
                <dd className="text-right text-slate-200">{resLines.length ? resLines.join(", ") : "Not on file"}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-400">Mailing Address</dt>
                <dd className="text-right text-slate-200">{mailLines.length ? mailLines.join(", ") : "Same as residential"}</dd>
              </div>
              {user.advisorNotes && (
                <div className="py-2.5">
                  <dt className="text-slate-400 mb-1">Advisor Notes</dt>
                  <dd className="text-slate-200">{user.advisorNotes}</dd>
                </div>
              )}
            </dl>
            {application && (
              <div className="pt-3 border-t border-slate-800 text-xs space-y-1">
                <p className="font-semibold text-slate-300">Onboarding KYC Application (#{application.id})</p>
                <p className="text-slate-400">
                  {formatOnboardingLabel(application.employmentStatus)} · Income {formatOnboardingLabel(application.annualIncome)} · Goal {formatOnboardingLabel(application.investmentGoal)}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Client Banking Preferences</h3>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Statement Delivery</span>
                <select
                  value={prefsForm.statementDelivery}
                  onChange={(e) => setPrefsForm((p) => ({ ...p, statementDelivery: e.target.value as any }))}
                  className="h-8 rounded border border-slate-700 bg-slate-900 px-2.5 text-white"
                >
                  <option value="electronic">Electronic Only</option>
                  <option value="electronic_and_mail">Electronic &amp; Mailed Paper</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Transaction Activity Alerts</span>
                <Switch
                  checked={prefsForm.transactionAlerts}
                  onCheckedChange={(v) => setPrefsForm((p) => ({ ...p, transactionAlerts: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Security Sign-In Alerts</span>
                <Switch
                  checked={prefsForm.loginAlerts}
                  onCheckedChange={(v) => setPrefsForm((p) => ({ ...p, loginAlerts: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Inactivity Timeout</span>
                <select
                  value={prefsForm.sessionTimeoutMinutes}
                  onChange={(e) => setPrefsForm((p) => ({ ...p, sessionTimeoutMinutes: Number(e.target.value) as 5 | 10 | 15 | 25 }))}
                  className="h-8 rounded border border-slate-700 bg-slate-900 px-2.5 text-white font-mono"
                >
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                  <option value={25}>25 min</option>
                </select>
              </div>
              <Button
                size="sm"
                onClick={() => savePrefsMutation.mutate()}
                disabled={savePrefsMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs mt-2"
              >
                {savePrefsMutation.isPending ? "Saving…" : "Save Client Preferences"}
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* ── TAB: PER-CLIENT UI CONTROLS & CUSTOM BANNER ─────────────────────── */}
      {activeTab === "controls" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0E1623] px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Client UI Permissions &amp; Dashboard Notice</h3>
                <p className="text-xs text-slate-400">Override any sidebar section, transfer channel, card action, or self-service edit for {user.name}.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-slate-700 text-slate-200 text-xs"
                onClick={() => {
                  setControlsDirty(true);
                  setFeaturesDraft({ ...DEFAULT_CLIENT_FEATURE_FLAGS, canTradeInvestments: true });
                }}
              >
                Enable All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-700 text-amber-300 text-xs"
                onClick={() => {
                  setControlsDirty(true);
                  setFeaturesDraft({
                    canViewAccounts: true,
                    canOpenAccounts: false,
                    canTransferInternal: false,
                    canWireExternal: false,
                    canAddBeneficiaries: false,
                    canInstitutionalTransfer: false,
                    canViewInvestments: true,
                    canTradeInvestments: false,
                    canAccessCards: true,
                    canRequestNewCards: false,
                    canManageOwnCards: false,
                    canExportStatements: true,
                    canEditContactDetails: false,
                    canEditPreferences: false,
                  });
                }}
              >
                Read-Only Preset
              </Button>
              <Button
                size="sm"
                onClick={() => saveControlsMutation.mutate()}
                disabled={saveControlsMutation.isPending}
                data-testid="button-save-client-controls"
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                {saveControlsMutation.isPending ? "Saving…" : "Save Client Controls"}
              </Button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-slate-800 bg-[#0E1623] divide-y divide-slate-800/80">
              {FEATURE_CONTROL_ROWS.map((row) => {
                const enabled = featuresDraft[row.key];
                return (
                  <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white">{row.label}</span>
                        <StatusLabel tone={enabled ? "emerald" : "neutral"}>
                          {enabled ? "Allowed" : "Restricted"}
                        </StatusLabel>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{row.description}</p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(val) => {
                        setControlsDirty(true);
                        setFeaturesDraft((f) => ({ ...f, [row.key]: val }));
                      }}
                      data-testid={`switch-client-${row.key}`}
                    />
                  </div>
                );
              })}
            </section>

            <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4 h-fit">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-[#C6A15B]" />
                  <h4 className="text-sm font-semibold text-white">Custom Advisor Notice</h4>
                </div>
                <Switch
                  checked={noticeDraft.enabled}
                  onCheckedChange={(val) => {
                    setControlsDirty(true);
                    setNoticeDraft((n) => ({ ...n, enabled: val }));
                  }}
                />
              </div>
              <p className="text-xs text-slate-400">
                Displays a dedicated banner across the top of this client&apos;s portal pages.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300">Severity</label>
                <select
                  value={noticeDraft.severity}
                  onChange={(e) => {
                    setControlsDirty(true);
                    setNoticeDraft((n) => ({ ...n, severity: e.target.value as NoticeSeverity }));
                  }}
                  className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-white"
                >
                  <option value="info">Information</option>
                  <option value="warning">Advisory Warning</option>
                  <option value="critical">Critical Action Required</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300">Banner Title</label>
                <Input
                  value={noticeDraft.title}
                  onChange={(e) => {
                    setControlsDirty(true);
                    setNoticeDraft((n) => ({ ...n, title: e.target.value }));
                  }}
                  placeholder="e.g. Updated Tax Form Required"
                  className="bg-slate-900 border-slate-700 text-white text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300">Message</label>
                <Textarea
                  rows={4}
                  value={noticeDraft.message}
                  onChange={(e) => {
                    setControlsDirty(true);
                    setNoticeDraft((n) => ({ ...n, message: e.target.value }));
                  }}
                  placeholder="Instructions or advisor notice shown to this client."
                  className="bg-slate-900 border-slate-700 text-white text-xs resize-none"
                />
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ── TAB: ACCOUNTS & HOLDINGS ────────────────────────────────────────── */}
      {activeTab === "accounts" && (
        <div className="space-y-6">
          {/* Open New Account Directly */}
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" /> Provision New Custody Account
            </h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <select
                value={newAccType}
                onChange={(e) => setNewAccType(e.target.value as any)}
                className="h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-white"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Input
                value={newAccDisplayName}
                onChange={(e) => setNewAccDisplayName(e.target.value)}
                placeholder="Optional custom label (e.g. Family Trust)"
                className="bg-slate-900 border-slate-700 text-white text-xs h-9"
              />
              <Button
                size="sm"
                onClick={() => createAccountMutation.mutate()}
                disabled={createAccountMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Create Account
              </Button>
            </div>
          </section>

          {/* Accounts Table */}
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Client Accounts ({accounts.length})</h3>
            </div>
            <div className="divide-y divide-slate-800/70">
              {accounts.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No accounts found.</p>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 text-xs">
                    <div>
                      <div className="font-medium text-white">{accountLabel(acc)}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {acc.accountNumber} · {acc.accountType} {acc.isDemo ? "· Demo" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums font-semibold text-white text-sm">
                        {formatBalance(acc.balance, currency)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] border-slate-700 text-slate-200"
                        onClick={() => {
                          setEditingAccount(acc);
                          setEditAccType(acc.accountType);
                          setEditAccDisplayName(acc.displayName || "");
                          setEditAccDemo(Boolean(acc.isDemo));
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-rose-400 hover:text-rose-300"
                        onClick={() => deleteAccountMutation.mutate(acc.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Investment Holdings CRUD */}
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#C6A15B]" /> Investment Holdings ({investments.length})
            </h3>
            {accounts.length > 0 && (
              <div className="grid gap-2.5 sm:grid-cols-6 items-end bg-slate-950/50 border border-slate-800 p-3 rounded-md">
                <select
                  value={holdingAccId || String(accounts[0]?.id || "")}
                  onChange={(e) => setHoldingAccId(e.target.value)}
                  className="h-8 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-white sm:col-span-2"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>
                  ))}
                </select>
                <Input
                  placeholder="Symbol (AAPL)"
                  value={holdingSymbol}
                  onChange={(e) => setHoldingSymbol(e.target.value)}
                  className="h-8 bg-slate-900 border-slate-700 text-white text-xs font-mono"
                />
                <Input
                  type="number"
                  placeholder="Shares"
                  value={holdingShares}
                  onChange={(e) => setHoldingShares(e.target.value)}
                  className="h-8 bg-slate-900 border-slate-700 text-white text-xs font-mono"
                />
                <Input
                  type="number"
                  placeholder="Cost / Price"
                  value={holdingBuyPrice}
                  onChange={(e) => setHoldingBuyPrice(e.target.value)}
                  className="h-8 bg-slate-900 border-slate-700 text-white text-xs font-mono"
                />
                <Button
                  size="sm"
                  disabled={!holdingSymbol.trim() || !holdingShares || !holdingBuyPrice || addHoldingMutation.isPending}
                  onClick={() => addHoldingMutation.mutate()}
                  className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                >
                  Add Holding
                </Button>
              </div>
            )}
            <div className="divide-y divide-slate-800/70 text-xs">
              {investments.length === 0 ? (
                <p className="py-4 text-center text-slate-500">No holdings recorded.</p>
              ) : (
                investments.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-2.5 gap-3">
                    <div>
                      <span className="font-mono font-semibold text-white">{inv.symbol}</span>{" "}
                      <span className="text-slate-400">· {Number(inv.shares).toFixed(4)} shares</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums text-emerald-300">
                        {formatBalance(Number(inv.shares) * Number(inv.currentPrice || inv.purchasePrice), currency)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-rose-400"
                        onClick={() => deleteHoldingMutation.mutate(inv.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {accountRequests.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-2 text-xs">
              <h4 className="font-semibold text-white">Account Opening Request History</h4>
              {accountRequests.map((r: any) => (
                <div key={r.id} className="flex justify-between py-2 border-b border-slate-800/60 last:border-0">
                  <span className="text-slate-200">{r.requestedDisplayName || r.accountType} ({r.jurisdiction})</span>
                  <StatusLabel tone={r.status === "approved" ? "emerald" : r.status === "rejected" ? "red" : "amber"}>
                    {r.status}
                  </StatusLabel>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ── TAB: CARDS & CONTROLS ───────────────────────────────────────────── */}
      {activeTab === "cards" && (
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" /> Issue New Card for {user.name}
            </h3>
            <div className="grid gap-3 sm:grid-cols-5 items-end">
              <Input
                value={cardLabel}
                onChange={(e) => setCardLabel(e.target.value)}
                placeholder="Card label (e.g. Metal Reserve)"
                className="h-9 bg-slate-900 border-slate-700 text-white text-xs sm:col-span-2"
              />
              <select
                value={cardKind}
                onChange={(e) => setCardKind(e.target.value as CardKind)}
                className="h-9 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs text-white"
              >
                <option value="physical">Physical</option>
                <option value="virtual">Virtual</option>
                <option value="one_time">One-Time</option>
                <option value="business_platinum">Business Platinum</option>
              </select>
              <Input
                type="number"
                value={cardLimit}
                onChange={(e) => setCardLimit(e.target.value)}
                placeholder="Daily limit"
                className="h-9 bg-slate-900 border-slate-700 text-white text-xs font-mono"
              />
              <Button
                size="sm"
                disabled={!cardLabel.trim() || issueCardMutation.isPending}
                onClick={() => issueCardMutation.mutate()}
                className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                Issue Card
              </Button>
            </div>
            {accounts.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={cardAccountId}
                  onChange={(e) => setCardAccountId(e.target.value)}
                  className="h-8 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs text-white"
                >
                  <option value="">Portfolio Default (No specific account)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>
                  ))}
                </select>
                <select
                  value={cardNetwork}
                  onChange={(e) => setCardNetwork(e.target.value as CardNetwork)}
                  className="h-8 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs text-white"
                >
                  <option value="Visa">Visa Network</option>
                  <option value="Mastercard">Mastercard Network</option>
                </select>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-[#0E1623] divide-y divide-slate-800/70">
            {cards.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">No cards issued to this client yet.</p>
            ) : (
              cards.map((c) => (
                <div key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div>
                    <div className="font-medium text-white">
                      {c.label} <span className="font-mono text-slate-400">••{c.last4} · Exp {c.expiry}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 capitalize">
                      {c.cardKind.replace("_", " ")} · {c.network} · Daily Limit ${Number(c.dailyLimit || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={c.status}
                      onChange={(e) => updateCardMutation.mutate({ id: c.id, patch: { status: e.target.value as CardStatus } })}
                      className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-white"
                    >
                      <option value="active">Active</option>
                      <option value="locked">Locked</option>
                      <option value="frozen">Frozen</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-slate-300">
                      <Switch
                        checked={c.fraudProtection}
                        onCheckedChange={(v) => updateCardMutation.mutate({ id: c.id, patch: { fraudProtection: v } })}
                      />
                      Fraud
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-slate-300">
                      <Switch
                        checked={c.onlinePayments}
                        onCheckedChange={(v) => updateCardMutation.mutate({ id: c.id, patch: { onlinePayments: v } })}
                      />
                      Online
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-slate-300">
                      <Switch
                        checked={c.internationalSpend}
                        onCheckedChange={(v) => updateCardMutation.mutate({ id: c.id, patch: { internationalSpend: v } })}
                      />
                      Intl
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-rose-400"
                      onClick={() => deleteCardMutation.mutate(c.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* ── TAB: ACTIVITY, BENEFICIARIES & TRANSFERS ────────────────────────── */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Beneficiaries ({payees.length})</h3>
            <div className="grid gap-2.5 sm:grid-cols-6 items-end bg-slate-950/50 border border-slate-800 p-3 rounded-md">
              <Input placeholder="Recipient name" value={newPayeeName} onChange={(e) => setNewPayeeName(e.target.value)} className="h-8 bg-slate-900 border-slate-700 text-white text-xs" />
              <Input placeholder="Bank name" value={newPayeeBank} onChange={(e) => setNewPayeeBank(e.target.value)} className="h-8 bg-slate-900 border-slate-700 text-white text-xs" />
              <Input placeholder="Account / IBAN" value={newPayeeAcct} onChange={(e) => setNewPayeeAcct(e.target.value)} className="h-8 bg-slate-900 border-slate-700 text-white text-xs font-mono" />
              <Input placeholder="Routing / SWIFT" value={newPayeeRouting} onChange={(e) => setNewPayeeRouting(e.target.value)} className="h-8 bg-slate-900 border-slate-700 text-white text-xs font-mono" />
              <Input placeholder="Country" value={newPayeeCountry} onChange={(e) => setNewPayeeCountry(e.target.value)} className="h-8 bg-slate-900 border-slate-700 text-white text-xs" />
              <Button
                size="sm"
                disabled={!newPayeeName.trim() || !newPayeeBank.trim() || !newPayeeAcct.trim() || !newPayeeRouting.trim() || addPayeeMutation.isPending}
                onClick={() => addPayeeMutation.mutate()}
                className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                Add Payee
              </Button>
            </div>
            <div className="divide-y divide-slate-800/70 text-xs">
              {payees.length === 0 ? (
                <p className="py-3 text-slate-500 text-center">No beneficiaries configured.</p>
              ) : (
                payees.map((p) => (
                  <div key={p.id} className="py-2.5 flex justify-between gap-4">
                    <div>
                      <span className="font-medium text-white">{p.name}</span>{" "}
                      <span className="text-slate-400">· {p.bankName} ({p.country || "Domestic"})</span>
                    </div>
                    <StatusLabel tone={p.status === "approved" ? "emerald" : p.status === "rejected" ? "red" : "amber"}>
                      {p.status}
                    </StatusLabel>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Recent Client Transactions ({transactions.length})</h3>
            </div>
            <div className="divide-y divide-slate-800/70 text-xs">
              {transactions.length === 0 ? (
                <p className="p-6 text-center text-slate-500">No recorded transactions.</p>
              ) : (
                transactions.slice(0, 40).map((t) => (
                  <div key={t.id} className="px-5 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-white truncate">{t.description || t.transactionType}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        #{t.id} · {t.transactionType} · {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono tabular-nums font-semibold text-white">{formatCAD(t.amount)}</span>
                      <StatusLabel tone={t.status === "completed" ? "emerald" : t.status === "failed" ? "red" : "amber"}>
                        {t.status}
                      </StatusLabel>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {institutionalTransfers.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-2 text-xs">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" /> Institutional Transfers
              </h4>
              {institutionalTransfers.map((tr) => (
                <div key={tr.id} className="flex justify-between py-2 border-b border-slate-800/60 last:border-0">
                  <span className="text-slate-200">{tr.institutionName} ({destinationCountryName(tr.institutionCountry)})</span>
                  <StatusLabel tone={tr.status === "completed" ? "emerald" : tr.status === "rejected" ? "red" : "amber"}>
                    {tr.status}
                  </StatusLabel>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ── TAB: SECURITY & ACCESS ──────────────────────────────────────────── */}
      {activeTab === "security" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Administrative Security Controls</h3>
            <p className="text-xs text-slate-400">
              Current posture: {security.mfaEnabled ? "Authenticator 2FA Active" : "Password Only"} · Security Version {security.version}
            </p>
            <div className="grid gap-2.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => resetLinkMutation.mutate()}
                disabled={resetLinkMutation.isPending}
                className="justify-start border-slate-700 bg-slate-900/60 text-slate-200 text-xs gap-2"
              >
                <KeyRound className="w-3.5 h-3.5 text-emerald-400" /> Issue One-Time Password Reset Link
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => revokeSessionsMutation.mutate()}
                disabled={revokeSessionsMutation.isPending}
                className="justify-start border-slate-700 bg-slate-900/60 text-slate-200 text-xs gap-2"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Terminate All Active Client Sessions
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => disable2faMutation.mutate()}
                disabled={disable2faMutation.isPending || !security.mfaEnabled}
                className="justify-start border-rose-500/30 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40 text-xs gap-2"
              >
                <ShieldAlert className="w-3.5 h-3.5" /> Force Disable Authenticator 2FA &amp; Clear Recovery Codes
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Security Audit Events ({security.events.length})</h3>
            <div className="divide-y divide-slate-800/70 text-xs max-h-72 overflow-y-auto">
              {security.events.length === 0 ? (
                <p className="py-4 text-slate-500 text-center">No recent security events logged.</p>
              ) : (
                security.events.map((ev) => (
                  <div key={ev.id} className="py-2 flex justify-between gap-3">
                    <span className="font-mono text-slate-200">{ev.event}</span>
                    <span className="font-mono text-slate-400">{new Date(ev.createdAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── TAB: FEES & CONTRACTS ───────────────────────────────────────────── */}
      {activeTab === "fees" && (
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-5 space-y-4 text-xs">
          <h3 className="text-sm font-semibold text-white">Fee Enrollments, Contracts &amp; Assessments</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <p className="font-semibold text-slate-300">Enrollments ({fees.enrollments.length})</p>
              {fees.enrollments.map((e) => (
                <div key={e.id} className="text-slate-400">
                  {e.scheduleName || `Schedule #${e.scheduleId}`} · <span className="text-white">{e.state}</span>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <p className="font-semibold text-slate-300">Management Contracts ({fees.contracts.length})</p>
              {fees.contracts.map((c) => (
                <div key={c.id} className="text-slate-400">
                  {c.annualRatePercent}% · Min {formatCAD(c.annualMinimum)} · <span className="text-white">{c.state}</span>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <p className="font-semibold text-slate-300">Fee Assessments ({fees.assessments.length})</p>
              {fees.assessments.map((a) => (
                <div key={a.id} className="flex justify-between text-slate-400">
                  <span>{a.kind} ({a.period})</span>
                  <span className="font-mono text-white">{formatCAD(a.total)} · {a.status}</span>
                </div>
              ))}
            </div>
          </div>
          {displayCurrencyAudit.length > 0 && (
            <div className="pt-3 border-t border-slate-800 space-y-1">
              <p className="font-semibold text-slate-300">Display Currency Audit Trail</p>
              {displayCurrencyAudit.map((row) => (
                <div key={row.id} className="text-slate-400 font-mono text-[11px]">
                  {row.previousCurrency} → {row.displayCurrency} · {row.actor} · {row.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Client Profile & Address Modal */}
      <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
        <DialogContent className="bg-[#0E1623] border-slate-800 text-white sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Edit Client Profile &amp; Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-slate-300">Full Legal Name</label>
                <Input value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-9" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-300">Client Reference</label>
                <Input value={profileForm.clientRef} onChange={(e) => setProfileForm((p) => ({ ...p, clientRef: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-9 font-mono" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-slate-300">Email</label>
                <Input value={profileForm.email} onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-9" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-300">Phone Number</label>
                <Input value={profileForm.phoneNumber} onChange={(e) => setProfileForm((p) => ({ ...p, phoneNumber: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-9" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-slate-300">Activation / Initial Deposit Status</label>
                <select
                  value={profileForm.initialDepositStatus}
                  onChange={(e) => setProfileForm((p) => ({ ...p, initialDepositStatus: e.target.value as any }))}
                  className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-white"
                >
                  <option value="completed">Completed (Activated)</option>
                  <option value="pending_review">Pending Review</option>
                  <option value="required">Deposit Required</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-slate-300">Initial Deposit Tier</label>
                <Input value={profileForm.selectedInitialDeposit} onChange={(e) => setProfileForm((p) => ({ ...p, selectedInitialDeposit: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-9" />
              </div>
            </div>
            <div className="space-y-1 pt-2 border-t border-slate-800">
              <label className="text-slate-300 font-medium">Residential Address</label>
              <Input placeholder="Street address" value={contactForm.line1} onChange={(e) => setContactForm((c) => ({ ...c, line1: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-8" />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="City" value={contactForm.city} onChange={(e) => setContactForm((c) => ({ ...c, city: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-8" />
                <Input placeholder="Region / State" value={contactForm.region} onChange={(e) => setContactForm((c) => ({ ...c, region: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-8" />
                <Input placeholder="Postal code" value={contactForm.postalCode} onChange={(e) => setContactForm((c) => ({ ...c, postalCode: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-8" />
                <Input placeholder="Country" value={contactForm.country} onChange={(e) => setContactForm((c) => ({ ...c, country: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-8" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-slate-300">Internal Advisor Notes</label>
              <Textarea rows={2} value={profileForm.advisorNotes} onChange={(e) => setProfileForm((p) => ({ ...p, advisorNotes: e.target.value }))} className="bg-slate-900 border-slate-700 text-white resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditProfileOpen(false)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button size="sm" onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              {saveProfileMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Account Modal */}
      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => !open && setEditingAccount(null)}>
        <DialogContent className="bg-[#0E1623] border-slate-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Edit Account Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-slate-300">Account Type</label>
              <select
                value={editAccType}
                onChange={(e) => setEditAccType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-white"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-slate-300">Custom Display Name</label>
              <Input
                value={editAccDisplayName}
                onChange={(e) => setEditAccDisplayName(e.target.value)}
                placeholder="Optional display name"
                className="bg-slate-900 border-slate-700 text-white h-9"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-300">Demo Account Flag</span>
              <Switch checked={editAccDemo} onCheckedChange={setEditAccDemo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditingAccount(null)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button size="sm" onClick={() => updateAccountMutation.mutate()} disabled={updateAccountMutation.isPending} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              Save Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
