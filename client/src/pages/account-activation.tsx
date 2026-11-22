import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

const passwordChecks = [
  { label: "At least 12 characters", test: (value: string) => value.length >= 12 },
  { label: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "A number", test: (value: string) => /[0-9]/.test(value) },
  { label: "A symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export default function AccountActivationPage() {
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"activation" | "reset">("activation");
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientRef, setClientRef] = useState("");
  const [completedPurpose, setCompletedPurpose] = useState<"activation" | "reset">("activation");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentToken = params.get("token") || "";
    const fragmentMode = params.get("mode") === "reset" ? "reset" : "activation";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setToken(fragmentToken);
    setMode(fragmentMode);
    setTokenReady(true);
  }, []);

  const passwordIsValid = passwordChecks.every(check => check.test(password));
  const passwordsMatch = password === confirmPassword;
  const isReset = mode === "reset";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("This link is missing or invalid. Contact the team for a new link.");
      return;
    }
    if (!passwordIsValid) {
      setError("Choose a password that meets all the requirements.");
      return;
    }
    if (!passwordsMatch) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/account-activation/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Unable to complete password setup.");
      setClientRef(data.clientRef);
      setCompletedPurpose(data.purpose === "admin_reset" ? "reset" : mode);
      setToken("");
      setPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to complete password setup.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="activation-page min-h-screen bg-cream px-6 py-12 text-foreground sm:px-10">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/auth" className="mb-12 inline-flex items-center gap-2 font-serif text-lg text-primary">
          <ShieldCheck className="h-5 w-5" />
          Veritas Wealth
        </Link>

        <section className="mt-10 border-t border-border pt-8">
          {clientRef ? (
            <div className="space-y-6">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <div>
                <p className="label-caps text-muted-foreground">
                  {completedPurpose === "reset" ? "Password updated" : "Account setup complete"}
                </p>
                <h1 className="mt-2 font-serif text-3xl">
                  {completedPurpose === "reset" ? "Your new password is active." : "Your account is ready."}
                </h1>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Your Client ID is <strong className="font-mono text-accent">{clientRef}</strong>. Keep it available; you will use it with your password to sign in.
              </p>
              <Link href="/auth" className="inline-flex bg-primary px-6 py-3 text-sm text-primary-foreground hover:bg-primary/90">
                Continue to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="label-caps text-muted-foreground">
                {isReset ? "Administrator-issued password reset" : "Secure account setup"}
              </p>
              <h1 className="mt-2 font-serif text-3xl">
                {isReset ? "Reset your password." : "Create your password."}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {isReset
                  ? "This one-time reset link is valid for 24 hours. Enter a new strong password for your Veritas Wealth profile. Any existing two-factor authentication stays active."
                  : "This one-time link is valid for 24 hours. Choose a strong password to activate your account."}
              </p>

              {!tokenReady ? (
                <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking setup link…
                </div>
              ) : !token ? (
                <div className="mt-8 space-y-4 border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm leading-relaxed text-destructive">
                    This link is missing or invalid. Ask the team to verify your identity and provide a new link.
                  </p>
                  <Link href="/auth" className="label-caps text-primary hover:underline">Return to sign in</Link>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-8 space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="activation-password" className="label-caps text-muted-foreground">New password</label>
                    <input
                      id="activation-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      className="vw-input text-foreground"
                      required
                    />
                    <ul className="grid grid-cols-1 gap-1 pt-2 text-xs text-muted-foreground sm:grid-cols-2" aria-label="Password requirements">
                      {passwordChecks.map(check => (
                        <li key={check.label} className={check.test(password) ? "text-primary" : ""}>
                          {check.test(password) ? "✓" : "—"} {check.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="activation-confirm-password" className="label-caps text-muted-foreground">Confirm password</label>
                    <input
                      id="activation-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={event => setConfirmPassword(event.target.value)}
                      className="vw-input text-foreground"
                      required
                    />
                    {confirmPassword && !passwordsMatch && (
                      <p className="text-xs text-destructive">The passwords do not match.</p>
                    )}
                  </div>
                  {error && (
                    <p role="alert" className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={submitting || !passwordIsValid || !passwordsMatch}
                    className="flex w-full items-center justify-center gap-2 bg-primary px-6 py-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isReset ? "Save new password" : "Activate account"}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}