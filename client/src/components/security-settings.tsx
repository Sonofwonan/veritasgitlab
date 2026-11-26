import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  History,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  MapPin,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
} from "lucide-react";
import { recoveryRequestPath, type RecoveryRequest } from "@shared/client-settings";
import {
  securityPaths,
  type ClientSessionItem,
  type RecoveryResult,
  type SecurityActivityItem,
  type SecurityStatus,
  type SetupResult,
} from "@shared/security";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogStep = "password" | "setup" | "disable" | "recovery" | null;
type PasswordFields = { currentPassword: string; newPassword: string; confirmPassword: string; code: string };
type ReauthFields = { currentPassword: string; code: string };

const emptyPassword: PasswordFields = { currentPassword: "", newPassword: "", confirmPassword: "", code: "" };
const emptyReauth: ReauthFields = { currentPassword: "", code: "" };

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : fallback;
}

function formatActivityDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Recent";
  return date.toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SecurityField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  maxLength,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-slate-700 dark:text-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        className="h-10 rounded-md border-slate-200 dark:border-border bg-white dark:bg-background"
      />
    </div>
  );
}

export function SecuritySettings() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [dialog, setDialog] = useState<DialogStep>(null);
  const [passwordFields, setPasswordFields] = useState<PasswordFields>(emptyPassword);
  const [reauthFields, setReauthFields] = useState<ReauthFields>(emptyReauth);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState("");
  const [sessionsFeedback, setSessionsFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const statusQuery = useQuery<SecurityStatus>({
    queryKey: [securityPaths.status],
    queryFn: async () => (await apiRequest("GET", securityPaths.status)).json(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const status = statusQuery.data;

  const requestQuery = useQuery<RecoveryRequest | null>({
    queryKey: [recoveryRequestPath],
    queryFn: async () => (await apiRequest("GET", recoveryRequestPath)).json(),
    refetchInterval: 30000,
  });

  const activityQuery = useQuery<SecurityActivityItem[]>({
    queryKey: [securityPaths.activity],
    queryFn: async () => (await apiRequest("GET", securityPaths.activity)).json(),
    staleTime: 15000,
  });

  const sessionsQuery = useQuery<ClientSessionItem[]>({
    queryKey: [securityPaths.sessions],
    queryFn: async () => (await apiRequest("GET", securityPaths.sessions)).json(),
    staleTime: 15000,
  });

  const passwordMutation = useMutation({
    gcTime: 0,
    mutationFn: async (payload: PasswordFields) => {
      const body = {
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
        confirmPassword: payload.confirmPassword,
        ...(payload.code.trim() ? { code: payload.code.trim() } : {}),
      };
      const response = await apiRequest("POST", securityPaths.password, body);
      return response.json().catch(() => ({}));
    },
    onSuccess: () => {
      setDialog(null);
      setPasswordFields(emptyPassword);
      passwordMutation.reset();
      queryClient.clear();
      setLocation("/auth?passwordChanged=1");
    },
    onError: (e: Error) => setError(messageFrom(e, "We could not change your password. Please try again.")),
  });

  const setupMutation = useMutation<SetupResult, Error, { currentPassword: string }>({
    gcTime: 0,
    mutationFn: async (body) => (await apiRequest("POST", securityPaths.setup, body)).json(),
    onError: (e) => setError(messageFrom(e, "We could not start two-factor setup. Please try again.")),
  });

  const confirmMutation = useMutation({
    gcTime: 0,
    mutationFn: async (code: string) =>
      (await apiRequest("POST", securityPaths.confirm, { code })).json() as Promise<RecoveryResult>,
    onSuccess: async () => {
      setSetupResult(null);
      setDialog(null);
      setReauthFields(emptyReauth);
      disableMutation.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [securityPaths.status] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
      ]);
    },
    onError: (e) => setError(messageFrom(e, "That code could not be verified. Check it and try again.")),
  });

  const disableMutation = useMutation({
    gcTime: 0,
    mutationFn: async (body: ReauthFields) => (await apiRequest("POST", securityPaths.disable, body)).json(),
    onSuccess: async () => {
      setDialog(null);
      setReauthFields(emptyReauth);
      disableMutation.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [securityPaths.status] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
      ]);
    },
    onError: (e) => setError(messageFrom(e, "Two-factor sign-in could not be turned off. Please try again.")),
  });

  const recoveryMutation = useMutation<RecoveryRequest, Error, ReauthFields>({
    gcTime: 0,
    mutationFn: async (body) =>
      (await apiRequest("POST", recoveryRequestPath, { currentPassword: body.currentPassword })).json(),
    onSuccess: (result) => {
      setDialog(null);
      setReauthFields(emptyReauth);
      recoveryMutation.reset();
      queryClient.invalidateQueries({ queryKey: [securityPaths.status] });
      queryClient.setQueryData([recoveryRequestPath], result);
    },
    onError: (e) => setError(messageFrom(e, "Your request could not be submitted. Please try again.")),
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", securityPaths.revokeOtherSessions, {})).json(),
    onSuccess: async () => {
      setSessionsFeedback({ type: "success", message: "All other browser sessions have been signed out." });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [securityPaths.sessions] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
      ]);
    },
    onError: (e) =>
      setSessionsFeedback({
        type: "error",
        message: messageFrom(e, "Could not sign out of other sessions. Please try again."),
      }),
  });

  const revokeSingleSessionMutation = useMutation({
    mutationFn: async (prefix: string) =>
      (await apiRequest("POST", securityPaths.revokeSession(prefix), {})).json(),
    onSuccess: async () => {
      setSessionsFeedback({ type: "success", message: "Selected session has been signed out." });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [securityPaths.sessions] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
      ]);
    },
    onError: (e) =>
      setSessionsFeedback({
        type: "error",
        message: messageFrom(e, "Could not sign out that device. Please try again."),
      }),
  });

  const pending =
    passwordMutation.isPending ||
    setupMutation.isPending ||
    confirmMutation.isPending ||
    disableMutation.isPending ||
    recoveryMutation.isPending;

  const resetDialog = () => {
    setDialog(null);
    setPasswordFields(emptyPassword);
    setReauthFields(emptyReauth);
    setSetupResult(null);
    setError("");
    setupMutation.reset();
    confirmMutation.reset();
    passwordMutation.reset();
    disableMutation.reset();
    recoveryMutation.reset();
  };

  const beginSetup = async () => {
    if (setupMutation.isPending) return;
    setError("");
    const currentPassword = reauthFields.currentPassword;
    try {
      const result = await setupMutation.mutateAsync({ currentPassword });
      setSetupResult(result);
      setReauthFields(emptyReauth);
      setupMutation.reset();
    } catch {
      // Error is presented inline by the mutation.
    }
  };

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordMutation.isPending) return;
    setError("");
    if (passwordFields.newPassword.length < 12 || passwordFields.newPassword.length > 128) {
      setError("Choose a password between 12 and 128 characters.");
      return;
    }
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (status?.twoFactorEnabled && !passwordFields.code.trim()) {
      setError("Enter a code from your authenticator app or a recovery code.");
      return;
    }
    passwordMutation.mutate(passwordFields);
  };

  const submitDisable = (event: React.FormEvent) => {
    event.preventDefault();
    if (disableMutation.isPending) return;
    setError("");
    disableMutation.mutate(reauthFields);
  };

  const submitRecovery = (event: React.FormEvent) => {
    event.preventDefault();
    if (recoveryMutation.isPending) return;
    setError("");
    recoveryMutation.mutate(reauthFields);
  };

  return (
    <div className="space-y-5">
      {/* ── Authentication & Credentials Card ──────────────────────────── */}
      <section
        data-testid="security-status"
        className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-[#0B2218] dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">Sign-in & Authentication</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                Manage your password, authenticator app, and recovery verification.
              </p>
            </div>
          </div>
          {!statusQuery.isLoading && !statusQuery.isError && (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                status?.twoFactorEnabled
                  ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                  : "border-slate-200 dark:border-border bg-slate-50 dark:bg-muted text-slate-600 dark:text-muted-foreground"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status?.twoFactorEnabled ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400"
                }`}
              />
              {status?.twoFactorEnabled ? "2FA Enabled" : "2FA Off"}
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-border/60 px-5 sm:px-6">
          {statusQuery.isLoading ? (
            <div aria-label="Loading security status" className="space-y-3 py-5">
              <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded-md bg-muted" />
            </div>
          ) : statusQuery.isError ? (
            <div className="my-5 flex flex-col gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground">Your security settings could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-foreground">
                    Two-factor authenticator app
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                    {status?.twoFactorEnabled
                      ? `Active. ${status.recoveryCodesRemaining} unused recovery ${status.recoveryCodesRemaining === 1 ? "code" : "codes"} on file.`
                      : status?.setupRequired
                        ? "Enrollment is required to restore two-factor protection on sign-in."
                        : "Require a six-digit verification code from an authenticator app on every sign-in."}
                  </p>
                </div>
                {status?.twoFactorEnabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full shrink-0 rounded-md sm:w-auto"
                    data-testid="security-disable-two-factor"
                    onClick={() => {
                      setError("");
                      setReauthFields(emptyReauth);
                      setDialog("disable");
                    }}
                  >
                    Turn off 2FA
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full shrink-0 gap-2 rounded-md bg-[#0B2218] hover:bg-[#133526] text-white sm:w-auto"
                    data-testid="security-setup-two-factor"
                    onClick={() => {
                      setError("");
                      setReauthFields(emptyReauth);
                      setSetupResult(null);
                      setDialog("setup");
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Enable 2FA
                  </Button>
                )}
              </div>

              {status?.twoFactorEnabled && (
                <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-foreground">Recovery codes</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                      One-time emergency codes issued through Private Client Operations after identity confirmation.
                    </p>
                    {requestQuery.isError ? (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        Request status could not be loaded.{" "}
                        <button type="button" className="underline" onClick={() => void requestQuery.refetch()}>
                          Try again
                        </button>
                      </p>
                    ) : requestQuery.data ? (
                      <p role="status" className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {requestQuery.data.status === "pending"
                          ? "Recovery code request awaiting advisor verification."
                          : requestQuery.data.status === "issued"
                            ? "New recovery codes issued — contact your advisor for secure delivery."
                            : "Previous request declined. Contact your advisor or submit a new request."}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full shrink-0 gap-2 rounded-md sm:w-auto"
                    data-testid="security-replace-recovery"
                    disabled={requestQuery.isLoading || requestQuery.isError || requestQuery.data?.status === "pending"}
                    onClick={() => {
                      setError("");
                      setReauthFields(emptyReauth);
                      setDialog("recovery");
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Request recovery codes
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-foreground">Account password</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                Minimum 12 characters. Updating your password signs out all active sessions.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full shrink-0 rounded-md sm:w-auto"
              data-testid="security-change-password"
              onClick={() => {
                setError("");
                setPasswordFields(emptyPassword);
                setDialog("password");
              }}
            >
              Change password
            </Button>
          </div>
        </div>
      </section>

      {/* ── Active Sessions Card ────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
              <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">Active Devices &amp; Sessions</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                Review signed-in browsers, IP locations, and revoke unrecognized devices.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 gap-2 rounded-md sm:w-auto"
            data-testid="security-revoke-other-sessions"
            disabled={revokeSessionsMutation.isPending}
            onClick={() => {
              setSessionsFeedback(null);
              revokeSessionsMutation.mutate();
            }}
          >
            {revokeSessionsMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Sign out other sessions
          </Button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-border/60">
          {sessionsQuery.isLoading ? (
            <div className="space-y-3 p-5 sm:px-6">
              <div className="h-4 w-52 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-40 animate-pulse rounded-md bg-muted" />
            </div>
          ) : sessionsQuery.data && sessionsQuery.data.length > 0 ? (
            sessionsQuery.data.map((session) => {
              const dt = (session.deviceType || "").toLowerCase();
              const DeviceIcon =
                dt === "mobile"
                  ? Smartphone
                  : dt === "tablet"
                    ? Tablet
                    : Laptop;
              return (
                <div
                  key={session.sessionPrefix}
                  data-testid={`active-session-${session.sessionPrefix}`}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300 mt-0.5">
                      <DeviceIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-foreground">
                          {session.deviceSummary || `${session.browser} on ${session.os}`}
                        </p>
                        {session.current && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                            Current device
                          </span>
                        )}
                        {session.mfaVerified && (
                          <span className="inline-flex items-center rounded-md border border-slate-200 dark:border-border bg-slate-50 dark:bg-muted px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                            2FA verified
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-muted-foreground">
                        {session.ipAddress && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Globe className="h-3 w-3 shrink-0" />
                            {session.ipAddress}
                          </span>
                        )}
                        {session.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {session.location}
                          </span>
                        )}
                        <span className="tabular-nums">Last active {formatActivityDate(session.lastSeenAt)}</span>
                      </div>
                    </div>
                  </div>
                  {!session.current && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full shrink-0 rounded-md text-xs sm:w-auto"
                      disabled={revokeSingleSessionMutation.isPending}
                      onClick={() => {
                        setSessionsFeedback(null);
                        revokeSingleSessionMutation.mutate(session.sessionPrefix);
                      }}
                    >
                      Sign out
                    </Button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="px-5 py-5 sm:px-6">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-900 dark:text-foreground">Current portal session</p>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                Protected by automatic inactivity lock and encrypted session cookies.
              </p>
            </div>
          )}
        </div>

        {sessionsFeedback && (
          <div className="border-t border-slate-100 dark:border-border px-5 py-3 sm:px-6">
            <p
              role={sessionsFeedback.type === "error" ? "alert" : "status"}
              className={`flex items-center gap-2 text-xs font-medium ${
                sessionsFeedback.type === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {sessionsFeedback.type === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              )}
              {sessionsFeedback.message}
            </p>
          </div>
        )}
      </section>

      {/* ── Security Audit Log Card ─────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
              <History className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">Recent Security Activity</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                Verified sign-ins, device locations, and security configuration events on your account.
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-border/60">
          {activityQuery.isLoading ? (
            <div className="space-y-3 p-5 sm:px-6">
              <div className="h-4 w-52 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-44 animate-pulse rounded-md bg-muted" />
            </div>
          ) : activityQuery.isError ? (
            <div className="flex items-center justify-between gap-3 px-5 py-4 text-xs text-slate-500 sm:px-6">
              <span>Security activity log is temporarily unavailable.</span>
              <Button variant="ghost" size="sm" onClick={() => void activityQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : activityQuery.data && activityQuery.data.length > 0 ? (
            activityQuery.data.map((item) => {
              const isAlert = item.outcome === "failed" || item.outcome === "denied";
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-1.5 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between sm:px-6"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800 dark:text-foreground text-xs sm:text-sm">
                        {item.label}
                      </span>
                      {isAlert && (
                        <span className="inline-flex items-center rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-rose-700 dark:text-rose-300">
                          {item.outcome}
                        </span>
                      )}
                      {item.actorLabel && item.actorType && item.actorType !== "client" && (
                        <span className="inline-flex items-center rounded-md border border-slate-200 dark:border-border bg-slate-50 dark:bg-muted px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                          By {item.actorLabel}
                        </span>
                      )}
                    </div>
                    {(item.deviceSummary || item.ipAddress || item.location) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-muted-foreground">
                        {item.deviceSummary && <span>{item.deviceSummary}</span>}
                        {item.ipAddress && <span className="font-mono">{item.ipAddress}</span>}
                        {item.location && <span>{item.location}</span>}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500 dark:text-muted-foreground">
                    {formatActivityDate(item.createdAt)}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="px-5 py-6 text-center text-xs text-slate-500 dark:text-muted-foreground sm:px-6">
              No recent security events recorded.
            </p>
          )}
        </div>
      </section>

      {/* ── Security Dialogs ────────────────────────────────────────────── */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !pending) resetDialog();
        }}
      >
        <DialogContent data-testid="security-dialog" className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          {dialog === "password" && (
            <form onSubmit={submitPassword} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Change your password</DialogTitle>
                <DialogDescription>
                  For your protection, all signed-in devices will need to sign in again after this change.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <SecurityField
                  id="security-current-password"
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={passwordFields.currentPassword}
                  onChange={(value) => setPasswordFields((fields) => ({ ...fields, currentPassword: value }))}
                />
                <SecurityField
                  id="security-new-password"
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  maxLength={128}
                  value={passwordFields.newPassword}
                  onChange={(value) => setPasswordFields((fields) => ({ ...fields, newPassword: value }))}
                />
                <p className="-mt-2 text-xs text-muted-foreground">Use 12 to 128 characters.</p>
                <SecurityField
                  id="security-confirm-password"
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  maxLength={128}
                  value={passwordFields.confirmPassword}
                  onChange={(value) => setPasswordFields((fields) => ({ ...fields, confirmPassword: value }))}
                />
                {status?.twoFactorEnabled && (
                  <SecurityField
                    id="security-password-code"
                    label="Authenticator or recovery code"
                    autoComplete="one-time-code"
                    maxLength={64}
                    value={passwordFields.code}
                    onChange={(value) => setPasswordFields((fields) => ({ ...fields, code: value }))}
                  />
                )}
              </div>
              {error && (
                <p role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#0B2218] hover:bg-[#133526] text-white"
                  data-testid="security-change-password-submit"
                  disabled={passwordMutation.isPending}
                >
                  {passwordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change password
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === "setup" && !setupResult && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void beginSetup();
              }}
              className="space-y-5"
            >
              <DialogHeader>
                <DialogTitle>Set up authenticator sign-in</DialogTitle>
                <DialogDescription>
                  Enter your current password to begin. You will confirm a code before this is turned on.
                </DialogDescription>
              </DialogHeader>
              <SecurityField
                id="security-setup-current-password"
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={reauthFields.currentPassword}
                onChange={(value) => setReauthFields((fields) => ({ ...fields, currentPassword: value }))}
              />
              {error && (
                <p role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={setupMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#0B2218] hover:bg-[#133526] text-white"
                  disabled={setupMutation.isPending}
                >
                  {setupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Continue
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === "setup" && setupResult && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!confirmMutation.isPending) confirmMutation.mutate(reauthFields.code);
              }}
              className="space-y-5"
            >
              <DialogHeader>
                <DialogTitle>Connect your authenticator app</DialogTitle>
                <DialogDescription>
                  Scan this QR code with your authenticator app, then enter the six-digit code it shows.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-center rounded-md border border-slate-200 bg-white p-3">
                <img
                  src={setupResult.qrCodeDataUrl}
                  alt="Authenticator setup QR code"
                  className="h-48 w-48 max-w-full object-contain"
                />
              </div>
              <details className="rounded-md border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">Enter key manually</summary>
                <p className="mt-2 break-all font-mono text-xs tracking-wide" aria-label="Authenticator setup key">
                  {setupResult.secret}
                </p>
              </details>
              <SecurityField
                id="security-setup-code"
                label="Six-digit authenticator code"
                autoComplete="one-time-code"
                maxLength={6}
                value={reauthFields.code}
                onChange={(value) =>
                  setReauthFields((fields) => ({ ...fields, code: value.replace(/\D/g, "").slice(0, 6) }))
                }
              />
              {error && (
                <p role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={confirmMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#0B2218] hover:bg-[#133526] text-white"
                  disabled={confirmMutation.isPending || reauthFields.code.length !== 6}
                >
                  {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify and turn on
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === "disable" && (
            <form onSubmit={submitDisable} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Turn off authenticator sign-in?</DialogTitle>
                <DialogDescription>
                  You will no longer need an authenticator code when you sign in. Enter your password and a current code
                  to continue.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <SecurityField
                  id="security-disable-password"
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={reauthFields.currentPassword}
                  onChange={(value) => setReauthFields((fields) => ({ ...fields, currentPassword: value }))}
                />
                <SecurityField
                  id="security-disable-code"
                  label="Authenticator or recovery code"
                  autoComplete="one-time-code"
                  maxLength={64}
                  value={reauthFields.code}
                  onChange={(value) => setReauthFields((fields) => ({ ...fields, code: value }))}
                />
              </div>
              {error && (
                <p role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={disableMutation.isPending}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={disableMutation.isPending}>
                  {disableMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Turn off
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog === "recovery" && (
            <form onSubmit={submitRecovery} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Request recovery codes</DialogTitle>
                <DialogDescription>
                  An administrator will review your request. Existing codes stay valid until new codes are issued. Confirm
                  your password to submit.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <SecurityField
                  id="security-recovery-password"
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={reauthFields.currentPassword}
                  onChange={(value) => setReauthFields((fields) => ({ ...fields, currentPassword: value }))}
                />
              </div>
              {error && (
                <p role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={resetDialog} disabled={recoveryMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#0B2218] hover:bg-[#133526] text-white"
                  disabled={recoveryMutation.isPending}
                >
                  {recoveryMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit request
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
