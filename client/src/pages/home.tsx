import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { ArrowRight, ArrowUpRight, Landmark } from "lucide-react";
import { BrandedLoader } from "@/components/branded-loader";
import { SessionLoadError } from "@/components/session-load-error";

const SEGMENTS = [
  {
    label: "Individuals & families",
    summary: "Custom discretionary portfolios, multi-currency custody, and private banking cards built for internationally mobile wealth.",
    cta: "Begin your application",
    min: "From $250,000 USD",
  },
  {
    label: "Entrepreneurs & founders",
    summary: "Pre-exit structuring, concentrated equity liquidity, and disciplined treasury deployment across global financial centers.",
    cta: "Speak with an advisor",
    min: "From $1,000,000 USD",
  },
  {
    label: "Family offices",
    summary: "Consolidated multi-custodian oversight, private credit access, and generational wealth governance across jurisdictions.",
    cta: "Family office desk",
    min: "From $10,000,000 USD",
  },
  {
    label: "Institutions & endowments",
    summary: "Fiduciary investment mandates, sovereign fixed-income ladders, and institutional cross-border settlement infrastructure.",
    cta: "Institutional inquiry",
    min: "From $25,000,000 USD",
  },
];

const PRINCIPLES = [
  {
    n: "01",
    title: "Capital preservation first",
    body: "Before targeting growth, we define strict downside guardrails across currencies and asset classes so wealth compounds from a resilient base.",
  },
  {
    n: "02",
    title: "Institutional market access",
    body: "Client portfolios access global sovereign fixed income, direct equities, structured credit, and multi-currency liquidity instruments.",
  },
  {
    n: "03",
    title: "Transparent advisory fee",
    body: "One straightforward annual advisory schedule. No hidden custody spreads, no opaque fund markups, and complete fee visibility.",
  },
  {
    n: "04",
    title: "Cross-border coordination",
    body: "Every allocation accounts for reporting currency preferences, liquidity horizons, and multi-jurisdictional custody requirements.",
  },
];

const STORIES = [
  {
    name: "Catherine Mercer",
    background: "Medical technology founder · London",
    before: "$1.8M",
    after: "$4.9M",
    years: 7,
    quote: "Having one private banking team coordinating multi-currency liquidity and long-term fixed income transformed how our family plans.",
  },
  {
    name: "James & Eleanor Thornton",
    background: "Industrial partners · Zurich & New York",
    before: "$6.5M",
    after: "$16.2M",
    years: 9,
    quote: "Following our corporate exit, Veritas structured our cross-border custody and income mandate without disruption or unnecessary complexity.",
  },
  {
    name: "Dr. Marcus Lin",
    background: "Chief surgeon & private investor · Singapore",
    before: "$950K",
    after: "$2.7M",
    years: 6,
    quote: "The portfolio discipline, clear reporting, and responsive private banker access set Veritas apart from traditional commercial banks.",
  },
];

