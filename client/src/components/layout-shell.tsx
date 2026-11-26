import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useInactivityLogout } from "@/hooks/use-inactivity-logout";
import { useActiveLiquidation } from "@/hooks/use-liquidation-status";
import { useFundsAccess } from "@/hooks/use-funds-access";
import { fundsActionFeedback } from "@shared/funds-access";
import { LIQUIDATION_STATUS_UNAVAILABLE } from "@shared/liquidation";
import { FundsActionDialog } from "@/components/fees/funds-action-dialog";
import { ShieldAlert, Snowflake, AlertTriangle } from "lucide-react";
import { SlideOutNavigation, DesktopSidebar } from "@/components/navigation/slide-out-navigation";
import { Button } from "@/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { bankingPreferencesPath, DEFAULT_BANKING_PREFERENCES, type BankingPreferences } from "@shared/client-settings";
import { apiRequest } from "@/lib/queryClient";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const access = useFundsAccess();
  const { isUnderLiquidation, statusUnavailable, isError: liquidationError, refetch: refetchLiquidation } = useActiveLiquidation();
  const [fundsDialogOpen, setFundsDialogOpen] = useState(false);
  const fundsActionOrigin = useRef<HTMLElement | null>(null);
  const preferencesQuery = useQuery<BankingPreferences>({
    queryKey: [bankingPreferencesPath],
    queryFn: async () => (await apiRequest("GET", bankingPreferencesPath)).json(),
    enabled: Boolean(user),
    staleTime: 60_000,
    retry: false,
  });
  const feedback = statusUnavailable
    ? { title: "Portfolio transfer status unavailable", message: LIQUIDATION_STATUS_UNAVAILABLE.message, retry: true }
    : fundsActionFeedback(access.blocked, access.data, access.isError);

  // Capture marked entry actions before navigation or any submit handler runs.
  const guardFundsAction = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-funds-action]") : null;
    if (!target || (!access.blocked && !statusUnavailable)) return;
    event.preventDefault();
    event.stopPropagation();
    fundsActionOrigin.current = target;
    setFundsDialogOpen(true);
  };

  const handleAutoLogout = useCallback(() => {
    logout.mutate();
  }, [logout]);

  const sessionMinutes = preferencesQuery.data?.sessionTimeoutMinutes ?? DEFAULT_BANKING_PREFERENCES.sessionTimeoutMinutes;
  const { showWarning, secondsLeft, dismiss } = useInactivityLogout(handleAutoLogout, sessionMinutes);

  return (
    <>
      <div onClickCapture={guardFundsAction} className="flex h-[100dvh] w-full overflow-hidden bg-[#F6F7F8] dark:bg-background">
        <DesktopSidebar location={location} onNavigate={setLocation} onLogout={() => logout.mutate()} />
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <SlideOutNavigation location={location} userName={user?.name}
            open={sidebarOpen} onOpenChange={setSidebarOpen} onNavigate={setLocation} onLogout={() => logout.mutate()} />

          {(user as any)?.accountFrozen && (
            <div className="bg-slate-900 text-white border-b border-slate-800 px-6 py-3 flex items-start gap-3">
              <Snowflake className="w-4 h-4 text-sky-300 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Account on hold</p>
                <p className="text-slate-300 text-xs mt-0.5">
                  Transfers and account changes are paused. Please contact your advisor at <span className="underline">veritaswealth@accountant.com</span> for help.
                </p>
              </div>
            </div>
          )}
          {statusUnavailable && (
            <div role="alert" data-testid="liquidation-status-unavailable" className="bg-white dark:bg-card border-b border-border px-6 py-3 space-y-1">
              <p className="text-sm font-semibold">{liquidationError ? "Portfolio transfer status unavailable" : "Checking portfolio transfer status"}</p>
              <p className="text-sm text-muted-foreground">
                {liquidationError ? LIQUIDATION_STATUS_UNAVAILABLE.message : "Please wait before making transfers, trading or protected account changes."}
              </p>
              {liquidationError && <Button variant="outline" size="sm" onClick={() => void refetchLiquidation()}>Retry status check</Button>}
            </div>
          )}
          {isUnderLiquidation && !(user as any)?.accountFrozen && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/40 px-6 py-3 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-950 dark:text-amber-200 text-sm font-semibold">Portfolio transfer in progress</p>
                <p className="text-amber-900/80 dark:text-amber-300/80 text-xs mt-0.5">
                  Your portfolio transfer is in progress. Transfers, investing and account changes are paused until it is complete. Contact your advisor at{" "}
                  <span className="underline">veritaswealth@accountant.com</span> for updates.
                </p>
              </div>
            </div>
          )}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 bg-[#F6F7F8] dark:bg-background custom-scrollbar">
            <div className="w-full max-w-6xl mx-auto min-w-0 space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {children}
            </div>
          </main>
        </div>
      </div>

      <FundsActionDialog open={fundsDialogOpen} onOpenChange={setFundsDialogOpen}
        title={feedback?.title ?? "Access updated"}
        message={feedback?.message ?? "Your access has changed. Close this message and try again."}
        retry={feedback?.retry ? () => void (statusUnavailable ? refetchLiquidation() : access.refetch()) : undefined}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (fundsActionOrigin.current?.isConnected) fundsActionOrigin.current.focus();
        }} />

      {/* Inactivity warning dialog */}
      <Dialog open={showWarning} onOpenChange={(open) => { if (!open) dismiss(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm border-slate-200 dark:border-border bg-white dark:bg-card text-slate-900 dark:text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl text-slate-900 dark:text-foreground">
              <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400" />
              Session Expiring
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-muted-foreground">
              For your security, you will be signed out due to inactivity.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-4 gap-1.5">
            <div className="text-5xl font-semibold font-sans text-slate-900 dark:text-foreground tabular-nums">
              {secondsLeft}
            </div>
            <p className="text-xs text-slate-500 dark:text-muted-foreground">seconds remaining</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="border-slate-200 dark:border-border" onClick={() => logout.mutate()}>
              Sign out now
            </Button>
            <Button className="bg-[#0B2218] hover:bg-[#133526] text-white" onClick={dismiss}>
              Stay signed in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
