import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Users, ArrowLeftRight, Clock, CheckCircle2,
  XCircle, ShieldCheck, LogOut, Wallet, Eye, EyeOff,
  RefreshCw, DollarSign, Activity, FileText, ChevronDown, ChevronUp, Building2,
  Lock, Unlock, Snowflake, Copy, Check, History, UserPlus, UserCheck, ShieldAlert,
  KeyRound, Trash2, LayoutDashboard, Search, ChevronRight, Menu, X, LifeBuoy, FolderPlus
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog as ShadDialog,
  DialogContent as ShadDialogContent,
  DialogHeader as ShadDialogHeader,
  DialogTitle as ShadDialogTitle,
  DialogFooter as ShadDialogFooter,
} from "@/components/ui/dialog";
import { AdminFees } from "@/components/fees/admin-fees";
import { formatCAD } from "@shared/fees";
import { clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { ClientCurrencyPanel } from "@/components/admin/client-currency-panel";
import { DebtRestrictionPanel } from "@/components/admin/debt-restriction-panel";
import { HistoricalBalances } from "@/components/admin/historical-balances";
import { AdminRecoveryRequests } from "@/components/admin/recovery-requests";
import { AdminTransactions, type AdminStaff } from "@/components/admin/admin-transactions";
import { ClientDetailView, type ResetLinkResult } from "@/components/admin/client-detail-view";
import { destinationCountryName } from "@shared/institutional-destination";
import { formatOnboardingLabel } from "@shared/onboarding-options";

type AdminAuthSession = {
  token: string;
  staff: AdminStaff | null;
  legacyKeyMode: boolean;
};

type AdminAuthStatus = {
  configured: boolean;
  bootstrapRequired: boolean;
  envPasswordConfigured: boolean;
  staffCount: number;
};

type AdminSection =
  | "overview"
  | "users"
  | "applications"
  | "account-requests"
  | "transactions"
  | "inst-transfers"
  | "wire"
  | "fees"
  | "historical-balances"
  | "security";

function fmt(amount: string | number) {
  return formatCAD(amount);
}

function adminFetch(path: string, adminKey: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminKey}`,
      "x-admin-key": adminKey,
      ...(options.headers || {}),
    },
  });
}

function InlineTag({
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
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border whitespace-nowrap ${styles[tone]}`}>
      {children}
    </span>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }: { onLogin: (session: AdminAuthSession) => void }) {
  const [mode, setMode] = useState<"staff" | "legacy" | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: authStatus, isLoading: statusLoading } = useQuery<AdminAuthStatus>({
    queryKey: ["/api/admin/auth/status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/auth/status");
      if (!res.ok) throw new Error("Unable to load administrator status");
      return res.json();
    },
    staleTime: 0,
  });

  const defaultMode: "staff" | "legacy" =
    authStatus && authStatus.staffCount === 0 && authStatus.envPasswordConfigured
      ? "legacy"
      : "staff";

  const effectiveMode: "bootstrap" | "staff" | "legacy" = authStatus?.bootstrapRequired
    ? "bootstrap"
    : mode ?? defaultMode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (effectiveMode === "bootstrap") {
        const res = await fetch("/api/admin/auth/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, displayName, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message || "Failed to create initial administrator.");
          return;
        }
        onLogin({ token: data.token, staff: data.staff, legacyKeyMode: false });
        return;
      }

      if (effectiveMode === "legacy") {
        const res = await fetch("/api/admin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message || "Incorrect admin credential.");
          return;
        }
        onLogin({ token: password, staff: null, legacyKeyMode: true });
        return;
      }

      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "Invalid staff credentials.");
        return;
      }
      onLogin({ token: data.token, staff: data.staff, legacyKeyMode: Boolean(data.legacyKeyMode) });
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary/15 border border-primary/30 mb-4">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Veritas Wealth Admin</h1>
          <p className="text-slate-400 mt-1 text-sm">Dual-Control Administration &amp; Client Operations</p>
        </div>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardContent className="pt-6 space-y-4">
            {statusLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Checking administrator setup…
              </div>
            ) : (
              <>
                {effectiveMode === "bootstrap" ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" /> Initial Staff Administrator Setup
                    </p>
                    <p className="text-amber-200/80">
                      No admin credential is configured yet. Create the first staff administrator account to lock down the portal. After signing in, add a second staff admin inside Staff Access for dual-control posting approvals.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => { setMode("staff"); setError(""); }}
                      className={`flex-1 text-xs font-medium py-1.5 px-2.5 rounded-md transition-colors ${effectiveMode === "staff" ? "bg-primary text-white" : "text-slate-400 hover:text-white"}`}
                    >
                      Staff Sign In
                    </button>
                    {authStatus?.envPasswordConfigured && (
                      <button
                        type="button"
                        onClick={() => { setMode("legacy"); setError(""); }}
                        className={`flex-1 text-xs font-medium py-1.5 px-2.5 rounded-md transition-colors ${effectiveMode === "legacy" ? "bg-primary text-white" : "text-slate-400 hover:text-white"}`}
                      >
                        Admin Key
                      </button>
                    )}
                  </div>
                )}

                {effectiveMode === "legacy" && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
                    <span>
                      Sign in with the shared Admin Key to manage staff accounts inside Staff Access. Money-movement review and postings require a personal Staff account.
                    </span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {effectiveMode === "bootstrap" && (
                    <div className="space-y-1.5">
                      <label htmlFor="admin-staff-display-name" className="text-xs font-medium text-slate-300">Full Name (Audit Display Name)</label>
                      <Input
                        id="admin-staff-display-name"
                        name="displayName"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="e.g. Morgan Vance"
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500"
                        data-testid="input-staff-display-name"
                        autoFocus
                      />
                    </div>
                  )}

                  {effectiveMode !== "legacy" && (
                    <div className="space-y-1.5">
                      <label htmlFor="admin-staff-username" className="text-xs font-medium text-slate-300">Staff Username</label>
                      <Input
                        id="admin-staff-username"
                        name="username"
                        autoComplete="username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="e.g. morgan.vance"
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500"
                        data-testid="input-admin-username"
                        autoFocus={effectiveMode === "staff"}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label htmlFor="admin-login-password" className="text-xs font-medium text-slate-300">
                      {effectiveMode === "legacy"
                        ? "Configured Admin Password"
                        : effectiveMode === "staff"
                          ? "Staff Password"
                          : "Personal Staff Password (min 10 chars)"}
                    </label>
                    <div className="relative">
                      <Input
                        id="admin-login-password"
                        name="password"
                        autoComplete="current-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={effectiveMode === "legacy" ? "Enter configured admin password" : "Enter password"}
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                        data-testid="input-admin-password"
                        autoFocus={effectiveMode === "legacy"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      loading ||
                      !password ||
                      (effectiveMode !== "legacy" && !username.trim()) ||
                      (effectiveMode === "bootstrap" && !displayName.trim())
                    }
                    data-testid="button-admin-login"
                  >
                    {loading ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : effectiveMode === "bootstrap" ? (
                      <UserPlus className="w-4 h-4 mr-2" />
                    ) : effectiveMode === "legacy" ? (
                      <KeyRound className="w-4 h-4 mr-2" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 mr-2" />
                    )}
                    {effectiveMode === "bootstrap"
                      ? "Create Initial Staff Admin & Sign In"
                      : effectiveMode === "legacy"
                        ? "Sign In with Admin Key"
                        : "Sign In to Admin"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Application Card ──────────────────────────────────────────────────────────
function ApplicationCard({
  app,
  onApprove,
  onReject,
  onDelete,
  onOpenClient,
  isPending,
}: {
  app: any;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onDelete: (app: any) => void;
  onOpenClient: (userId: number) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-slate-900/60 border border-slate-700/80 overflow-hidden" data-testid={`app-card-${app.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-white font-semibold text-sm">{app.fullName}</span>
            <InlineTag tone={app.status === "approved" ? "emerald" : app.status === "rejected" ? "red" : "amber"}>
              {app.status}
            </InlineTag>
            {app.clientRef && (
              <code className="font-mono text-xs text-emerald-300 bg-slate-950 border border-slate-700 px-2 py-0.5 rounded">
                {app.clientRef}
              </code>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400">
            <span>{app.email}</span>
            <span className="text-slate-600">·</span>
            <span>{app.phone}</span>
            <span className="text-slate-600">·</span>
            <span>{new Date(app.createdAt).toLocaleDateString()}</span>
          </div>
          {app.notes && (
            <p className="mt-1 text-xs text-slate-400 italic">Note: {app.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {app.userId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenClient(app.userId)}
              className="h-8 text-xs border-slate-600 text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              View Profile
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(v => !v)} className="h-8 text-xs text-slate-300 hover:text-white gap-1 whitespace-nowrap shrink-0">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            KYC Details
          </Button>
          {app.status === "pending" && (
            <>
              <Button size="sm" disabled={isPending} onClick={() => onApprove(app.id)}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 whitespace-nowrap shrink-0" data-testid={`button-approve-app-${app.id}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => onReject(app.id)}
                className="h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 whitespace-nowrap shrink-0" data-testid={`button-reject-app-${app.id}`}>
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => onDelete(app)}
            className="h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 whitespace-nowrap shrink-0" data-testid={`button-delete-app-${app.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-4 bg-slate-950/50">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-xs">
            {[
              ["Date of Birth", app.dateOfBirth],
              ["Nationality", app.nationality],
              ["Address", app.address],
              ["City", app.city],
              ["Country", app.country],
              ["Employment", formatOnboardingLabel(app.employmentStatus)],
              ["Annual Income", formatOnboardingLabel(app.annualIncome)],
              ["Inv. Experience", formatOnboardingLabel(app.investmentExperience)],
              ["Risk Tolerance", formatOnboardingLabel(app.riskTolerance)],
              ["Investment Goal", formatOnboardingLabel(app.investmentGoal)],
              ["Initial Deposit", formatOnboardingLabel(app.initialDeposit)],
              ["Preferred Currency", app.preferredCurrency || "CAD"],
              ["Source of Funds", formatOnboardingLabel(app.sourceOfFunds)],
            ].map(([label, value]) => value && (
              <div key={String(label)}>
                <span className="text-slate-500 uppercase tracking-wide text-[11px]">{label}</span>
                <p className="text-slate-200 font-medium mt-0.5">{String(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function AdminDashboard({
  adminKey,
  currentStaff,
  legacyKeyMode,
  onLogout,
}: {
  adminKey: string;
  currentStaff: AdminStaff | null;
  legacyKeyMode: boolean;
  onLogout: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [clientSearch, setClientSearch] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState<"all" | "active" | "frozen" | "restricted" | "debt">("all");
  const [copiedUserRefId, setCopiedUserRefId] = useState<number | null>(null);
  const [directoryResetResult, setDirectoryResetResult] = useState<ResetLinkResult | null>(null);
  const [directoryResetCopied, setDirectoryResetCopied] = useState(false);
  const [directoryResetCopyFailed, setDirectoryResetCopyFailed] = useState(false);

  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [newStaffForm, setNewStaffForm] = useState({ username: "", displayName: "", password: "" });

  const adminGet = useCallback((path: string) =>
    adminFetch(path, adminKey).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Request failed");
      return data;
    }), [adminKey]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["/api/admin/stats"],
    queryFn: () => adminGet("/api/admin/stats"),
    refetchInterval: 30000,
  });

  const { data: allUsers = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: () => adminGet("/api/admin/users"),
  });

  const { data: staffList = [], isLoading: staffLoading, refetch: refetchStaff } = useQuery<any[]>({
    queryKey: ["/api/admin/staff"],
    queryFn: () => adminGet("/api/admin/staff"),
  });

  const createStaffMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch("/api/admin/staff", adminKey, {
        method: "POST",
        body: JSON.stringify(newStaffForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Failed to add staff administrator");
      return data;
    },
    onSuccess: (created) => {
      toast({
        title: "Staff administrator added",
        description: `${created.displayName} (@${created.username}) can now sign in to create or approve postings.`,
      });
      setNewStaffForm({ username: "", displayName: "", password: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/auth/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not add staff admin", description: err.message, variant: "destructive" });
    },
  });

  const toggleStaffActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await adminFetch(`/api/admin/staff/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Failed to update staff status");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      toast({ title: "Staff access updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSignOut = async () => {
    try {
      await adminFetch("/api/admin/logout", adminKey, { method: "POST" });
    } catch {
      // Clear local session regardless of network failure
    }
    queryClient.clear();
    onLogout();
  };

  const { data: instTransfers = [], isLoading: instLoading } = useQuery({
    queryKey: ["/api/admin/institutional-transfers"],
    queryFn: () => adminGet("/api/admin/institutional-transfers"),
    refetchInterval: 30000,
  });

  const updateInstMonitorMutation = useMutation({
    mutationFn: ({ id, status, estimatedCompletionDate, adminNotes }: { id: number; status: string; estimatedCompletionDate?: string; adminNotes?: string }) =>
      adminFetch(`/api/admin/institutional-transfers/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ status, estimatedCompletionDate: estimatedCompletionDate || null, adminNotes }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Monitor Updated", description: "Client's transfer status has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/institutional-transfers"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to update transfer monitor.", variant: "destructive" }),
  });

  const [monitorDialog, setMonitorDialog] = useState<{ transfer: any } | null>(null);
  const [monitorForm, setMonitorForm] = useState({ status: "pending", estimatedCompletionDate: "", adminNotes: "" });

  const { data: allPayees = [], isLoading: payeesLoading } = useQuery({
    queryKey: ["/api/admin/payees"],
    queryFn: () => adminGet("/api/admin/payees"),
    refetchInterval: 30000,
  });

  const { data: wireTransfers = [], isLoading: wireLoading } = useQuery({
    queryKey: ["/api/admin/wire-transfers"],
    queryFn: () => adminGet("/api/admin/wire-transfers"),
    refetchInterval: 30000,
  });

  const approvePayeeMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/api/admin/payees/${id}/approve`, adminKey, { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Beneficiary Approved", description: "Client can now wire to this beneficiary." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payees"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to approve beneficiary.", variant: "destructive" }),
  });

  const rejectPayeeMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/api/admin/payees/${id}/reject`, adminKey, { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Beneficiary Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payees"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to reject beneficiary.", variant: "destructive" }),
  });

  const [wireDialog, setWireDialog] = useState<{ txn: any } | null>(null);
  const [wireForm, setWireForm] = useState({ status: "pending", adminNotes: "" });

  const updateWireMutation = useMutation({
    mutationFn: ({ id, status, adminNotes }: { id: number; status: string; adminNotes?: string }) =>
      adminFetch(`/api/admin/wire-transfers/${id}`, adminKey, {
        method: "PATCH", body: JSON.stringify({ status, adminNotes }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Wire Transfer Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wire-transfers"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to update wire transfer.", variant: "destructive" }),
  });

  const { data: allApplications = [], isLoading: appsLoading, refetch: refetchApps } = useQuery({
    queryKey: ["/api/admin/applications"],
    queryFn: () => adminGet("/api/admin/applications"),
    refetchInterval: 30000,
  });

  const { data: accountRequests = [], isLoading: accountRequestsLoading, refetch: refetchAccountRequests } = useQuery<any[]>({
    queryKey: ["/api/admin/account-requests"],
    queryFn: () => adminGet("/api/admin/account-requests"),
    refetchInterval: 30000,
  });

  const [approveAccountReqDialog, setApproveAccountReqDialog] = useState<{ request: any } | null>(null);
  const [approveAccountReqForm, setApproveAccountReqForm] = useState({ displayName: "", adminNotes: "" });
  const [rejectAccountReqDialog, setRejectAccountReqDialog] = useState<{ request: any } | null>(null);
  const [rejectAccountReqNotes, setRejectAccountReqNotes] = useState("");

  const approveAccountRequestMutation = useMutation({
    mutationFn: async ({ id, displayName, adminNotes }: { id: number; displayName?: string; adminNotes?: string }) => {
      const res = await adminFetch(`/api/admin/account-requests/${id}/approve`, adminKey, {
        method: "POST",
        body: JSON.stringify({ displayName, adminNotes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to approve account request");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Account Opening Approved",
        description: `${data.account?.accountType || "Account"} (${data.account?.accountNumber || "opened"}) is now active.`,
      });
      setApproveAccountReqDialog(null);
      setApproveAccountReqForm({ displayName: "", adminNotes: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/account-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      if (data.account?.userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", data.account.userId, "details"] });
      }
    },
    onError: (err: any) => {
      toast({ title: "Approval Failed", description: err.message, variant: "destructive" });
    },
  });

  const rejectAccountRequestMutation = useMutation({
    mutationFn: async ({ id, adminNotes }: { id: number; adminNotes?: string }) => {
      const res = await adminFetch(`/api/admin/account-requests/${id}/reject`, adminKey, {
        method: "POST",
        body: JSON.stringify({ adminNotes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to reject account request");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Account Request Declined" });
      setRejectAccountReqDialog(null);
      setRejectAccountReqNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/account-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Rejection Failed", description: err.message, variant: "destructive" });
    },
  });

  const [activationResult, setActivationResult] = useState<{
    clientRef: string;
    userName: string;
    activationUrl: string;
    expiresAt: string;
  } | null>(null);
  const [activationCopied, setActivationCopied] = useState(false);
  const [activationCopyError, setActivationCopyError] = useState(false);

  const approveAppMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes?: string }) => {
      const response = await adminFetch(`/api/admin/applications/${id}/approve`, adminKey, {
        method: "POST", body: JSON.stringify({ notes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Failed to approve application");
      return data;
    },
    onSuccess: (data) => {
      setActivationResult({
        clientRef: data.clientRef,
        userName: data.userName,
        activationUrl: new URL(data.activationPath, window.location.origin).toString(),
        expiresAt: data.activationExpiresAt,
      });
      setActivationCopied(false);
      setActivationCopyError(false);
      toast({ title: "Application approved", description: "The Client ID and one-time setup link are ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message || "Failed to approve", variant: "destructive" }),
  });

  const rejectAppMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) =>
      adminFetch(`/api/admin/applications/${id}/reject`, adminKey, {
        method: "POST", body: JSON.stringify({ notes }),
      }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Application Rejected", description: "Applicant notified." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/applications"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to reject application", variant: "destructive" }),
  });

  const directoryResetMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await adminFetch(`/api/admin/users/${userId}/password-reset-link`, adminKey, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to generate password reset link");
      return data;
    },
    onSuccess: (data) => {
      setDirectoryResetResult({
        userId: data.userId,
        userName: data.userName,
        email: data.email,
        clientRef: data.clientRef ?? null,
        resetUrl: new URL(data.resetPath, window.location.origin).toString(),
        expiresAt: data.expiresAt,
      });
      setDirectoryResetCopied(false);
      setDirectoryResetCopyFailed(false);
      toast({
        title: "Password Reset Link Generated",
        description: `One-time reset link ready for ${data.userName} (${data.clientRef || "Client"}).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", data.userId, "details"] });
    },
    onError: (err: any) => {
      toast({ title: "Reset Link Failed", description: err.message, variant: "destructive" });
    },
  });

  const restrictUserMutation = useMutation({
    mutationFn: ({ id, restricted, message }: { id: number; restricted: boolean; message?: string }) =>
      adminFetch(`/api/admin/users/${id}/restrict`, adminKey, {
        method: "POST", body: JSON.stringify({ restricted, message }),
      }).then(r => r.json()),
    onSuccess: (_, vars) => {
      toast({ title: vars.restricted ? "Access Restricted" : "Access Restored", description: vars.restricted ? "User can no longer sign in." : "User can now sign in again." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", vars.id, "details"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to update restriction.", variant: "destructive" }),
  });

  const [restrictDialog, setRestrictDialog] = useState<{ user: any } | null>(null);
  const [restrictMsg, setRestrictMsg] = useState("");
  const [freezeDialog, setFreezeDialog] = useState<{ user: any } | null>(null);
  const [freezeReason, setFreezeReason] = useState("");
  const [currencyClient, setCurrencyClient] = useState<any | null>(null);
  const [debtNoticeClient, setDebtNoticeClient] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "user" | "application" | "account-request" | "inst-transfer" | "payee" | "wire" | "staff";
    id: number;
    title: string;
    description: string;
    isCompletedTxn?: boolean;
  } | null>(null);
  const [reverseWireBalance, setReverseWireBalance] = useState(true);

  const deleteRecordMutation = useMutation({
    mutationFn: async (target: NonNullable<typeof deleteTarget>) => {
      const path =
        target.kind === "user"
          ? `/api/admin/users/${target.id}`
          : target.kind === "application"
            ? `/api/admin/applications/${target.id}`
            : target.kind === "account-request"
              ? `/api/admin/account-requests/${target.id}`
              : target.kind === "inst-transfer"
                ? `/api/admin/institutional-transfers/${target.id}`
                : target.kind === "payee"
                  ? `/api/admin/payees/${target.id}`
                  : target.kind === "wire"
                    ? `/api/admin/transactions/${target.id}?reverseBalance=${target.isCompletedTxn && reverseWireBalance ? "true" : "false"}`
                    : `/api/admin/staff/${target.id}`;
      const res = await adminFetch(path, adminKey, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Failed to delete record (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data, target) => {
      toast({ title: "Record Deleted", description: data?.message || "Database record removed." });
      if (target.kind === "user" && selectedClientId === target.id) {
        setSelectedClientId(null);
      }
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/account-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/postings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/institutional-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wire-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-trail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/auth/status"] });
    },
    onError: (err: any) => toast({ title: "Delete Failed", description: err.message, variant: "destructive" }),
  });

  const freezeUserMutation = useMutation({
    mutationFn: ({ id, frozen, reason }: { id: number; frozen: boolean; reason?: string }) =>
      adminFetch(`/api/admin/users/${id}/freeze`, adminKey, {
        method: "POST", body: JSON.stringify({ frozen, reason }),
      }).then(r => r.json()),
    onSuccess: (_, vars) => {
      toast({
        title: vars.frozen ? "Account Frozen" : "Account Unfrozen",
        description: vars.frozen
          ? "All sessions terminated. Client cannot log in."
          : "Account has been restored to normal access.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", vars.id, "details"] });
      setFreezeDialog(null);
      setFreezeReason("");
    },
    onError: () => toast({ title: "Error", description: "Failed to update account freeze status.", variant: "destructive" }),
  });

  const pendingAppsCount = useMemo(
    () => (Array.isArray(allApplications) ? allApplications.filter((a: any) => a.status === "pending").length : 0),
    [allApplications],
  );
  const pendingAccountReqCount = useMemo(
    () => (Array.isArray(accountRequests) ? accountRequests.filter((r: any) => r.status === "pending").length : 0),
    [accountRequests],
  );
  const pendingTxCount = (stats?.pendingCount ?? 0) + (stats?.pendingSecondAdminCount ?? 0);
  const pendingInstCount = useMemo(
    () => (Array.isArray(instTransfers) ? instTransfers.filter((t: any) => t.status === "pending").length : 0),
    [instTransfers],
  );
  const pendingPayeeCount = useMemo(
    () => (Array.isArray(allPayees) ? allPayees.filter((p: any) => p.status === "pending_approval").length : 0),
    [allPayees],
  );

  const filteredUsers = useMemo(() => {
    const list = Array.isArray(allUsers) ? allUsers : [];
    const q = clientSearch.trim().toLowerCase();
    return list.filter((u: any) => {
      if (clientStatusFilter === "active" && (u.accountFrozen || u.loginRestricted)) return false;
      if (clientStatusFilter === "frozen" && !u.accountFrozen) return false;
      if (clientStatusFilter === "restricted" && (!u.loginRestricted || u.accountFrozen)) return false;
      if (clientStatusFilter === "debt" && !u.debtClearanceRequired) return false;
      if (!q) return true;
      return (
        String(u.name || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q) ||
        String(u.clientRef || "").toLowerCase().includes(q) ||
        String(u.phoneNumber || "").toLowerCase().includes(q) ||
        String(u.id) === q
      );
    });
  }, [allUsers, clientSearch, clientStatusFilter]);

  const selectedClientSummary = useMemo(
    () => (Array.isArray(allUsers) ? allUsers.find((u: any) => u.id === selectedClientId) : null),
    [allUsers, selectedClientId],
  );

  const openClientProfile = (userId: number) => {
    setSelectedClientId(userId);
    setActiveSection("users");
    setMobileNavOpen(false);
  };

  const navigateSection = (sec: AdminSection) => {
    setActiveSection(sec);
    if (sec !== "users") setSelectedClientId(null);
    if (sec === "users") setSelectedClientId(null);
    setMobileNavOpen(false);
  };

  const navGroups: Array<{
    title: string;
    items: Array<{ id: AdminSection; label: string; icon: any; badge?: number; testId?: string }>;
  }> = [
    {
      title: "Workspace",
      items: [
        { id: "overview", label: "Overview", icon: LayoutDashboard },
        { id: "users", label: "Client Directory", icon: Users, badge: Array.isArray(allUsers) ? allUsers.length : 0 },
        { id: "applications", label: "Applications", icon: FileText, badge: pendingAppsCount > 0 ? pendingAppsCount : undefined },
        { id: "account-requests", label: "Account Requests", icon: FolderPlus, badge: pendingAccountReqCount > 0 ? pendingAccountReqCount : undefined, testId: "tab-admin-account-requests" },
      ],
    },
    {
      title: "Operations & Transfers",
      items: [
        {
          id: "transactions",
          label: "Transactions & Approvals",
          icon: ArrowLeftRight,
          badge: pendingTxCount > 0 ? pendingTxCount : undefined,
          testId: "tab-admin-transactions",
        },
        {
          id: "inst-transfers",
          label: "Institutional Transfers",
          icon: Building2,
          badge: pendingInstCount > 0 ? pendingInstCount : undefined,
        },
        {
          id: "wire",
          label: "Wire & Beneficiaries",
          icon: Wallet,
          badge: pendingPayeeCount > 0 ? pendingPayeeCount : undefined,
        },
      ],
    },
    {
      title: "Billing & Security",
      items: [
        { id: "fees", label: "Service & Mgmt Fees", icon: DollarSign },
        { id: "historical-balances", label: "Historical Balances", icon: History },
        { id: "security", label: "Recovery Requests", icon: LifeBuoy },
      ],
    },
  ];

  const sectionLabels: Record<AdminSection, string> = {
    overview: "Operations Overview",
    users: "Client Directory",
    applications: "Account Applications",
    "account-requests": "Client Account Opening Requests",
    transactions: "Transactions & Dual-Control Postings",
    "inst-transfers": "Institutional Transfers",
    wire: "Wire Disbursements & Beneficiaries",
    fees: "Service & Management Fees",
    "historical-balances": "Historical Balances",
    security: "2FA Recovery Requests",
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between">
      <div className="space-y-6">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/35 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">Veritas Wealth</p>
              <p className="text-[11px] text-slate-400 truncate">Admin Console</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white p-1"
            aria-label="Close navigation menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="space-y-5 px-2" aria-label="Admin sections">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateSection(item.id)}
                      data-testid={item.testId}
                      className={`w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        active
                          ? "bg-primary/15 text-white border border-primary/30"
                          : "text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-slate-400"}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded ${
                          active ? "bg-primary/25 text-white" : "bg-slate-800 text-slate-300"
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-slate-800 p-3 space-y-2.5">
        <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs">
          {currentStaff ? (
            <div>
              <p className="font-medium text-white truncate">{currentStaff.displayName}</p>
              <p className="font-mono text-[11px] text-emerald-400 truncate">@{currentStaff.username}</p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>Shared Key Mode</span>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setStaffDialogOpen(true); refetchStaff(); }}
          className="w-full justify-start border-slate-700 text-slate-200 hover:bg-slate-800 text-xs h-8 whitespace-nowrap"
          data-testid="button-manage-staff"
        >
          <UserPlus className="w-3.5 h-3.5 mr-2 shrink-0" />
          Staff Access ({Array.isArray(staffList) ? staffList.filter((s: any) => s.active).length : 0})
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 bg-slate-950 sticky top-0 h-screen overflow-y-auto p-3">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative z-10 w-64 max-w-[85vw] bg-slate-950 border-r border-slate-800 h-full overflow-y-auto p-3">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Top Header Bar */}
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 sm:px-7 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden rounded-md border border-slate-700 p-1.5 text-slate-300 hover:text-white hover:bg-slate-800"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <button
                type="button"
                onClick={() => navigateSection("overview")}
                className="text-slate-400 hover:text-white transition-colors hidden sm:inline whitespace-nowrap"
              >
                Admin
              </button>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <button
                type="button"
                onClick={() => {
                  if (activeSection === "users" && selectedClientId !== null) {
                    setSelectedClientId(null);
                  }
                }}
                className={`font-semibold truncate ${
                  activeSection === "users" && selectedClientId !== null
                    ? "text-slate-300 hover:text-white"
                    : "text-white"
                }`}
              >
                {sectionLabels[activeSection]}
              </button>
              {activeSection === "users" && selectedClientId !== null && (
                <>
                  <span className="text-slate-600">/</span>
                  <span className="text-emerald-300 font-medium truncate">
                    {selectedClientSummary
                      ? `${selectedClientSummary.name}${selectedClientSummary.clientRef ? ` (${selectedClientSummary.clientRef})` : ""}`
                      : `Client #${selectedClientId}`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void refetchStats();
                void refetchUsers();
                void refetchApps();
                void refetchAccountRequests();
              }}
              className="text-slate-400 hover:text-white hover:bg-slate-800 h-8 text-xs whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-slate-400 hover:text-white hover:bg-slate-800 h-8 text-xs whitespace-nowrap shrink-0"
              data-testid="button-admin-logout"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Sign Out
            </Button>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-7 py-6 space-y-6">
          {legacyKeyMode && !currentStaff && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
              <span>
                You signed in with the shared Admin Key. To create, approve, or reverse money movements, add a staff administrator under <strong>Staff Access</strong> and sign in with your personal staff credentials.
              </span>
            </div>
          )}

          {/* Shared Modals for Client Operations (available from Directory and Client Profile Detail view) */}
          <DebtRestrictionPanel user={debtNoticeClient} adminKey={adminKey} onClose={() => setDebtNoticeClient(null)} />
          <ClientCurrencyPanel
            user={currencyClient}
            adminKey={adminKey}
            open={!!currencyClient}
            onOpenChange={open => { if (!open) setCurrencyClient(null); }}
          />

          <ShadDialog open={!!freezeDialog} onOpenChange={(o) => { if (!o) { setFreezeDialog(null); setFreezeReason(""); } }}>
            <ShadDialogContent className="bg-slate-900 border-sky-500/35 text-white">
              <ShadDialogHeader>
                <ShadDialogTitle className="flex items-center gap-2">
                  <Snowflake className="w-4 h-4 text-sky-400" />
                  Freeze Account — {freezeDialog?.user?.name}
                </ShadDialogTitle>
              </ShadDialogHeader>
              <div className="space-y-3 py-2">
                <div className="bg-sky-500/10 border border-sky-500/25 rounded-lg px-3 py-2.5 text-xs text-sky-200">
                  Freezing this account terminates all active sessions and prevents the client from signing in. API access is blocked with a compliance hold notice.
                </div>
                <label htmlFor="admin-freeze-reason" className="text-xs font-medium text-slate-300 block">
                  Compliance freeze reason
                </label>
                <Textarea
                  id="admin-freeze-reason"
                  name="freezeReason"
                  value={freezeReason}
                  onChange={e => setFreezeReason(e.target.value)}
                  placeholder="e.g. Account suspended pending fraud investigation — Reference: FRD-2025-0142."
                  className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 min-h-[100px] resize-none"
                />
                <p className="text-slate-500 text-xs">Freeze reason is required and retained in client records.</p>
              </div>
              <ShadDialogFooter>
                <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => { setFreezeDialog(null); setFreezeReason(""); }}>Cancel</Button>
                <Button
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                  disabled={!freezeReason.trim() || freezeUserMutation.isPending}
                  onClick={() => freezeUserMutation.mutate({ id: freezeDialog!.user.id, frozen: true, reason: freezeReason.trim() })}
                >
                  <Snowflake className="w-3.5 h-3.5 mr-1.5" />
                  Freeze Account
                </Button>
              </ShadDialogFooter>
            </ShadDialogContent>
          </ShadDialog>

          <ShadDialog open={!!restrictDialog} onOpenChange={(o) => { if (!o) { setRestrictDialog(null); setRestrictMsg(""); } }}>
            <ShadDialogContent className="bg-slate-900 border-slate-700 text-white">
              <ShadDialogHeader>
                <ShadDialogTitle className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-red-400" />
                  Restrict Login — {restrictDialog?.user?.name}
                </ShadDialogTitle>
              </ShadDialogHeader>
              <div className="space-y-3 py-2">
                <p className="text-slate-400 text-sm">This client will be blocked from signing in. Optionally provide a notice displayed on sign-in attempts.</p>
                <label htmlFor="admin-restrict-message" className="text-xs font-medium text-slate-300 block">
                  Client-facing restriction message (optional)
                </label>
                <Textarea
                  id="admin-restrict-message"
                  name="restrictMessage"
                  value={restrictMsg}
                  onChange={e => setRestrictMsg(e.target.value)}
                  placeholder="e.g. Your account is temporarily restricted pending KYC review."
                  className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 min-h-[100px] resize-none"
                />
              </div>
              <ShadDialogFooter>
                <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => { setRestrictDialog(null); setRestrictMsg(""); }}>Cancel</Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={restrictUserMutation.isPending}
                  onClick={() => {
                    restrictUserMutation.mutate({ id: restrictDialog!.user.id, restricted: true, message: restrictMsg || undefined }, {
                      onSuccess: () => { setRestrictDialog(null); setRestrictMsg(""); }
                    });
                  }}
                >
                  <Lock className="w-3.5 h-3.5 mr-1.5" />
                  Restrict Access
                </Button>
              </ShadDialogFooter>
            </ShadDialogContent>
          </ShadDialog>

          {/* ── VIEW 1: OPERATIONS OVERVIEW ── */}
          {activeSection === "overview" && (
            <div className="space-y-6">
              {/* Top Metric Strip */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "Total Clients", value: statsLoading ? "—" : stats?.userCount ?? 0, icon: Users, tone: "text-white" },
                  { label: "Transactions", value: statsLoading ? "—" : stats?.txCount ?? 0, icon: ArrowLeftRight, tone: "text-white" },
                  { label: "Pending Review", value: statsLoading ? "—" : pendingTxCount, icon: Clock, tone: pendingTxCount > 0 ? "text-amber-300" : "text-white" },
                  { label: "Completed Volume", value: statsLoading ? "—" : fmt(stats?.totalVolume ?? 0), icon: DollarSign, tone: "text-emerald-300" },
                  { label: "Total Cash (CAD)", value: statsLoading ? "—" : fmt(stats?.totalAssets ?? 0), icon: Wallet, tone: "text-sky-300" },
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <div key={metric.label} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-medium uppercase tracking-wider">{metric.label}</span>
                        <Icon className="h-4 w-4 text-slate-500" />
                      </div>
                      <p className={`mt-2 font-mono text-xl font-semibold tabular-nums ${metric.tone}`}>
                        {metric.value}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Action Queues + Quick Client Directory */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white">Pending Operations Queue</h2>
                  <div className="divide-y divide-slate-800 text-xs">
                    {[
                      { label: "Onboarding Applications", count: pendingAppsCount, target: "applications" as AdminSection },
                      { label: "Account Opening Requests", count: pendingAccountReqCount, target: "account-requests" as AdminSection },
                      { label: "Transactions & 2nd-Admin Postings", count: pendingTxCount, target: "transactions" as AdminSection },
                      { label: "Institutional Transfers", count: pendingInstCount, target: "inst-transfers" as AdminSection },
                      { label: "Beneficiary Approvals", count: pendingPayeeCount, target: "wire" as AdminSection },
                    ].map((row) => (
                      <button
                        key={row.label}
                        type="button"
                        onClick={() => navigateSection(row.target)}
                        className="w-full py-3 flex items-center justify-between gap-2 text-left hover:text-white transition-colors group"
                      >
                        <span className="text-slate-300 group-hover:text-white">{row.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`font-mono font-semibold tabular-nums ${row.count > 0 ? "text-amber-300" : "text-slate-500"}`}>
                            {row.count}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-white" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-white">Recent Clients &amp; References</h2>
                      <p className="text-xs text-slate-400">Select any client to view full profile, accounts, and password reset controls.</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigateSection("users")}
                      className="h-8 text-xs border-slate-700 text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      All Clients ({Array.isArray(allUsers) ? allUsers.length : 0})
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-4 py-2.5">Client Ref</th>
                          <th className="px-4 py-2.5">Client</th>
                          <th className="px-4 py-2.5 text-right">Cash Balance</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(Array.isArray(allUsers) ? allUsers.slice(0, 8) : []).map((u: any) => (
                          <tr key={u.id} className="hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono text-emerald-300 font-medium whitespace-nowrap">
                              {u.clientRef || "Unassigned"}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => openClientProfile(u.id)}
                                className="text-left font-medium text-white hover:text-emerald-300 transition-colors"
                              >
                                {u.name}
                              </button>
                              <p className="text-slate-400 text-[11px]">{u.email}</p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                              {formatBalance(u.totalBalance ?? 0, clientBalanceCurrency(u))}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {u.accountFrozen ? (
                                <InlineTag tone="sky">Frozen</InlineTag>
                              ) : u.loginRestricted ? (
                                <InlineTag tone="red">Restricted</InlineTag>
                              ) : (
                                <InlineTag tone="emerald">Active</InlineTag>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openClientProfile(u.id)}
                                className="h-7 text-xs text-slate-300 hover:text-white"
                              >
                                View Profile <ChevronRight className="ml-1 h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {(!Array.isArray(allUsers) || allUsers.length === 0) && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                              No registered clients yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── VIEW 2: CLIENT DIRECTORY OR DEDICATED CLIENT PROFILE DETAIL VIEW ── */}
          {activeSection === "users" && selectedClientId !== null && (
            <ClientDetailView
              userId={selectedClientId}
              adminKey={adminKey}
              onBack={() => setSelectedClientId(null)}
              onOpenCurrency={(u) => setCurrencyClient(u)}
              onOpenDebtNotice={(u) => setDebtNoticeClient(u)}
              onFreeze={(u) => { setFreezeDialog({ user: u }); setFreezeReason(""); }}
              onUnfreeze={(u) => freezeUserMutation.mutate({ id: u.id, frozen: false })}
              onRestrict={(u) => { setRestrictDialog({ user: u }); setRestrictMsg(""); }}
              onUnrestrict={(u) => restrictUserMutation.mutate({ id: u.id, restricted: false })}
              onDeleteProfile={(u) => setDeleteTarget({
                kind: "user",
                id: u.id,
                title: `Delete client profile "${u.name}" (${u.clientRef || `#${u.id}`})?`,
                description: `This permanently deletes ${u.name} (${u.email}) and ALL of their accounts, balances, transactions, holdings, institutional transfers, beneficiaries, fee schedules/assessments, historical balance imports, security/2FA records, and active sessions.`,
              })}
              freezePending={freezeUserMutation.isPending}
              restrictPending={restrictUserMutation.isPending}
            />
          )}

          {activeSection === "users" && selectedClientId === null && (
            <div className="space-y-5">
              {/* Generated Password Reset Link Banner from Directory */}
              {directoryResetResult && (
                <div
                  className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-4 space-y-3"
                  data-testid="directory-password-reset-result"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                        <KeyRound className="h-4 w-4" />
                        One-Time Password Reset Link Ready
                      </h3>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {directoryResetResult.userName} · Client Ref: <strong className="font-mono text-white">{directoryResetResult.clientRef || "Unassigned"}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-mono">
                        Expires {new Date(directoryResetResult.expiresAt).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDirectoryResetResult(null)}
                        className="text-slate-400 hover:text-white"
                        aria-label="Dismiss reset link notice"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      readOnly
                      value={directoryResetResult.resetUrl}
                      aria-label="One-time password reset link"
                      onFocus={(e) => e.currentTarget.select()}
                      className="border-slate-600 bg-slate-950 font-mono text-xs text-slate-100"
                      data-testid="input-directory-reset-link"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 whitespace-nowrap shrink-0"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(directoryResetResult.resetUrl);
                          setDirectoryResetCopied(true);
                          setDirectoryResetCopyFailed(false);
                        } catch {
                          setDirectoryResetCopied(false);
                          setDirectoryResetCopyFailed(true);
                        }
                      }}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      {directoryResetCopied ? "Copied" : "Copy Reset Link"}
                    </Button>
                  </div>
                  {directoryResetCopyFailed && (
                    <p className="text-xs text-amber-300">Copy was blocked by the browser. Select the URL above and copy manually.</p>
                  )}
                </div>
              )}

              {/* Search & Filter Toolbar */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <label htmlFor="admin-client-search" className="sr-only">
                    Search clients by name, Client Reference, email, or ID
                  </label>
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    id="admin-client-search"
                    name="clientSearch"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search by Client Ref (VW-...), name, email, or phone…"
                    className="pl-9 bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                    data-testid="input-admin-client-search"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    { id: "all", label: "All" },
                    { id: "active", label: "Active" },
                    { id: "frozen", label: "Frozen" },
                    { id: "restricted", label: "Restricted" },
                    { id: "debt", label: "Debt Hold" },
                  ] as const).map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setClientStatusFilter(filter.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
                        clientStatusFilter === filter.id
                          ? "bg-primary/20 border-primary/40 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Client Table / Directory */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Registered Clients ({filteredUsers.length})
                  </h2>
                  <span className="text-xs text-slate-400">Click any client to inspect full details</span>
                </div>

                {usersLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading clients…
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    No matching client profiles found.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {filteredUsers.map((u: any) => (
                      <div
                        key={u.id}
                        className={`p-4 transition-colors hover:bg-slate-800/30 ${
                          u.accountFrozen ? "bg-sky-950/15" : u.loginRestricted ? "bg-red-950/10" : ""
                        }`}
                        data-testid={`user-row-${u.id}`}
                      >
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => openClientProfile(u.id)}
                                className="text-left text-sm font-semibold text-white hover:text-emerald-300 transition-colors"
                                data-testid={`button-open-client-${u.id}`}
                              >
                                {u.name}
                              </button>
                              <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-emerald-300">
                                {u.clientRef || "Unassigned"}
                                {u.clientRef && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(u.clientRef);
                                        setCopiedUserRefId(u.id);
                                        setTimeout(() => setCopiedUserRefId(null), 1600);
                                      } catch {
                                        setCopiedUserRefId(null);
                                      }
                                    }}
                                    className="text-slate-400 hover:text-white ml-0.5"
                                    title="Copy Client Reference"
                                  >
                                    {copiedUserRefId === u.id ? (
                                      <Check className="h-3 w-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </button>
                                )}
                              </span>
                              <span className="font-mono text-xs text-slate-500">#{u.id}</span>
                              {u.accountFrozen && <InlineTag tone="sky"><Snowflake className="h-3 w-3" /> Frozen</InlineTag>}
                              {u.loginRestricted && !u.accountFrozen && <InlineTag tone="red"><Lock className="h-3 w-3" /> Restricted</InlineTag>}
                              {!u.accountFrozen && !u.loginRestricted && <InlineTag tone="emerald">Active</InlineTag>}
                              {u.debtClearanceRequired && <InlineTag tone="amber">Debt Hold</InlineTag>}
                              <InlineTag tone={u.mfaEnabled ? "emerald" : "neutral"}>
                                {u.mfaEnabled ? "2FA On" : "2FA Off"}
                              </InlineTag>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                              <span>{u.email}</span>
                              <span className="text-slate-600">·</span>
                              <span>{u.phoneNumber || "No phone"}</span>
                              <span className="text-slate-600">·</span>
                              <span className="font-mono text-slate-300">{u.accountCount} acct{u.accountCount !== 1 ? "s" : ""}</span>
                              <span className="text-slate-600">·</span>
                              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                                {u.totalBalance === null || u.totalBalance === undefined
                                  ? "Unavailable"
                                  : formatBalance(u.totalBalance, clientBalanceCurrency(u))}
                                <span className="ml-1 font-sans text-slate-500 font-normal">
                                  ({clientBalanceCurrency(u)})
                                </span>
                              </span>
                              <span className="text-slate-600">·</span>
                              <span>Joined {new Date(u.createdAt).toLocaleDateString("en-CA")}</span>
                            </div>

                            {u.accountFrozen && u.freezeReason && (
                              <p className="text-xs text-sky-300/80 italic">Freeze reason: "{u.freezeReason}"</p>
                            )}
                            {u.loginRestricted && !u.accountFrozen && u.loginRestrictionMessage && (
                              <p className="text-xs text-red-300/80 italic">Restriction: "{u.loginRestrictionMessage}"</p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              onClick={() => openClientProfile(u.id)}
                              className="h-8 bg-primary hover:bg-primary/90 text-white text-xs whitespace-nowrap shrink-0"
                              data-testid={`button-view-profile-${u.id}`}
                            >
                              Full Profile
                              <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={directoryResetMutation.isPending}
                              onClick={() => directoryResetMutation.mutate(u.id)}
                              className="h-8 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs whitespace-nowrap shrink-0"
                              data-testid={`button-reset-link-${u.id}`}
                            >
                              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                              Reset Password Link
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-slate-600 text-slate-200 hover:bg-slate-800 text-xs whitespace-nowrap shrink-0"
                              onClick={() => setCurrencyClient(u)}
                            >
                              Display &amp; Accounts
                            </Button>
                            {u.debtClearanceRequired && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs whitespace-nowrap shrink-0"
                                data-testid={`debt-notice-admin-${u.id}`}
                                onClick={() => setDebtNoticeClient(u)}
                              >
                                Debt Notice
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs whitespace-nowrap shrink-0"
                              data-testid={`button-delete-user-${u.id}`}
                              onClick={() => setDeleteTarget({
                                kind: "user",
                                id: u.id,
                                title: `Delete client profile "${u.name}" (${u.clientRef || `#${u.id}`})?`,
                                description: `This permanently deletes ${u.name} (${u.email}) and ALL of their accounts, balances, transactions, holdings, institutional transfers, beneficiaries, fee schedules/assessments, historical balance imports, security/2FA records, and active sessions.`,
                              })}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── VIEW 3: ACCOUNT APPLICATIONS ── */}
          {activeSection === "applications" && (
            <Card className="bg-slate-900/70 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Account Applications
                  <Button size="sm" variant="ghost" onClick={() => refetchApps()} className="ml-auto text-slate-400 hover:text-white">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activationResult && (
                  <div className="mb-5 rounded-lg border border-emerald-500/35 bg-emerald-950/30 p-4" data-testid="application-activation-result">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <h3 className="text-sm font-semibold text-emerald-300">
                        Approved: {activationResult.userName}
                      </h3>
                      <span className="font-mono text-sm text-white">
                        Client ID: {activationResult.clientRef}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">
                      Verify the recipient through an established contact method before sharing. This setup link expires {new Date(activationResult.expiresAt).toLocaleString()} and can be used once.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        readOnly
                        value={activationResult.activationUrl}
                        aria-label="One-time account setup link"
                        className="min-w-0 border-slate-600 bg-slate-950 font-mono text-xs text-slate-200"
                        onFocus={event => event.currentTarget.select()}
                        data-testid="input-activation-link"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-slate-500 text-slate-200 whitespace-nowrap"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(activationResult.activationUrl);
                            setActivationCopied(true);
                            setActivationCopyError(false);
                          } catch {
                            setActivationCopied(false);
                            setActivationCopyError(true);
                          }
                        }}
                        data-testid="button-copy-activation-link"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        {activationCopied ? "Copied" : "Copy link"}
                      </Button>
                    </div>
                    {activationCopyError && (
                      <p className="mt-2 text-xs text-amber-300">Copy was blocked by the browser. Select the link above and copy it manually.</p>
                    )}
                  </div>
                )}
                {appsLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                  </div>
                ) : !Array.isArray(allApplications) || allApplications.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No applications yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allApplications.map((app: any) => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        onApprove={(id) => approveAppMutation.mutate({ id })}
                        onReject={(id) => rejectAppMutation.mutate({ id })}
                        onOpenClient={(uid) => openClientProfile(uid)}
                        onDelete={(targetApp) => setDeleteTarget({
                          kind: "application",
                          id: targetApp.id,
                          title: `Delete application #${targetApp.id}?`,
                          description: `Permanently remove the onboarding application for ${targetApp.fullName} (${targetApp.email}) from the database.`,
                        })}
                        isPending={approveAppMutation.isPending || rejectAppMutation.isPending || deleteRecordMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── VIEW 3B: CLIENT ACCOUNT OPENING REQUESTS ── */}
          {activeSection === "account-requests" && (
            <div className="space-y-4">
              {/* Approve Account Request Dialog */}
              <ShadDialog open={!!approveAccountReqDialog} onOpenChange={(o) => { if (!o) setApproveAccountReqDialog(null); }}>
                <ShadDialogContent className="bg-slate-900 border-emerald-500/35 text-white max-w-md">
                  <ShadDialogHeader>
                    <ShadDialogTitle className="flex items-center gap-2 text-white">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Approve &amp; Open Account — AR-{approveAccountReqDialog?.request?.id}
                    </ShadDialogTitle>
                  </ShadDialogHeader>
                  <div className="space-y-4 py-2 text-xs">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                      <p className="text-slate-200 font-semibold">
                        {approveAccountReqDialog?.request?.accountType} · {approveAccountReqDialog?.request?.userName}
                      </p>
                      <p className="text-slate-400">
                        {approveAccountReqDialog?.request?.ownershipStructure} · {approveAccountReqDialog?.request?.expectedInitialFunding} · {approveAccountReqDialog?.request?.jurisdiction}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="approve-account-display-name" className="text-xs font-medium text-slate-300 block">
                        Account Label / Display Name <span className="text-slate-500">(optional)</span>
                      </label>
                      <Input
                        id="approve-account-display-name"
                        value={approveAccountReqForm.displayName}
                        onChange={(e) => setApproveAccountReqForm(f => ({ ...f, displayName: e.target.value }))}
                        placeholder="Leave blank to use default account type name"
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                        data-testid="input-approve-account-display-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="approve-account-notes" className="text-xs font-medium text-slate-300 block">
                        Compliance / Advisor Note <span className="text-slate-500">(optional)</span>
                      </label>
                      <Textarea
                        id="approve-account-notes"
                        value={approveAccountReqForm.adminNotes}
                        onChange={(e) => setApproveAccountReqForm(f => ({ ...f, adminNotes: e.target.value }))}
                        placeholder="e.g. Mandate and funding source verified. Account opened."
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 min-h-[80px] resize-none"
                        data-testid="input-approve-account-notes"
                      />
                    </div>
                  </div>
                  <ShadDialogFooter>
                    <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setApproveAccountReqDialog(null)}>
                      Cancel
                    </Button>
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap shrink-0"
                      disabled={approveAccountRequestMutation.isPending}
                      onClick={() => approveAccountRequestMutation.mutate({
                        id: approveAccountReqDialog!.request.id,
                        displayName: approveAccountReqForm.displayName.trim() || undefined,
                        adminNotes: approveAccountReqForm.adminNotes.trim() || undefined,
                      })}
                      data-testid="button-confirm-approve-account-request"
                    >
                      {approveAccountRequestMutation.isPending ? "Opening Account…" : "Approve & Open Account"}
                    </Button>
                  </ShadDialogFooter>
                </ShadDialogContent>
              </ShadDialog>

              {/* Reject Account Request Dialog */}
              <ShadDialog open={!!rejectAccountReqDialog} onOpenChange={(o) => { if (!o) setRejectAccountReqDialog(null); }}>
                <ShadDialogContent className="bg-slate-900 border-red-500/35 text-white max-w-md">
                  <ShadDialogHeader>
                    <ShadDialogTitle className="flex items-center gap-2 text-white">
                      <XCircle className="w-4 h-4 text-red-400" />
                      Decline Account Request — AR-{rejectAccountReqDialog?.request?.id}
                    </ShadDialogTitle>
                  </ShadDialogHeader>
                  <div className="space-y-3 py-2 text-xs">
                    <p className="text-slate-300">
                      Decline {rejectAccountReqDialog?.request?.userName}'s request to open a{" "}
                      <strong className="text-white">{rejectAccountReqDialog?.request?.accountType}</strong>.
                    </p>
                    <div className="space-y-1.5">
                      <label htmlFor="reject-account-notes" className="text-xs font-medium text-slate-300 block">
                        Decline Reason / Client Note
                      </label>
                      <Textarea
                        id="reject-account-notes"
                        value={rejectAccountReqNotes}
                        onChange={(e) => setRejectAccountReqNotes(e.target.value)}
                        placeholder="Provide the reason shown to the client on their request tracker."
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 min-h-[90px] resize-none"
                        data-testid="input-reject-account-notes"
                      />
                    </div>
                  </div>
                  <ShadDialogFooter>
                    <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setRejectAccountReqDialog(null)}>
                      Cancel
                    </Button>
                    <Button
                      className="bg-red-600 hover:bg-red-700 text-white whitespace-nowrap shrink-0"
                      disabled={rejectAccountRequestMutation.isPending}
                      onClick={() => rejectAccountRequestMutation.mutate({
                        id: rejectAccountReqDialog!.request.id,
                        adminNotes: rejectAccountReqNotes.trim() || undefined,
                      })}
                      data-testid="button-confirm-reject-account-request"
                    >
                      {rejectAccountRequestMutation.isPending ? "Declining…" : "Confirm Decline"}
                    </Button>
                  </ShadDialogFooter>
                </ShadDialogContent>
              </ShadDialog>

              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-primary" />
                    Client Account Opening Requests
                    {pendingAccountReqCount > 0 && (
                      <InlineTag tone="amber">{pendingAccountReqCount} pending</InlineTag>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => refetchAccountRequests()} className="ml-auto text-slate-400 hover:text-white">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {accountRequestsLoading ? (
                    <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
                      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading account requests…
                    </div>
                  ) : !Array.isArray(accountRequests) || accountRequests.length === 0 ? (
                    <div className="text-center py-12">
                      <FolderPlus className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-slate-400 text-sm">No account opening requests submitted yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {accountRequests.map((reqItem: any) => (
                        <div
                          key={reqItem.id}
                          className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3"
                          data-testid={`admin-account-request-${reqItem.id}`}
                        >
                          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                            <div className="space-y-1.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-slate-400">AR-{reqItem.id}</span>
                                <span className="text-sm font-semibold text-white">
                                  {reqItem.requestedDisplayName || reqItem.accountType}
                                </span>
                                {reqItem.requestedDisplayName && (
                                  <span className="text-xs text-slate-400">({reqItem.accountType})</span>
                                )}
                                <InlineTag
                                  tone={
                                    reqItem.status === "approved"
                                      ? "emerald"
                                      : reqItem.status === "rejected"
                                        ? "red"
                                        : "amber"
                                  }
                                >
                                  {reqItem.status}
                                </InlineTag>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                <span>
                                  Client:{" "}
                                  <button
                                    type="button"
                                    onClick={() => openClientProfile(reqItem.userId)}
                                    className="text-slate-200 font-medium hover:text-emerald-300"
                                  >
                                    {reqItem.userName || `Client #${reqItem.userId}`}
                                  </button>
                                </span>
                                {reqItem.userClientRef && (
                                  <code className="font-mono text-emerald-300 bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded">
                                    {reqItem.userClientRef}
                                  </code>
                                )}
                                {reqItem.userEmail && <span>{reqItem.userEmail}</span>}
                                <span>· Submitted {new Date(reqItem.createdAt).toLocaleDateString("en-CA")}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {reqItem.status === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 whitespace-nowrap shrink-0"
                                    disabled={approveAccountRequestMutation.isPending || rejectAccountRequestMutation.isPending}
                                    onClick={() => {
                                      setApproveAccountReqForm({
                                        displayName: reqItem.requestedDisplayName || "",
                                        adminNotes: "",
                                      });
                                      setApproveAccountReqDialog({ request: reqItem });
                                    }}
                                    data-testid={`button-approve-account-request-${reqItem.id}`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Approve &amp; Open Account
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 whitespace-nowrap shrink-0"
                                    disabled={approveAccountRequestMutation.isPending || rejectAccountRequestMutation.isPending}
                                    onClick={() => {
                                      setRejectAccountReqNotes("");
                                      setRejectAccountReqDialog({ request: reqItem });
                                    }}
                                    data-testid={`button-reject-account-request-${reqItem.id}`}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    Reject
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 whitespace-nowrap shrink-0"
                                data-testid={`button-delete-account-request-${reqItem.id}`}
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "account-request",
                                    id: reqItem.id,
                                    title: `Delete account request AR-${reqItem.id}?`,
                                    description: `Permanently delete ${reqItem.userName || "client"}'s ${reqItem.accountType} opening request from the database.`,
                                  })
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-800/80 text-xs">
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Ownership</span>
                              <span className="text-slate-200">{reqItem.ownershipStructure}</span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Objective</span>
                              <span className="text-slate-200">{reqItem.investmentObjective}</span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Risk Profile</span>
                              <span className="text-slate-200">{reqItem.riskTolerance}</span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Funding Source</span>
                              <span className="text-slate-200">{reqItem.fundingSource}</span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Expected Funding</span>
                              <span className="text-slate-200 font-mono">{reqItem.expectedInitialFunding}</span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">Jurisdiction</span>
                              <span className="text-slate-200">{reqItem.jurisdiction}</span>
                            </div>
                          </div>

                          {reqItem.additionalNotes && (
                            <p className="text-xs text-slate-300 bg-slate-900/70 border border-slate-800 rounded px-3 py-2">
                              <span className="text-slate-400 font-medium">Client notes:</span> {reqItem.additionalNotes}
                            </p>
                          )}

                          {(reqItem.createdAccountNumber || reqItem.adminNotes || reqItem.reviewedByStaffName) && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-1 text-slate-400">
                              {reqItem.createdAccountNumber && (
                                <span className="font-mono text-emerald-300">
                                  Opened Account: {reqItem.createdAccountNumber}
                                </span>
                              )}
                              {reqItem.adminNotes && (
                                <span className="italic text-slate-300">Review note: {reqItem.adminNotes}</span>
                              )}
                              {reqItem.reviewedByStaffName && (
                                <span>
                                  Reviewed by {reqItem.reviewedByStaffName}
                                  {reqItem.reviewedAt ? ` on ${new Date(reqItem.reviewedAt).toLocaleDateString("en-CA")}` : ""}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── VIEW 4: TRANSACTIONS & DUAL CONTROL ── */}
          {activeSection === "transactions" && (
            <AdminTransactions
              adminKey={adminKey}
              currentStaff={currentStaff}
              allUsers={Array.isArray(allUsers) ? allUsers : []}
            />
          )}

          {/* ── VIEW 5: INSTITUTIONAL TRANSFERS ── */}
          {activeSection === "inst-transfers" && (
            <Card className="bg-slate-900/70 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  Institutional Transfer Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                {instLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                  </div>
                ) : !Array.isArray(instTransfers) || instTransfers.length === 0 ? (
                  <div className="text-center py-12">
                    <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No institutional transfer requests</p>
                  </div>
                ) : (
                  <>
                    <ShadDialog open={!!monitorDialog} onOpenChange={(o) => { if (!o) setMonitorDialog(null); }}>
                      <ShadDialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
                        <ShadDialogHeader>
                          <ShadDialogTitle className="flex items-center gap-2 text-white">
                            <Activity className="w-4 h-4 text-primary" />
                            Update Transfer Monitor — IT-{monitorDialog?.transfer?.id}
                          </ShadDialogTitle>
                          <p className="text-slate-400 text-xs mt-1">
                            {monitorDialog?.transfer?.institutionName} · {monitorDialog?.transfer?.userName}
                            {monitorDialog?.transfer?.userClientRef ? ` (${monitorDialog.transfer.userClientRef})` : ""}
                          </p>
                        </ShadDialogHeader>

                        <div className="space-y-5 py-2">
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Status Stage</p>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { value: "pending", label: "Pending", desc: "Awaiting advisor review", color: "border-amber-500/40 text-amber-400" },
                                { value: "under_review", label: "Under Review", desc: "Advisor actively reviewing", color: "border-blue-500/40 text-blue-400" },
                                { value: "liquidating", label: "Liquidating", desc: "Investments being liquidated", color: "border-orange-500/40 text-orange-400" },
                                { value: "transfer_out", label: "Transfer Out", desc: "Portfolio transmitting", color: "border-violet-500/40 text-violet-400" },
                                { value: "completed", label: "Completed", desc: "Confirmed by receiving institution", color: "border-emerald-500/40 text-emerald-400" },
                                { value: "rejected", label: "Rejected", desc: "Request declined", color: "border-red-500/40 text-red-400" },
                              ].map(opt => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setMonitorForm(f => ({ ...f, status: opt.value }))}
                                  className={`text-left rounded-lg border p-3 transition-all ${monitorForm.status === opt.value ? `${opt.color} bg-white/5` : "border-slate-700 text-slate-400 hover:border-slate-500"}`}
                                >
                                  <p className="text-sm font-semibold">{opt.label}</p>
                                  <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
                                </button>
                              ))}
                            </div>
                          </div>

                          {(monitorForm.status === "approved" || monitorForm.status === "under_review") && (
                            <div className="space-y-1.5">
                              <label htmlFor="monitor-est-completion" className="text-xs uppercase tracking-widest text-slate-400 font-semibold block">Estimated Completion Date</label>
                              <input
                                id="monitor-est-completion"
                                type="date"
                                value={monitorForm.estimatedCompletionDate}
                                onChange={e => setMonitorForm(f => ({ ...f, estimatedCompletionDate: e.target.value }))}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                          )}

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label htmlFor="monitor-advisor-note" className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
                                Advisor Note <span className="normal-case text-slate-500">(optional)</span>
                              </label>
                              {monitorForm.adminNotes && (
                                <button type="button" onClick={() => setMonitorForm(f => ({ ...f, adminNotes: "" }))} className="text-[11px] text-slate-500 hover:text-red-400 underline">Clear</button>
                              )}
                            </div>
                            <Textarea
                              id="monitor-advisor-note"
                              value={monitorForm.adminNotes}
                              onChange={e => setMonitorForm(f => ({ ...f, adminNotes: e.target.value }))}
                              placeholder="Optional — leave blank if no special message."
                              className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 resize-none min-h-[80px]"
                            />
                          </div>
                        </div>

                        <ShadDialogFooter>
                          <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setMonitorDialog(null)}>Cancel</Button>
                          <Button
                            className="bg-primary hover:bg-primary/90 text-white"
                            disabled={updateInstMonitorMutation.isPending}
                            onClick={() => {
                              updateInstMonitorMutation.mutate({
                                id: monitorDialog!.transfer.id,
                                status: monitorForm.status,
                                estimatedCompletionDate: monitorForm.estimatedCompletionDate || undefined,
                                adminNotes: monitorForm.adminNotes,
                              }, { onSuccess: () => setMonitorDialog(null) });
                            }}
                          >
                            <Activity className="w-3.5 h-3.5 mr-1.5" />
                            Save Monitor Update
                          </Button>
                        </ShadDialogFooter>
                      </ShadDialogContent>
                    </ShadDialog>

                    <div className="space-y-3">
                      {instTransfers.map((t: any) => {
                        const statusLabel: Record<string, string> = {
                          pending: "Pending", under_review: "Under Review", approved: "Liquidating",
                          liquidating: "Liquidating", transfer_out: "Transfer Out", completed: "Completed", rejected: "Rejected",
                        };
                        const tone = t.status === "completed" || t.status === "approved"
                          ? "emerald"
                          : t.status === "rejected"
                            ? "red"
                            : t.status === "under_review"
                              ? "sky"
                              : "amber";
                        return (
                          <div key={t.id} className="rounded-lg bg-slate-950/60 border border-slate-800 p-4" data-testid={`inst-transfer-admin-${t.id}`}>
                            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-white font-semibold font-mono text-sm">IT-{t.id}</span>
                                  <InlineTag tone={tone}>{statusLabel[t.status] || t.status}</InlineTag>
                                  <span className="text-xs text-slate-400">
                                    {t.transferType === "in-kind" ? "In-Kind" : "Cash"} · {t.transferScope === "full" ? "Full" : `Partial CAD $${Number(t.partialAmount).toLocaleString()}`}
                                  </span>
                                </div>
                                <p className="text-slate-200 font-medium text-sm mt-1">{t.institutionName}</p>
                                <div className="text-xs text-slate-300 mt-1 space-y-0.5 break-words">
                                  <p>Destination: {t.institutionCountry ? destinationCountryName(t.institutionCountry) : "Country not supplied"}</p>
                                  <p>Receiving account / portfolio ID: <span className="font-mono">{t.institutionAccountNumber}</span></p>
                                  {t.destinationDetails && <p className="whitespace-pre-wrap text-slate-400">{t.destinationDetails}</p>}
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-slate-400">
                                  <span>
                                    Client: <button type="button" onClick={() => openClientProfile(t.userId)} className="text-slate-200 font-medium hover:text-emerald-300">{t.userName}</button>
                                  </span>
                                  {t.userClientRef && (
                                    <span className="font-mono text-emerald-300">[{t.userClientRef}]</span>
                                  )}
                                  <span>{t.userEmail}</span>
                                  <span>· Acct #{t.accountId ?? "Full"}</span>
                                  <span>· {new Date(t.createdAt).toLocaleDateString("en-CA")}</span>
                                </div>
                                {t.estimatedCompletionDate && (
                                  <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Est. completion: {new Date(t.estimatedCompletionDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}
                                  </p>
                                )}
                                {t.adminNotes && (
                                  <p className="text-xs text-slate-500 mt-1 italic">Note: {t.adminNotes}</p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-primary/40 text-primary hover:bg-primary/10 gap-1.5 shrink-0 h-8 text-xs whitespace-nowrap"
                                  data-testid={`button-update-monitor-${t.id}`}
                                  onClick={() => {
                                    setMonitorForm({
                                      status: t.status,
                                      estimatedCompletionDate: t.estimatedCompletionDate
                                        ? new Date(t.estimatedCompletionDate).toISOString().split("T")[0]
                                        : "",
                                      adminNotes: t.adminNotes || "",
                                    });
                                    setMonitorDialog({ transfer: t });
                                  }}
                                >
                                  <Activity className="w-3.5 h-3.5" />
                                  Update Monitor
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 shrink-0 h-8 text-xs whitespace-nowrap"
                                  data-testid={`button-delete-inst-transfer-${t.id}`}
                                  onClick={() => setDeleteTarget({
                                    kind: "inst-transfer",
                                    id: t.id,
                                    title: `Delete institutional transfer IT-${t.id}?`,
                                    description: `Permanently delete institutional transfer request IT-${t.id} (${t.institutionName} · ${t.userName}) from the database.`,
                                  })}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── VIEW 6: WIRE & BENEFICIARIES ── */}
          {activeSection === "wire" && (
            <div className="space-y-6">
              <ShadDialog open={!!wireDialog} onOpenChange={(o) => { if (!o) setWireDialog(null); }}>
                <ShadDialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
                  <ShadDialogHeader>
                    <ShadDialogTitle className="flex items-center gap-2 text-white">
                      <ArrowLeftRight className="w-4 h-4 text-primary" />
                      Update Wire Transfer #{wireDialog?.txn?.id}
                    </ShadDialogTitle>
                    <p className="text-slate-400 text-xs mt-1">{wireDialog?.txn?.payeeName} · {wireDialog?.txn?.userName}</p>
                  </ShadDialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Status</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: "pending", label: "Pending", color: "border-amber-500/40 text-amber-400" },
                          { value: "completed", label: "Completed", color: "border-emerald-500/40 text-emerald-400" },
                          { value: "failed", label: "Rejected", color: "border-red-500/40 text-red-400" },
                        ].map(opt => (
                          <button key={opt.value} type="button"
                            onClick={() => setWireForm(f => ({ ...f, status: opt.value }))}
                            className={`rounded-lg border p-2.5 text-sm font-semibold transition-all ${wireForm.status === opt.value ? `${opt.color} bg-white/5` : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="wire-admin-note" className="text-xs uppercase tracking-widest text-slate-400 font-semibold block">
                        Admin Note <span className="normal-case text-slate-500">(optional)</span>
                      </label>
                      <Textarea
                        id="wire-admin-note"
                        value={wireForm.adminNotes}
                        onChange={e => setWireForm(f => ({ ...f, adminNotes: e.target.value }))}
                        placeholder="e.g. Wire confirmed by compliance. Funds dispatched via SWIFT."
                        className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 resize-none min-h-[72px]"
                      />
                    </div>
                  </div>
                  <ShadDialogFooter>
                    <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setWireDialog(null)}>Cancel</Button>
                    <Button className="bg-primary hover:bg-primary/90 text-white" disabled={updateWireMutation.isPending}
                      onClick={() => {
                        updateWireMutation.mutate({ id: wireDialog!.txn.id, status: wireForm.status, adminNotes: wireForm.adminNotes },
                          { onSuccess: () => setWireDialog(null) });
                      }}>
                      Save Update
                    </Button>
                  </ShadDialogFooter>
                </ShadDialogContent>
              </ShadDialog>

              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    Beneficiary Approvals
                    {pendingPayeeCount > 0 && (
                      <InlineTag tone="amber">{pendingPayeeCount} pending</InlineTag>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {payeesLoading ? (
                    <div className="flex items-center justify-center py-8 text-slate-400"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
                  ) : !Array.isArray(allPayees) || allPayees.length === 0 ? (
                    <p className="text-center text-slate-400 py-8 text-sm">No beneficiaries registered yet</p>
                  ) : (
                    <div className="space-y-2">
                      {allPayees.map((p: any) => {
                        const isPending = p.status === "pending_approval";
                        const isApproved = p.status === "approved";
                        return (
                          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
                            data-testid={`payee-admin-${p.id}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white font-semibold text-sm">{p.name}</span>
                                <InlineTag tone={isPending ? "amber" : isApproved ? "emerald" : "red"}>
                                  {isPending ? "Pending" : isApproved ? "Approved" : "Rejected"}
                                </InlineTag>
                              </div>
                              <p className="text-slate-400 text-xs mt-0.5">{p.bankName || "—"} · IBAN ****{p.accountNumber?.slice(-4)} · SWIFT {p.routingNumber || "—"}</p>
                              <p className="text-slate-400 text-xs mt-0.5">
                                Client: <button type="button" onClick={() => openClientProfile(p.userId)} className="text-slate-200 hover:text-emerald-300">{p.userName}</button>
                                {p.userClientRef && <span className="font-mono text-emerald-300 ml-1.5">[{p.userClientRef}]</span>}
                                <span className="ml-2 text-slate-500">· {new Date(p.createdAt).toLocaleDateString("en-CA")}</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              {isPending ? (
                                <>
                                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 h-8 text-xs whitespace-nowrap"
                                    disabled={approvePayeeMutation.isPending || rejectPayeeMutation.isPending}
                                    onClick={() => approvePayeeMutation.mutate(p.id)}
                                    data-testid={`button-approve-payee-${p.id}`}>
                                    <CheckCircle2 className="w-3 h-3" /> Approve
                                  </Button>
                                  <Button size="sm" variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 h-8 text-xs whitespace-nowrap"
                                    disabled={approvePayeeMutation.isPending || rejectPayeeMutation.isPending}
                                    onClick={() => rejectPayeeMutation.mutate(p.id)}
                                    data-testid={`button-reject-payee-${p.id}`}>
                                    <XCircle className="w-3 h-3" /> Reject
                                  </Button>
                                </>
                              ) : (
                                <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white h-8 text-xs shrink-0 whitespace-nowrap"
                                  onClick={() => approvePayeeMutation.mutate(p.id)}>
                                  {isApproved ? "Re-approve" : "Approve"}
                                </Button>
                              )}
                              <Button size="sm" variant="outline"
                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 h-8 text-xs whitespace-nowrap"
                                data-testid={`button-delete-payee-${p.id}`}
                                onClick={() => setDeleteTarget({
                                  kind: "payee",
                                  id: p.id,
                                  title: `Delete beneficiary "${p.name}"?`,
                                  description: `Permanently delete saved beneficiary "${p.name}" (${p.bankName || "External"}) for ${p.userName}. Existing transactions keep their record with beneficiary link cleared.`,
                                })}>
                                <Trash2 className="w-3 h-3" /> Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-900/70 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-primary" />
                    Wire Disbursements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {wireLoading ? (
                    <div className="flex items-center justify-center py-8 text-slate-400"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
                  ) : !Array.isArray(wireTransfers) || wireTransfers.length === 0 ? (
                    <p className="text-center text-slate-400 py-8 text-sm">No wire disbursements submitted yet</p>
                  ) : (
                    <div className="space-y-2">
                      {wireTransfers.map((t: any) => {
                        const wireDisplayCurrency = clientBalanceCurrency({ displayCurrency: t.displayCurrency });
                        return (
                        <div key={t.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col sm:flex-row sm:items-start gap-3"
                          data-testid={`wire-txn-admin-${t.id}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-semibold text-sm font-mono">WT-{t.id}</span>
                              <InlineTag tone={t.status === "completed" ? "emerald" : t.status === "failed" ? "red" : "amber"}>
                                {t.status === "failed" ? "Rejected" : t.status}
                              </InlineTag>
                            </div>
                            <p className="text-slate-200 text-sm mt-0.5">
                              To: {t.payeeName || "Beneficiary"}
                              {t.payeeCountry ? ` · ${t.payeeCountry}` : ""}
                              {t.payeeCurrency ? ` (${t.payeeCurrency})` : ""}
                            </p>
                            {t.description && (
                              <p className="text-slate-400 text-xs mt-0.5">{t.description}</p>
                            )}
                            <div className="flex flex-wrap gap-x-3 text-xs text-slate-400 mt-0.5">
                              <span>
                                Client: <span className="text-slate-200">{t.userName}</span>
                                {t.userClientRef && <span className="font-mono text-emerald-300 ml-1.5">[{t.userClientRef}]</span>}
                              </span>
                              <span>·</span>
                              <span className="font-mono tabular-nums">
                                <strong className="text-white">{formatBalance(t.amount, wireDisplayCurrency)}</strong>
                              </span>
                              {t.payeeRoutingNumber && (
                                <>
                                  <span>·</span>
                                  <span className="font-mono text-slate-300">SWIFT/Routing: {t.payeeRoutingNumber}</span>
                                </>
                              )}
                              <span>·</span>
                              <span>{new Date(t.createdAt).toLocaleDateString("en-CA")}</span>
                            </div>
                            {t.adminNotes && <p className="text-slate-500 text-xs mt-1 italic">Note: {t.adminNotes}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="outline"
                              className="border-primary/40 text-primary hover:bg-primary/10 gap-1.5 shrink-0 h-8 text-xs whitespace-nowrap"
                              data-testid={`button-update-wire-${t.id}`}
                              onClick={() => { setWireForm({ status: t.status, adminNotes: t.adminNotes || "" }); setWireDialog({ txn: t }); }}>
                              <Activity className="w-3 h-3" /> Update
                            </Button>
                            <Button size="sm" variant="outline"
                              className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1 shrink-0 h-8 text-xs whitespace-nowrap"
                              data-testid={`button-delete-wire-${t.id}`}
                              onClick={() => {
                                setReverseWireBalance(t.status === "completed");
                                setDeleteTarget({
                                  kind: "wire",
                                  id: t.id,
                                  title: `Delete wire disbursement WT-${t.id}?`,
                                  description: `Permanently delete wire transfer WT-${t.id} (${fmt(t.amount)} to ${t.payeeName || "recipient"}) and linked audit entries.`,
                                  isCompletedTxn: t.status === "completed",
                                });
                              }}>
                              <Trash2 className="w-3 h-3" /> Delete
                            </Button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── VIEW 7: SERVICE & MANAGEMENT FEES ── */}
          {activeSection === "fees" && <AdminFees adminKey={adminKey} />}

          {/* ── VIEW 8: HISTORICAL BALANCES ── */}
          {activeSection === "historical-balances" && (
            <HistoricalBalances
              adminKey={adminKey}
              users={(Array.isArray(allUsers) ? allUsers : []).map((user: any) => ({
                id: user.id,
                name: user.clientRef ? `${user.name} [${user.clientRef}]` : user.name,
                email: user.email,
              }))}
            />
          )}

          {/* ── VIEW 9: RECOVERY REQUESTS ── */}
          {activeSection === "security" && <AdminRecoveryRequests adminKey={adminKey} />}
        </main>
      </div>

      {/* Staff Access Dialog */}
      <ShadDialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <ShadDialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <ShadDialogHeader>
            <ShadDialogTitle className="flex items-center gap-2 text-white">
              <UserCheck className="w-4 h-4 text-primary" />
              Staff Administrators (Dual Control)
            </ShadDialogTitle>
          </ShadDialogHeader>
          <div className="space-y-5 py-2">
            <p className="text-xs text-slate-400 leading-relaxed">
              Every direct deposit, transfer posting, or reversal created by a staff administrator requires approval from a different active staff administrator before client balances change.
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {staffLoading ? (
                <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading staff…
                </div>
              ) : (Array.isArray(staffList) ? staffList : []).length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">No staff accounts created yet.</p>
              ) : (
                staffList.map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{s.displayName}</span>
                        <span className="text-xs font-mono text-slate-400">@{s.username}</span>
                        {currentStaff?.id === s.id && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/20 text-primary">You</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {s.active ? "Active" : "Deactivated"} · Added {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {(!currentStaff || currentStaff.id !== s.id) && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleStaffActiveMutation.isPending}
                          onClick={() => toggleStaffActiveMutation.mutate({ id: s.id, active: !s.active })}
                          className="h-7 text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
                        >
                          {s.active ? "Deactivate" : "Reactivate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deleteRecordMutation.isPending}
                          onClick={() => setDeleteTarget({
                            kind: "staff",
                            id: s.id,
                            title: `Delete staff administrator @${s.username}?`,
                            description: `Permanently delete staff account ${s.displayName} (@${s.username}) and terminate their active admin sessions. Historical posting text logs are preserved.`,
                          })}
                          className="h-7 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                          data-testid={`button-delete-staff-${s.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Create Staff Administrator</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="new-staff-display-name" className="sr-only">Full name</label>
                  <Input
                    id="new-staff-display-name"
                    name="displayName"
                    value={newStaffForm.displayName}
                    onChange={e => setNewStaffForm(f => ({ ...f, displayName: e.target.value }))}
                    placeholder="Full name (e.g. Alex Chen)"
                    className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                    data-testid="input-new-staff-name"
                  />
                </div>
                <div>
                  <label htmlFor="new-staff-username" className="sr-only">Username</label>
                  <Input
                    id="new-staff-username"
                    name="username"
                    value={newStaffForm.username}
                    onChange={e => setNewStaffForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="Username (e.g. alex.chen)"
                    className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                    data-testid="input-new-staff-username"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="new-staff-password" className="sr-only">Initial password</label>
                <Input
                  id="new-staff-password"
                  name="password"
                  type="password"
                  value={newStaffForm.password}
                  onChange={e => setNewStaffForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Initial password (min 10 characters)"
                  className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                  data-testid="input-new-staff-password"
                />
              </div>
              <Button
                type="button"
                disabled={
                  createStaffMutation.isPending ||
                  !newStaffForm.displayName.trim() ||
                  !newStaffForm.username.trim() ||
                  newStaffForm.password.length < 10
                }
                onClick={() => createStaffMutation.mutate()}
                className="w-full"
                data-testid="button-create-staff"
              >
                {createStaffMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <UserPlus className="w-3.5 h-3.5 mr-2" />}
                Create Staff Administrator
              </Button>
            </div>
          </div>
        </ShadDialogContent>
      </ShadDialog>

      {/* Reusable Permanent Delete Confirmation Dialog */}
      <ShadDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleteRecordMutation.isPending) setDeleteTarget(null); }}>
        <ShadDialogContent className="bg-slate-900 border-red-500/40 text-white max-w-md">
          <ShadDialogHeader>
            <ShadDialogTitle className="flex items-center gap-2 text-red-300">
              <Trash2 className="w-4 h-4" />
              {deleteTarget?.title}
            </ShadDialogTitle>
          </ShadDialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <p className="text-slate-300 leading-relaxed">{deleteTarget?.description}</p>
            {deleteTarget?.kind === "wire" && deleteTarget.isCompletedTxn && (
              <label
                htmlFor="delete-wire-reverse-balance"
                className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-slate-200 cursor-pointer"
              >
                <input
                  id="delete-wire-reverse-balance"
                  name="delete-wire-reverse-balance"
                  type="checkbox"
                  checked={reverseWireBalance}
                  onChange={(e) => setReverseWireBalance(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also reverse balance impact on affected account(s) if completed.
                </span>
              </label>
            )}
          </div>
          <ShadDialogFooter>
            <Button variant="ghost" className="text-slate-400 hover:text-white" disabled={deleteRecordMutation.isPending} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteRecordMutation.isPending}
              data-testid="button-confirm-admin-delete"
              onClick={() => deleteTarget && deleteRecordMutation.mutate(deleteTarget)}
            >
              {deleteRecordMutation.isPending ? "Deleting…" : "Delete Permanently"}
            </Button>
          </ShadDialogFooter>
        </ShadDialogContent>
      </ShadDialog>
    </div>
  );
}

// ─── Admin Page (entry point) ─────────────────────────────────────────────────
export default function AdminPage() {
  const [session, setSession] = useState<AdminAuthSession | null>(null);

  const handleLogin = (nextSession: AdminAuthSession) => setSession(nextSession);

  const handleLogout = () => {
    setSession(null);
  };

  if (!session) return <AdminLogin onLogin={handleLogin} />;
  return (
    <AdminDashboard
      adminKey={session.token}
      currentStaff={session.staff}
      legacyKeyMode={session.legacyKeyMode}
      onLogout={handleLogout}
    />
  );
}
