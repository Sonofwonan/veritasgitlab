import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  Landmark,
  Mail,
  MapPin,
  Menu,
  PhoneCall,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

const DIVISIONS = [
  {
    n: "01",
    icon: Landmark,
    title: "Private Banking & Liquidity",
    scope: "Global Accounts · Cards · Multi-Currency",
    description:
      "Segregated cash and custody accounts across 18 settlement currencies with SWIFT wire rails, institutional transfer monitoring, and private banking cards.",
    cta: "Access client portal",
    action: "portal" as const,
  },
  {
    n: "02",
    icon: TrendingUp,
    title: "Discretionary Wealth",
    scope: "Equities · Sovereign Bonds · Credit",
    description:
      "Bespoke portfolios constructed around capital preservation, risk guardrails, and long-horizon compounding across global exchanges.",
    cta: "Apply for an account",
    action: "portal" as const,
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Custody & Fiduciary Control",
    scope: "Dual-Control Ledger · MFA · Audit",
    description:
      "Hardware-grade authenticator security, dual-administrator ledger approvals, real-time account controls, and immutable balance statements.",
    cta: "Request custody briefing",
    action: "contact" as const,
  },
  {
    n: "04",
    icon: Globe,
    title: "Cross-Border Structuring",
    scope: "Family Offices · Exits · Trusts",
    description:
      "Dedicated advisory support for multi-generational families, post-exit founders, and international holding companies operating across borders.",
    cta: "Speak with an advisor",
    action: "contact" as const,
  },
];

const DESKS = [
  { city: "Zurich", district: "Bahnhofstrasse Private Desk", hours: "CET · Multi-Currency Custody" },
  { city: "London", district: "Mayfair Advisory Office", hours: "GMT · UK & European Families" },
  { city: "Singapore", district: "Marina Bay Treasury Hub", hours: "SGT · APAC & Cross-Border FX" },
  { city: "New York", district: "Midtown Institutional Desk", hours: "EST · USD & Americas Custody" },
];

