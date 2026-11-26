import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowLeftRight, ChartNoAxesCombined, ChevronRight, CircleHelp, Clock3,
  LayoutDashboard, LogOut, Mail, Menu, Settings, Wallet, X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import "./slide-out-navigation.css";

export const accountRoutes = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Wallet, label: "Accounts", href: "/accounts" },
  { icon: ChartNoAxesCombined, label: "Investments", href: "/investments" },
  { icon: ArrowLeftRight, label: "Transfers", href: "/transfers" },
  { icon: Clock3, label: "Transaction history", href: "/transactions" },
];
export const personalRoutes = [
  { icon: Settings, label: "Settings", href: "/settings" },
];

type Props = {
  location: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
  onLogout?: () => void;
  userName?: string | null;
};

function initialsFor(name?: string | null) {
  if (!name?.trim()) return "VW";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function DesktopSidebar({
  location,
  onNavigate,
  onLogout,
}: {
  location: string;
  onNavigate: (href: string) => void;
  onLogout?: () => void;
}) {
  const renderLinks = (routes: typeof accountRoutes) =>
    routes.map(item => {
      const active = location === item.href || location.startsWith(item.href + "/");
      return (
        <button
          key={item.href}
          type="button"
          className={`qd-link${active ? " qd-link-active" : ""}`}
          aria-current={active ? "page" : undefined}
          onClick={() => onNavigate(item.href)}
          data-funds-action={["/transfers", "/investments"].includes(item.href) ? "" : undefined}
        >
          <item.icon size={17} strokeWidth={1.8} aria-hidden="true" />
          <span className="whitespace-nowrap">{item.label}</span>
        </button>
      );
    });

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col bg-[#0B2218] text-white border-r border-[#163628] px-4 py-0 select-none"
    >
      <div className="min-h-[64px] flex items-center gap-3 px-2 border-b border-white/10 shrink-0">
        <span className="qd-brand-mark shrink-0">
          <img src="/veritas-logo.png" alt="" />
        </span>
        <span className="qd-brand-copy">
          <strong>Veritas Wealth</strong>
          <small>Private Banking</small>
        </span>
      </div>

      <nav className="qd-nav flex-1 overflow-y-auto" aria-label="Account navigation">
        <p className="qd-section-label">Portfolio</p>
        <div className="qd-link-list">{renderLinks(accountRoutes)}</div>
        <div className="qd-nav-divider" />
        <p className="qd-section-label">Personal</p>
        <div className="qd-link-list">{renderLinks(personalRoutes)}</div>
      </nav>

      <div className="qd-sidebar-footer">
        <section className="qd-advisor" aria-label="Advisor contact">
          <div className="qd-advisor-icon">
            <CircleHelp size={16} aria-hidden="true" />
          </div>
          <div className="qd-advisor-copy">
            <span className="qd-advisor-eyebrow">Private Advisor</span>
            <a href="mailto:veritaswealth@accountant.com">Contact your advisor</a>
            <span className="qd-advisor-email">veritaswealth@accountant.com</span>
          </div>
        </section>
        {onLogout && (
          <button
            type="button"
            className="qd-signout"
            onClick={onLogout}
            data-testid="sidebar-signout"
          >
            <LogOut size={15} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  );
}

export function SlideOutNavigation({ location, open, onOpenChange, onNavigate, onLogout, userName }: Props) {
  const previousLocation = useRef(location);
  useEffect(() => {
    if (previousLocation.current !== location) {
      previousLocation.current = location;
      onOpenChange(false);
    }
  }, [location, onOpenChange]);

  const navigate = (href: string) => {
    onOpenChange(false);
    onNavigate(href);
  };
  const links = (routes: typeof accountRoutes) => routes.map(item => {
    const active = location === item.href || location.startsWith(item.href + "/");
    return (
      <button key={item.href} type="button" className={`qd-link${active ? " qd-link-active" : ""}`}
        aria-current={active ? "page" : undefined} onClick={() => navigate(item.href)}
        data-funds-action={["/transfers", "/investments"].includes(item.href) ? "" : undefined}>
        <item.icon size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>{item.label}</span>
      </button>
    );
  });
  const pageLabel = location === "/profile" ? "Profile" : [...accountRoutes, ...personalRoutes].find(item =>
    location === item.href || location.startsWith(item.href + "/"))?.label ?? "Client portal";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <header className="qd-topbar">
        <div className="qd-topbar-left">
          <DialogPrimitive.Trigger asChild>
            <button type="button" className="qd-icon-button lg:hidden" data-testid="sidebar-toggle"
              aria-label="Open menu" aria-controls="veritas-side-navigation">
              <Menu size={19} aria-hidden="true" />
            </button>
          </DialogPrimitive.Trigger>
          <div className="qd-breadcrumb" aria-label={`Current page: ${pageLabel}`}>
            <span className="qd-breadcrumb-label lg:hidden">VERITAS WEALTH</span>
            <ChevronRight size={14} className="lg:hidden" aria-hidden="true" />
            <span className="qd-breadcrumb-current" aria-current="page">{pageLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => navigate("/transfers")}
            data-funds-action=""
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted text-slate-800 dark:text-foreground text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
            <span>Move funds</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2.5 h-9 px-2.5 sm:px-3 rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted text-slate-800 dark:text-foreground text-xs font-medium transition-colors shrink-0"
            data-testid="profile-button"
            aria-label="Open profile"
            onClick={() => navigate("/profile")}
          >
            <span className="w-6 h-6 rounded-full bg-[#0B2218] text-[#DFBD76] dark:bg-primary/25 dark:text-foreground text-[10px] font-semibold tracking-tight grid place-items-center shrink-0">
              {initialsFor(userName)}
            </span>
            {userName && <span className="hidden sm:inline whitespace-nowrap">{userName}</span>}
          </button>
        </div>
      </header>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="qd-scrim" data-testid="drawer-scrim" />
        <DialogPrimitive.Content id="veritas-side-navigation" className="qd-drawer"
          data-testid="sidebar-panel" aria-describedby={undefined}>
          <div className="qd-drawer-head">
            <div className="qd-brand">
              <span className="qd-brand-mark"><img src="/veritas-logo.png" alt="" /></span>
              <span className="qd-brand-copy">
                <DialogPrimitive.Title asChild><strong>Veritas Wealth</strong></DialogPrimitive.Title>
                <small>Private Banking</small>
              </span>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="qd-close-button" data-testid="sidebar-close"
                aria-label="Close menu"><X size={18} aria-hidden="true" /></button>
            </DialogPrimitive.Close>
          </div>
          <nav className="qd-nav" aria-label="Account navigation">
            <p className="qd-section-label">Portfolio</p>
            <div className="qd-link-list">{links(accountRoutes)}</div>
            <div className="qd-nav-divider" />
            <p className="qd-section-label">Personal</p>
            <div className="qd-link-list">{links(personalRoutes)}</div>
          </nav>
          <div className="qd-sidebar-footer">
            <section className="qd-advisor" aria-label="Advisor contact">
              <div className="qd-advisor-icon"><CircleHelp size={16} aria-hidden="true" /></div>
              <div className="qd-advisor-copy">
                <span className="qd-advisor-eyebrow">Private Advisor</span>
                <a href="mailto:veritaswealth@accountant.com">Contact your advisor</a>
                <span className="qd-advisor-email">veritaswealth@accountant.com</span>
              </div>
              <a className="qd-email-action" href="mailto:veritaswealth@accountant.com"
                aria-label="Email your advisor"><Mail size={16} aria-hidden="true" /></a>
            </section>
            {onLogout && (
              <button
                type="button"
                className="qd-signout"
                onClick={() => {
                  onOpenChange(false);
                  onLogout();
                }}
                data-testid="drawer-signout"
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