const INSIGHTS = [
  {
    category: "Global fixed income",
    date: "Q4 2025",
    headline: "Positioning sovereign and corporate duration across G10 rate cycles",
    excerpt: "Diverging central bank trajectories across North America, Europe, and Asia create distinct yield curves. Disciplined duration ladders balance income stability with currency hedging.",
    readTime: "6 min read",
  },
  {
    category: "Equity strategy",
    date: "Q4 2025",
    headline: "Allocating global equities across developed and Pacific markets",
    excerpt: "Geographic and sector diversification reduces single-market concentration while capturing durable cash-flow compounders across global exchanges.",
    readTime: "8 min read",
  },
  {
    category: "Cross-border custody",
    date: "Q3 2025",
    headline: "Structuring multi-currency liquidity for international families",
    excerpt: "Coordinating accounts across USD, EUR, GBP, CHF, and SGD requires clean reporting, instant internal settlement, and clear fiduciary oversight.",
    readTime: "5 min read",
  },
];

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { user, isLoading, hasSessionError, retrySession } = useAuth();

  useEffect(() => {
    if (user) setLocation("/dashboard");
  }, [user, setLocation]);

  if (isLoading) {
    return <BrandedLoader />;
  }

  if (hasSessionError) return <SessionLoadError onRetry={retrySession} />;

  return (
    <div className="min-h-screen bg-cream text-foreground">
      {/* 3-Zone Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#143524]/10 bg-cream/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-left"
          >
            <img src="/veritas-logo.png" alt="Veritas Wealth" className="w-9 h-9 object-contain" />
            <span className="font-serif text-[1.125rem] font-semibold tracking-tight text-[#113221]">
              Veritas Wealth
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#113221]/70" aria-label="Primary navigation">
            {[
              { label: "Who we serve", id: "who-we-serve" },
              { label: "Our approach", id: "our-approach" },
              { label: "Performance", id: "performance" },
              { label: "Insights", id: "insights" },
            ].map(({ label, id }) => (
              <button
                key={id}
                type="button"
                className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="hover:text-[#113221] transition-colors whitespace-nowrap shrink-0"
              onClick={() => setLocation("/company")}
            >
              About firm
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setLocation("/auth")}
              className="text-[13px] font-medium text-[#113221] hover:text-[#113221]/75 px-3 py-2 transition-colors whitespace-nowrap shrink-0"
            >
              Client login
            </button>
            <button
              type="button"
              onClick={() => setLocation("/auth")}
              data-testid="button-get-started"
              className="flex items-center gap-1.5 bg-[#113221] text-white border border-[#C6A15B]/40 text-[13px] font-medium px-4 py-2 hover:bg-[#194730] transition-colors whitespace-nowrap shrink-0"
            >
              Apply now <ArrowRight className="w-3.5 h-3.5 text-[#DFBD76]" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-[76vh] flex flex-col justify-end pt-16 overflow-hidden bg-[#0D2418]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B1F15] via-[#123524] to-[#08170F]">
          <img
            src="/assets/hero_private_bank_1795696128307.jpg"
            alt="Veritas Wealth private bank headquarters atrium"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-65"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B1F15] via-[#0B1F15]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B1F15]/95 via-[#0B1F15]/75 to-transparent" />

        <div className="relative z-10 max-w-7xl mx-auto w-full px-6 sm:px-8 pb-14 sm:pb-20 pt-24">
          <div className="max-w-2xl">
            <p className="label-caps text-[#DFBD76] mb-4 tracking-[0.2em]">
              Global Private Banking · Multi-Currency Custody
            </p>
            <h1
              className="font-serif text-white leading-[1.08] text-balance"
              style={{ fontSize: "clamp(2.4rem, 4.4vw, 4rem)" }}
            >
              Capital, <em>protected</em>.<br />Wealth, compounded.
            </h1>
            <p className="text-white/85 text-base sm:text-lg mt-5 max-w-xl leading-relaxed">
              Discretionary private banking, global custodial accounts, and institutional wealth management for individuals, families, and enterprises across 38+ jurisdictions.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-8">
              <button
                type="button"
                onClick={() => setLocation("/auth")}
                className="flex items-center gap-2 bg-[#C6A15B] text-[#0B1F15] text-sm font-semibold px-7 py-3.5 hover:bg-[#DFBD76] transition-colors whitespace-nowrap shrink-0"
                data-testid="button-cta-start"
              >
                Begin your application <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLocation("/auth")}
                data-testid="button-sign-in"
                className="login-entry login-entry-dark label-caps flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                Client login <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="relative z-10 h-px w-full bg-gradient-to-r from-[#C6A15B]/60 via-[#C6A15B]/20 to-transparent" />
      </section>

      {/* Credibility Strip */}
      <div className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-4">
          <p className="font-serif text-base italic text-[#113221]/80">
            Global private banking across USD, EUR, GBP, CHF, SGD, and 13 additional settlement currencies.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#113221]/65 font-medium">
            <span>Private Custody</span>
            <span aria-hidden="true">·</span>
            <span>Zurich · London · Singapore · New York</span>
            <span aria-hidden="true">·</span>
            <span>Segregated Accounts</span>
          </div>
        </div>
      </div>

      {/* Who We Serve */}
      <section id="who-we-serve" className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-20 sm:py-28">
          <div className="mb-12">
            <p className="label-caps text-[#967432] mb-3">Who we serve</p>
            <div className="flex items-end justify-between gap-8">
              <h2 className="font-serif leading-tight text-[#113221] text-balance" style={{ fontSize: "clamp(1.9rem, 3vw, 2.6rem)" }}>
                One private bank, every chapter<br />
                <em>of your global wealth.</em>
              </h2>
              <p className="hidden lg:block text-[15px] text-[#113221]/70 max-w-xs leading-relaxed text-right">
                Tailored liquidity, custody, and discretionary mandates structured around your cross-border life and enterprise.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 border border-[#143524]/15 bg-white/60">
            {SEGMENTS.map((seg, i) => (
              <div
                key={seg.label}
                className={`p-8 space-y-5 flex flex-col justify-between group hover:bg-[#113221] hover:text-white transition-colors duration-200 ${
                  i < 3 ? "lg:border-r border-[#143524]/15" : ""
                } ${i < 2 ? "sm:border-r border-[#143524]/15" : ""}`}
              >
                <div className="space-y-3">
                  <span className="font-mono-nums text-xs text-[#967432] group-hover:text-[#DFBD76] transition-colors">
                    0{i + 1}
                  </span>
                  <h3 className="font-serif text-xl leading-snug">{seg.label}</h3>
                  <p className="text-[15px] text-[#113221]/75 group-hover:text-white/85 leading-relaxed transition-colors">
                    {seg.summary}
                  </p>
                </div>
                <div className="pt-4 border-t border-[#143524]/15 group-hover:border-white/15 transition-colors space-y-2">
                  <button
                    type="button"
                    onClick={() => setLocation("/auth")}
                    className="flex items-center gap-1.5 text-sm text-[#113221] group-hover:text-[#DFBD76] font-semibold transition-colors whitespace-nowrap"
                  >
                    {seg.cta} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <p className="label-caps text-[#113221]/55 group-hover:text-white/70 transition-colors">{seg.min}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Philosophy & Advisory Suite */}
      <section id="our-approach" className="bg-[#EFE9DC] border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-32">
          <div className="grid lg:grid-cols-[1fr_1.15fr] gap-14 lg:gap-20 items-stretch">
            <div className="flex flex-col justify-between space-y-8">
              <div className="space-y-5">
                <p className="label-caps text-[#967432]">Our philosophy</p>
                <blockquote
                  className="font-serif leading-snug text-[#113221]"
                  style={{ fontSize: "clamp(1.6rem, 2.7vw, 2.3rem)" }}
                >
                  "Most institutions optimize for volume. We optimize for resilience—protecting purchasing power across borders and market cycles."
                </blockquote>
                <div className="pt-2 flex items-center gap-3">
                  <div className="w-8 h-px bg-[#C6A15B]" />
                  <span className="text-sm text-[#113221]/70">Veritas Wealth Investment Committee</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLocation("/company")}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#113221] hover:text-[#967432] transition-colors"
                >
                  Explore our banking architecture <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative overflow-hidden border border-[#143524]/15 bg-[#113221] aspect-[4/3]">
                <img
                  src="/assets/advisory_suite_1795696128693.jpg"
                  alt="Veritas Wealth private client advisory suite"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B1F15]/90 via-[#0B1F15]/40 to-transparent p-5">
                  <p className="text-xs font-medium text-[#DFBD76]">Private Advisory Desks</p>
                  <p className="text-sm text-white/90 mt-0.5">Direct senior banker access across global time zones.</p>
                </div>
              </div>
            </div>

            <div className="space-y-0 divide-y divide-[#143524]/15 self-center">
              {PRINCIPLES.map(p => (
                <div key={p.n} className="py-7 first:pt-0 last:pb-0 flex gap-6">
                  <span className="font-mono-nums text-xs text-[#967432] font-semibold shrink-0 mt-1">{p.n}</span>
                  <div className="space-y-2">
                    <h3 className="font-serif text-xl font-semibold text-[#113221]">{p.title}</h3>
                    <p className="text-[#113221]/75 text-[15px] leading-relaxed">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Performance */}
      <section id="performance" className="bg-[#0D2418] wealth-panel text-white border-b border-[#C6A15B]/20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-20 sm:py-28">
          <div className="grid lg:grid-cols-[auto_1fr] gap-16 lg:gap-28 items-start">
            <div className="lg:max-w-xs space-y-4">
              <p className="label-caps text-[#DFBD76]">Institutional scale</p>
              <h2 className="font-serif text-white leading-tight" style={{ fontSize: "clamp(1.8rem, 3vw, 2.8rem)" }}>
                Measured discipline across market cycles.
              </h2>
              <p className="text-white/80 text-[15px] leading-relaxed">
                Returns reflect composite discretionary mandates net of advisory fees. Market conditions vary and past performance does not guarantee future results.
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-white/15">
              {[
                { v: "$4.2B", l: "Assets under advisory", sub: "USD equivalent · Q4 2025" },
                { v: "12.4%", l: "10-year annualized return", sub: "Net composite mandate" },
                { v: "0.32%", l: "All-in annual fee", sub: "Transparent schedule" },
                { v: "38+", l: "Global jurisdictions", sub: "18 settlement currencies" },
              ].map(s => (
                <div key={s.l} className="min-w-0 px-6 sm:px-8 first:pl-0 space-y-2 py-2">
                  <p className="font-mono-nums text-[#DFBD76] text-3xl sm:text-4xl font-medium tracking-tight">{s.v}</p>
                  <p className="text-white/90 text-sm leading-snug">{s.l}</p>
                  <p className="label-caps text-white/65">{s.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Client Stories */}
      <section className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-32">
          <div className="flex items-end justify-between mb-14">
            <div className="space-y-2">
              <p className="label-caps text-[#967432]">Client outcomes</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.8rem, 3vw, 2.5rem)" }}>
                Trusted by global families<br />
                <em>and enterprise founders.</em>
              </h2>
            </div>
            <p className="hidden lg:block text-xs text-[#113221]/65 max-w-xs leading-relaxed text-right">
              Selected client case summaries. Identifying details shared with client authorization.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-[#143524]/15">
            {STORIES.map(s => (
              <div key={s.name} className="py-10 lg:py-0 lg:px-10 first:pl-0 last:pr-0 space-y-6">
                <div>
                  <span className="font-serif text-5xl text-[#C6A15B]/60 leading-none">"</span>
                  <p className="font-serif text-xl italic leading-snug -mt-2 text-[#113221]">{s.quote}</p>
                </div>
                <div className="flex items-center gap-3 pt-4 border-t border-[#143524]/15">
                  <div className="w-9 h-9 bg-[#113221] text-[#DFBD76] flex items-center justify-center shrink-0">
                    <span className="font-serif font-semibold">{s.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#113221]">{s.name}</p>
                    <p className="text-xs text-[#113221]/65">{s.background}</p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="label-caps text-[#113221]/55 mb-1">Initial mandate</p>
                    <p className="font-mono-nums text-base text-[#113221]">{s.before}</p>
                  </div>
                  <div className="text-[#967432] self-center text-xs">to</div>
                  <div>
                    <p className="label-caps text-[#113221]/55 mb-1">After {s.years} years</p>
                    <p className="font-mono-nums text-base font-semibold text-[#113221]">{s.after}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Market Insights */}
      <section id="insights" className="bg-[#EFE9DC] border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-32">
          <div className="flex items-end justify-between mb-12">
            <div className="space-y-2">
              <p className="label-caps text-[#967432]">Research &amp; perspectives</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.8rem, 3vw, 2.5rem)" }}>
                Thinking clearly<br />
                <em>about global markets.</em>
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setLocation("/company")}
              className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-[#113221] hover:text-[#967432] transition-colors"
            >
              About our investment committee <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Featured Insight with Generated Editorial Visual */}
          <div
            onClick={() => setLocation("/company")}
            className="border border-[#143524]/15 bg-white/75 mb-6 group hover:border-[#143524]/40 transition-colors cursor-pointer grid lg:grid-cols-[1.25fr_0.75fr] items-stretch"
          >
            <div className="p-8 sm:p-10 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-xs">
                  <span className="label-caps text-[#967432]">{INSIGHTS[0].category}</span>
                  <span aria-hidden="true" className="text-[#143524]/30">·</span>
                  <span className="label-caps text-[#113221]/60">{INSIGHTS[0].date}</span>
                  <span aria-hidden="true" className="text-[#143524]/30">·</span>
                  <span className="label-caps text-[#113221]/60">{INSIGHTS[0].readTime}</span>
                </div>
                <h3 className="font-serif leading-snug text-[#113221]" style={{ fontSize: "clamp(1.4rem, 2.2vw, 2rem)" }}>
                  {INSIGHTS[0].headline}
                </h3>
                <p className="text-[#113221]/75 text-[15px] leading-relaxed max-w-xl">{INSIGHTS[0].excerpt}</p>
              </div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-[#113221] group-hover:text-[#967432] transition-colors">
                Explore firm perspective <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="relative bg-[#113221] min-h-[220px] lg:min-h-full overflow-hidden">
              <img
                src="/assets/insights_markets_1795696130489.jpg"
                alt="Veritas Wealth macro research library"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              />
            </div>
          </div>

          {/* Two Secondary Articles */}
          <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-[#143524]/15 border border-[#143524]/15 bg-white/50">
            {INSIGHTS.slice(1).map(article => (
              <div
                key={article.headline}
                onClick={() => setLocation("/auth")}
                className="p-7 space-y-4 group hover:bg-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 text-xs">
                  <span className="label-caps text-[#967432]">{article.category}</span>
                  <span aria-hidden="true" className="text-[#143524]/30">·</span>
                  <span className="label-caps text-[#113221]/60">{article.date}</span>
                </div>
                <h3 className="font-serif text-xl leading-snug text-[#113221] group-hover:text-[#967432] transition-colors">
                  {article.headline}
                </h3>
                <p className="text-[#113221]/75 text-[15px] leading-relaxed">{article.excerpt}</p>
                <div className="flex items-center justify-between pt-2">
                  <span className="label-caps text-[#113221]/55">{article.readTime}</span>
                  <span className="flex items-center gap-1 text-xs font-medium text-[#113221] group-hover:text-[#967432]">
                    Open mandate <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Onboarding & Custody Steps */}
      <section className="bg-cream border-b border-[#143524]/12">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-32 space-y-14">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 items-end">
            <div className="space-y-2">
              <p className="label-caps text-[#967432]">Private onboarding</p>
              <h2 className="font-serif leading-tight text-[#113221]" style={{ fontSize: "clamp(1.8rem, 3vw, 2.5rem)" }}>
                From application to funded<br />
                global custody in 5 business days.
              </h2>
            </div>
            <div className="relative overflow-hidden border border-[#143524]/15 bg-[#113221] aspect-[16/9]">
              <img
                src="/assets/vault_custody_1795696130118.jpg"
                alt="Segregated private banking custody corridor"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B1F15]/90 via-[#0B1F15]/35 to-transparent p-4 flex items-center justify-between">
                <span className="text-xs font-medium text-[#DFBD76]">Segregated Custody · 18 Currencies</span>
                <Landmark className="w-4 h-4 text-[#DFBD76]" aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-[#143524]/15 border-t border-[#143524]/15 pt-10">
            {[
              {
                n: "01",
                title: "Apply online",
                body: "Complete our private banking application. Every submission is reviewed directly by our onboarding and compliance desk.",
              },
              {
                n: "02",
                title: "Advisory & KYC review",
                body: "Your assigned private banker confirms residency, currency preferences, and bespoke mandate objectives prior to approval.",
              },
              {
                n: "03",
                title: "Fund your account",
                body: "Send funds via SWIFT wire, SEPA, Fedwire, or institutional transfer. Private accounts open from $250,000 USD with zero lock-up periods ever.",
              },
              {
                n: "04",
                title: "Portal & cards live",
                body: "Your multi-currency accounts, investment allocations, and private banking cards activate within two business days.",
              },
            ].map(step => (
              <div key={step.n} className="py-6 sm:py-0 sm:px-8 first:pl-0 last:pr-0 space-y-3">
                <span className="font-mono-nums text-xs text-[#967432] font-semibold">{step.n}</span>
                <h3 className="font-serif text-xl text-[#113221]">{step.title}</h3>
                <p className="text-[#113221]/75 text-[15px] leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA & Quiet Global Footer */}
      <section className="bg-[#0D2418] wealth-panel text-white">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-24 sm:py-28">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-5">
              <p className="label-caps text-[#DFBD76]">Begin a relationship</p>
              <h2 className="font-serif leading-tight text-white" style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)" }}>
                Serious capital deserves<br />
                <em>global stewardship.</em>
              </h2>
              <p className="text-white/80 text-[15px] leading-relaxed max-w-md">
                Submit your onboarding profile in 15 minutes. A dedicated senior advisor will follow up within one business day across your preferred time zone.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setLocation("/auth")}
                className="flex items-center gap-2 bg-[#C6A15B] text-[#0B1F15] text-sm font-semibold px-8 py-4 hover:bg-[#DFBD76] transition-colors whitespace-nowrap"
                data-testid="button-apply-final"
              >
                Begin your application <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLocation("/company")}
                className="login-entry login-entry-dark label-caps flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                About Veritas <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-20 pt-8 border-t border-white/10 grid min-w-0 sm:grid-cols-2 gap-4 text-[11px] text-white/70 leading-relaxed">
            <p className="min-w-0 break-words">
              Veritas Wealth Private Banking &amp; Global Custody provides international multi-currency banking and discretionary portfolio management across regulated jurisdictions.
            </p>
            <p className="min-w-0 break-words">
              All investment strategies carry market risk and past performance is not indicative of future results. Advisory schedules and custody terms are provided prior to account funding.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
