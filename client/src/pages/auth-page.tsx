import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Loader2, Eye, EyeOff, ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { BrandedLoader } from "@/components/branded-loader";
import { SessionLoadError } from "@/components/session-load-error";
import { InfoTip } from "@/components/ui/info-tip";

import {
  ANNUAL_INCOME_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  INITIAL_DEPOSIT_OPTIONS,
  INVESTMENT_EXPERIENCE_OPTIONS,
  INVESTMENT_GOAL_OPTIONS,
  ONBOARDING_COUNTRIES,
  ONBOARDING_NATIONALITIES,
  RISK_TOLERANCE_OPTIONS,
  SOURCE_OF_FUNDS_OPTIONS,
} from "@shared/onboarding-options";
import { BALANCE_CURRENCIES, BALANCE_CURRENCY_INFO } from "@shared/balance-currency";

const loginSchema = z.object({
  userId: z.string().min(1, "Client Reference is required"),
  password: z.string().min(1, "Password required"),
});

const appSchema = z.object({
  fullName: z.string().min(2, "Full name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(7, "Phone required"),
  dateOfBirth: z.string().min(1, "Date of birth required"),
  nationality: z.string().min(1, "Nationality required"),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().min(1, "Country required"),
  employmentStatus: z.string().min(1, "Required"),
  annualIncome: z.string().min(1, "Required"),
  investmentExperience: z.string().min(1, "Required"),
  riskTolerance: z.string().min(1, "Required"),
  investmentGoal: z.string().min(1, "Required"),
  initialDeposit: z.string().min(1, "Required"),
  customInitialDeposit: z.string().optional(),
  preferredCurrency: z.string().min(1, "Preferred currency required"),
  sourceOfFunds: z.string().min(1, "Required"),
}).superRefine((val, ctx) => {
  if (val.initialDeposit === "custom") {
    const num = Number(String(val.customInitialDeposit || "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(num) || num <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customInitialDeposit"],
        message: "Enter your intended initial deposit amount",
      });
    }
  }
});

type AppData = z.infer<typeof appSchema>;

function Field({ id, label, error, children }: { id?: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label-caps text-muted-foreground">{label}</label>
      {children}
      {error && <p className="auth-error-copy text-xs mt-1">{error}</p>}
    </div>
  );
}

function TextInput({ id, reg, type = "text", placeholder, autoComplete }: {
  id?: string; reg: any; type?: string; placeholder?: string; autoComplete?: string;
}) {
  return (
    <input
      id={id}
      {...reg}
      type={type}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="vw-input text-foreground"
    />
  );
}

