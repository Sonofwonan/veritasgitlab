import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function InfoTip({
  content,
  label = "More information",
  className,
}: {
  content: string;
  label?: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-muted/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0",
            className,
          )}
        >
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3 text-xs leading-relaxed text-popover-foreground shadow-md">
        {content}
      </PopoverContent>
    </Popover>
  );
}
