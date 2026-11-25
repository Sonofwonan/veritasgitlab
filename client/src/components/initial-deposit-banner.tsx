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
      className="rounded-lg border border-[#C6A15B]/45 bg-[#0B2218] text-white px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shadow-xs"
    >
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-md bg-[#C6A15B]/15 border border-[#C6A15B]/35 flex items-center justify-center shrink-0 mt-0.5">
          <StatusIcon className="w-4 h-4 text-[#DFBD76]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="font-sans text-sm font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
              {isPendingReview ? "Initial Deposit Pending Review" : "Initial Deposit Required"}
            </h2>
            <InfoTip
              label="Initial deposit information"
              className="border-white/20 bg-white/10 text-white/75 hover:border-white/40 hover:text-white"
              content="Transfer and investment features unlock once your initial deposit is submitted and verified by an administrator."
            />
          </div>
          <p className="text-xs text-white/70 [overflow-wrap:anywhere]">
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
        className="w-full sm:w-auto bg-[#C6A15B] hover:bg-[#d3b06d] text-[#0B2218] rounded-md text-xs font-semibold whitespace-nowrap shrink-0"
        data-testid="button-dashboard-initiate-deposit"
      >
        {isPendingReview ? "View Deposit" : "Make Initial Deposit"}
      </Button>
    </section>
  );
}
