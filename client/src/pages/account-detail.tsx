import { useAccounts, useAccountTransactions } from "@/hooks/use-finances";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Download, Info, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ClientFees } from "@/components/fees/client-fees";
import { transactionDescription, clientBalanceCurrency, formatBalance, type BalanceCurrency } from "@shared/balance-currency";
import { useAuth } from "@/hooks/use-auth";
import { useClientFeeSummary } from "@/hooks/use-fees";
import { accountStatementCsv } from "@/lib/account-statement";
import { accountLabel, maskAccountNumber, transactionDate, type CashPosting } from "@shared/account-display";
import { TransactionAmountBalance } from "@/components/transaction-amount-balance";

function exportStatement(account: { id: number; accountType: string; accountNumber?: string }, transactions: any[] = [], currency: BalanceCurrency = "CAD") {
  const number = account.accountNumber || "account-number-unavailable";
  const csv = accountStatementCsv(account.id, number, transactions, currency);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `veritas-account-${number.replace(/[^a-zA-Z0-9_-]/g, "")}-statement.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AccountDetailPage() {
  const { user } = useAuth();
  const currency = clientBalanceCurrency(user);
  const money = (value: string | number) => formatBalance(value,currency);
  const params = useParams();
  const [, setLocation] = useLocation();
  const { data: accounts, isLoading: accountsLoading, isError: accountsError, refetch: refetchAccounts } = useAccounts();
  const feeSummary = useClientFeeSummary();
  const [selectedTxn, setSelectedTxn] = useState<any>(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  
  const accountId = parseInt(params.id as string);
  const account = accounts?.find(a => a.id === accountId);
  const { data: transactions, isLoading: transactionsLoading, isError: transactionsError, refetch: refetchTransactions } = useAccountTransactions(accountId);

  if (accountsLoading) {
    return (
      <LayoutShell>
        <div className="mb-8">
          <Skeleton className="h-12 w-32 mb-4" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="grid gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-96" />
        </div>
      </LayoutShell>
    );
  }

  if (accountsError) {
    return <LayoutShell><div role="alert" className="border border-red-300 bg-red-50 p-4 text-red-950">
      Account details could not be loaded.
      <Button variant="outline" className="ml-3" onClick={() => void refetchAccounts()}>Retry</Button>
    </div></LayoutShell>;
  }

  if (!account) {
    return (
      <LayoutShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">Account not found</p>
          <Button onClick={() => setLocation("/accounts")}>Back to Accounts</Button>
        </div>
      </LayoutShell>
    );
  }

  const accountBalance = Number(account.balance);
  const accountFees = feeSummary.data?.accounts.find(item => item.accountId === accountId);
  const unpaidFees = Number(accountFees?.unpaidTotal || 0);
  const balanceError = !Number.isFinite(accountBalance) ||
    !Number.isFinite(unpaidFees) || unpaidFees < 0;
  const displayBalance = money(accountBalance);

  return (
    <LayoutShell>
      <div className="space-y-5">
        <Button 
          variant="ghost" 
          className="h-auto gap-2 px-0 py-1 text-xs font-medium text-slate-500 dark:text-muted-foreground hover:bg-transparent hover:text-slate-900 dark:hover:text-foreground"
          onClick={() => setLocation("/accounts")}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Accounts
        </Button>

        {/* Account Overview Card */}
        <section className="bg-white dark:bg-card border border-slate-200/90 dark:border-border border-t-2 border-t-[#C6A15B]/80 rounded-lg p-5 sm:p-7 shadow-xs">
          <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-5 sm:gap-8">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">{account.accountType}</p>
              <h1 className="break-words font-serif text-2xl sm:text-3xl font-semibold leading-tight text-slate-900 dark:text-foreground">
                {accountLabel(account)}
              </h1>
              <p className="mt-1.5 font-mono text-xs tracking-wide text-slate-500 dark:text-muted-foreground">{maskAccountNumber(account.accountNumber)}</p>
              <Button ref={detailsTriggerRef} type="button" variant="outline" size="sm" className="mt-4 w-fit rounded-md border-slate-200 dark:border-border text-xs"
                aria-haspopup="dialog" aria-controls="account-details-dialog" onClick={() => setDetailsOpen(true)}>
                Account details
              </Button>
            </div>
            <div className="min-w-0 [container-type:inline-size] pt-4 border-t border-slate-100 dark:border-border sm:border-t-0 sm:border-l sm:border-slate-200/80 sm:pl-6 sm:pt-0 sm:text-right" data-testid="account-detail-balance">
              {balanceError ? (
                <div role="alert" className="text-sm text-destructive">Balance details are unavailable.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex min-w-0 flex-col sm:items-end gap-1">
                    <p className="text-xs font-medium text-slate-500 dark:text-muted-foreground">Balance</p>
                    <p data-testid="text-account-cash-balance"
                      style={{ fontSize: `clamp(16px, ${Math.min(11.5, 170 / displayBalance.length)}cqi, 26px)` }}
                      className={cn("max-w-full whitespace-nowrap font-sans font-semibold leading-tight tracking-tight tabular-nums", accountBalance < 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-900 dark:text-foreground")}>
                      {displayBalance}
                    </p>
                  </div>
                  {feeSummary.isLoading ? (
                    <div role="status" aria-label="Loading unpaid fees" className="flex items-center justify-between gap-4 border-t border-slate-100 dark:border-border/70 pt-3">
                      <p className="text-xs text-slate-500 dark:text-muted-foreground">Unpaid fees</p>
                      <Skeleton className="h-4 w-20" />
                    </div>
                  ) : feeSummary.isError ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-border/70 pt-3 text-xs">
                      <span className="text-slate-500 dark:text-muted-foreground">Unpaid fee details are unavailable.</span>
                      <button type="button" className="underline underline-offset-4" onClick={() => void feeSummary.refetch()}>Retry</button>
                    </div>
                  ) : unpaidFees > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-slate-100 dark:border-border/70 pt-3">
                      <p className="text-xs text-slate-500 dark:text-muted-foreground">Unpaid fees</p>
                      <p className="whitespace-nowrap font-sans text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300" data-testid="text-total-fee-debt">{money(unpaidFees)}</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>

        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent id="account-details-dialog" className="w-[calc(100%-2rem)] max-h-[min(85dvh,38rem)] overflow-y-auto sm:max-w-md border-slate-200 dark:border-border bg-white dark:bg-card"
            onCloseAutoFocus={event => {
              event.preventDefault();
              detailsTriggerRef.current?.focus();
            }}>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Account details</DialogTitle>
              <DialogDescription className="text-xs">
                Recorded account information. The application account number identifies this account within Veritas Wealth; it is not an external payment instruction.
              </DialogDescription>
            </DialogHeader>
            <div className="divide-y divide-slate-100 dark:divide-border text-sm">
              {[
                ["Application account number", account.accountNumber || "Account number unavailable"],
                ["Account name", accountLabel(account)],
                ["Account type", account.accountType],
                ["Account holder", user?.name || "—"],
                ...(account.createdAt && Number.isFinite(new Date(account.createdAt).getTime())
                  ? [["Opened", transactionDate(account.createdAt)]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:justify-between sm:gap-4">
                  <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">{label}</span>
                  <span className={cn("break-words text-sm font-medium sm:text-right", label === "Application account number" && "font-mono")}>{value}</span>
                </div>
              ))}
            </div>
            <Button onClick={() => setDetailsOpen(false)} className="w-full bg-[#0B2218] hover:bg-[#133526] text-white rounded-md">Close</Button>
          </DialogContent>
        </Dialog>

        {/* Transaction History */}
        <Card className="min-w-0 overflow-hidden border border-slate-200/90 dark:border-border bg-white dark:bg-card rounded-lg shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 dark:border-border bg-slate-50/70 dark:bg-muted/20 px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-sans text-sm font-semibold text-slate-900 dark:text-foreground">Transaction history</h2>
              <CardDescription className="mt-0.5 text-xs">Recorded activity for this account</CardDescription>
            </div>
            <Button data-testid="button-export-statement" aria-label="Export" title="Export statement" variant="outline" size="sm" className="h-9 w-9 shrink-0 rounded-md border-slate-200 dark:border-border p-0 sm:h-9 sm:w-auto sm:gap-2 sm:px-3" disabled={transactionsLoading || transactionsError} onClick={() => exportStatement(account, transactions || [], currency)}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline text-xs">Export CSV</span>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[min(65vh,720px)] overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-border/50" aria-label="Scrollable account transaction history">
              {transactionsLoading ? (
                <div role="status" className="space-y-3 p-5">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : transactionsError ? (
                <div role="alert" className="p-5 text-sm text-rose-700">
                  Transaction history could not be loaded.
                  <button data-testid="button-retry-transactions" className="ml-2 underline" onClick={() => void refetchTransactions()}>Retry</button>
                </div>
              ) : transactions && transactions.length > 0 ? (
                transactions.map((transaction) => {
                  const isIncoming = transaction.toAccountId === accountId;
                  return (
                    <div
                      key={transaction.id}
                      data-testid={`account-txn-row-${transaction.id}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      className="group grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-slate-50/80 dark:hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:gap-x-6"
                      onClick={() => setSelectedTxn(transaction)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTxn(transaction);
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium leading-snug text-slate-900 dark:text-foreground transition-colors group-hover:text-[#0B2218] dark:group-hover:text-primary">{transactionDescription(transaction.description,currency,transaction.transactionType)}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                          <span className="font-mono">{transactionDate(transaction.createdAt)}</span>
                          <span className="px-1.5" aria-hidden="true">·</span>
                          <span className={cn("font-semibold capitalize", transaction.status === "pending" ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-muted-foreground")}>
                            {transaction.status}
                          </span>
                        </p>
                      </div>
                      <TransactionAmountBalance
                        amount={`${isIncoming ? "+" : "−"}${money(transaction.amount)}`}
                        currency={currency}
                        postings={(transaction.cashPostings as CashPosting[] | undefined)?.filter(posting => posting.accountId === accountId) || []}
                        amountClassName={cn("text-sm font-semibold", transaction.status === 'pending' ? 'text-amber-700 dark:text-amber-300' : (isIncoming ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-foreground'))}
                        showAccountNames={false}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-slate-500 dark:text-muted-foreground">No transactions yet</p>
                </div>
              )}
            </div>

            <Dialog open={!!selectedTxn} onOpenChange={(open) => !open && setSelectedTxn(null)}>
              <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md border-slate-200 dark:border-border bg-white dark:bg-card">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 font-serif text-xl">
                    <Info className="w-4 h-4 text-[#0B2218] dark:text-primary" />
                    Transaction Details
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Review the recorded transaction details.
                  </DialogDescription>
                </DialogHeader>
                <div className="min-w-0 divide-y divide-slate-100 dark:divide-border py-2">
                  <div className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">Description</span>
                    <span className="break-words text-sm font-medium sm:text-right">{transactionDescription(selectedTxn?.description,currency,selectedTxn?.transactionType)}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">Amount</span>
                    <span className={cn("whitespace-nowrap font-sans text-base font-semibold tabular-nums sm:text-right", selectedTxn?.status === 'pending' ? "text-amber-700 dark:text-amber-300" : (selectedTxn?.toAccountId === accountId ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-foreground"))}>
                      {selectedTxn && `${selectedTxn.toAccountId === accountId ? "+" : "−"}${money(selectedTxn.amount)}`}
                    </span>
                  </div>
                  {(selectedTxn?.cashPostings as CashPosting[] | undefined)?.filter(posting => posting.accountId === accountId).map(posting => (
                    <div key={posting.accountId} className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">Balance after transaction</span>
                      <span className="font-sans text-sm font-semibold tabular-nums sm:text-right">{money(posting.balanceAfter)}</span>
                    </div>
                  ))}
                  <div className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">Status</span>
                    <span className={cn("text-xs font-semibold capitalize", selectedTxn?.status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
                      {selectedTxn?.status}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">Date</span>
                    <span className="font-mono text-xs sm:text-right">{selectedTxn?.createdAt && transactionDate(selectedTxn.createdAt,true)}</span>
                  </div>
                  {selectedTxn?.status === 'pending' && (
                    <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                      <p className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-300">Security Notice</p>
                      <p className="text-xs leading-relaxed text-amber-800/85 dark:text-amber-200/80">
                        This transaction is currently undergoing institutional verification and will remain pending until settlement.
                      </p>
                    </div>
                  )}
                </div>
                <Button onClick={() => setSelectedTxn(null)} className="w-full bg-[#0B2218] hover:bg-[#133526] text-white rounded-md">
                  Close
                </Button>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <section className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-lg p-5 sm:p-6 shadow-xs" aria-labelledby="account-services-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="account-services-heading" className="text-sm font-semibold text-slate-900 dark:text-foreground">Account services</h2>
              <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">Fee arrangements and available account services.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={servicesOpen}
              aria-controls="account-services-content"
              onClick={() => setServicesOpen((open) => !open)}
              className="w-full justify-between sm:w-auto rounded-md border-slate-200 dark:border-border text-xs"
            >
              {servicesOpen ? "Hide account services" : "Account services"}
              <ChevronDown className={cn("ml-2 h-3.5 w-3.5 transition-transform", servicesOpen && "rotate-180")} />
            </Button>
          </div>
          <div id="account-services-content" hidden={!servicesOpen} className="mt-5 min-w-0">
            {servicesOpen && <ClientFees accountId={accountId} cashBalance={account.balance} />}
          </div>
        </section>
      </div>
    </LayoutShell>
  );
}
