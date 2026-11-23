import { Clock, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { formatOnboardingLabel } from "@shared/onboarding-options";

export interface InitialDepositBannerProps {
  status?: string | null;
  selectedInitialDeposit?: string | null;
  onAction: () => void;
}

export function InitialDepositBanner({
  status,
  selectedInitialDeposit,
  onAction,
}: InitialDepositBannerProps) {
  const isRequired = status === "required";
  const isPendingReview = status === "pending_review";

  if (!isRequired && !isPendingReview) {
    return null;
  }

  const StatusIcon = isPendingReview ? Clock : Landmark;

  return (
    <section
      role="region"
      aria-label="Account activation"
      data-testid="banner-initiate-initial-deposit"
      className="rounded-sm border border-amber-500/40 bg-[#0B2218] text-white px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4"
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-sm bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
          <StatusIcon className="w-4 h-4 text-amber-400" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
              {isPendingReview ? "Initial Deposit Pending Review" : "Initial Deposit Required"}
            </h2>
            <InfoTip
              label="Initial deposit information"
              className="border-white/20 bg-white/10 text-white/75 hover:border-white/40 hover:text-white"
              content="Transfer and investment features unlock once your initial deposit is submitted and verified by an administrator."
            />
          </div>
          <p className="text-xs text-white/65 [overflow-wrap:anywhere]">
            <span>{isPendingReview ? "Pending verification" : "Transfers & investing locked"}</span>
            {selectedInitialDeposit && (
              <>
                <span aria-hidden="true"> · </span>
                <span>
                  Selected:{" "}
                  <span className="font-mono font-semibold tabular-nums text-white">
                    {formatOnboardingLabel(selectedInitialDeposit)}
                  </span>
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <Button
        size="sm"
        onClick={onAction}
        className="w-full sm:w-auto bg-amber-400 hover:bg-amber-300 text-[#0B2218] rounded-sm text-xs font-semibold whitespace-nowrap shrink-0"
        data-testid="button-dashboard-initiate-deposit"
      >
        {isPendingReview ? "View Deposit" : "Make Initial Deposit"}
      </Button>
    </section>
  );
}
