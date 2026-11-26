import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Headphones,
  Laptop,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Moon,
  PencilLine,
  Shield,
  SlidersHorizontal,
  Sun,
  UserRound,
} from "lucide-react";
import {
  bankingPreferencesPath,
  contactDetailsPath,
  contactDetailsSchema,
  DEFAULT_BANKING_PREFERENCES,
  type Address,
  type BankingPreferences,
  type ContactDetails,
} from "@shared/client-settings";
import { clientBalanceCurrency } from "@shared/balance-currency";
import { securityPaths } from "@shared/security";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { SecuritySettings } from "@/components/security-settings";
import { apiRequest } from "@/lib/queryClient";
import { applyThemeMode, normalizeThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type UserPreferences = {
  marketingEmails: boolean;
  securityAlerts: boolean;
  theme: ThemeMode;
};

type ContactPayload = ContactDetails & { currentPassword: string; code?: string };
const blankAddress = (): Address => ({ line1: "", line2: "", city: "", region: "", postalCode: "", country: "" });
const emptyContact = (): ContactDetails => ({ email: "", phoneNumber: "", residentialAddress: null, mailingAddress: null });
const advisorEmail = "veritaswealth@accountant.com";

const TIMEOUT_OPTIONS: Array<{ value: BankingPreferences["sessionTimeoutMinutes"]; label: string; note: string }> = [
  { value: 5, label: "5 minutes", note: "Highest security for shared environments" },
  { value: 10, label: "10 minutes", note: "Short inactivity lock" },
  { value: 15, label: "15 minutes", note: "Balanced banking protection" },
  { value: 25, label: "25 minutes", note: "Standard private client session limit" },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", description: "Crisp white and stone private bank canvas", icon: Sun },
  { value: "dark", label: "Dark", description: "Deep emerald-slate palette for low light", icon: Moon },
  { value: "system", label: "System", description: "Matches your device display settings", icon: Laptop },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : fallback;
}

function formatAddress(address: Address | null) {
  if (!address) return "Not provided";
  return [address.line1, address.line2, address.city, address.region, address.postalCode, address.country]
    .filter(Boolean)
    .join(", ");
}

function ContactInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border-slate-200 dark:border-border bg-white dark:bg-background"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AddressFields({
  title,
  address,
  onChange,
  errors,
}: {
  title: string;
  address: Address;
  onChange: (address: Address) => void;
  errors: Record<string, string>;
}) {
  const change = (key: keyof Address, value: string) => onChange({ ...address, [key]: value });
  const prefix = title === "Residential address" ? "residentialAddress" : "mailingAddress";
  return (
    <fieldset className="space-y-4 border-t border-slate-100 dark:border-border pt-5">
      <legend className="mb-1 pr-3 text-sm font-semibold text-slate-900 dark:text-foreground">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ContactInput
            id={`${prefix}-line1`}
            label="Street address"
            autoComplete="address-line1"
            value={address.line1}
            onChange={(value) => change("line1", value)}
            error={errors[`${prefix}.line1`]}
          />
        </div>
        <div className="sm:col-span-2">
          <ContactInput
            id={`${prefix}-line2`}
            label="Suite, apartment, or building (optional)"
            autoComplete="address-line2"
            value={address.line2}
            onChange={(value) => change("line2", value)}
            error={errors[`${prefix}.line2`]}
          />
        </div>
        <ContactInput
          id={`${prefix}-city`}
          label="City / town"
          autoComplete="address-level2"
          value={address.city}
          onChange={(value) => change("city", value)}
          error={errors[`${prefix}.city`]}
        />
        <ContactInput
          id={`${prefix}-region`}
          label="Province, state, or region (optional)"
          autoComplete="address-level1"
          value={address.region}
          onChange={(value) => change("region", value)}
          error={errors[`${prefix}.region`]}
        />
        <ContactInput
          id={`${prefix}-postal`}
          label="Postal / ZIP code"
          autoComplete="postal-code"
          value={address.postalCode}
          onChange={(value) => change("postalCode", value)}
          error={errors[`${prefix}.postalCode`]}
        />
        <ContactInput
          id={`${prefix}-country`}
          label="Country"
          autoComplete="country-name"
          value={address.country}
          onChange={(value) => change("country", value)}
          error={errors[`${prefix}.country`]}
        />
      </div>
    </fieldset>
  );
}

