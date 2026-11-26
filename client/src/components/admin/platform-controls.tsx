import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PLATFORM_SETTINGS,
  type NoticeSeverity,
  type PlatformSettings,
} from "@shared/client-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, StatusLabel } from "./admin-status";
import {
  Building2,
  Check,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";

type StaffMember = {
  id: number;
  username: string;
  displayName: string;
  active: boolean;
  createdAt: string;
};

type PlatformControlsProps = {
  adminKey: string;
  currentStaffId: number | null;
  onDeleteStaff?: (staff: StaffMember) => void;
};

export function PlatformControlsPanel({
  adminKey,
  currentStaffId,
  onDeleteStaff,
}: PlatformControlsProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const settingsQuery = useQuery<PlatformSettings>({
    queryKey: ["/api/admin/platform-settings"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/platform-settings", adminKey);
      if (!res.ok) throw new Error("Failed to load platform settings");
      return res.json();
    },
  });

  const staffQuery = useQuery<StaffMember[]>({
    queryKey: ["/api/admin/staff"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/staff", adminKey);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [draft, setDraft] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setDraft(settingsQuery.data);
    }
  }, [settingsQuery.data, dirty]);

  const updateDraft = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: PlatformSettings) => {
      const res = await adminFetch("/api/admin/platform-settings", adminKey, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to save platform settings");
      return data;
    },
    onSuccess: (data) => {
      setDirty(false);
      if (data?.settings) setDraft(data.settings);
      qc.invalidateQueries({ queryKey: ["/api/admin/platform-settings"] });
      qc.invalidateQueries({ queryKey: ["/api/client/controls"] });
      toast({
        title: "Platform controls saved",
        description: "Global client portal features and notices have been updated immediately.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // Inline Staff Creation & Toggle
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const createStaffMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch("/api/admin/staff", adminKey, {
        method: "POST",
        body: JSON.stringify({ username: newUsername, displayName: newDisplayName, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to create staff admin");
      return data;
    },
    onSuccess: (created) => {
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      qc.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/auth/status"] });
      toast({
        title: "Administrator created",
        description: `${created.displayName} (@${created.username}) can now sign in.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Could not add staff", description: err.message, variant: "destructive" });
    },
  });

  const toggleStaffMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await adminFetch(`/api/admin/staff/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to update staff status");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/staff"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const globalModules: Array<{
    key: keyof PlatformSettings;
    title: string;
    description: string;
  }> = [
    {
      key: "applicationsOpen",
      title: "Public Client Applications",
      description: "Allow prospective clients to submit new onboarding applications.",
    },
    {
      key: "accountOpeningEnabled",
      title: "New Account Opening Requests",
      description: "Allow clients to apply for additional Brokerage, IRA, or Trust accounts.",
    },
    {
      key: "wiresFeatureEnabled",
      title: "Domestic & International Wires",
      description: "Enable wire transfers and beneficiary management across the client portal.",
    },
    {
      key: "institutionalTransfersEnabled",
      title: "Institutional Custody Transfers",
      description: "Enable ACAT / rollover transfer submissions on the Transfers page.",
    },
    {
      key: "cardsFeatureEnabled",
      title: "Wealth Cards Module",
      description: "Expose the Cards navigation section and card management workspace.",
    },
    {
      key: "investmentsFeatureEnabled",
      title: "Investments & Portfolio Custody",
      description: "Expose the Investments route and holdings tables in client navigation.",
    },
    {
      key: "marketTradingEnabled",
      title: "Live Equity & ETF Order Execution",
      description: "Permit live buy/sell orders when enabled on both platform and client level.",
    },
  ];

  return (
    <div className="space-y-6" data-testid="admin-platform-controls">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0E1623] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-white">Global Platform &amp; Feature Controls</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Master kill-switches, maintenance mode, global client banners, portal branding, and staff administrators.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {dirty && <StatusLabel tone="amber">Unsaved changes</StatusLabel>}
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 text-xs"
            onClick={() => {
              setDirty(false);
              if (settingsQuery.data) setDraft(settingsQuery.data);
            }}
            disabled={!dirty || saveMutation.isPending}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(draft)}
            disabled={saveMutation.isPending}
            data-testid="button-save-platform-settings"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium gap-1.5"
          >
            {saveMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save Global Settings
          </Button>
        </div>
      </div>

      {/* Master Module Switches */}
      <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-800">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Master Client UI Modules</h3>
        </div>
        <div className="divide-y divide-slate-800/80">
          {globalModules.map((mod) => {
            const enabled = Boolean(draft[mod.key]);
            return (
              <div
                key={String(mod.key)}
                className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-900/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-medium text-white">{mod.title}</span>
                    <StatusLabel tone={enabled ? "emerald" : "neutral"}>
                      {enabled ? "Enabled" : "Disabled"}
                    </StatusLabel>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{mod.description}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(val) => updateDraft(mod.key, val as any)}
                  data-testid={`switch-platform-${String(mod.key)}`}
                />
              </div>
            );
          })}
        </div>
        {!draft.marketTradingEnabled && (
          <div className="px-5 py-3.5 bg-slate-950/60 border-t border-slate-800 space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Trading Paused Message (Shown to Clients)</label>
            <Input
              value={draft.marketPausedMessage}
              onChange={(e) => updateDraft("marketPausedMessage", e.target.value)}
              className="bg-slate-900 border-slate-700 text-white text-xs"
            />
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Maintenance Mode & Global Notice */}
        <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-800">
            <Wrench className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Maintenance &amp; Global Announcement</h3>
          </div>
          <div className="p-5 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Portal Maintenance Mode</span>
                  <StatusLabel tone={draft.maintenanceMode ? "red" : "emerald"}>
                    {draft.maintenanceMode ? "Active Lockout" : "Operational"}
                  </StatusLabel>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Blocks all client portal pages with an institutional maintenance screen (admin remains accessible).
                </p>
              </div>
              <Switch
                checked={draft.maintenanceMode}
                onCheckedChange={(val) => updateDraft("maintenanceMode", val)}
                data-testid="switch-maintenance-mode"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Maintenance Notice Text</label>
              <Textarea
                rows={2}
                value={draft.maintenanceMessage}
                onChange={(e) => updateDraft("maintenanceMessage", e.target.value)}
                className="bg-slate-900 border-slate-700 text-white text-xs resize-none"
              />
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-sky-400" />
                  <span className="text-sm font-medium text-white">Global Client Banner</span>
                </div>
                <Switch
                  checked={draft.globalNoticeEnabled}
                  onCheckedChange={(val) => updateDraft("globalNoticeEnabled", val)}
                  data-testid="switch-global-notice"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Severity</label>
                  <select
                    value={draft.globalNoticeSeverity}
                    onChange={(e) => updateDraft("globalNoticeSeverity", e.target.value as NoticeSeverity)}
                    className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-white"
                  >
                    <option value="info">Information</option>
                    <option value="warning">Advisory Warning</option>
                    <option value="critical">Critical Notice</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Banner Title</label>
                  <Input
                    value={draft.globalNoticeTitle}
                    onChange={(e) => updateDraft("globalNoticeTitle", e.target.value)}
                    placeholder="e.g. Quarterly Custody Window"
                    className="bg-slate-900 border-slate-700 text-white text-xs h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Banner Message</label>
                <Textarea
                  rows={2}
                  value={draft.globalNoticeMessage}
                  onChange={(e) => updateDraft("globalNoticeMessage", e.target.value)}
                  placeholder="Displayed across the top of all client portal screens when enabled."
                  className="bg-slate-900 border-slate-700 text-white text-xs resize-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Portal Identity & Advisor Desk */}
        <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-800">
            <Building2 className="w-4 h-4 text-[#C6A15B]" />
            <h3 className="text-sm font-semibold text-white">Portal Identity &amp; Private Advisor Desk</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Portal Brand Name</label>
                <Input
                  value={draft.portalName}
                  onChange={(e) => updateDraft("portalName", e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Brand Tagline</label>
                <Input
                  value={draft.portalTagline}
                  onChange={(e) => updateDraft("portalTagline", e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Primary Advisor Label</label>
                <Input
                  value={draft.advisorName}
                  onChange={(e) => updateDraft("advisorName", e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Advisor Contact Email</label>
                <Input
                  type="email"
                  value={draft.advisorEmail}
                  onChange={(e) => updateDraft("advisorEmail", e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Default Client Inactivity Timeout</label>
              <select
                value={draft.defaultSessionTimeoutMinutes}
                onChange={(e) =>
                  updateDraft("defaultSessionTimeoutMinutes", Number(e.target.value) as 5 | 10 | 15 | 25)
                }
                className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-white"
              >
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={25}>25 minutes (Standard)</option>
              </select>
            </div>
          </div>
        </section>
      </div>

      {/* Staff Administrators Management */}
      <section className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Staff Administrators &amp; Dual-Control Access</h3>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-400">
            {(staffQuery.data ?? []).length} staff accounts
          </span>
        </div>

        <div className="p-5 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto border border-slate-800 rounded-md">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-medium">Staff Member</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {(staffQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-500">
                      No staff administrator profiles created yet.
                    </td>
                  </tr>
                ) : (
                  (staffQuery.data ?? []).map((member) => {
                    const isSelf = currentStaffId === member.id;
                    return (
                      <tr key={member.id} className="hover:bg-slate-900/30">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-white">
                            {member.displayName} {isSelf && <span className="text-emerald-400">(You)</span>}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">@{member.username}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusLabel tone={member.active ? "emerald" : "red"}>
                            {member.active ? "Active" : "Disabled"}
                          </StatusLabel>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {!isSelf && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-[11px] border-slate-700 text-slate-200 hover:bg-slate-800"
                                disabled={toggleStaffMutation.isPending}
                                onClick={() => toggleStaffMutation.mutate({ id: member.id, active: !member.active })}
                              >
                                {member.active ? "Disable" : "Enable"}
                              </Button>
                            )}
                            {!isSelf && onDeleteStaff && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                                onClick={() => onDeleteStaff(member)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createStaffMutation.mutate();
            }}
            className="rounded-md border border-slate-800 bg-slate-950/50 p-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <UserPlus className="w-4 h-4 text-emerald-400" />
              Add Staff Administrator
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400">Display Name</label>
              <Input
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="e.g. Jordan Mercer"
                className="bg-slate-900 border-slate-700 text-white text-xs h-8"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400">Username</label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. jmercer"
                className="bg-slate-900 border-slate-700 text-white text-xs h-8 font-mono"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400">Password (min 10 chars)</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white text-xs h-8"
                required
                minLength={10}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={createStaffMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              {createStaffMutation.isPending ? "Creating…" : "Create Staff Admin"}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
