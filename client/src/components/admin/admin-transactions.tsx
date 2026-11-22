import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  History,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  XCircle,
} from "lucide-react";
import { formatCAD } from "@shared/fees";
import { accountLabel } from "@shared/account-display";

export type AdminStaff = {
  id: number;
  username: string;
  displayName: string;
};

type AdminTransactionsProps = {
  adminKey: string;
  currentStaff: AdminStaff | null;
  allUsers: any[];
};

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

function directionBadge(direction: string) {
  switch (direction) {
    case "deposit":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
          <ArrowDownLeft className="w-3 h-3" />
          Deposit (Incoming)
        </span>
      );
    case "internal_transfer":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-sky-500/10 text-sky-300 border-sky-500/30">
          <ArrowLeftRight className="w-3 h-3" />
          Internal Transfer
        </span>
      );
    case "transfer_outgoing":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-indigo-500/10 text-indigo-300 border-indigo-500/30">
          <ArrowUpRight className="w-3 h-3" />
          Transfer (Outgoing)
        </span>
      );
    case "wire_outgoing":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-500/10 text-violet-300 border-violet-500/30">
          <ArrowUpRight className="w-3 h-3" />
          Wire / Payment (Outgoing)
        </span>
      );
    case "reversal":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-300 border-amber-500/30">
          <RotateCcw className="w-3 h-3" />
          Reversal
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-500/10 text-slate-300 border-slate-500/30 capitalize">
          {direction.replace(/_/g, " ")}
        </span>
      );
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: "bg-amber-400/10 text-amber-400 border-amber-400/20",
    pending_second_admin: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    completed: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    approved: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    failed: "bg-red-400/10 text-red-400 border-red-400/20",
    rejected: "bg-red-400/10 text-red-400 border-red-400/20",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${variants[status] || "bg-slate-400/10 text-slate-400 border-slate-400/20"}`}>
      {status === "pending_second_admin" ? "Awaiting 2nd Admin" : status}
    </span>
  );
}

function defaultLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function AdminTransactions({ adminKey, currentStaff, allUsers }: AdminTransactionsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [subView, setSubView] = useState<"review" | "create" | "ledger">("review");

  const adminGet = async (path: string) => {
    const r = await adminFetch(path, adminKey);
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || "Request failed");
    return data;
  };

  const { data: pendingClientTxns = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["/api/admin/transactions", "pending"],
    queryFn: () => adminGet("/api/admin/transactions?status=pending"),
    refetchInterval: 15000,
  });

  const { data: allTxns = [], isLoading: allTxnsLoading } = useQuery({
    queryKey: ["/api/admin/transactions"],
    queryFn: () => adminGet("/api/admin/transactions"),
  });

  const { data: postingRequests = [], isLoading: postingsLoading } = useQuery({
    queryKey: ["/api/admin/postings"],
    queryFn: () => adminGet("/api/admin/postings"),
    refetchInterval: 15000,
  });

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["/api/admin/accounts"],
    queryFn: () => adminGet("/api/admin/accounts"),
  });

  const { data: globalAuditTrail = [] } = useQuery({
    queryKey: ["/api/admin/audit-trail"],
    queryFn: () => adminGet("/api/admin/audit-trail"),
  });

  const pendingSecondAdminRequests = useMemo(
    () => (Array.isArray(postingRequests) ? postingRequests.filter((p: any) => p.status === "pending_second_admin") : []),
    [postingRequests],
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/postings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-trail"] });
  };

  // ── Client Request Approve / Reject Dialogs ──────────────────────────────────
  const [approveClientDialog, setApproveClientDialog] = useState<any | null>(null);
  const [verifiedMovement, setVerifiedMovement] = useState(false);
  const [verificationNote, setVerificationNote] = useState("");

  const [rejectClientDialog, setRejectClientDialog] = useState<any | null>(null);
  const [rejectClientReason, setRejectClientReason] = useState("");

  const approveClientMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }) => {
      const r = await adminFetch(`/api/admin/transactions/${id}/approve`, adminKey, {
        method: "POST",
        body: JSON.stringify({ verifiedRealWorldMovement: true, verificationNote: note || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Failed to approve transaction");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Client Request Approved", description: data.message });
      setApproveClientDialog(null);
      setVerifiedMovement(false);
      setVerificationNote("");
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Approval Failed", description: err.message, variant: "destructive" }),
  });

  const rejectClientMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const r = await adminFetch(`/api/admin/transactions/${id}/reject`, adminKey, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Failed to reject transaction");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Client Request Rejected", description: data.message });
      setRejectClientDialog(null);
      setRejectClientReason("");
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Rejection Failed", description: err.message, variant: "destructive" }),
  });

  // ── Second-Admin Posting Approve / Reject Dialogs ────────────────────────────
  const [approvePostingDialog, setApprovePostingDialog] = useState<any | null>(null);
  const [postingReviewNote, setPostingReviewNote] = useState("");
  const [rejectPostingDialog, setRejectPostingDialog] = useState<any | null>(null);
  const [rejectPostingReason, setRejectPostingReason] = useState("");

  const approvePostingMutation = useMutation({
    mutationFn: async ({ id, reviewNote }: { id: number; reviewNote: string }) => {
      const r = await adminFetch(`/api/admin/postings/${id}/approve`, adminKey, {
        method: "POST",
        body: JSON.stringify({ confirmSummary: true, reviewNote: reviewNote || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Approval failed");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Posting Approved & Executed", description: data.message });
      setApprovePostingDialog(null);
      setPostingReviewNote("");
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Approval Blocked", description: err.message, variant: "destructive" }),
  });

  const rejectPostingMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const r = await adminFetch(`/api/admin/postings/${id}/reject`, adminKey, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Rejection failed");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Posting Request Rejected", description: data.message });
      setRejectPostingDialog(null);
      setRejectPostingReason("");
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Rejection Failed", description: err.message, variant: "destructive" }),
  });

  // ── Admin Delete Confirmation ────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "transaction" | "posting" | "audit";
    id: number;
    title: string;
    summary: string;
    isCompletedTxn?: boolean;
  } | null>(null);
  const [reverseBalanceOnDelete, setReverseBalanceOnDelete] = useState(true);

  const deleteRecordMutation = useMutation({
    mutationFn: async (target: NonNullable<typeof deleteTarget>) => {
      const path =
        target.kind === "transaction"
          ? `/api/admin/transactions/${target.id}?reverseBalance=${target.isCompletedTxn && reverseBalanceOnDelete ? "true" : "false"}`
          : target.kind === "posting"
            ? `/api/admin/postings/${target.id}`
            : `/api/admin/audit-trail/${target.id}`;
      const r = await adminFetch(path, adminKey, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.message || `Failed to delete record (HTTP ${r.status})`);
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Record Deleted", description: data?.message || "Database record removed." });
      setDeleteTarget(null);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
    },
    onError: (err: any) => toast({ title: "Delete Failed", description: err.message, variant: "destructive" }),
  });

  // ── Create Posting Form + Preview ────────────────────────────────────────────
  const [postingForm, setPostingForm] = useState({
    postingType: "deposit" as "deposit" | "transfer",
    clientUserId: "",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    effectiveDate: defaultLocalDatetime(),
    reason: "",
    evidenceRef: "",
    description: "",
  });
  const [postingPreview, setPostingPreview] = useState<any | null>(null);

  const clientAccounts = useMemo(() => {
    const uid = Number(postingForm.clientUserId);
    if (!uid || !Array.isArray(allAccounts)) return [];
    return allAccounts.filter((a: any) => a.userId === uid);
  }, [allAccounts, postingForm.clientUserId]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const parsedDate = new Date(postingForm.effectiveDate);
      if (!Number.isFinite(parsedDate.getTime())) {
        throw new Error("Enter a valid effective date and time");
      }
      const payload = {
        postingType: postingForm.postingType,
        clientUserId: Number(postingForm.clientUserId),
        fromAccountId: postingForm.postingType === "transfer" ? Number(postingForm.fromAccountId) : null,
        toAccountId: Number(postingForm.toAccountId),
        amount: postingForm.amount.trim(),
        effectiveDate: parsedDate.toISOString(),
        reason: postingForm.reason.trim(),
        evidenceRef: postingForm.evidenceRef.trim(),
        description: postingForm.description.trim() || undefined,
      };
      const r = await adminFetch("/api/admin/postings/preview", adminKey, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const rawText = await r.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (!r.ok) {
        throw new Error(data?.message || `Failed to generate preview (HTTP ${r.status})`);
      }
      return { preview: data, payload };
    },
    onSuccess: ({ preview }) => {
      setPostingPreview(preview);
    },
    onError: (err: any) => toast({ title: "Cannot Preview Posting", description: err.message, variant: "destructive" }),
  });

  const submitPostingMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        postingType: postingForm.postingType,
        clientUserId: Number(postingForm.clientUserId),
        fromAccountId: postingForm.postingType === "transfer" ? Number(postingForm.fromAccountId) : null,
        toAccountId: Number(postingForm.toAccountId),
        amount: postingForm.amount.trim(),
        effectiveDate: new Date(postingForm.effectiveDate).toISOString(),
        reason: postingForm.reason.trim(),
        evidenceRef: postingForm.evidenceRef.trim(),
        description: postingForm.description.trim() || undefined,
      };
      const r = await adminFetch("/api/admin/postings", adminKey, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Failed to submit posting");
      return data;
    },
    onSuccess: (created) => {
      toast({
        title: "Posting Queued for Second Admin",
        description: `Request APR-${created.id} submitted. Another administrator must approve before balances update.`,
      });
      setPostingPreview(null);
      setPostingForm({
        postingType: "deposit",
        clientUserId: "",
        fromAccountId: "",
        toAccountId: "",
        amount: "",
        effectiveDate: defaultLocalDatetime(),
        reason: "",
        evidenceRef: "",
        description: "",
      });
      invalidateAll();
      setSubView("review");
    },
    onError: (err: any) => toast({ title: "Submission Failed", description: err.message, variant: "destructive" }),
  });

  // ── Ledger Filters + Audit Drawer + Reversal Dialog ──────────────────────────
  const [originFilter, setOriginFilter] = useState<"all" | "client" | "staff">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending" | "failed">("all");
  const [showGlobalAudit, setShowGlobalAudit] = useState(false);

  const filteredLedger = useMemo(() => {
    return (Array.isArray(allTxns) ? allTxns : []).filter((t: any) => {
      if (originFilter !== "all" && (t.entryOrigin || "client") !== originFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [allTxns, originFilter, statusFilter]);

  const [auditDialogTxn, setAuditDialogTxn] = useState<any | null>(null);
  const { data: txnAuditEntries = [], isLoading: auditLoading } = useQuery({
    queryKey: ["/api/admin/transactions", auditDialogTxn?.id, "audit"],
    queryFn: () => adminGet(`/api/admin/transactions/${auditDialogTxn.id}/audit`),
    enabled: Boolean(auditDialogTxn?.id),
  });

  const [reverseDialogTxn, setReverseDialogTxn] = useState<any | null>(null);
  const [reverseForm, setReverseForm] = useState({
    reason: "",
    evidenceRef: "",
    includeReplacement: false,
    postingType: "deposit" as "deposit" | "transfer",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    effectiveDate: defaultLocalDatetime(),
    description: "",
  });

  const reverseOwnerAccounts = useMemo(() => {
    if (!reverseDialogTxn?.clientUserId || !Array.isArray(allAccounts)) return [];
    return allAccounts.filter((a: any) => a.userId === reverseDialogTxn.clientUserId);
  }, [allAccounts, reverseDialogTxn]);

  const reverseMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        reason: reverseForm.reason.trim(),
        evidenceRef: reverseForm.evidenceRef.trim(),
      };
      if (reverseForm.includeReplacement) {
        body.replacement = {
          postingType: reverseForm.postingType,
          fromAccountId: reverseForm.postingType === "transfer" ? Number(reverseForm.fromAccountId) : null,
          toAccountId: Number(reverseForm.toAccountId),
          amount: reverseForm.amount.trim(),
          effectiveDate: new Date(reverseForm.effectiveDate).toISOString(),
          description: reverseForm.description.trim() || undefined,
        };
      }
      const r = await adminFetch(`/api/admin/transactions/${reverseDialogTxn.id}/reverse`, adminKey, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Failed to queue reversal");
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Reversal Queued for Second Admin",
        description: "Another administrator must approve before the reversal posts to client balances.",
      });
      setReverseDialogTxn(null);
      invalidateAll();
      setSubView("review");
    },
    onError: (err: any) => toast({ title: "Reversal Failed", description: err.message, variant: "destructive" }),
  });

  const totalPendingReviews =
    (Array.isArray(pendingClientTxns) ? pendingClientTxns.length : 0) + pendingSecondAdminRequests.length;

  return (
    <div className="space-y-4">
      {!currentStaff && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Individual staff identification required for money movements</p>
            <p className="text-xs text-amber-200/80 mt-1">
              You are currently authenticated with a shared environment credential. Sign out and sign in with an individual staff administrator account (or enroll one under Staff Access) before reviewing requests, creating postings, or approving dual-control entries.
            </p>
          </div>
        </div>
      )}

      {/* Sub-navigation under Admin -> Transactions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800/60 border border-slate-700 rounded-xl p-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={subView === "review" ? "default" : "ghost"}
            className={subView === "review" ? "bg-primary text-white" : "text-slate-300 hover:text-white"}
            onClick={() => setSubView("review")}
            data-testid="subtab-review-requests"
          >
            <Clock className="w-3.5 h-3.5 mr-1.5" />
            Review Requests
            {totalPendingReviews > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {totalPendingReviews}
              </span>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={subView === "create" ? "default" : "ghost"}
            className={subView === "create" ? "bg-primary text-white" : "text-slate-300 hover:text-white"}
            onClick={() => setSubView("create")}
            data-testid="subtab-create-posting"
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
            Create Posting
          </Button>
          <Button
            type="button"
            size="sm"
            variant={subView === "ledger" ? "default" : "ghost"}
            className={subView === "ledger" ? "bg-primary text-white" : "text-slate-300 hover:text-white"}
            onClick={() => setSubView("ledger")}
            data-testid="subtab-ledger-audit"
          >
            <Activity className="w-3.5 h-3.5 mr-1.5" />
            Ledger & Audit Trail
          </Button>
        </div>
        {currentStaff && (
          <div className="text-xs text-slate-400 px-2 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            Acting as <span className="text-slate-200 font-medium">{currentStaff.displayName}</span>
            <span className="text-slate-500">(@{currentStaff.username})</span>
          </div>
        )}
      </div>

      {/* ── 1. REVIEW REQUESTS (Client Requests + Pending 2nd-Admin Postings) ── */}
      {subView === "review" && (
        <div className="space-y-6">
          {/* Path A: Client-Submitted Transfers & Deposits */}
          <Card className="bg-slate-800/40 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                Client-Submitted Requests
                <span className="ml-auto text-xs font-normal text-slate-400">
                  Verify real-world movement before approving; rejection requires a reason
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingLoading ? (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                </div>
              ) : !Array.isArray(pendingClientTxns) || pendingClientTxns.length === 0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto mb-2 opacity-60" />
                  <p className="text-slate-300 text-sm">No pending client-submitted requests</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingClientTxns.map((txn: any) => (
                    <div
                      key={txn.id}
                      className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 rounded-xl bg-slate-700/30 border border-slate-600/50"
                      data-testid={`txn-pending-${txn.id}`}
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold font-mono">TXN-{txn.id}</span>
                          <StatusBadge status={txn.status} />
                          {directionBadge(txn.direction || "transfer")}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-600/50 text-slate-300 border border-slate-500/40">
                            Client Request
                          </span>
                        </div>
                        <p className="text-slate-200 text-sm font-medium">{txn.description || "No description"}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>
                            Client: <span className="text-slate-200 font-medium">{txn.userName}</span>{" "}
                            {txn.userEmail ? `(${txn.userEmail})` : ""}
                          </span>
                          <span>
                            Account:{" "}
                            <span className="text-slate-200">
                              {txn.fromAccountLabel && txn.toAccountLabel
                                ? `${txn.fromAccountLabel} (${txn.fromAccountNumber}) → ${txn.toAccountLabel} (${txn.toAccountNumber})`
                                : txn.toAccountLabel
                                  ? `${txn.toAccountLabel} (${txn.toAccountNumber})`
                                  : txn.fromAccountLabel
                                    ? `${txn.fromAccountLabel} (${txn.fromAccountNumber})`
                                    : "—"}
                            </span>
                          </span>
                          <span>Requested: {new Date(txn.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-white font-bold text-lg whitespace-nowrap">{formatCAD(txn.amount)}</span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!currentStaff}
                            onClick={() => {
                              setVerifiedMovement(false);
                              setVerificationNote("");
                              setApproveClientDialog(txn);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            data-testid={`button-approve-${txn.id}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Verify & Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!currentStaff}
                            onClick={() => {
                              setRejectClientReason("");
                              setRejectClientDialog(txn);
                            }}
                            className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1"
                            data-testid={`button-reject-${txn.id}`}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReverseBalanceOnDelete(false);
                              setDeleteTarget({
                                kind: "transaction",
                                id: txn.id,
                                title: `Delete client request TXN-${txn.id}?`,
                                summary: `Permanently delete pending ${txn.direction || txn.transactionType || "transaction"} request (${formatCAD(txn.amount)}) for ${txn.userName || "client"} from the database.`,
                                isCompletedTxn: false,
                              });
                            }}
                            className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1"
                            data-testid={`button-delete-pending-txn-${txn.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Path B: Admin-Created Postings & Reversals (Dual Control) */}
          <Card className="bg-slate-800/40 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Pending Second-Admin Approvals (Staff Entries)
                <span className="ml-auto text-xs font-normal text-slate-400">
                  Admin-created postings & reversals require approval by a different administrator
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {postingsLoading ? (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                </div>
              ) : pendingSecondAdminRequests.length === 0 ? (
                <div className="text-center py-10">
                  <ShieldCheck className="w-9 h-9 text-slate-500 mx-auto mb-2" />
                  <p className="text-slate-300 text-sm">No admin-created entries awaiting second-admin review</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingSecondAdminRequests.map((req: any) => {
                    const isSameAdmin = currentStaff && req.createdByStaffId === currentStaff.id;
                    const amountNum = Number(req.amount);
                    const fromBefore = req.fromAccountBalance != null ? Number(req.fromAccountBalance) : null;
                    const toBefore = req.toAccountBalance != null ? Number(req.toAccountBalance) : null;
                    return (
                      <div
                        key={req.id}
                        className="p-4 rounded-xl bg-slate-700/30 border border-amber-500/30 space-y-3"
                        data-testid={`posting-pending-${req.id}`}
                      >
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-semibold font-mono">APR-{req.id}</span>
                              <StatusBadge status={req.status} />
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 capitalize">
                                {req.postingType.replace(/_/g, " ")}
                              </span>
                              {req.targetTransactionId && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-600/50 text-slate-200 font-mono">
                                  Target: TXN-{req.targetTransactionId}
                                </span>
                              )}
                            </div>
                            <p className="text-slate-200 text-sm font-medium">{req.description}</p>
                            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 pt-1">
                              <span>
                                Client: <span className="text-slate-200">{req.clientName}</span> ({req.clientEmail})
                              </span>
                              <span>
                                Created By:{" "}
                                <span className="text-slate-200 font-medium">
                                  {req.createdByStaffName} (@{req.createdByStaffUsername})
                                </span>
                              </span>
                              <span>Effective Date: {new Date(req.effectiveDate).toLocaleString()}</span>
                              <span>Evidence / Ref: <span className="text-slate-200 font-mono">{req.evidenceRef}</span></span>
                              <span className="sm:col-span-2">
                                Reason: <span className="text-slate-200">{req.reason}</span>
                              </span>
                            </div>

                            {/* Live Before -> After Balance Preview */}
                            <div className="mt-2 grid sm:grid-cols-2 gap-2 pt-2">
                              {req.fromAccountId && (
                                <div className="rounded-lg bg-slate-800/70 border border-slate-600/50 px-3 py-2 text-xs">
                                  <p className="text-slate-400">
                                    Source: <span className="text-slate-200">{req.fromAccountLabel}</span> ({req.fromAccountNumber})
                                  </p>
                                  <p className="mt-1 font-mono text-slate-200">
                                    {fromBefore != null ? formatCAD(fromBefore) : "—"} →{" "}
                                    <span className="text-red-300 font-semibold">
                                      {fromBefore != null ? formatCAD(fromBefore - amountNum) : "—"}
                                    </span>
                                  </p>
                                </div>
                              )}
                              {req.toAccountId && (
                                <div className="rounded-lg bg-slate-800/70 border border-slate-600/50 px-3 py-2 text-xs">
                                  <p className="text-slate-400">
                                    Destination: <span className="text-slate-200">{req.toAccountLabel}</span> ({req.toAccountNumber})
                                  </p>
                                  <p className="mt-1 font-mono text-slate-200">
                                    {toBefore != null ? formatCAD(toBefore) : "—"} →{" "}
                                    <span className="text-emerald-300 font-semibold">
                                      {toBefore != null ? formatCAD(toBefore + amountNum) : "—"}
                                    </span>
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="text-white font-bold text-lg">{formatCAD(req.amount)}</span>
                            {isSameAdmin ? (
                              <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1">
                                Created by you — another admin must approve
                              </span>
                            ) : null}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!currentStaff || Boolean(isSameAdmin)}
                                onClick={() => {
                                  setPostingReviewNote("");
                                  setApprovePostingDialog(req);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                data-testid={`button-approve-posting-${req.id}`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve & Post
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!currentStaff}
                                onClick={() => {
                                  setRejectPostingReason("");
                                  setRejectPostingDialog(req);
                                }}
                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1"
                                data-testid={`button-reject-posting-${req.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setDeleteTarget({
                                    kind: "posting",
                                    id: req.id,
                                    title: `Delete posting request APR-${req.id}?`,
                                    summary: `Permanently remove staff posting request APR-${req.id} (${formatCAD(req.amount)}) and its linked audit events.`,
                                  });
                                }}
                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1"
                                data-testid={`button-delete-posting-${req.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </Button>
                            </div>
                          </div>
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

      {/* ── 2. CREATE POSTING (Staff-Initiated Deposit or Transfer) ── */}
      {subView === "create" && (
        <Card className="bg-slate-800/40 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-primary" />
              Create Staff Posting (Deposit or Transfer)
              <span className="ml-auto text-xs font-normal text-slate-400">
                Requires second-admin approval before posting to client ledger
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!postingPreview ? (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <p id="posting-type-label" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Posting Type</p>
                  <div className="grid sm:grid-cols-2 gap-3" role="group" aria-labelledby="posting-type-label">
                    <button
                      type="button"
                      onClick={() => setPostingForm(f => ({ ...f, postingType: "deposit", fromAccountId: "" }))}
                      className={`text-left rounded-lg border p-3 transition-all ${
                        postingForm.postingType === "deposit"
                          ? "border-emerald-500/50 bg-emerald-500/10 text-white"
                          : "border-slate-600 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      <p className="text-sm font-semibold">Direct Deposit (Credit)</p>
                      <p className="text-xs opacity-80 mt-0.5">Credit verified incoming funds directly into a client account.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostingForm(f => ({ ...f, postingType: "transfer" }))}
                      className={`text-left rounded-lg border p-3 transition-all ${
                        postingForm.postingType === "transfer"
                          ? "border-sky-500/50 bg-sky-500/10 text-white"
                          : "border-slate-600 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      <p className="text-sm font-semibold">Account Transfer</p>
                      <p className="text-xs opacity-80 mt-0.5">Move funds between a client’s source account and a destination account.</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="posting-client" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Client</label>
                  <select
                    id="posting-client"
                    name="clientUserId"
                    value={postingForm.clientUserId}
                    onChange={(e) =>
                      setPostingForm(f => ({
                        ...f,
                        clientUserId: e.target.value,
                        fromAccountId: "",
                        toAccountId: "",
                      }))
                    }
                    className="w-full h-10 rounded-md bg-slate-700 border border-slate-600 px-3 text-sm text-white"
                    data-testid="select-posting-client"
                  >
                    <option value="">Select client…</option>
                    {(Array.isArray(allUsers) ? allUsers : []).map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="posting-effective-date" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Effective Date & Time</label>
                  <Input
                    id="posting-effective-date"
                    name="effectiveDate"
                    type="datetime-local"
                    value={postingForm.effectiveDate}
                    onChange={(e) => setPostingForm(f => ({ ...f, effectiveDate: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                    data-testid="input-posting-date"
                  />
                </div>

                {postingForm.postingType === "transfer" && (
                  <div className="space-y-1.5">
                    <label htmlFor="posting-from-account" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Source Account</label>
                    <select
                      id="posting-from-account"
                      name="fromAccountId"
                      value={postingForm.fromAccountId}
                      onChange={(e) => setPostingForm(f => ({ ...f, fromAccountId: e.target.value }))}
                      disabled={!postingForm.clientUserId}
                      className="w-full h-10 rounded-md bg-slate-700 border border-slate-600 px-3 text-sm text-white disabled:opacity-50"
                      data-testid="select-posting-from-account"
                    >
                      <option value="">Select source account…</option>
                      {clientAccounts.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)} ({a.accountNumber}) — {formatCAD(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="posting-to-account" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Destination Account
                  </label>
                  <select
                    id="posting-to-account"
                    name="toAccountId"
                    value={postingForm.toAccountId}
                    onChange={(e) => setPostingForm(f => ({ ...f, toAccountId: e.target.value }))}
                    disabled={!postingForm.clientUserId}
                    className="w-full h-10 rounded-md bg-slate-700 border border-slate-600 px-3 text-sm text-white disabled:opacity-50"
                    data-testid="select-posting-to-account"
                  >
                    <option value="">Select destination account…</option>
                    {(postingForm.postingType === "deposit" ? clientAccounts : allAccounts)
                      .filter((a: any) => String(a.id) !== postingForm.fromAccountId)
                      .map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.userName ? `${a.userName} — ` : ""}
                          {accountLabel(a)} ({a.accountNumber}) — {formatCAD(a.balance)}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="posting-amount" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Amount (CAD)</label>
                  <Input
                    id="posting-amount"
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 25000.00"
                    value={postingForm.amount}
                    onChange={(e) => setPostingForm(f => ({ ...f, amount: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                    data-testid="input-posting-amount"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="posting-evidence" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Evidence / Reference
                  </label>
                  <Input
                    id="posting-evidence"
                    name="evidenceRef"
                    type="text"
                    placeholder="e.g. WIRE-2026-88412 / RBC Statement #44"
                    value={postingForm.evidenceRef}
                    onChange={(e) => setPostingForm(f => ({ ...f, evidenceRef: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                    data-testid="input-posting-evidence"
                  />
                </div>

                <div className="md:col-span-2 space-y-1.5">
                  <label htmlFor="posting-description" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Statement Description <span className="normal-case text-slate-500">(optional — shown in client history)</span>
                  </label>
                  <Input
                    id="posting-description"
                    name="description"
                    type="text"
                    placeholder="e.g. Inbound Wire Settlement"
                    value={postingForm.description}
                    onChange={(e) => setPostingForm(f => ({ ...f, description: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                    data-testid="input-posting-description"
                  />
                </div>

                <div className="md:col-span-2 space-y-1.5">
                  <label htmlFor="posting-reason" className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Audit Reason
                  </label>
                  <Textarea
                    id="posting-reason"
                    name="reason"
                    placeholder="Explain why this posting is being created and how the movement was verified…"
                    value={postingForm.reason}
                    onChange={(e) => setPostingForm(f => ({ ...f, reason: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 min-h-[84px]"
                    data-testid="input-posting-reason"
                  />
                </div>

                {previewMutation.isError && (
                  <div className="md:col-span-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2" role="alert">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{(previewMutation.error as Error)?.message || "Failed to generate posting preview"}</span>
                  </div>
                )}

                <div className="md:col-span-2 flex justify-end">
                  <Button
                    type="button"
                    disabled={
                      !currentStaff ||
                      !postingForm.clientUserId ||
                      !postingForm.toAccountId ||
                      (postingForm.postingType === "transfer" && !postingForm.fromAccountId) ||
                      !postingForm.amount ||
                      !postingForm.reason.trim() ||
                      !postingForm.evidenceRef.trim() ||
                      previewMutation.isPending
                    }
                    onClick={() => previewMutation.mutate()}
                    data-testid="button-preview-posting"
                  >
                    <FileCheck2 className="w-4 h-4 mr-1.5" />
                    {previewMutation.isPending ? "Generating Summary…" : "Review Before & After Summary"}
                  </Button>
                </div>
              </div>
            ) : (
              /* Before-and-After Summary Step */
              <div className="space-y-4 rounded-xl border border-primary/40 bg-slate-900/60 p-5" data-testid="posting-preview-summary">
                <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                  <div>
                    <h3 className="text-white font-semibold text-base">Before & After Posting Summary</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Review all affected balances and audit fields before queuing for second-admin approval.
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 uppercase font-semibold">
                    {postingPreview.postingType}
                  </span>
                </div>

                {Array.isArray(postingPreview.warnings) && postingPreview.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                    {postingPreview.warnings.map((w: string, i: number) => (
                      <p key={i} className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
                    <span className="text-slate-400 uppercase">Client</span>
                    <p className="text-white font-medium mt-0.5">{postingPreview.client?.name} ({postingPreview.client?.email})</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
                    <span className="text-slate-400 uppercase">Amount & Effective Date</span>
                    <p className="text-white font-semibold mt-0.5">
                      {formatCAD(postingPreview.amount)} · {new Date(postingPreview.effectiveDate).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
                    <span className="text-slate-400 uppercase">Evidence / Reference</span>
                    <p className="text-white font-mono mt-0.5">{postingPreview.evidenceRef}</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
                    <span className="text-slate-400 uppercase">Submitted By</span>
                    <p className="text-white font-medium mt-0.5">
                      {currentStaff?.displayName} (@{currentStaff?.username})
                    </p>
                  </div>
                  <div className="sm:col-span-2 bg-slate-800/60 rounded-lg p-3 border border-slate-700">
                    <span className="text-slate-400 uppercase">Reason</span>
                    <p className="text-slate-200 mt-0.5">{postingPreview.reason}</p>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-700 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800/80 text-xs uppercase text-slate-400">
                      <tr>
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-left px-3 py-2">Role</th>
                        <th className="text-right px-3 py-2">Balance Before</th>
                        <th className="text-right px-3 py-2">Change</th>
                        <th className="text-right px-3 py-2">Balance After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/60">
                      {postingPreview.affectedAccounts.map((acc: any) => (
                        <tr key={acc.accountId} className="text-slate-200">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-white">{acc.accountLabel}</div>
                            <div className="text-xs text-slate-400 font-mono">{acc.accountNumber} · {acc.ownerName}</div>
                          </td>
                          <td className="px-3 py-2.5 capitalize text-xs text-slate-300">{acc.role}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{formatCAD(acc.balanceBefore)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-semibold ${String(acc.delta).startsWith("+") ? "text-emerald-400" : "text-red-400"}`}>
                            {acc.delta.startsWith("+") ? `+${formatCAD(acc.delta.slice(1))}` : `-${formatCAD(acc.delta.slice(1))}`}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">
                            {formatCAD(acc.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap justify-between gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-600 text-slate-300"
                    onClick={() => setPostingPreview(null)}
                  >
                    Back to Edit
                  </Button>
                  <Button
                    type="button"
                    disabled={!postingPreview.canSubmit || submitPostingMutation.isPending}
                    onClick={() => submitPostingMutation.mutate()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    data-testid="button-confirm-queue-posting"
                  >
                    <ShieldCheck className="w-4 h-4 mr-1.5" />
                    Confirm & Queue for Second-Admin Approval
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 3. LEDGER & AUDIT TRAIL ── */}
      {subView === "ledger" && (
        <div className="space-y-4">
          <Card className="bg-slate-800/40 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-400" />
                  Immutable Transaction Ledger
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value as any)}
                    className="h-8 rounded-md bg-slate-700 border border-slate-600 px-2.5 text-xs text-white"
                  >
                    <option value="all">All Origins</option>
                    <option value="client">Client Origin</option>
                    <option value="staff">Staff Origin</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="h-8 rounded-md bg-slate-700 border border-slate-600 px-2.5 text-xs text-white"
                  >
                    <option value="all">All Statuses</option>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed / Rejected</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-slate-600 text-slate-300"
                    onClick={() => setShowGlobalAudit(v => !v)}
                  >
                    <History className="w-3.5 h-3.5 mr-1.5" />
                    {showGlobalAudit ? "Hide Audit Log" : "View Full Audit Log"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {allTxnsLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide">
                        <th className="text-left py-3 pr-3 font-medium">ID & Origin</th>
                        <th className="text-left py-3 pr-3 font-medium">Client & Accounts</th>
                        <th className="text-left py-3 pr-3 font-medium">Direction</th>
                        <th className="text-right py-3 pr-3 font-medium">Amount</th>
                        <th className="text-left py-3 pr-3 font-medium">Status</th>
                        <th className="text-left py-3 pr-3 font-medium">Effective Date</th>
                        <th className="text-left py-3 pr-3 font-medium">Audit Summary</th>
                        <th className="text-right py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {filteredLedger.map((txn: any) => {
                        const canReverse =
                          txn.status === "completed" &&
                          !txn.reversalOfTransactionId &&
                          !txn.reversedByTransactionId &&
                          !txn.pendingReversalRequestId &&
                          (txn.fromAccountId != null || txn.toAccountId != null);
                        return (
                          <tr key={txn.id} className="hover:bg-slate-700/20 align-top" data-testid={`txn-row-${txn.id}`}>
                            <td className="py-3 pr-3 whitespace-nowrap">
                              <div className="text-slate-200 font-mono text-xs font-semibold">TXN-{txn.id}</div>
                              <span
                                className={`inline-block mt-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                                  txn.entryOrigin === "staff"
                                    ? "border-primary/40 text-primary bg-primary/10"
                                    : "border-slate-500/40 text-slate-300 bg-slate-700/50"
                                }`}
                              >
                                {txn.entryOrigin === "staff" ? "Staff Entry" : "Client"}
                              </span>
                            </td>
                            <td className="py-3 pr-3">
                              <div className="text-slate-200 font-medium">{txn.userName}</div>
                              <div className="text-slate-400 text-xs">{txn.fromAccountLabel || txn.toAccountLabel || "—"}</div>
                              {txn.fromAccountLabel && txn.toAccountLabel && (
                                <div className="text-slate-500 text-xs">→ {txn.toAccountLabel}</div>
                              )}
                              <div className="text-slate-400 text-xs mt-0.5 max-w-[220px] truncate">{txn.description || "—"}</div>
                            </td>
                            <td className="py-3 pr-3 whitespace-nowrap">{directionBadge(txn.direction || txn.transactionType)}</td>
                            <td className="py-3 pr-3 text-right font-semibold text-white whitespace-nowrap">{formatCAD(txn.amount)}</td>
                            <td className="py-3 pr-3 whitespace-nowrap">
                              <StatusBadge status={txn.status} />
                              {txn.reversedByTransactionId && (
                                <div className="text-[11px] text-amber-300 font-mono mt-1">
                                  Reversed by TXN-{txn.reversedByTransactionId}
                                </div>
                              )}
                              {txn.pendingReversalRequestId && (
                                <div className="text-[11px] text-amber-300 mt-1">
                                  Reversal APR-{txn.pendingReversalRequestId} pending
                                </div>
                              )}
                              {txn.reversalOfTransactionId && (
                                <div className="text-[11px] text-sky-300 font-mono mt-1">
                                  Reverses TXN-{txn.reversalOfTransactionId}
                                </div>
                              )}
                              {txn.replacesTransactionId && (
                                <div className="text-[11px] text-emerald-300 font-mono mt-1">
                                  Replaces TXN-{txn.replacesTransactionId}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-3 text-slate-400 text-xs whitespace-nowrap">
                              {new Date(txn.createdAt).toLocaleString()}
                            </td>
                            <td className="py-3 pr-3 text-xs text-slate-400 max-w-[240px]">
                              {txn.createdByStaffName && (
                                <p>Created: <span className="text-slate-200">{txn.createdByStaffName}</span></p>
                              )}
                              {txn.approvedByStaffName && (
                                <p>Reviewed: <span className="text-slate-200">{txn.approvedByStaffName}</span></p>
                              )}
                              {txn.evidenceRef && (
                                <p className="font-mono text-slate-300 truncate">Ref: {txn.evidenceRef}</p>
                              )}
                              {(txn.auditReason || txn.adminNotes) && (
                                <p className="italic text-slate-400 truncate">{txn.auditReason || txn.adminNotes}</p>
                              )}
                            </td>
                            <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-slate-300 hover:text-white"
                                onClick={() => setAuditDialogTxn(txn)}
                                data-testid={`button-audit-txn-${txn.id}`}
                              >
                                <History className="w-3.5 h-3.5 mr-1" />
                                Audit
                              </Button>
                              {canReverse && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!currentStaff}
                                  className="h-7 px-2 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                                  onClick={() => {
                                    setReverseForm({
                                      reason: "",
                                      evidenceRef: "",
                                      includeReplacement: false,
                                      postingType: txn.fromAccountId ? "transfer" : "deposit",
                                      fromAccountId: txn.fromAccountId ? String(txn.fromAccountId) : "",
                                      toAccountId: txn.toAccountId ? String(txn.toAccountId) : "",
                                      amount: String(txn.amount),
                                      effectiveDate: defaultLocalDatetime(),
                                      description: txn.description || "",
                                    });
                                    setReverseDialogTxn(txn);
                                  }}
                                  data-testid={`button-reverse-txn-${txn.id}`}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                  Reverse
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                                onClick={() => {
                                  setReverseBalanceOnDelete(txn.status === "completed");
                                  setDeleteTarget({
                                    kind: "transaction",
                                    id: txn.id,
                                    title: `Delete transaction TXN-${txn.id}?`,
                                    summary: `Permanently delete TXN-${txn.id} (${formatCAD(txn.amount)} · ${txn.status}) along with linked audit trail, historical balance references, and fee assessment links.`,
                                    isCompletedTxn: txn.status === "completed",
                                  });
                                }}
                                data-testid={`button-delete-txn-${txn.id}`}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredLedger.length === 0 && (
                    <p className="text-center text-slate-400 py-8">No matching transactions</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {showGlobalAudit && (
            <Card className="bg-slate-800/40 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  Ledger Audit Events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(Array.isArray(globalAuditTrail) ? globalAuditTrail : []).map((ev: any) => (
                    <div key={ev.id} className="rounded-lg bg-slate-900/50 border border-slate-700 p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-white font-semibold">
                            {ev.transactionId ? `TXN-${ev.transactionId}` : ev.postingRequestId ? `APR-${ev.postingRequestId}` : "Ledger"}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-200 uppercase text-[10px]">
                            {ev.entryOrigin}
                          </span>
                          <span className="text-primary font-medium">{ev.action.replace(/_/g, " ")}</span>
                          <span className="text-slate-400">by {ev.actorName}</span>
                        </div>
                        <p className="text-slate-300 mt-1">{ev.reason}</p>
                        {ev.evidenceRef && <p className="text-slate-400 font-mono mt-0.5">Ref: {ev.evidenceRef}</p>}
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <span className="text-slate-500 whitespace-nowrap">{new Date(ev.createdAt).toLocaleString()}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          data-testid={`button-delete-audit-${ev.id}`}
                          onClick={() => setDeleteTarget({
                            kind: "audit",
                            id: ev.id,
                            title: `Delete audit event #${ev.id}?`,
                            summary: `Permanently delete audit log event #${ev.id} (${ev.action.replace(/_/g, " ")}) from the database.`,
                          })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(!Array.isArray(globalAuditTrail) || globalAuditTrail.length === 0) && (
                    <p className="text-center text-slate-400 py-6 text-sm">No audit events recorded yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── DIALOGS ── */}

      {/* Verify & Approve Client Request */}
      <Dialog open={!!approveClientDialog} onOpenChange={(o) => { if (!o) setApproveClientDialog(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Verify & Approve TXN-{approveClientDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-1 text-xs">
              <p className="text-slate-400">Client: <span className="text-white font-medium">{approveClientDialog?.userName}</span></p>
              <p className="text-slate-400">Amount: <span className="text-white font-semibold">{approveClientDialog ? formatCAD(approveClientDialog.amount) : ""}</span></p>
              <p className="text-slate-400">Direction: <span className="text-slate-200 capitalize">{String(approveClientDialog?.direction || "").replace(/_/g, " ")}</span></p>
            </div>
            <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <input
                type="checkbox"
                checked={verifiedMovement}
                onChange={(e) => setVerifiedMovement(e.target.checked)}
                className="mt-0.5"
                data-testid="checkbox-verify-movement"
              />
              <span>
                I confirm that the real-world funds movement / bank settlement for this request has been independently verified. (A client request alone is not proof of funds arrival.)
              </span>
            </label>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 uppercase font-semibold">Verification Note / Reference (optional)</label>
              <Input
                value={verificationNote}
                onChange={(e) => setVerificationNote(e.target.value)}
                placeholder="e.g. Verified wire settlement ref #88412"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveClientDialog(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!verifiedMovement || approveClientMutation.isPending}
              onClick={() => approveClientMutation.mutate({ id: approveClientDialog.id, note: verificationNote })}
              data-testid="button-confirm-approve-client"
            >
              Approve & Credit/Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Client Request (Reason Required) */}
      <Dialog open={!!rejectClientDialog} onOpenChange={(o) => { if (!o) setRejectClientDialog(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Client Request TXN-{rejectClientDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-400">
              Rejection requires an explicit audit reason (minimum 5 characters). Any deferred or held debit will be handled safely.
            </p>
            <Textarea
              value={rejectClientReason}
              onChange={(e) => setRejectClientReason(e.target.value)}
              placeholder="e.g. Funds were not received by settlement cutoff / bank trace unverified."
              className="bg-slate-700 border-slate-600 text-white min-h-[90px]"
              data-testid="input-reject-client-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectClientDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectClientReason.trim().length < 5 || rejectClientMutation.isPending}
              onClick={() => rejectClientMutation.mutate({ id: rejectClientDialog.id, reason: rejectClientReason.trim() })}
              data-testid="button-confirm-reject-client"
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Second-Admin Approve Posting */}
      <Dialog open={!!approvePostingDialog} onOpenChange={(o) => { if (!o) setApprovePostingDialog(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Second-Admin Approval — APR-{approvePostingDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-1.5">
              <p className="text-slate-400">Type: <span className="text-white capitalize font-medium">{String(approvePostingDialog?.postingType || "").replace(/_/g, " ")}</span></p>
              <p className="text-slate-400">Client: <span className="text-white">{approvePostingDialog?.clientName}</span></p>
              <p className="text-slate-400">Amount: <span className="text-white font-semibold">{approvePostingDialog ? formatCAD(approvePostingDialog.amount) : ""}</span></p>
              <p className="text-slate-400">Created By: <span className="text-white">{approvePostingDialog?.createdByStaffName} (@{approvePostingDialog?.createdByStaffUsername})</span></p>
              <p className="text-slate-400">Evidence Ref: <span className="text-white font-mono">{approvePostingDialog?.evidenceRef}</span></p>
              <p className="text-slate-400">Reason: <span className="text-slate-200">{approvePostingDialog?.reason}</span></p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 uppercase font-semibold">Reviewer Note (optional)</label>
              <Input
                value={postingReviewNote}
                onChange={(e) => setPostingReviewNote(e.target.value)}
                placeholder="e.g. Second-admin check complete against bank confirmation"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApprovePostingDialog(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={approvePostingMutation.isPending}
              onClick={() => approvePostingMutation.mutate({ id: approvePostingDialog.id, reviewNote: postingReviewNote })}
              data-testid="button-confirm-approve-posting"
            >
              Approve & Post to Ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Admin Posting */}
      <Dialog open={!!rejectPostingDialog} onOpenChange={(o) => { if (!o) setRejectPostingDialog(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Staff Entry APR-{rejectPostingDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              value={rejectPostingReason}
              onChange={(e) => setRejectPostingReason(e.target.value)}
              placeholder="Reason for rejecting this posting request (min 5 characters)…"
              className="bg-slate-700 border-slate-600 text-white min-h-[90px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectPostingDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectPostingReason.trim().length < 5 || rejectPostingMutation.isPending}
              onClick={() => rejectPostingMutation.mutate({ id: rejectPostingDialog.id, reason: rejectPostingReason.trim() })}
            >
              Reject Posting Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Audit Trail Dialog */}
      <Dialog open={!!auditDialogTxn} onOpenChange={(o) => { if (!o) setAuditDialogTxn(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Audit Trail — TXN-{auditDialogTxn?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto py-2">
            {auditLoading ? (
              <p className="text-slate-400 text-sm">Loading audit events…</p>
            ) : !Array.isArray(txnAuditEntries) || txnAuditEntries.length === 0 ? (
              <p className="text-slate-400 text-sm">No granular audit events logged for this historical entry.</p>
            ) : (
              txnAuditEntries.map((ev: any) => (
                <div key={ev.id} className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-primary uppercase">{ev.action.replace(/_/g, " ")}</span>
                    <span className="text-slate-400">{new Date(ev.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-200">Actor: {ev.actorName} ({ev.entryOrigin})</p>
                  <p className="text-slate-300">Reason: {ev.reason}</p>
                  {ev.evidenceRef && <p className="text-slate-400 font-mono">Evidence: {ev.evidenceRef}</p>}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditDialogTxn(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reversal & Optional Replacement Dialog */}
      <Dialog open={!!reverseDialogTxn} onOpenChange={(o) => { if (!o) setReverseDialogTxn(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reverse & Correct TXN-{reverseDialogTxn?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-amber-200">
              Posted entries are never edited or deleted. Queuing a reversal creates a linked offsetting entry (and optional replacement posting) subject to second-admin approval.
            </div>
            <div className="space-y-1.5">
              <label className="uppercase text-slate-400 font-semibold">Correction Reason</label>
              <Textarea
                value={reverseForm.reason}
                onChange={(e) => setReverseForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Explain why TXN is being reversed and corrected…"
                className="bg-slate-700 border-slate-600 text-white min-h-[72px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="uppercase text-slate-400 font-semibold">Evidence / Reference</label>
              <Input
                value={reverseForm.evidenceRef}
                onChange={(e) => setReverseForm(f => ({ ...f, evidenceRef: e.target.value }))}
                placeholder="e.g. CORR-2026-109 / Supervisor Ticket #14"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-slate-200 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={reverseForm.includeReplacement}
                onChange={(e) => setReverseForm(f => ({ ...f, includeReplacement: e.target.checked }))}
              />
              <span>Also create a linked replacement posting after reversing</span>
            </label>

            {reverseForm.includeReplacement && (
              <div className="space-y-3 rounded-lg bg-slate-900/60 border border-slate-700 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Replacement Type</label>
                    <select
                      value={reverseForm.postingType}
                      onChange={(e) => setReverseForm(f => ({ ...f, postingType: e.target.value as any, fromAccountId: "" }))}
                      className="w-full h-9 rounded bg-slate-700 border border-slate-600 px-2 text-white"
                    >
                      <option value="deposit">Deposit</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Corrected Amount (CAD)</label>
                    <Input
                      value={reverseForm.amount}
                      onChange={(e) => setReverseForm(f => ({ ...f, amount: e.target.value }))}
                      className="h-9 bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                </div>
                {reverseForm.postingType === "transfer" && (
                  <div>
                    <label className="text-slate-400 block mb-1">Source Account</label>
                    <select
                      value={reverseForm.fromAccountId}
                      onChange={(e) => setReverseForm(f => ({ ...f, fromAccountId: e.target.value }))}
                      className="w-full h-9 rounded bg-slate-700 border border-slate-600 px-2 text-white"
                    >
                      <option value="">Select source account…</option>
                      {reverseOwnerAccounts.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)} ({a.accountNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-slate-400 block mb-1">Destination Account</label>
                  <select
                    value={reverseForm.toAccountId}
                    onChange={(e) => setReverseForm(f => ({ ...f, toAccountId: e.target.value }))}
                    className="w-full h-9 rounded bg-slate-700 border border-slate-600 px-2 text-white"
                  >
                    <option value="">Select destination account…</option>
                    {(reverseForm.postingType === "deposit" ? reverseOwnerAccounts : allAccounts)
                      .filter((a: any) => String(a.id) !== reverseForm.fromAccountId)
                      .map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.userName ? `${a.userName} — ` : ""}
                          {accountLabel(a)} ({a.accountNumber})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Effective Date</label>
                  <Input
                    type="datetime-local"
                    value={reverseForm.effectiveDate}
                    onChange={(e) => setReverseForm(f => ({ ...f, effectiveDate: e.target.value }))}
                    className="h-9 bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Replacement Description</label>
                  <Input
                    value={reverseForm.description}
                    onChange={(e) => setReverseForm(f => ({ ...f, description: e.target.value }))}
                    className="h-9 bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReverseDialogTxn(null)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={
                reverseForm.reason.trim().length < 5 ||
                reverseForm.evidenceRef.trim().length < 3 ||
                reverseMutation.isPending
              }
              onClick={() => reverseMutation.mutate()}
            >
              Queue Reversal for Second Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleteRecordMutation.isPending) setDeleteTarget(null); }}>
        <DialogContent className="bg-slate-800 border-red-500/40 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-300">
              <Trash2 className="w-4 h-4" />
              {deleteTarget?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <p className="text-slate-300 leading-relaxed">{deleteTarget?.summary}</p>
            {deleteTarget?.kind === "transaction" && deleteTarget.isCompletedTxn && (
              <label
                htmlFor="delete-txn-reverse-balance"
                className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-slate-200 cursor-pointer"
              >
                <input
                  id="delete-txn-reverse-balance"
                  name="delete-txn-reverse-balance"
                  type="checkbox"
                  checked={reverseBalanceOnDelete}
                  onChange={(e) => setReverseBalanceOnDelete(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also reverse balance impact on affected account(s) if completed (recommended so account balances match remaining ledger records).
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={deleteRecordMutation.isPending} onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteRecordMutation.isPending}
              data-testid="button-confirm-delete-record"
              onClick={() => deleteTarget && deleteRecordMutation.mutate(deleteTarget)}
            >
              {deleteRecordMutation.isPending ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