function SelectInput({ id, reg, options }: { id?: string; reg: any; options: ReadonlyArray<{ v: string; l: string }> }) {
  return (
    <select
      id={id}
      {...reg}
      className="vw-input text-foreground appearance-none cursor-pointer"
    >
      <option value="">Select one</option>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

const STEPS = ["About you", "Where you live", "How you invest"];

const CURRENCY_OPTIONS = BALANCE_CURRENCIES.map(code => ({
  v: code,
  l: `${code} — ${BALANCE_CURRENCY_INFO[code].name} (${BALANCE_CURRENCY_INFO[code].symbol})`,
}));

function ApplicationForm({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const form = useForm<AppData>({
    resolver: zodResolver(appSchema),
    defaultValues: {
      fullName: "", email: "", phone: "", dateOfBirth: "", nationality: "",
      address: "", city: "", country: "", employmentStatus: "", annualIncome: "",
      investmentExperience: "", riskTolerance: "", investmentGoal: "",
      initialDeposit: "", customInitialDeposit: "", preferredCurrency: "USD", sourceOfFunds: "",
    },
    mode: "onTouched",
  });
  const { register, handleSubmit, trigger, watch, formState: { errors } } = form;
  const selectedInitialDeposit = watch("initialDeposit");

  const stepFields: (keyof AppData)[][] = [
    ["fullName", "email", "phone", "dateOfBirth", "nationality"],
    ["address", "city", "country", "employmentStatus", "annualIncome"],
    ["investmentExperience", "riskTolerance", "investmentGoal", "initialDeposit", "customInitialDeposit", "preferredCurrency", "sourceOfFunds"],
  ];

  const mutation = useMutation({
    mutationFn: async (data: AppData) => {
      const cleanedCustom = String(data.customInitialDeposit || "").replace(/[^0-9.]/g, "");
      const formattedDeposit = data.initialDeposit === "custom"
        ? `$${Number(cleanedCustom).toLocaleString("en-US", { maximumFractionDigits: 2 })} (Custom)`
        : data.initialDeposit;

      const { customInitialDeposit: _unused, ...rest } = data;
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rest,
          initialDeposit: formattedDeposit,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Submission failed");
      return res.json();
    },
    onSuccess: () => setDone(true),
    onError: (e: Error) => toast({ title: "Something went wrong", description: e.message, variant: "destructive" }),
  });

  const next = async () => {
    const ok = await trigger(stepFields[step]);
    if (ok) setStep(s => s + 1);
  };

  if (done) {
    return (
      <div className="text-center space-y-6 py-16">
        <div className="inline-flex items-center justify-center w-14 h-14 border border-primary/30 bg-primary/5">
          <CheckCircle2 className="w-7 h-7 text-primary" />
        </div>
        <div className="space-y-2 max-w-sm mx-auto">
          <h3 className="font-serif text-2xl">We have your application</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Someone from our team will review it and reach out within one to two business days. If approved, you will receive your Client ID and a one-time account setup link through a verified contact channel.
          </p>
        </div>
        <button onClick={onBack} className="label-caps text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto">
          <ArrowLeft className="w-3 h-3" /> Return to login
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 ${i <= step ? "text-foreground" : "text-muted-foreground/40"}`}>
              <span className={`font-mono-nums text-xs ${i < step ? "text-primary" : i === step ? "text-foreground" : "text-muted-foreground/30"}`}>
                {i < step ? "✓" : `0${i + 1}`}
              </span>
              <span className="label-caps hidden sm:inline">{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${i < step ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(data => mutation.mutate(data))} className="space-y-6">

        {/* Step 0 */}
        {step === 0 && (
          <div className="space-y-6">
            <p className="font-serif text-xl">Tell us a bit about yourself</p>
            <Field id="app-fullName" label="Full legal name" error={errors.fullName?.message}>
              <TextInput id="app-fullName" reg={register("fullName")} placeholder="As it appears on your ID" autoComplete="name" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              <Field id="app-email" label="Email address" error={errors.email?.message}>
                <TextInput id="app-email" reg={register("email")} type="email" placeholder="you@example.com" autoComplete="email" />
              </Field>
              <Field id="app-phone" label="Phone number" error={errors.phone?.message}>
                <TextInput id="app-phone" reg={register("phone")} placeholder="+44 20 7946 0820" />
              </Field>
              <Field id="app-dob" label="Date of birth" error={errors.dateOfBirth?.message}>
                <TextInput id="app-dob" reg={register("dateOfBirth")} type="date" />
              </Field>
              <Field id="app-nationality" label="Nationality" error={errors.nationality?.message}>
                <SelectInput
                  id="app-nationality"
                  reg={register("nationality")}
                  options={ONBOARDING_NATIONALITIES}
                />
              </Field>
            </div>
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-6">
            <p className="font-serif text-xl">Where are you based?</p>
            <Field id="app-address" label="Street address" error={errors.address?.message}>
              <TextInput id="app-address" reg={register("address")} placeholder="Street address & suite" autoComplete="street-address" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              <Field id="app-city" label="City" error={errors.city?.message}>
                <TextInput id="app-city" reg={register("city")} placeholder="e.g. Zurich, London, Singapore" />
              </Field>
              <Field id="app-country" label="Country of residence" error={errors.country?.message}>
                <SelectInput
                  id="app-country"
                  reg={register("country")}
                  options={ONBOARDING_COUNTRIES}
                />
              </Field>
            </div>
            <Field id="app-employment" label="Employment status" error={errors.employmentStatus?.message}>
              <SelectInput id="app-employment" reg={register("employmentStatus")} options={EMPLOYMENT_STATUS_OPTIONS} />
            </Field>
            <Field id="app-annualIncome" label="Annual income" error={errors.annualIncome?.message}>
              <SelectInput id="app-annualIncome" reg={register("annualIncome")} options={ANNUAL_INCOME_OPTIONS} />
            </Field>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-6">
            <p className="font-serif text-xl">How do you like to invest?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              <Field id="app-experience" label="Investment experience" error={errors.investmentExperience?.message}>
                <SelectInput id="app-experience" reg={register("investmentExperience")} options={INVESTMENT_EXPERIENCE_OPTIONS} />
              </Field>
              <Field id="app-risk" label="Risk tolerance" error={errors.riskTolerance?.message}>
                <SelectInput id="app-risk" reg={register("riskTolerance")} options={RISK_TOLERANCE_OPTIONS} />
              </Field>
              <Field id="app-goal" label="Primary investment goal" error={errors.investmentGoal?.message}>
                <SelectInput id="app-goal" reg={register("investmentGoal")} options={INVESTMENT_GOAL_OPTIONS} />
              </Field>
              <Field id="app-deposit" label="Anticipated initial deposit" error={errors.initialDeposit?.message}>
                <SelectInput id="app-deposit" reg={register("initialDeposit")} options={INITIAL_DEPOSIT_OPTIONS} />
              </Field>
            </div>

            {selectedInitialDeposit === "custom" && (
              <Field id="app-customDeposit" label="Custom initial deposit amount" error={errors.customInitialDeposit?.message}>
                <TextInput
                  id="app-customDeposit"
                  reg={register("customInitialDeposit")}
                  placeholder="e.g. 250000"
                />
              </Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              <Field id="app-currency" label="Preferred display currency" error={errors.preferredCurrency?.message}>
                <SelectInput id="app-currency" reg={register("preferredCurrency")} options={CURRENCY_OPTIONS} />
              </Field>
              <Field id="app-sourceOfFunds" label="Primary source of funds" error={errors.sourceOfFunds?.message}>
                <SelectInput id="app-sourceOfFunds" reg={register("sourceOfFunds")} options={SOURCE_OF_FUNDS_OPTIONS} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground border-t border-border">
            <span>Terms &amp; account activation</span>
            <InfoTip
              label="Application terms and activation"
              content="By submitting this form you confirm that everything provided is accurate, that you are the beneficial owner of the assets, and agree to our Terms of Service and Privacy Policy. Once approved, you will receive a one-time setup link to set your password."
            />
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <button
            type="button"
            onClick={step === 0 ? onBack : () => setStep(s => s - 1)}
            className="label-caps text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            {step === 0 ? "Back to login" : "Previous"}
          </button>

          {step < 2 ? (
            <button
              type="button"
              onClick={next}
              className="label-caps text-primary hover:text-primary/80 flex items-center gap-1.5 transition-colors"
            >
              Continue <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit application
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default function AuthPage() {
  const { login, verifyMfa, logout, user, isLoading, hasSessionError, retrySession } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<"login" | "apply">("login");
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { userId: "", password: "" },
  });

  useEffect(() => {
    if (user) setLocation("/dashboard");
  }, [user, setLocation]);

  useEffect(() => {
    if (window.location.search.includes("passwordChanged=1")) {
      setPasswordChanged(true);
      window.history.replaceState({}, "", "/auth");
    }
  }, []);

  if (isLoading || user) {
    return <BrandedLoader />;
  }

  if (hasSessionError) return <SessionLoadError onRetry={retrySession} />;

  const onLogin = handleSubmit(async data => {
    if (login.isPending) return;
    setLoginError(null);
    try {
      const result = await login.mutateAsync({ userId: data.userId, password: data.password });
      login.reset();
      if ("mfaRequired" in result) {
        setValue("password", "");
        setMfaCode("");
        setMfaError(null);
        setMfaRequired(true);
      }
    } catch (err: any) {
      const raw = err?.message || "";
      const msg = raw.replace(/^\d+:\s*/, "");
      if (msg === "ACCOUNT_FROZEN") {
        setLoginError("Your account is on hold. Please contact your advisor at veritaswealth@accountant.com for help.");
      } else {
        setLoginError(msg || "Please check your Client ID and password and try again.");
      }
    }
  });

  const submitMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaCode.trim() || verifyMfa.isPending) return;
    setMfaError(null);
    try {
      await verifyMfa.mutateAsync({ code: mfaCode.trim() });
      setMfaCode("");
    } catch (err: any) {
      setMfaCode("");
      setMfaError((err?.message || "").replace(/^\d+:\s*/, "") || "That code could not be verified. Check it and try again.");
    }
  };

  const cancelMfa = async () => {
    if (logout.isPending) return;
    setMfaError(null);
    try {
      await logout.mutateAsync();
      setMfaRequired(false);
      setMfaCode("");
      setLoginError(null);
      reset({ userId: "", password: "" });
    } catch (err: any) {
      setMfaError((err?.message || "").replace(/^\d+:\s*/, "") || "We could not safely end this sign-in. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-cream">

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[38%] shrink-0 flex-col justify-between p-12 xl:p-16 bg-[#0D2418] wealth-panel text-[#F6F1E8] relative overflow-hidden border-r border-[#C6A15B]/20">
        <img
          src="/assets/vault_custody_1795696130118.jpg"
          alt="Veritas Wealth private banking custody vault architecture"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity pointer-events-none"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(170deg, rgba(13,36,24,0.92) 0%, rgba(13,36,24,0.82) 50%, rgba(9,25,17,0.96) 100%)",
          }}
        />

        <div className="relative z-10">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setLocation("/");
            }}
            className="inline-flex items-center gap-3 mb-14 group"
          >
            <img src="/veritas-logo.png" alt="Veritas Wealth crest" className="w-10 h-10 object-contain" />
            <div>
              <span className="font-serif text-lg font-medium tracking-tight text-[#F6F1E8] block leading-none">
                Veritas Wealth
              </span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#DFBD76] mt-1 block">
                Global Private Banking
              </span>
            </div>
          </a>

          <div className="space-y-6 max-w-sm">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#DFBD76] font-medium">
              Zurich · London · Singapore · New York
            </p>
            <h1 className="font-serif leading-[1.05] text-[#F6F1E8]" style={{ fontSize: "clamp(2.1rem, 3.5vw, 2.85rem)" }}>
              Global wealth,<br />
              stewarded with<br />
              <em className="text-[#DFBD76]">precision</em> and care.
            </h1>
            <p className="text-[#F6F1E8]/75 text-sm leading-relaxed">
              Cross-border private banking, segregated institutional custody, and multi-currency discretionary mandates built for international families and endowments.
            </p>
          </div>
        </div>

        <div className="relative z-10 pt-8 border-t border-[#C6A15B]/25 grid grid-cols-2 gap-6">
          {[
            { v: "$4.2B USD", l: "Assets under advisory" },
            { v: "38+ Countries", l: "Global custody network" },
            { v: "18 Currencies", l: "Multi-currency settlement" },
            { v: "Zero Lock-Up", l: "Liquid institutional access" },
          ].map(s => (
            <div key={s.l}>
              <p className="font-mono-nums text-xl font-medium text-[#DFBD76]">{s.v}</p>
              <p className="label-caps text-[#F6F1E8]/60 mt-1">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col justify-between px-6 sm:px-12 lg:px-16 xl:px-24 py-8 sm:py-12 overflow-y-auto bg-[#F6F1E8]">
        <div className="w-full max-w-md mx-auto flex items-center justify-between pb-6 border-b border-[#0D2418]/10">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setLocation("/");
            }}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#0D2418]/75 hover:text-[#0D2418] transition-colors"
          >
            <img src="/veritas-logo.png" alt="Veritas Wealth" className="w-6 h-6 object-contain lg:hidden" />
            <ArrowLeft className="w-3.5 h-3.5 hidden lg:inline" />
            <span>Veritas Home</span>
          </a>
          <a
            href="/company"
            onClick={(e) => {
              e.preventDefault();
              setLocation("/company");
            }}
            className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[#113221] hover:text-[#8E6D2F] transition-colors"
          >
            The Firm
          </a>
        </div>

        <div className="w-full max-w-md mx-auto my-auto py-10">

          {view === "login" ? (
            <div className="space-y-10">
              <div>
                <p className="label-caps text-[#8E6D2F] mb-3">Private Client Wealth Portal</p>
                <h2 className="font-serif text-display-md text-[#0D2418]">{mfaRequired ? "One more step." : "Welcome back."}</h2>
              </div>

              {passwordChanged && !mfaRequired && (
                <div role="status" className="border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
                  Your password has changed. For your security, sign in again with your new password.
                </div>
              )}

              {mfaRequired ? (
                <div className="space-y-6">
                  <div className="flex items-start gap-3 border border-border bg-background/60 p-4">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Enter the six-digit code from your authenticator app, or use one of your recovery codes.
                    </p>
                  </div>
                  <form onSubmit={submitMfa} className="space-y-6">
                    <div className="space-y-2">
                      <label htmlFor="mfa-login-code" className="label-caps text-muted-foreground">Authenticator or recovery code</label>
                      <input
                        id="mfa-login-code"
                        name="code"
                        type="text"
                        inputMode="text"
                        autoComplete="one-time-code"
                        autoFocus
                        value={mfaCode}
                        onChange={event => setMfaCode(event.target.value)}
                        className="vw-input text-foreground min-h-11"
                        aria-describedby={mfaError ? "mfa-login-error" : undefined}
                        data-testid="mfa-login-code"
                        required
                      />
                    </div>
                    {mfaError && <div id="mfa-login-error" role="alert" className="auth-error-copy border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm leading-relaxed">{mfaError}</div>}
                    <button
                      type="submit"
                      disabled={verifyMfa.isPending || !mfaCode.trim()}
                      data-testid="mfa-login-submit"
                      className="login-submit w-full flex items-center justify-center gap-2 py-3.5 text-sm disabled:opacity-60"
                    >
                      {verifyMfa.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      Verify and sign in
                    </button>
                    <button type="button" onClick={cancelMfa} disabled={logout.isPending}
                      className="label-caps text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors disabled:opacity-60">
                      {logout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                      Back to password
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  <form onSubmit={onLogin} className="space-y-7">
                    <Field label="Client Reference" error={errors.userId?.message}>
                      <TextInput reg={register("userId")} placeholder="e.g. VW-440FR" autoComplete="username" />
                    </Field>
                    <Field label="Password" error={errors.password?.message}>
                      <div className="relative">
                        <TextInput
                          reg={register("password")}
                          type={showPw ? "text" : "password"}
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => setShowPw(v => !v)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                          className="absolute right-0 bottom-2.5 text-muted-foreground hover:text-foreground transition-colors">
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </Field>

                    {loginError && (
                      <div role="alert" className="auth-error-copy border border-destructive/40 bg-destructive/5 rounded px-4 py-3 text-sm leading-relaxed">
                        {loginError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={login.isPending}
                      data-testid="button-sign-in"
                      className="login-submit w-full flex items-center justify-center gap-2 py-3.5 text-sm"
                    >
                      {login.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      Sign in to Veritas Wealth
                    </button>
                  </form>

                  <div className="pt-2 border-t border-border space-y-4">
                    <p className="text-sm text-muted-foreground">Not yet a client?</p>
                    <button
                      onClick={() => setView("apply")}
                      data-testid="button-open-application"
                      className="w-full flex items-center justify-between border border-border px-5 py-3.5 text-sm hover:border-primary hover:text-primary transition-colors group"
                    >
                      <span>Open an investment account</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              <div>
                <button
                  onClick={() => setView("login")}
                  className="label-caps text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-6 transition-colors"
                >
                  <ArrowLeft className="w-3 h-3" /> Back to login
                </button>
                <p className="label-caps text-muted-foreground mb-3">Account application</p>
                <h2 className="font-serif text-display-md">Apply for<br />membership.</h2>
                <p className="text-muted-foreground text-sm mt-3 leading-relaxed">
                  Fill in all three sections and your dedicated advisor will be in touch within one business day.
                </p>
              </div>
              <ApplicationForm onBack={() => setView("login")} />
            </div>
          )}
        </div>

        <div className="w-full max-w-md mx-auto pt-6 border-t border-[#0D2418]/10 text-[11px] text-[#0D2418]/55 flex items-center justify-between">
          <span>Encrypted multi-jurisdictional custody</span>
          <span className="font-mono-nums">256-bit TLS · FIDO/TOTP</span>
        </div>
      </div>
    </div>
  );
}
