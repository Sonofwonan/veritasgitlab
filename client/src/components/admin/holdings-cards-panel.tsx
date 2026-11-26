import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CardKind, CardNetwork, CardStatus, ClientCardRecord } from "@shared/client-controls";
import { formatBalance } from "@shared/balance-currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, StatusLabel } from "./admin-status";
import { CreditCard, Plus, Trash2, TrendingUp } from "lucide-react";

type AdminHolding = {
  id: number;
  accountId: number;
  symbol: string;
  shares: string;
  purchasePrice: string;
  currentPrice: string;
  accountLabel: string;
  userId: number;
  userName: string;
  userEmail: string;
  userClientRef: string | null;
};

export function HoldingsAndCardsPanel({
  adminKey,
  allUsers,
  onOpenClient,
}: {
  adminKey: string;
  allUsers: any[];
  onOpenClient: (userId: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<"cards" | "holdings">("cards");
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  const [cardUserId, setCardUserId] = useState<string>("");
  const [cardKind, setCardKind] = useState<CardKind>("virtual");
  const [cardLabel, setCardLabel] = useState("");
  const [cardNetwork, setCardNetwork] = useState<CardNetwork>("Visa");
  const [cardDailyLimit, setCardDailyLimit] = useState("15000");

  const cardsQuery = useQuery<ClientCardRecord[]>({
    queryKey: ["/api/admin/cards"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/cards", adminKey);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const holdingsQuery = useQuery<AdminHolding[]>({
    queryKey: ["/api/admin/investments"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/investments", adminKey);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const issueCardMutation = useMutation({
    mutationFn: async () => {
      const uid = Number(cardUserId);
      const res = await adminFetch(`/api/admin/users/${uid}/cards`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          cardKind,
          label: cardLabel.trim(),
          network: cardNetwork,
          dailyLimit: Number(cardDailyLimit || 10000),
          status: "active",
          fraudProtection: true,
          onlinePayments: true,
          internationalSpend: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to issue card");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cards"] });
      setIssueDialogOpen(false);
      setCardLabel("");
      toast({ title: "Card issued", description: "Card is now visible in the client portal." });
    },
    onError: (err: any) => {
      toast({ title: "Issuance failed", description: err.message, variant: "destructive" });
    },
  });

  const updateCardMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, any> }) => {
      const res = await adminFetch(`/api/admin/cards/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to update card");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cards"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/cards/${id}`, adminKey, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke card");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cards"] });
      toast({ title: "Card revoked" });
    },
  });

  const deleteHoldingMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminFetch(`/api/admin/investments/${id}`, adminKey, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove holding");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/investments"] });
      toast({ title: "Holding removed" });
    },
  });

  const cards = cardsQuery.data ?? [];
  const holdings = holdingsQuery.data ?? [];

  return (
    <div className="space-y-5" data-testid="admin-holdings-cards-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0E1623] px-5 py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("cards")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-colors ${
              subTab === "cards"
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white border border-transparent"
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Wealth Cards ({cards.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("holdings")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-colors ${
              subTab === "holdings"
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white border border-transparent"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Investment Holdings ({holdings.length})
          </button>
        </div>

        {subTab === "cards" && (
          <Button
            size="sm"
            onClick={() => {
              if (!cardUserId && allUsers.length > 0) setCardUserId(String(allUsers[0].id));
              setIssueDialogOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Issue Card to Client
          </Button>
        )}
      </div>

      {subTab === "cards" ? (
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/70 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Card &amp; Client</th>
                  <th className="py-3 px-4 font-medium">Type / Network</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Daily Limit</th>
                  <th className="py-3 px-4 font-medium">Controls (Fraud / Online / Intl)</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      No wealth cards issued yet. Use "Issue Card to Client" or open a client profile.
                    </td>
                  </tr>
                ) : (
                  cards.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-900/30">
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">
                          {c.label} <span className="font-mono text-slate-400">••{c.last4}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenClient(c.userId)}
                          className="text-[11px] text-emerald-400 hover:underline mt-0.5"
                        >
                          {c.userName || `Client #${c.userId}`}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-300 capitalize">
                        {c.cardKind.replace("_", " ")} · {c.network}
                        <div className="font-mono text-[11px] text-slate-500">Exp {c.expiry}</div>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={c.status}
                          onChange={(e) =>
                            updateCardMutation.mutate({ id: c.id, patch: { status: e.target.value as CardStatus } })
                          }
                          className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-white"
                        >
                          <option value="active">Active</option>
                          <option value="locked">Locked</option>
                          <option value="frozen">Frozen</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-white">
                        ${Number(c.dailyLimit || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Switch
                              checked={c.fraudProtection}
                              onCheckedChange={(v) =>
                                updateCardMutation.mutate({ id: c.id, patch: { fraudProtection: v } })
                              }
                            />
                            Fraud
                          </label>
                          <label className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Switch
                              checked={c.onlinePayments}
                              onCheckedChange={(v) =>
                                updateCardMutation.mutate({ id: c.id, patch: { onlinePayments: v } })
                              }
                            />
                            Web
                          </label>
                          <label className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Switch
                              checked={c.internationalSpend}
                              onCheckedChange={(v) =>
                                updateCardMutation.mutate({ id: c.id, patch: { internationalSpend: v } })
                              }
                            />
                            Intl
                          </label>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                          onClick={() => deleteCardMutation.mutate(c.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-[#0E1623] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/70 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Symbol</th>
                  <th className="py-3 px-4 font-medium">Client &amp; Account</th>
                  <th className="py-3 px-4 font-medium text-right">Shares</th>
                  <th className="py-3 px-4 font-medium text-right">Cost Basis</th>
                  <th className="py-3 px-4 font-medium text-right">Stored Price</th>
                  <th className="py-3 px-4 font-medium text-right">Position Value</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No investment holdings recorded across client accounts. Open any client profile to add positions.
                    </td>
                  </tr>
                ) : (
                  holdings.map((h) => {
                    const value = Number(h.shares) * Number(h.currentPrice || h.purchasePrice);
                    return (
                      <tr key={h.id} className="hover:bg-slate-900/30">
                        <td className="py-3 px-4 font-mono font-semibold text-white">{h.symbol}</td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => onOpenClient(h.userId)}
                            className="font-medium text-emerald-400 hover:underline"
                          >
                            {h.userName}
                          </button>
                          <div className="text-[11px] text-slate-400">{h.accountLabel}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                          {Number(h.shares).toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-400">
                          {formatBalance(h.purchasePrice, "CAD")}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                          {formatBalance(h.currentPrice, "CAD")}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-300">
                          {formatBalance(value, "CAD")}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                            onClick={() => deleteHoldingMutation.mutate(h.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
        <DialogContent className="bg-[#0E1623] border-slate-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Issue Wealth Card</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Client</label>
              <select
                value={cardUserId}
                onChange={(e) => setCardUserId(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-white"
              >
                {allUsers.map((u: any) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name} ({u.clientRef || `#${u.id}`})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Card Label</label>
              <Input
                value={cardLabel}
                onChange={(e) => setCardLabel(e.target.value)}
                placeholder="e.g. Private Metal Black"
                className="bg-slate-900 border-slate-700 text-white h-9"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Type</label>
                <select
                  value={cardKind}
                  onChange={(e) => setCardKind(e.target.value as CardKind)}
                  className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-white"
                >
                  <option value="physical">Physical</option>
                  <option value="virtual">Virtual</option>
                  <option value="one_time">One-Time</option>
                  <option value="business_platinum">Platinum</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Network</label>
                <select
                  value={cardNetwork}
                  onChange={(e) => setCardNetwork(e.target.value as CardNetwork)}
                  className="w-full h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-white"
                >
                  <option value="Visa">Visa</option>
                  <option value="Mastercard">Mastercard</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Daily Limit</label>
                <Input
                  type="number"
                  value={cardDailyLimit}
                  onChange={(e) => setCardDailyLimit(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white h-9 font-mono"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIssueDialogOpen(false)} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!cardUserId || !cardLabel.trim() || issueCardMutation.isPending}
              onClick={() => issueCardMutation.mutate()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {issueCardMutation.isPending ? "Issuing…" : "Issue Card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
