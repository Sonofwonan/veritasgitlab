import { useInvestments, useAccounts, useBuyInvestment, useSellInvestment } from "@/hooks/use-finances";
import { MARKET_TRADING_ENABLED } from "@shared/market";
import { accountLabel } from "@shared/account-display";
import { clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useFundsAccess } from "@/hooks/use-funds-access";
import { useClientControls } from "@/hooks/use-client-controls";
import { FundsAccessNotice } from "@/components/fees/funds-access-notice";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, BookOpen, Zap, DollarSign, Settings, Zap as ZapIcon, Plus, Lock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { InfoTip } from "@/components/ui/info-tip";

const STOCKS = ["AAPL", "GOOGL", "TSLA", "AMZN", "MSFT"];
const ETFS = ["SPY", "QQQ", "IVV", "VOO", "VTI"];
const ROBO_PORTFOLIOS = [
  { id: "conservative", name: "Conservative", allocation: "80% Bonds, 20% Stocks", risk: "Low" },
  { id: "balanced", name: "Balanced", allocation: "60% Stocks, 40% Bonds", risk: "Medium" },
  { id: "growth", name: "Growth", allocation: "80% Stocks, 20% Bonds", risk: "High" },
  { id: "aggressive", name: "Aggressive Growth", allocation: "95% Stocks, 5% Cash", risk: "Very High" },
];

const RESEARCH_ARTICLES = [
  { title: "Market Volatility: What You Should Know", category: "Market Analysis", date: "Dec 24, 2025" },
  { title: "Diversification Strategy Guide", category: "Strategy", date: "Dec 23, 2025" },
  { title: "Tax-Loss Harvesting Explained", category: "Tax Planning", date: "Dec 21, 2025" },
  { title: "Advanced Order Types Guide", category: "Trading Tools", date: "Dec 24, 2025" },
  { title: "Risk Management Strategies", category: "Risk", date: "Dec 23, 2025" },
  { title: "Technical Analysis Mastery", category: "Technical Analysis", date: "Dec 22, 2025" },
];