export default function SettingsPage({ profile = false }: { profile?: boolean } = {}) {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const currency = clientBalanceCurrency(user);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactDetails>(emptyContact);
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [contactError, setContactError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [contactSaved, setContactSaved] = useState(false);

  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    marketingEmails: true,
    securityAlerts: true,
    theme: "light",
  });
  const [bankingPrefs, setBankingPrefs] = useState<BankingPreferences>(DEFAULT_BANKING_PREFERENCES);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsSaved, setNotificationsSaved] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [portalSaved, setPortalSaved] = useState(false);

  const userPrefsInitialized = useRef(false);
  const bankingPrefsInitialized = useRef(false);

  const contactQuery = useQuery<ContactDetails>({
    queryKey: [contactDetailsPath],
    queryFn: async () => (await apiRequest("GET", contactDetailsPath)).json(),
  });

  const bankingPrefsQuery = useQuery<BankingPreferences>({
    queryKey: [bankingPreferencesPath],
    queryFn: async () => (await apiRequest("GET", bankingPreferencesPath)).json(),
  });

  useEffect(() => {
    if (user && !userPrefsInitialized.current) {
      userPrefsInitialized.current = true;
      setUserPrefs({
        marketingEmails: user.marketingEmails ?? true,
        securityAlerts: user.securityAlerts ?? true,
        theme: normalizeThemeMode(user.theme),
      });
    }
  }, [user]);

  useEffect(() => {
    if (bankingPrefsQuery.data && !bankingPrefsInitialized.current) {
      bankingPrefsInitialized.current = true;
      setBankingPrefs(bankingPrefsQuery.data);
    }
  }, [bankingPrefsQuery.data]);

  const saveContact = useMutation({
    gcTime: 0,
    mutationFn: async (payload: ContactPayload) =>
      (await apiRequest("PATCH", contactDetailsPath, payload)).json() as Promise<ContactDetails>,
    onSuccess: async (saved) => {
      queryClient.setQueryData([contactDetailsPath], saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [contactDetailsPath] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
      ]);
      setEditing(false);
      setCurrentPassword("");
      setCode("");
      setContactError("");
      setFieldErrors({});
      setContactSaved(true);
      saveContact.reset();
    },
    onError: (error) => {
      setContactError(errorMessage(error, "Your contact details could not be saved. Please try again."));
      saveContact.reset();
    },
  });

  const saveNotificationsMutation = useMutation({
    mutationFn: async (payload: {
      marketingEmails: boolean;
      securityAlerts: boolean;
      banking: BankingPreferences;
    }) => {
      await Promise.all([
        apiRequest("PATCH", "/api/user", {
          marketingEmails: payload.marketingEmails,
          securityAlerts: payload.securityAlerts,
        }),
        apiRequest("PATCH", bankingPreferencesPath, payload.banking),
      ]);
    },
    onSuccess: async (_data, vars) => {
      queryClient.setQueryData([bankingPreferencesPath], vars.banking);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
        queryClient.invalidateQueries({ queryKey: [bankingPreferencesPath] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
      ]);
      setNotificationsError("");
      setNotificationsSaved(true);
    },
    onError: (error) =>
      setNotificationsError(errorMessage(error, "Notification and statement settings could not be saved.")),
  });

  const savePortalMutation = useMutation({
    mutationFn: async (payload: { theme: ThemeMode; banking: BankingPreferences }) => {
      await Promise.all([
        apiRequest("PATCH", "/api/user", { theme: payload.theme }),
        apiRequest("PATCH", bankingPreferencesPath, payload.banking),
      ]);
    },
    onSuccess: async (_data, vars) => {
      applyThemeMode(vars.theme);
      queryClient.setQueryData([bankingPreferencesPath], vars.banking);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
        queryClient.invalidateQueries({ queryKey: [bankingPreferencesPath] }),
        queryClient.invalidateQueries({ queryKey: [securityPaths.activity] }),
      ]);
      setPortalError("");
      setPortalSaved(true);
    },
    onError: (error) => setPortalError(errorMessage(error, "Portal preferences could not be saved.")),
  });

  const startEditing = () => {
    const contact = contactQuery.data ?? emptyContact();
    setDraft({
      ...contact,
      residentialAddress: contact.residentialAddress ? { ...contact.residentialAddress } : null,
      mailingAddress: contact.mailingAddress ? { ...contact.mailingAddress } : null,
    });
    setCurrentPassword("");
    setCode("");
    setContactError("");
    setFieldErrors({});
    setContactSaved(false);
    setEditing(true);
  };

  const submitContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveContact.isPending) return;
    setContactError("");
    setFieldErrors({});
    const parsed = contactDetailsSchema.safeParse(draft);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setContactError("Please review the highlighted contact details.");
      return;
    }
    if (!currentPassword) {
      setContactError("Enter your current password to confirm these changes.");
      return;
    }
    if (user?.twoFactorEnabled && !code.trim()) {
      setContactError("Enter an authenticator or recovery code to confirm these changes.");
      return;
    }
    saveContact.mutate({
      ...parsed.data,
      currentPassword,
      ...(user?.twoFactorEnabled ? { code: code.trim() } : {}),
    });
  };

  const setAddress = (kind: "residentialAddress" | "mailingAddress", address: Address | null) =>
    setDraft((value) => ({ ...value, [kind]: address }));

  const name = user?.name?.trim() || "Private Client";
  const accountStanding = (user as any)?.accountFrozen
    ? "On Hold"
    : user?.initialDepositStatus === "required"
      ? "Activation Pending"
      : user?.initialDepositStatus === "pending_review"
        ? "Deposit Under Review"
        : "Active";

  return (
    <LayoutShell>
      <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
        {/* ── Page Header ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between px-0.5">
          <div>
            <h1 className="font-serif text-[26px] sm:text-[30px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
              {profile ? "Client Profile & Settings" : "Account Settings"}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
              Manage your verified banking identity, security credentials, statement delivery, and portal preferences.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5 text-[#0B2218] dark:text-primary" aria-hidden="true" />
            Protected client access
          </div>
        </div>

        {/* ── Client Identity Overview Strip ────────────────────────────── */}
        <section
          aria-label="Client profile summary"
          className="rounded-lg border border-slate-200/90 dark:border-border border-t-2 border-t-[#C6A15B]/80 bg-white dark:bg-card p-5 sm:px-6 shadow-sm"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0B2218] text-white font-serif text-lg font-semibold">
                {name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() || "")
                  .join("")}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-base font-semibold text-slate-900 dark:text-foreground" data-testid="text-profile-name">
                    {name}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      accountStanding === "Active"
                        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                        : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300",
                    )}
                  >
                    {accountStanding}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-muted-foreground">
                  <span>Private client</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Reporting Currency: <span className="font-mono font-medium text-slate-700 dark:text-foreground">{currency}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-md border-slate-200 dark:border-border"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                {logout.isPending ? "Signing out…" : "Sign out"}
              </Button>
              {logout.isError && (
                <p role="alert" className="w-full text-xs text-destructive">
                  Could not sign out. Please try again.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Banking Settings Workspace (Rail + Detail Panels) ─────────── */}
        <Tabs
          defaultValue="contact"
          className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start"
        >
          <TabsList
            aria-label="Account settings sections"
            className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card p-1.5 sm:grid-cols-3 lg:flex lg:flex-col lg:items-stretch lg:gap-1"
          >
            {[
              { value: "contact", label: "Profile & Contact", icon: UserRound },
              { value: "security", label: "Security & Sessions", icon: Shield },
              { value: "notifications", label: "Alerts & Statements", icon: Bell },
              { value: "preferences", label: "Portal & Display", icon: SlidersHorizontal },
              { value: "support", label: "Private Advisor", icon: Headphones },
            ].map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="justify-start gap-2.5 rounded-md px-3 py-2.5 text-xs font-medium text-slate-600 dark:text-muted-foreground data-[state=active]:bg-[#0B2218] data-[state=active]:text-white dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-none sm:text-[13px]"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── 1. Profile & Contact ────────────────────────────────────── */}
          <TabsContent value="contact" className="m-0 space-y-5">
            <section
              aria-labelledby="identity-heading"
              className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden"
            >
              <div className="flex flex-col gap-2 border-b border-slate-100 dark:border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 id="identity-heading" className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Verified Legal Identity
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Regulatory client record verified during onboarding.
                  </p>
                </div>
                <a
                  className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-[#0B2218] dark:text-primary hover:underline underline-offset-4"
                  href={`mailto:${advisorEmail}?subject=${encodeURIComponent("Legal name or KYC record update request")}`}
                >
                  Request legal name update <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>

              <dl className="divide-y divide-slate-100 dark:divide-border/60 px-5 sm:px-6">
                <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-5">
                  <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Legal name</dt>
                  <dd className="break-words text-sm font-semibold text-slate-900 dark:text-foreground">{name}</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-5">
                  <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Account standing</dt>
                  <dd className="text-sm font-medium text-slate-900 dark:text-foreground">{accountStanding}</dd>
                </div>
              </dl>
            </section>

            <section
              aria-labelledby="contact-heading"
              className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden"
            >
              <div className="flex flex-col gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 id="contact-heading" className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Contact & Correspondence Details
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Your email, telephone number, and registered residential or mailing addresses.
                  </p>
                </div>
                {!editing && !contactQuery.isLoading && !contactQuery.isError && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 rounded-md border-slate-200 dark:border-border sm:w-auto"
                    onClick={startEditing}
                  >
                    <PencilLine className="h-3.5 w-3.5" /> Edit details
                  </Button>
                )}
              </div>

              <div className="px-5 py-4 sm:px-6">
                {contactQuery.isLoading ? (
                  <div aria-label="Loading contact details" className="space-y-4 py-2">
                    <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
                    <div className="h-4 w-64 max-w-full animate-pulse rounded-md bg-muted" />
                    <div className="h-4 w-52 max-w-full animate-pulse rounded-md bg-muted" />
                  </div>
                ) : contactQuery.isError ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-sm text-foreground">
                      Contact details could not be loaded. Your saved information has not been changed.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => contactQuery.refetch()}>
                      Try again
                    </Button>
                  </div>
                ) : editing ? (
                  <form onSubmit={submitContact} className="space-y-5 py-1">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <ContactInput
                          id="contact-email"
                          label="Contact email"
                          type="email"
                          autoComplete="email"
                          value={draft.email}
                          onChange={(email) => {
                            setDraft((value) => ({ ...value, email }));
                            setContactSaved(false);
                          }}
                        />
                        {fieldErrors.email && <p className="mt-1.5 text-xs text-destructive">{fieldErrors.email}</p>}
                      </div>
                      <div>
                        <ContactInput
                          id="contact-phone"
                          label="Phone number"
                          type="tel"
                          autoComplete="tel"
                          value={draft.phoneNumber}
                          onChange={(phoneNumber) => {
                            setDraft((value) => ({ ...value, phoneNumber }));
                            setContactSaved(false);
                          }}
                        />
                        {fieldErrors.phoneNumber && (
                          <p className="mt-1.5 text-xs text-destructive">{fieldErrors.phoneNumber}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {draft.residentialAddress ? (
                        <AddressFields
                          title="Residential address"
                          address={draft.residentialAddress}
                          onChange={(address) => setAddress("residentialAddress", address)}
                          errors={fieldErrors}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddress("residentialAddress", blankAddress())}
                          className="flex min-h-11 w-full items-center justify-between rounded-md border border-dashed border-slate-300 dark:border-border px-4 py-2.5 text-left text-xs font-semibold text-[#0B2218] dark:text-primary hover:bg-slate-50 dark:hover:bg-muted/30"
                        >
                          <span className="inline-flex items-center gap-2">
                            <MapPin className="h-4 w-4" /> Add residential address
                          </span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      )}

                      {draft.mailingAddress ? (
                        <>
                          <AddressFields
                            title="Separate mailing address"
                            address={draft.mailingAddress}
                            onChange={(address) => setAddress("mailingAddress", address)}
                            errors={fieldErrors}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-xs text-slate-500 hover:text-foreground"
                            onClick={() => setAddress("mailingAddress", null)}
                          >
                            Remove separate mailing address
                          </Button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setAddress(
                              "mailingAddress",
                              draft.residentialAddress ? { ...draft.residentialAddress } : blankAddress(),
                            )
                          }
                          className="flex min-h-11 w-full items-center justify-between rounded-md border border-dashed border-slate-300 dark:border-border px-4 py-2.5 text-left text-xs font-semibold text-[#0B2218] dark:text-primary hover:bg-slate-50 dark:hover:bg-muted/30"
                        >
                          <span className="inline-flex items-center gap-2">
                            <MapPin className="h-4 w-4" /> Add a separate mailing address
                          </span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      )}
                      {fieldErrors.residentialAddress && (
                        <p className="text-xs text-destructive">{fieldErrors.residentialAddress}</p>
                      )}
                      {fieldErrors.mailingAddress && (
                        <p className="text-xs text-destructive">{fieldErrors.mailingAddress}</p>
                      )}
                    </div>

                    <div className="grid gap-4 border-t border-slate-100 dark:border-border pt-5 sm:grid-cols-2">
                      <ContactInput
                        id="contact-current-password"
                        label="Current password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={setCurrentPassword}
                      />
                      {user?.twoFactorEnabled && (
                        <ContactInput
                          id="contact-auth-code"
                          label="Authenticator or recovery code"
                          autoComplete="one-time-code"
                          value={code}
                          onChange={setCode}
                        />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-muted-foreground">
                      Confirm identity with your password
                      {user?.twoFactorEnabled ? " and an authenticator or recovery code" : ""} to update contact records.
                    </p>

                    {contactError && (
                      <p role="alert" className="flex gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {contactError}
                      </p>
                    )}

                    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 dark:border-border pt-4 sm:flex-row sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-md"
                        disabled={saveContact.isPending}
                        onClick={() => {
                          setEditing(false);
                          setCurrentPassword("");
                          setCode("");
                          setContactError("");
                          setFieldErrors({});
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="rounded-md bg-[#0B2218] hover:bg-[#133526] text-white"
                        disabled={saveContact.isPending}
                      >
                        {saveContact.isPending ? "Saving…" : "Save contact details"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    {contactSaved && (
                      <p role="status" className="mb-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-4 w-4" />
                        Contact details saved.
                      </p>
                    )}
                    <dl className="divide-y divide-slate-100 dark:divide-border/60">
                      <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-5">
                        <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Contact email</dt>
                        <dd className="break-words text-sm font-medium text-slate-900 dark:text-foreground">
                          {contactQuery.data?.email || "Not provided"}
                        </dd>
                      </div>
                      <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-5">
                        <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Phone number</dt>
                        <dd className="break-words text-sm font-medium text-slate-900 dark:text-foreground">
                          {contactQuery.data?.phoneNumber || "Not provided"}
                        </dd>
                      </div>
                      <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:items-start sm:gap-5">
                        <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Residential address</dt>
                        <dd className="break-words text-sm font-medium leading-6 text-slate-900 dark:text-foreground">
                          {formatAddress(contactQuery.data?.residentialAddress ?? null)}
                        </dd>
                      </div>
                      <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:items-start sm:gap-5">
                        <dt className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Mailing address</dt>
                        <dd className="break-words text-sm font-medium leading-6 text-slate-900 dark:text-foreground">
                          {contactQuery.data?.mailingAddress
                            ? formatAddress(contactQuery.data.mailingAddress)
                            : contactQuery.data?.residentialAddress
                              ? "Same as residential address"
                              : "Not provided"}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>
            </section>
          </TabsContent>

          {/* ── 2. Security & Sessions ──────────────────────────────────── */}
          <TabsContent value="security" className="m-0">
            <SecuritySettings />
          </TabsContent>

          {/* ── 3. Notifications & Statements ───────────────────────────── */}
          <TabsContent value="notifications" className="m-0 space-y-5">
            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
              <div className="flex items-start gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
                  <Bell className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Security & Activity Alerts
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Configure real-time notifications for sign-ins, transfers, and private client briefings.
                  </p>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-border/60 px-5 sm:px-6">
                <div className="flex items-start justify-between gap-4 py-4">
                  <div className="pr-2">
                    <Label htmlFor="security-alerts" className="text-sm font-medium text-slate-900 dark:text-foreground">
                      Security & sign-in alerts
                    </Label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                      Immediate notices for password updates, authenticator changes, and new sign-ins.
                    </p>
                  </div>
                  <Switch
                    id="security-alerts"
                    checked={userPrefs.securityAlerts}
                    onCheckedChange={(checked) => {
                      setUserPrefs((v) => ({ ...v, securityAlerts: checked }));
                      setBankingPrefs((v) => ({ ...v, loginAlerts: checked }));
                      setNotificationsSaved(false);
                      setNotificationsError("");
                    }}
                    aria-label="Security alerts preference"
                  />
                </div>

                <div className="flex items-start justify-between gap-4 py-4">
                  <div className="pr-2">
                    <Label htmlFor="transaction-alerts" className="text-sm font-medium text-slate-900 dark:text-foreground">
                      Transfer & wire activity alerts
                    </Label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                      Notifications when deposits clear, wire transfers execute, or fee notices are posted.
                    </p>
                  </div>
                  <Switch
                    id="transaction-alerts"
                    checked={bankingPrefs.transactionAlerts}
                    onCheckedChange={(checked) => {
                      setBankingPrefs((v) => ({ ...v, transactionAlerts: checked }));
                      setNotificationsSaved(false);
                      setNotificationsError("");
                    }}
                    aria-label="Transaction alerts preference"
                  />
                </div>

                <div className="flex items-start justify-between gap-4 py-4">
                  <div className="pr-2">
                    <Label htmlFor="marketing-emails" className="text-sm font-medium text-slate-900 dark:text-foreground">
                      Private wealth briefings & research
                    </Label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                      Quarterly investment outlooks, estate notes, and institutional commentary.
                    </p>
                  </div>
                  <Switch
                    id="marketing-emails"
                    checked={userPrefs.marketingEmails}
                    onCheckedChange={(checked) => {
                      setUserPrefs((v) => ({ ...v, marketingEmails: checked }));
                      setNotificationsSaved(false);
                      setNotificationsError("");
                    }}
                    aria-label="Marketing emails preference"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
              <div className="flex items-start gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Statements & Document Delivery
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Choose how monthly account statements and tax confirmations are delivered.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-2 sm:px-6">
                {[
                  {
                    value: "electronic" as const,
                    title: "Paperless (Electronic only)",
                    desc: "Encrypted PDF statements and tax slips in your client portal.",
                  },
                  {
                    value: "electronic_and_mail" as const,
                    title: "Electronic & Mailed Paper",
                    desc: "Portal access plus physical copies sent to your mailing address.",
                  },
                ].map((opt) => {
                  const selected = bankingPrefs.statementDelivery === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setBankingPrefs((v) => ({ ...v, statementDelivery: opt.value }));
                        setNotificationsSaved(false);
                        setNotificationsError("");
                      }}
                      aria-pressed={selected}
                      className={cn(
                        "flex flex-col items-start rounded-md border p-4 text-left transition-colors",
                        selected
                          ? "border-[#0B2218] dark:border-primary bg-emerald-50/40 dark:bg-primary/10"
                          : "border-slate-200 dark:border-border hover:border-slate-300 dark:hover:border-primary/40",
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-slate-900 dark:text-foreground">
                        {opt.title}
                        {selected && <Check className="h-4 w-4 text-[#0B2218] dark:text-primary shrink-0" />}
                      </span>
                      <span className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                        {opt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  {notificationsError && (
                    <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {notificationsError}
                    </p>
                  )}
                  {notificationsSaved && (
                    <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      Notification and statement preferences saved.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full rounded-md bg-[#0B2218] hover:bg-[#133526] text-white sm:w-auto"
                  disabled={saveNotificationsMutation.isPending}
                  onClick={() => {
                    setNotificationsError("");
                    setNotificationsSaved(false);
                    saveNotificationsMutation.mutate({
                      marketingEmails: userPrefs.marketingEmails,
                      securityAlerts: userPrefs.securityAlerts,
                      banking: bankingPrefs,
                    });
                  }}
                >
                  {saveNotificationsMutation.isPending ? "Saving…" : "Save preferences"}
                </Button>
              </div>
            </section>
          </TabsContent>

          {/* ── 4. Portal & Display ─────────────────────────────────────── */}
          <TabsContent value="preferences" className="m-0 space-y-5">
            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
              <div className="flex items-start gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
                  <Sun className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">Portal Appearance</h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Choose your display theme across your accounts and portfolio views.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = userPrefs.theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`theme-option-${opt.value}`}
                      aria-pressed={active}
                      onClick={() => {
                        setUserPrefs((v) => ({ ...v, theme: opt.value }));
                        applyThemeMode(opt.value);
                        setPortalSaved(false);
                        setPortalError("");
                      }}
                      className={cn(
                        "flex flex-col items-start rounded-md border p-3.5 text-left transition-colors",
                        active
                          ? "border-[#0B2218] dark:border-primary bg-emerald-50/40 dark:bg-primary/10"
                          : "border-slate-200 dark:border-border hover:border-slate-300 dark:hover:border-primary/40",
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <Icon className="h-4 w-4 text-[#0B2218] dark:text-primary" aria-hidden="true" />
                        {active && <Check className="h-3.5 w-3.5 text-[#0B2218] dark:text-primary" />}
                      </div>
                      <span className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-foreground">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
              <div className="flex items-start gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Automatic Session Lock
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Automatically sign out after periods of inactivity (maximum 25 minutes per security policy).
                  </p>
                </div>
              </div>

              <div className="grid gap-2.5 p-5 sm:grid-cols-2 sm:px-6">
                {TIMEOUT_OPTIONS.map((opt) => {
                  const active = bankingPrefs.sessionTimeoutMinutes === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`session-timeout-${opt.value}`}
                      aria-pressed={active}
                      onClick={() => {
                        setBankingPrefs((v) => ({ ...v, sessionTimeoutMinutes: opt.value }));
                        setPortalSaved(false);
                        setPortalError("");
                      }}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border px-3.5 py-3 text-left transition-colors",
                        active
                          ? "border-[#0B2218] dark:border-primary bg-emerald-50/40 dark:bg-primary/10"
                          : "border-slate-200 dark:border-border hover:border-slate-300 dark:hover:border-primary/40",
                      )}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-foreground">{opt.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">{opt.note}</p>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-[#0B2218] dark:text-primary" />}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  {portalError && (
                    <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {portalError}
                    </p>
                  )}
                  {portalSaved && (
                    <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      Portal preferences saved.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="button-save-portal-preferences"
                  className="w-full rounded-md bg-[#0B2218] hover:bg-[#133526] text-white sm:w-auto"
                  disabled={savePortalMutation.isPending}
                  onClick={() => {
                    setPortalError("");
                    setPortalSaved(false);
                    savePortalMutation.mutate({
                      theme: userPrefs.theme,
                      banking: bankingPrefs,
                    });
                  }}
                >
                  {savePortalMutation.isPending ? "Saving…" : "Save display & session settings"}
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card p-5 sm:px-6 shadow-xs">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground">
                    <Globe className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                        Institutional Reporting Currency
                      </h2>
                      <span className="rounded-md border border-slate-200 dark:border-border bg-slate-50 dark:bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-slate-800 dark:text-foreground">
                        {currency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                      Your portfolio reporting currency is an institutional designation managed by Private Client Operations.
                    </p>
                  </div>
                </div>
                <a
                  href={`mailto:${advisorEmail}?subject=${encodeURIComponent(`Reporting currency inquiry (${user?.clientRef || name})`)}`}
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#0B2218] dark:text-primary hover:underline underline-offset-4"
                >
                  Request review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </section>
          </TabsContent>

          {/* ── 5. Private Advisor ──────────────────────────────────────── */}
          <TabsContent value="support" className="m-0 space-y-5">
            <section className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card shadow-xs overflow-hidden">
              <div className="flex items-start gap-3 border-b border-slate-100 dark:border-border px-5 py-4 sm:px-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-[#0B2218] dark:text-emerald-300">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
                    Private Client Advisory Desk
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                    Direct institutional support for record amendments, custody inquiries, and wire verification.
                  </p>
                </div>
              </div>

              <div className="p-5 sm:px-6 space-y-4">
                <a
                  href={`mailto:${advisorEmail}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-4 py-3.5 text-sm font-semibold text-[#0B2218] dark:text-primary hover:border-slate-300 dark:hover:border-primary/40 transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Mail className="h-4 w-4 shrink-0" />
                    <span className="break-all">{advisorEmail}</span>
                  </span>
                  <ArrowUpRight className="ml-3 h-4 w-4 shrink-0" aria-hidden="true" />
                </a>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      title: "Legal Name & KYC",
                      desc: "Submit supporting identity documents for name or residency amendments.",
                      subject: "Legal name / KYC update request",
                    },
                    {
                      title: "Statements & Tax",
                      desc: "Request certified institutional balance letters or historical tax slips.",
                      subject: "Certified statement & tax documentation request",
                    },
                    {
                      title: "Wire & Custody",
                      desc: "Coordinate large international wires or third-party custody transfers.",
                      subject: "Wire & custody instruction assistance",
                    },
                  ].map((item) => (
                    <a
                      key={item.title}
                      href={`mailto:${advisorEmail}?subject=${encodeURIComponent(`${item.subject}${user?.clientRef ? ` (${user.clientRef})` : ""}`)}`}
                      className="flex flex-col justify-between rounded-md border border-slate-200 dark:border-border p-4 hover:border-slate-300 dark:hover:border-primary/40 transition-colors group"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-foreground flex items-center justify-between gap-2">
                          {item.title}
                          <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#0B2218] dark:group-hover:text-primary shrink-0" />
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </LayoutShell>
  );
}
