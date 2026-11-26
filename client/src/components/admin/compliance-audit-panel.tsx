import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { ComplianceAuditItem, ComplianceAuditSummary } from "@shared/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, StatusLabel, type StatusTone } from "./admin-status";

type ComplianceAuditResponse = {
  logs: ComplianceAuditItem[];
  summary: ComplianceAuditSummary;
};

const CATEGORY_OPTIONS = [
  { value: "", label: "All Categories" },
  { value: "auth", label: "Authentication" },
  { value: "session", label: "Sessions" },
  { value: "mfa", label: "2FA & Recovery" },
  { value: "money_movement", label: "Money Movement & Orders" },
  { value: "kyc_profile", label: "Profile & Preferences" },
  { value: "card_control", label: "Card Controls" },
  { value: "security", label: "Account Security" },
  { value: "admin_action", label: "Admin Actions" },
] as const;

const OUTCOME_OPTIONS = [
  { value: "", label: "All Outcomes" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "denied", label: "Denied" },
  { value: "pending_review", label: "Pending Review" },
] as const;

const SEVERITY_OPTIONS = [
  { value: "", label: "All Severities" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
] as const;

function severityTone(severity: string): StatusTone {
  if (severity === "critical") return "red";
  if (severity === "warning") return "amber";
  return "sky";
}

function outcomeTone(outcome: string): StatusTone {
  if (outcome === "failed" || outcome === "denied") return "red";
  if (outcome === "pending_review") return "amber";
  return "emerald";
}

export function ComplianceAuditPanel({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const buildParams = (limit?: number) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (outcome) params.set("outcome", outcome);
    if (severity) params.set("severity", severity);
    if (search.trim()) params.set("search", search.trim());
    if (limit) params.set("limit", String(limit));
    return params.toString();
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ComplianceAuditResponse>({
    queryKey: ["/api/admin/compliance-audit", category, outcome, severity, search.trim()],
    queryFn: async () => {
      const qs = buildParams(250);
      const url = qs ? `/api/admin/compliance-audit?${qs}` : "/api/admin/compliance-audit";
      const res = await adminFetch(url, adminKey);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to load compliance audit trail");
      return body;
    },
    refetchInterval: 30000,
    staleTime: 0,
  });

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const qs = buildParams();
      const url = qs ? `/api/admin/compliance-audit/export?${qs}` : "/api/admin/compliance-audit/export";
      const res = await adminFetch(url, adminKey);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to export CSV");
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `veritas-compliance-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
      toast({ title: "Compliance Audit Exported", description: "CSV report downloaded." });
      void refetch();
    } catch (err: any) {
      toast({
        title: "Export Failed",
        description: err?.message || "Could not export compliance logs",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary ?? {
    total24h: 0,
    failedLogins24h: 0,
    activeClientSessions: 0,
    criticalEvents24h: 0,
  };
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Events Logged (24h)</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{summary.total24h}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Failed Sign-Ins (24h)</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-amber-300">{summary.failedLogins24h}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Active Client Sessions</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-emerald-300">
            {summary.activeClientSessions}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Critical / Denied (24h)</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-rose-300">{summary.criticalEvents24h}</p>
        </div>
      </div>

      {/* Main Audit Card */}
      <section className="rounded-xl border border-[#1E293B] bg-[#0E1623] overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Security &amp; Compliance Audit Ledger</h2>
              <p className="text-xs text-slate-400">
                Immutable trace of authentication, devices, geo-IP context, financial approvals, and admin actions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="border-slate-700 bg-slate-900/70 text-slate-200 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExportCsv}
              disabled={exporting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="grid gap-2.5 border-b border-slate-800/80 bg-[#080D15]/60 px-5 py-3.5 md:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, actor, IP, action..."
              className="h-8.5 pl-8 bg-slate-900 border-slate-700 text-white text-xs"
            />
          </div>
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="h-8.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {OUTCOME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="h-8.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading compliance audit records…</div>
        ) : isError ? (
          <div className="p-6 text-center text-xs text-rose-300 space-y-2">
            <p>{(error as Error)?.message || "Could not load compliance logs."}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()} className="border-slate-700 text-xs">
              Retry
            </Button>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No audit records match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2.5 whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Severity / Outcome</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Category &amp; Action</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Actor</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Client Ref</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Device / IP / Location</th>
                  <th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {logs.map((entry) => {
                  const metaEntries = Object.entries(entry.metadata || {}).filter(
                    ([, v]) => v !== null && v !== undefined && v !== "",
                  );
                  return (
                    <tr key={entry.id} className="hover:bg-slate-900/40 align-top">
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-300 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap space-y-1">
                        <div>
                          <StatusLabel tone={severityTone(entry.severity)}>{entry.severity}</StatusLabel>
                        </div>
                        <div>
                          <StatusLabel tone={outcomeTone(entry.outcome)}>{entry.outcome}</StatusLabel>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono font-medium text-white">{entry.action}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{entry.category}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-slate-200">{entry.actorLabel || entry.actorType}</p>
                        <p className="text-[11px] text-slate-500 capitalize">{entry.actorType}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        {entry.targetClientRef || (entry.targetUserId ? `#${entry.targetUserId}` : "—")}
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <p className="text-slate-200">{entry.deviceSummary || "—"}</p>
                        <p className="font-mono text-[11px] text-slate-400 mt-0.5">
                          {[entry.ipAddress, entry.location].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {entry.requestMethod && entry.requestPath && (
                          <p className="font-mono text-[10px] text-slate-500 mt-0.5">
                            {entry.requestMethod} {entry.requestPath}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {metaEntries.length === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {metaEntries.slice(0, 5).map(([k, v]) => (
                              <span
                                key={k}
                                className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                              >
                                {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