export default function CompanyPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Advisory inquiry form state (clean inline confirmation, zero window.alert)
  const [inquiryEmail, setInquiryEmail] = useState("");
  const [inquiryName, setInquiryName] = useState("");
  const [inquiryJurisdiction, setInquiryJurisdiction] = useState("Switzerland / Europe");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [inquirySent, setInquirySent] = useState(false);

  const openWealthPortal = () => {
    setMobileMenuOpen(false);
    setLocation(user ? "/dashboard" : "/auth");
  };

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleInquirySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryEmail.trim() || !inquiryMessage.trim()) return;
    setInquirySent(true);
  };

  return (
    <div className="min-h-screen bg-cream text-foreground">
      {/* Unified 3-Zone Top Bar Matching Landing Page */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#143524]/10 bg-cream/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-left"
          >
            <img src="/veritas-logo.png" alt="Veritas Wealth" className="w-9 h-9 object-contain" />
            <span className="font-serif text-[1.125rem] font-semibold tracking-tight text-[#113221]">
              Veritas Wealth
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#113221]/70" aria-label="Company navigation">
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => scrollTo("divisions")}
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
            >
              Divisions
            </button>
            <button
              type="button"
              onClick={() => scrollTo("custody")}
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
            >
              Custody
            </button>
            <button
              type="button"
              onClick={() => scrollTo("offices")}
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
            >
              Global desks
            </button>
            <button
              type="button"
              onClick={() => scrollTo("contact")}
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={openWealthPortal}
              data-testid="button-company-wealth-portal"
              className="hidden sm:flex items-center gap-1.5 bg-[#113221] text-white border border-[#C6A15B]/40 text-[13px] font-medium px-4 py-2 hover:bg-[#194730] transition-colors whitespace-nowrap shrink-0"
            >
              Wealth Portal <ArrowRight className="w-3.5 h-3.5 text-[#DFBD76]" />
            </button>
            <button
              type="button"
              className="md:hidden p-2 text-[#113221]"
              aria-label="Toggle menu"
              onClick={() => setMobileMenuOpen(v => !v)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#143524]/10 bg-cream px-6 py-5 space-y-3">
            <div className="flex flex-col gap-3 text-sm font-medium text-[#113221]">
              <button type="button" onClick={() => setLocation("/")} className="text-left py-1">Home</button>
              <button type="button" onClick={() => scrollTo("divisions")} className="text-left py-1">Divisions</button>
              <button type="button" onClick={() => scrollTo("custody")} className="text-left py-1">Custody</button>
              <button type="button" onClick={() => scrollTo("offices")} className="text-left py-1">Global desks</button>
              <button type="button" onClick={() => scrollTo("contact")} className="text-left py-1">Contact</button>
            </div>
            <button
              type="button"
              onClick={openWealthPortal}
              className="w-full flex items-center justify-center gap-2 bg-[#113221] text-white text-sm font-medium py-3"
            >
              Wealth Portal <ArrowRight className="w-4 h-4 text-[#DFBD76]" />
            </button>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative min-h-[70vh] flex flex-col justify-end pt-16 overflow-hidden bg-[#0D2418]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B1F15] via-[#123524] to-[#08170F]">
          <img
            src="/assets/global_offices_1795696131203.jpg"
            alt="Global financial district skyline at twilight"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-55"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B1F15] via-[#0B1F15]/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B1F15]/95 via-[#0B1F15]/75 to-transparent" />

        <div className="relative z-10 max-w-7xl mx-auto w-full px-6 sm:px-8 pb-14 sm:pb-20 pt-24">
          <div className="max-w-2xl">
            <p className="label-caps text-[#DFBD76] mb-4 tracking-[0.2em]">
              About Veritas Wealth · International Firm
            </p>
            <h1
              className="font-serif text-white leading-[1.08] text-balance"
              style={{ fontSize: "clamp(2.3rem, 4.2vw, 3.8rem)" }}
            >
              Global stewardship,<br />
              built for <em>enduring</em> capital.
            </h1>
            <p className="text-white/85 text-base sm:text-lg mt-5 max-w-xl leading-relaxed">
              Veritas Wealth unites segregated multi-currency private banking with institutional portfolio management across four international financial hubs.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-8">
              <button
                type="button"
                onClick={openWealthPortal}
                data-testid="button-hero-wealth-portal"
                className="flex items-center gap-2 bg-[#C6A15B] text-[#0B1F15] text-sm font-semibold px-7 py-3.5 hover:bg-[#DFBD76] transition-colors whitespace-nowrap shrink-0"
              >
                Open Wealth Portal <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollTo("contact")}
                className="login-entry login-entry-dark label-caps flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                Private inquiries <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="relative z-10 h-px w-full bg-gradient-to-r from-[#C6A15B]/60 via-[#C6A15B]/20 to-transparent" />
      </section>

      {/* Firm Figures Strip */}
      <section className="bg-[#0D2418] text-white border-b border-[#C6A15B]/20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-white/10">
            {[
              { value: "$4.2B", label: "Assets Under Advisory (USD)" },
              { value: "38+", label: "Client Jurisdictions Served" },
              { value: "18", label: "Settlement & Custody Currencies" },
              { value: "24/7", label: "Global Private Banker Desk" },
            ].map((stat, idx) => (
              <div key={stat.label} className={idx > 0 ? "pl-6" : ""}>
                <p className="font-mono-nums text-3xl sm:text-4xl font-medium text-[#DFBD76]">{stat.value}</p>
                <p className="text-xs text-white/75 mt-1.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Banking & Wealth Divisions */}
      <section id="divisions" className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-20 sm:py-28">
          <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <p className="label-caps text-[#967432] mb-3">Banking &amp; Advisory Divisions</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.9rem, 3vw, 2.6rem)" }}>
                Four integrated practices,<br />
                <em>one custodial relationship.</em>
              </h2>
            </div>
            <button
              type="button"
              onClick={openWealthPortal}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#113221] hover:text-[#967432] transition-colors whitespace-nowrap shrink-0"
            >
              Sign in or apply <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 border border-[#143524]/15 bg-white/60">
            {DIVISIONS.map((div, i) => {
              const Icon = div.icon;
              return (
                <div
                  key={div.title}
                  className={`p-8 space-y-6 flex flex-col justify-between group hover:bg-[#113221] hover:text-white transition-colors duration-200 ${
                    i < 3 ? "lg:border-r border-[#143524]/15" : ""
                  } ${i < 2 ? "sm:border-r border-[#143524]/15" : ""}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-nums text-xs text-[#967432] group-hover:text-[#DFBD76]">{div.n}</span>
                      <Icon className="w-4 h-4 text-[#113221]/60 group-hover:text-[#DFBD76]" aria-hidden="true" />
                    </div>
                    <h3 className="font-serif text-xl leading-snug">{div.title}</h3>
                    <p className="text-xs text-[#967432] group-hover:text-[#DFBD76]/90 font-medium">{div.scope}</p>
                    <p className="text-[15px] text-[#113221]/75 group-hover:text-white/85 leading-relaxed">
                      {div.description}
                    </p>
                  </div>
                  <div className="pt-4 border-t border-[#143524]/15 group-hover:border-white/15">
                    <button
                      type="button"
                      onClick={() => (div.action === "portal" ? openWealthPortal() : scrollTo("contact"))}
                      className="flex items-center gap-1.5 text-sm font-semibold text-[#113221] group-hover:text-[#DFBD76] transition-colors whitespace-nowrap"
                    >
                      {div.cta} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Custody & Portfolio Discipline */}
      <section id="custody" className="bg-[#EFE9DC] border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-32">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-stretch">
            <div className="space-y-6 flex flex-col justify-center">
              <p className="label-caps text-[#967432]">Custody &amp; Controls</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.9rem, 3vw, 2.6rem)" }}>
                Precision asset allocation backed by institutional controls.
              </h2>
              <p className="text-[#113221]/75 text-[15px] leading-relaxed">
                Every balance, movement, and beneficiary mandate inside Veritas Wealth is protected by dual-control administrative verification, encrypted TOTP authentication, and full ledger auditability.
              </p>
              <ul className="space-y-3 pt-2 text-sm text-[#113221]/85">
                {[
                  "Segregated custodial accounts across 18 presentation currencies",
                  "Dual-control verification for institutional transfers and disbursements",
                  "Real-time statement exports, fee schedules, and advisor oversight",
                  "Customizable card spend permissions and instant freeze protection",
                ].map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#113221] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openWealthPortal}
                  className="inline-flex items-center gap-2 bg-[#113221] text-white text-sm font-medium px-6 py-3 hover:bg-[#194730] transition-colors"
                >
                  Enter Wealth Portal <ArrowRight className="w-4 h-4 text-[#DFBD76]" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative overflow-hidden border border-[#143524]/15 bg-[#113221] aspect-[4/3] sm:aspect-auto">
                <img
                  src="/assets/vault_custody_1795696130118.jpg"
                  alt="Veritas Wealth architectural vault and custody corridor"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="relative overflow-hidden border border-[#143524]/15 bg-[#113221] aspect-[4/3] sm:aspect-auto">
                <img
                  src="/assets/advisory_suite_1795696128693.jpg"
                  alt="Veritas Wealth private banking client suite"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Desks */}
      <section id="offices" className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-20 sm:py-24">
          <div className="mb-10">
            <p className="label-caps text-[#967432] mb-2">International Presence</p>
            <h2 className="font-serif text-3xl text-[#113221]">Global private banking desks</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-[#143524]/15 border border-[#143524]/15 bg-white/60">
            {DESKS.map(desk => (
              <div key={desk.city} className="p-7 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-xl text-[#113221]">{desk.city}</h3>
                  <MapPin className="w-4 h-4 text-[#967432]" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-[#113221]/85">{desk.district}</p>
                <p className="text-xs text-[#113221]/60">{desk.hours}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Advisory Inquiry Contact */}
      <section id="contact" className="bg-[#EFE9DC] border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-20 sm:py-28">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-14 items-start">
            <div className="space-y-6">
              <p className="label-caps text-[#967432]">Direct Advisory Desk</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.9rem, 3vw, 2.6rem)" }}>
                Connect with a private banker.
              </h2>
              <p className="text-[#113221]/75 text-[15px] leading-relaxed">
                Whether opening a multi-currency custody account or transferring an existing institutional portfolio, our senior advisors respond within one business day.
              </p>
              <div className="space-y-4 pt-2 border-t border-[#143524]/15 text-sm">
                <div className="flex items-center gap-3 text-[#113221]">
                  <Mail className="w-4 h-4 text-[#967432] shrink-0" aria-hidden="true" />
                  <span>veritaswealth@accountant.com</span>
                </div>
                <div className="flex items-center gap-3 text-[#113221]">
                  <PhoneCall className="w-4 h-4 text-[#967432] shrink-0" aria-hidden="true" />
                  <span className="font-mono-nums">+44 20 7946 0820 · +1 (702) 718-8852</span>
                </div>
                <div className="flex items-center gap-3 text-[#113221]">
                  <Globe className="w-4 h-4 text-[#967432] shrink-0" aria-hidden="true" />
                  <span>Zurich · London · Singapore · New York</span>
                </div>
              </div>
            </div>

            <div className="border border-[#143524]/15 bg-white p-8 sm:p-10">
              {inquirySent ? (
                <div className="py-10 space-y-4">
                  <CheckCircle2 className="w-7 h-7 text-[#113221]" />
                  <h3 className="font-serif text-2xl text-[#113221]">Inquiry received</h3>
                  <p className="text-sm text-[#113221]/75 leading-relaxed">
                    Thank you{inquiryName ? `, ${inquiryName}` : ""}. Our private advisory desk has logged your note and will reply to{" "}
                    <span className="font-medium text-[#113221]">{inquiryEmail}</span> within one business day.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setInquirySent(false);
                      setInquiryMessage("");
                    }}
                    className="label-caps text-[#967432] hover:text-[#113221] transition-colors"
                  >
                    Send another inquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleInquirySubmit} className="space-y-5">
                  <h3 className="font-serif text-2xl text-[#113221]">Private client inquiry</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="company-inquiry-name" className="label-caps text-[#113221]/65">Full name</label>
                      <input
                        id="company-inquiry-name"
                        type="text"
                        value={inquiryName}
                        onChange={e => setInquiryName(e.target.value)}
                        placeholder="Your name"
                        className="vw-input text-[#113221]"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="company-inquiry-email" className="label-caps text-[#113221]/65">Email address</label>
                      <input
                        id="company-inquiry-email"
                        type="email"
                        value={inquiryEmail}
                        onChange={e => setInquiryEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="vw-input text-[#113221]"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="company-inquiry-region" className="label-caps text-[#113221]/65">Preferred desk</label>
                    <select
                      id="company-inquiry-region"
                      value={inquiryJurisdiction}
                      onChange={e => setInquiryJurisdiction(e.target.value)}
                      className="vw-input text-[#113221] cursor-pointer"
                    >
                      <option value="Switzerland / Europe">Zurich / Europe</option>
                      <option value="United Kingdom">London / United Kingdom</option>
                      <option value="Asia Pacific">Singapore / Asia Pacific</option>
                      <option value="Americas">New York / Americas</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="company-inquiry-message" className="label-caps text-[#113221]/65">Mandate overview</label>
                    <textarea
                      id="company-inquiry-message"
                      rows={4}
                      value={inquiryMessage}
                      onChange={e => setInquiryMessage(e.target.value)}
                      placeholder="Briefly describe your custodial, banking, or advisory requirements…"
                      className="vw-input text-[#113221] resize-none"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#113221] text-white text-sm font-medium px-7 py-3 hover:bg-[#194730] transition-colors"
                  >
                    Submit inquiry <ArrowRight className="w-4 h-4 text-[#DFBD76]" />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer Matching Landing Page */}
      <footer className="bg-[#0D2418] text-white">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-14">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <img src="/veritas-logo.png" alt="Veritas Wealth" className="w-8 h-8 object-contain" />
              <span className="font-serif text-lg font-medium">Veritas Wealth</span>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-xs text-white/75">
              <button type="button" onClick={() => setLocation("/")} className="hover:text-[#DFBD76] transition-colors">
                Homepage
              </button>
              <button type="button" onClick={openWealthPortal} className="hover:text-[#DFBD76] transition-colors">
                Wealth Portal
              </button>
              <button type="button" onClick={() => scrollTo("divisions")} className="hover:text-[#DFBD76] transition-colors">
                Divisions
              </button>
              <button type="button" onClick={() => scrollTo("contact")} className="hover:text-[#DFBD76] transition-colors">
                Contact
              </button>
            </div>
          </div>
          <div className="pt-6 flex flex-col sm:flex-row justify-between gap-4 text-[11px] text-white/60">
            <p>© 2026 Veritas Wealth Private Banking &amp; Global Custody. All rights reserved.</p>
            <p>Zurich · London · Singapore · New York</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
