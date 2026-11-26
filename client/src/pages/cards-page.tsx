import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccounts } from "@/hooks/use-finances";
import { useAuth } from "@/hooks/use-auth";
import { useClientControls } from "@/hooks/use-client-controls";
import { LayoutShell } from "@/components/layout-shell";
import { MetallicCard } from "@/components/metallic-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { accountLabel } from "@shared/account-display";
import { clientBalanceCurrency, formatBalance } from "@shared/balance-currency";
import type { ClientCardRecord } from "@shared/client-controls";
import { CreditCard, Shield, Lock, Unlock, Globe, ShoppingBag, Plus } from "lucide-react";

export default function CardsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const { features, platform } = useClientControls();
  const currency = clientBalanceCurrency(user);

  const [newCardLabel, setNewCardLabel] = useState("");
  const [newCardKind, setNewCardKind] = useState<"virtual" | "one_time" | "business_platinum">("virtual");
  const [newCardAccountId, setNewCardAccountId] = useState<string>("");

  const { data: cards = [], isLoading } = useQuery<ClientCardRecord[]>({
    queryKey: ["/api/cards"],
    enabled: Boolean(user) && features.canAccessCards,
    retry: false,
  });

  const createCardMutation = useMutation({
    mutationFn: async (payload: { label: string; cardKind: "virtual" | "one_time" | "business_platinum"; accountId: number | null }) => {
      const res = await apiRequest("POST", "/api/cards", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cards"] });
      setNewCardLabel("");
      toast({ title: "Card issued", description: "Your new card is ready for immediate use." });
    },
    onError: (err: any) => {
      toast({ title: "Unable to issue card", description: err.message, variant: "destructive" });
    },
  });

  const updateCardMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number;
      patch: { status?: "active" | "locked"; fraudProtection?: boolean; onlinePayments?: boolean; internationalSpend?: boolean };
    }) => {
      const res = await apiRequest("PATCH", `/api/cards/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cards"] });
    },
    onError: (err: any) => {
      toast({ title: "Unable to update card", description: err.message, variant: "destructive" });
    },
  });

  if (!features.canAccessCards) {
    return (
      <LayoutShell>
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl p-8 max-w-xl" data-testid="cards-disabled-notice">
          <CreditCard className="w-6 h-6 text-slate-400 mb-3" />
          <h1 className="font-serif text-2xl font-semibold">Cards Unavailable</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Wealth card services are currently disabled on your profile. Contact your private advisor at{" "}
            <span className="underline">{platform.advisorEmail}</span> to enable card access.
          </p>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="space-y-6" data-testid="cards-page">
        <div>
          <h1 className="font-serif text-[28px] sm:text-[32px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
            Wealth Cards
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
            Manage physical, virtual, and single-use custodial cards issued to your portfolio
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Issued Cards ({cards.length})
            </h2>

            {isLoading ? (
              <div className="border border-border rounded-lg p-6 text-sm text-muted-foreground bg-white dark:bg-card">
                Loading your issued cards…
              </div>
            ) : cards.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-6 text-sm text-muted-foreground bg-white dark:bg-card">
                No cards have been issued yet. {features.canRequestNewCards ? "Generate a virtual or one-time card using the issuance panel." : "Contact your advisor to request card issuance."}
              </div>
            ) : (
              <div className="space-y-4">
                {cards.map((card) => {
                  const locked = card.status === "locked";
                  const adminLocked = card.status === "frozen" || card.status === "cancelled";
                  return (
                    <Card key={card.id} className="border-slate-200/90 dark:border-border bg-white dark:bg-card overflow-hidden">
                      <CardContent className="p-5 space-y-5">
                        <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)] items-start">
                          <div className="max-w-[260px]">
                            <MetallicCard
                              userName={user?.name || "Veritas Client"}
                              accountType={card.label}
                              accountNumber={`•••• •••• •••• ${card.last4}`}
                            />
                          </div>
                          <div className="space-y-4 min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-semibold text-foreground">{card.label}</span>
                                  <span className="text-xs font-mono-nums text-muted-foreground">
                                    {card.network} ·••{card.last4}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                                  {card.cardKind.replace("_", " ")} · Expires {card.expiry}
                                  {card.accountLabel ? ` · Linked to ${card.accountLabel}` : ""}
                                </p>
                              </div>
                              <span
                                className={`text-xs font-semibold uppercase tracking-wide ${
                                  card.status === "active"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : card.status === "locked"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {card.status}
                              </span>
                            </div>

                            <div className="text-xs text-muted-foreground flex items-center justify-between border-y border-border/60 py-2">
                              <span>Daily spend limit</span>
                              <span className="font-mono-nums font-medium text-foreground">
                                {formatBalance(Number(card.dailyLimit || 0), currency)}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Shield className="w-3.5 h-3.5" /> Fraud Protection
                                </span>
                                <Switch
                                  checked={card.fraudProtection}
                                  disabled={!features.canManageOwnCards || adminLocked || updateCardMutation.isPending}
                                  onCheckedChange={(val) =>
                                    updateCardMutation.mutate({ id: card.id, patch: { fraudProtection: val } })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <ShoppingBag className="w-3.5 h-3.5" /> Online Spend
                                </span>
                                <Switch
                                  checked={card.onlinePayments}
                                  disabled={!features.canManageOwnCards || adminLocked || updateCardMutation.isPending}
                                  onCheckedChange={(val) =>
                                    updateCardMutation.mutate({ id: card.id, patch: { onlinePayments: val } })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Globe className="w-3.5 h-3.5" /> International
                                </span>
                                <Switch
                                  checked={card.internationalSpend}
                                  disabled={!features.canManageOwnCards || adminLocked || updateCardMutation.isPending}
                                  onCheckedChange={(val) =>
                                    updateCardMutation.mutate({ id: card.id, patch: { internationalSpend: val } })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-end">
                                {!adminLocked ? (
                                  <Button
                                    size="sm"
                                    variant={locked ? "default" : "outline"}
                                    disabled={!features.canManageOwnCards || updateCardMutation.isPending}
                                    onClick={() =>
                                      updateCardMutation.mutate({
                                        id: card.id,
                                        patch: { status: locked ? "active" : "locked" },
                                      })
                                    }
                                    className="h-8 text-xs gap-1.5"
                                  >
                                    {locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                    {locked ? "Unlock Card" : "Instant Lock"}
                                  </Button>
                                ) : (
                                  <span className="text-[11px] text-rose-500">Advisor control active</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              Issue Virtual Card
            </h2>
            <Card className="border-slate-200/90 dark:border-border bg-white dark:bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Generate Card</CardTitle>
                <CardDescription className="text-xs">
                  Create a dedicated virtual, single-use, or corporate platinum card linked to one of your accounts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!features.canRequestNewCards ? (
                  <p className="text-xs text-muted-foreground border border-border rounded-md p-3">
                    Self-service card issuance is disabled by your administrator. Contact {platform.advisorEmail} to request a new card.
                  </p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Card Label</label>
                      <Input
                        placeholder="e.g. Executive Travel Virtual"
                        value={newCardLabel}
                        onChange={(e) => setNewCardLabel(e.target.value)}
                        data-testid="input-new-card-label"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Card Type</label>
                      <select
                        value={newCardKind}
                        onChange={(e) => setNewCardKind(e.target.value as any)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="virtual">Virtual Wealth Card</option>
                        <option value="one_time">Virtual One-Time Card</option>
                        <option value="business_platinum">Business Platinum</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Linked Account (Optional)</label>
                      <select
                        value={newCardAccountId}
                        onChange={(e) => setNewCardAccountId(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Portfolio Default</option>
                        {(accounts ?? []).map((acc) => (
                          <option key={acc.id} value={String(acc.id)}>
                            {accountLabel(acc)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      className="w-full"
                      data-funds-action=""
                      disabled={!newCardLabel.trim() || createCardMutation.isPending}
                      onClick={() =>
                        createCardMutation.mutate({
                          label: newCardLabel.trim(),
                          cardKind: newCardKind,
                          accountId: newCardAccountId ? Number(newCardAccountId) : null,
                        })
                      }
                    >
                      {createCardMutation.isPending ? "Generating…" : "Generate Card"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