export default function InvestmentsPage() {
  const access = useFundsAccess();
  const { data: investments, isLoading: loadingInv } = useInvestments();
  const { data: accounts } = useAccounts();
  const buyMutation = useBuyInvestment();
  const sellMutation = useSellInvestment();
  const { toast } = useToast();
  const { user } = useAuth();
  const { platform, features } = useClientControls();
  const [, setLocation] = useLocation();
  const initialDepositPending = user?.initialDepositStatus === "pending_review";
  const needsInitialDeposit = user?.initialDepositStatus === "required" || initialDepositPending;
  // Stock Trading State
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string>("");

  // ETF/Fractional Trading State
  const [selectedETF, setSelectedETF] = useState("SPY");
  const [etfAmount, setEtfAmount] = useState("");
  const [etfAccount, setEtfAccount] = useState<string>("");

  // Robo-Advisor State
  const [selectedRobo, setSelectedRobo] = useState("balanced");
  const [roboAccount, setRoboAccount] = useState<string>("");

  // Options Trading State
  const [optionType, setOptionType] = useState<"call" | "put">("call");
  const [strikePrice, setStrikePrice] = useState("");
  const [expiration, setExpiration] = useState("");
  const [optionAccount, setOptionAccount] = useState<string>("");

  // Advanced Orders State
  const [orderType, setOrderType] = useState("limit");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [trailingPercent, setTrailingPercent] = useState("");
  const [orderAccount, setOrderAccount] = useState<string>("");

  // Trading follows admin platform policy and per-client authorization.
  const tradingEnabled = Boolean(platform.marketTradingEnabled && features.canTradeInvestments);
  const pricingBlocked = !tradingEnabled;
  const pausedBannerText = !platform.marketTradingEnabled
    ? (platform.marketPausedMessage || "Trading is currently paused. Please contact your advisor.")
    : "Trading is disabled on your profile. Please contact your advisor.";
  const rejectUnpricedOrder = () => {
    toast({ title: "Trading paused", description: pausedBannerText, variant: "destructive" });
  };

  // Trading eligibility is independent of Accounts-page presentation groups:
  // trusts display under Business & Trust but can also hold and trade investments.
  const investmentAccounts = accounts?.filter(a =>
    ['Brokerage Account', 'Traditional IRA', 'Roth IRA', '401(k) / 403(b)', '529 Savings Plan', 'Trust Account'].includes(a.accountType)
  ) || [];

  const handleBuy = () => {
    if (access.blocked) return;
    if (pricingBlocked) return rejectUnpricedOrder();
    if (!selectedAccount) {
      toast({ title: "Select an account", variant: "destructive" });
      return;
    }
    buyMutation.mutate({
      accountId: parseInt(selectedAccount),
      symbol: selectedSymbol,
      amount: amount
    }, {
      onSuccess: () => {
        toast({ title: "Purchase Successful", description: `Bought $${amount} of ${selectedSymbol}` });
        setAmount("");
      },
      onError: (err) => {
        toast({ title: "Failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleSell = () => {
    if (access.blocked) return;
    if (pricingBlocked) return rejectUnpricedOrder();
    if (!selectedAccount) {
      toast({ title: "Select an account", variant: "destructive" });
      return;
    }
    sellMutation.mutate({
      accountId: parseInt(selectedAccount),
      symbol: selectedSymbol,
      shares: shares
    }, {
      onSuccess: () => {
        toast({ title: "Sale Successful", description: `Sold ${shares} shares of ${selectedSymbol}` });
        setShares("");
      },
      onError: (err) => {
        toast({ title: "Failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleFractionalBuy = () => {
    if (access.blocked) return;
    rejectUnpricedOrder();
  };

  const handleRoboSetup = () => {
    if (!roboAccount) {
      toast({ title: "Select an account", variant: "destructive" });
      return;
    }
    const portfolio = ROBO_PORTFOLIOS.find(p => p.id === selectedRobo);
    toast({ 
      title: "Robo-Advisor Activated", 
      description: `Your ${portfolio?.name} portfolio is now actively managed. Rebalancing happens quarterly.` 
    });
  };

  const handlePlaceOption = () => {
    if (!optionAccount) {
      toast({ title: "Select an account", variant: "destructive" });
      return;
    }
    if (!strikePrice || !expiration) {
      toast({ title: "Fill in all required fields", variant: "destructive" });
      return;
    }
    toast({
      title: "Options Order Placed",
      description: `${optionType.toUpperCase()} contract on ${selectedSymbol} at $${strikePrice} strike, expires ${expiration}. Order submitted to market.`
    });
    setStrikePrice("");
    setExpiration("");
  };

  const handlePlaceOrder = () => {
    if (!orderAccount) {
      toast({ title: "Select an account", variant: "destructive" });
      return;
    }
    
    let description = "";
    if (orderType === "limit") {
      if (!limitPrice) {
        toast({ title: "Enter limit price", variant: "destructive" });
        return;
      }
      description = `Limit order on ${selectedSymbol} at $${limitPrice}`;
    } else if (orderType === "stop" || orderType === "stop-limit") {
      if (!stopPrice) {
        toast({ title: "Enter stop price", variant: "destructive" });
        return;
      }
      description = `${orderType === 'stop' ? 'Stop-Loss' : 'Stop-Limit'} order on ${selectedSymbol} at $${stopPrice}`;
    } else if (orderType === "trailing") {
      if (!trailingPercent) {
        toast({ title: "Enter trailing percentage", variant: "destructive" });
        return;
      }
      description = `Trailing stop order on ${selectedSymbol} at ${trailingPercent}%`;
    } else {
      description = `Market order on ${selectedSymbol}`;
    }
    
    toast({
      title: "Advanced Order Placed",
      description: `${description}. Order is now active and monitoring the market.`
    });
    setLimitPrice("");
    setStopPrice("");
    setTrailingPercent("");
  };

  return (
    <LayoutShell>
      <FundsAccessNotice />
      <div className="space-y-5">
        <header className="px-0.5">
          <h1 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
            Wealth &amp; Custody
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
            Review your recorded holdings and cash positions
          </p>
        </header>

        {pricingBlocked && (
          <div
            role="alert"
            data-testid="market-trading-paused"
            className="rounded-lg border border-amber-200/90 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/25 px-5 py-3.5 text-sm text-amber-950 dark:text-amber-200"
          >
            {pausedBannerText}
          </div>
        )}

        {needsInitialDeposit ? (
          <div
            className="rounded-lg border border-slate-200/90 dark:border-border bg-white dark:bg-card px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs"
            data-testid="investments-activation-notice"
          >
            <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-foreground">
              <Lock className="w-4 h-4 text-[#0B2218] dark:text-primary shrink-0" />
              <span>
                {initialDepositPending
                  ? "Initial deposit pending review — investing unlocks after verification."
                  : "Complete your initial deposit to unlock portfolio investing."}
              </span>
              <InfoTip
                label="Investing activation notice"
                content="Your portfolio investments unlock automatically once an administrator verifies your initial deposit."
              />
            </div>
            <Button
              size="sm"
              onClick={() => setLocation("/transfers?tab=deposit")}
              className="bg-[#0B2218] hover:bg-[#133526] text-white rounded-md text-xs whitespace-nowrap shrink-0"
            >
              {initialDepositPending ? "View Deposit" : "Make Initial Deposit"}
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="stocks" className="w-full">
            <TabsList className="grid w-full sm:w-auto sm:inline-grid grid-cols-3 mb-5 bg-slate-200/60 dark:bg-muted/40 p-1 rounded-lg">
              <TabsTrigger value="stocks" aria-label="Stocks" className="gap-2 text-xs sm:text-sm rounded-md whitespace-nowrap">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Stocks</span>
              </TabsTrigger>
              <TabsTrigger value="etfs" aria-label="ETFs" className="gap-2 text-xs sm:text-sm rounded-md whitespace-nowrap">
                <DollarSign className="w-3.5 h-3.5" />
                <span>ETFs</span>
              </TabsTrigger>
              <TabsTrigger value="cash" aria-label="Cash" className="gap-2 text-xs sm:text-sm rounded-md whitespace-nowrap">
                <DollarSign className="w-3.5 h-3.5" />
                <span>Cash</span>
              </TabsTrigger>
            </TabsList>

            {/* Stock Trading */}
            <TabsContent value="stocks" className="space-y-6">
              <div className="grid lg:grid-cols-3 gap-5 items-start">
                {/* Order Entry Panel */}
                <div className="min-w-0 lg:col-span-1">
                  <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                    <div className="bg-slate-50/75 dark:bg-muted/20 p-5 border-b border-slate-100 dark:border-border">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground">Equity Custody</p>
                          <h2 className="text-xl font-semibold text-slate-900 dark:text-foreground mt-0.5">{selectedSymbol}</h2>
                        </div>
                      </div>

                      <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                        <SelectTrigger className="bg-white dark:bg-background h-10 rounded-md border-slate-200 dark:border-border">
                          <SelectValue placeholder="Select Stock" />
                        </SelectTrigger>
                        <SelectContent>
                          {STOCKS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <CardContent className="p-5">
                      <div className="mb-4">
                        <Label className="text-xs font-medium text-slate-600 dark:text-muted-foreground mb-1.5 block">Source Account</Label>
                        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                          <SelectTrigger className="h-10 rounded-md border-slate-200 dark:border-border bg-white dark:bg-background">
                            <SelectValue placeholder="Select Account" />
                          </SelectTrigger>
                          <SelectContent>
                            {investmentAccounts.map(a => (
                              <SelectItem key={a.id} value={a.id.toString()}>
                                {accountLabel(a)} ({formatBalance(a.balance,clientBalanceCurrency(user))})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Tabs defaultValue="buy" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4 bg-slate-100 dark:bg-muted/40 rounded-md p-1">
                          <TabsTrigger value="buy" className="rounded-sm text-xs">Buy</TabsTrigger>
                          <TabsTrigger value="sell" className="rounded-sm text-xs">Sell</TabsTrigger>
                        </TabsList>

                        <TabsContent value="buy" className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-600 dark:text-muted-foreground">Amount</Label>
                            <Input
                              type="number"
                              placeholder="0.00"
                              className="h-10 rounded-md border-slate-200 dark:border-border tabular-nums"
                              value={amount}
                              onChange={e => setAmount(e.target.value)}
                            />
                          </div>
                          <Button
                            data-funds-action=""
                            className="w-full bg-[#0B2218] hover:bg-[#133526] text-white rounded-md"
                            onClick={handleBuy}
                            disabled={(pricingBlocked && !access.blocked) || buyMutation.isPending}
                          >
                            {buyMutation.isPending ? "Processing..." : "Buy Stock"}
                          </Button>
                        </TabsContent>

                        <TabsContent value="sell" className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-600 dark:text-muted-foreground">Shares</Label>
                            <Input
                              type="number"
                              placeholder="0"
                              className="h-10 rounded-md border-slate-200 dark:border-border tabular-nums"
                              value={shares}
                              onChange={e => setShares(e.target.value)}
                            />
                          </div>
                          <Button
                            data-funds-action=""
                            className="w-full bg-rose-800 hover:bg-rose-900 text-white rounded-md"
                            onClick={handleSell}
                            disabled={(pricingBlocked && !access.blocked) || sellMutation.isPending}
                          >
                            {sellMutation.isPending ? "Processing..." : "Sell Shares"}
                          </Button>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                </div>

                {/* Portfolio Table */}
                <div className="min-w-0 lg:col-span-2">
                  <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                    <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                      <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Current Holdings</CardTitle>
                      <CardDescription className="text-xs">Your recorded investments</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {loadingInv ? (
                        <p className="text-center py-10 text-xs text-slate-500 dark:text-muted-foreground">Loading portfolio...</p>
                      ) : investments && investments.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-100 dark:border-border">
                              <TableHead className="text-xs">Symbol</TableHead>
                              <TableHead className="text-xs text-right">Shares</TableHead>
                              <TableHead className="text-xs text-right">Avg Price</TableHead>
                              <TableHead className="text-xs text-right">Stored Price</TableHead>
                              <TableHead className="text-xs text-right">Stored Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {investments.map((inv) => {
                              const marketValue = Number(inv.shares) * Number(inv.currentPrice ?? inv.purchasePrice);
                              return (
                                <TableRow key={inv.id} className="border-slate-100 dark:border-border/50">
                                  <TableCell className="font-semibold text-slate-900 dark:text-foreground">{inv.symbol}</TableCell>
                                  <TableCell className="text-right font-mono text-xs tabular-nums">{Number(inv.shares).toFixed(4)}</TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{formatBalance(inv.purchasePrice,clientBalanceCurrency(user))}</TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{formatBalance(inv.currentPrice ?? inv.purchasePrice,clientBalanceCurrency(user))}</TableCell>
                                  <TableCell className="text-right font-semibold text-xs tabular-nums text-slate-900 dark:text-foreground">
                                    {formatBalance(marketValue,clientBalanceCurrency(user))}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-center py-12 text-xs text-slate-500 dark:text-muted-foreground">No holdings yet</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ETF/Fractional Trading */}
            <TabsContent value="etfs" className="space-y-6">
              <div className="grid lg:grid-cols-3 gap-5 items-start">
                <div className="lg:col-span-1">
                  <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                    <div className="bg-slate-50/75 dark:bg-muted/20 p-5 border-b border-slate-100 dark:border-border">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground">Index &amp; Fund Custody</p>
                          <h2 className="text-xl font-semibold text-slate-900 dark:text-foreground mt-0.5">{selectedETF}</h2>
                        </div>
                      </div>

                      <Select value={selectedETF} onValueChange={setSelectedETF}>
                        <SelectTrigger className="bg-white dark:bg-background h-10 rounded-md border-slate-200 dark:border-border">
                          <SelectValue placeholder="Select ETF" />
                        </SelectTrigger>
                        <SelectContent>
                          {ETFS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <CardContent className="p-5 space-y-4">
                      <div>
                        <Label className="text-xs font-medium text-slate-600 dark:text-muted-foreground mb-1.5 block">Account</Label>
                        <Select value={etfAccount} onValueChange={setEtfAccount}>
                          <SelectTrigger className="h-10 rounded-md border-slate-200 dark:border-border bg-white dark:bg-background">
                            <SelectValue placeholder="Select Account" />
                          </SelectTrigger>
                          <SelectContent>
                            {investmentAccounts.map(a => (
                              <SelectItem key={a.id} value={a.id.toString()}>
                                {accountLabel(a)} ({formatBalance(a.balance,clientBalanceCurrency(user))})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-slate-600 dark:text-muted-foreground mb-1.5 block">Invest Amount</Label>
                        <Input
                          type="number"
                          placeholder="0.00"
                          className="h-10 rounded-md border-slate-200 dark:border-border tabular-nums"
                          value={etfAmount}
                          onChange={e => setEtfAmount(e.target.value)}
                        />
                      </div>

                      <Button
                        data-funds-action=""
                        className="w-full bg-[#0B2218] hover:bg-[#133526] text-white rounded-md"
                        onClick={handleFractionalBuy}
                        disabled={pricingBlocked && !access.blocked}
                      >
                        Buy Fractional Shares
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-2">
                  <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                    <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                      <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Reference ETFs</CardTitle>
                      <CardDescription className="text-xs">Eligible index funds for reference</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 divide-y divide-slate-100 dark:divide-border/50">
                      {[
                        { symbol: "SPY", name: "S&P 500 ETF" },
                        { symbol: "QQQ", name: "Nasdaq-100 ETF" },
                        { symbol: "IVV", name: "Core S&P 500 ETF" },
                        { symbol: "VOO", name: "Vanguard S&P 500" },
                        { symbol: "VTI", name: "Total Stock Market" },
                      ].map(etf => (
                        <button
                          key={etf.symbol}
                          type="button"
                          onClick={() => setSelectedETF(etf.symbol)}
                          className="w-full text-left flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{etf.symbol}</p>
                            <p className="text-xs text-slate-500 dark:text-muted-foreground">{etf.name}</p>
                          </div>
                          {selectedETF === etf.symbol && (
                            <span className="text-xs font-medium text-[#0B2218] dark:text-primary">Selected</span>
                          )}
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Cash Management */}
            <TabsContent value="cash" className="space-y-6">
              <Card className="border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
                  <CardTitle className="text-sm font-semibold text-slate-900 dark:text-foreground">Cash Positions</CardTitle>
                  <CardDescription className="text-xs">Cash balances held in your investment accounts.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-100 dark:border-border">
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs text-right">Cash Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {investmentAccounts.map(a => {
                        const balance = Number(a.balance);
                        return (
                          <TableRow key={a.id} className="border-slate-100 dark:border-border/50">
                            <TableCell className="text-sm font-medium text-slate-900 dark:text-foreground">{accountLabel(a)}</TableCell>
                            <TableCell className="text-right font-sans text-sm font-semibold tabular-nums text-slate-900 dark:text-foreground">{formatBalance(balance,clientBalanceCurrency(user))}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </LayoutShell>
  );
}
