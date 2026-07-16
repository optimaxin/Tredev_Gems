import React, { useEffect, useState } from "react";
import { apiAstro } from "@/context/AstroAuthContext";
import { formatINR } from "@/lib/api";
import { toast } from "sonner";
import { LinkSimple, Copy, WhatsappLogo, Coins, Users, ShoppingCart, TrendUp } from "@phosphor-icons/react";
import { copyToClipboard } from "@/lib/clipboard";

const STATUS_STYLES = {
  pending:  "border-suspicious text-suspicious",
  paid:     "border-verified text-verified",
  reversed: "border-revoked text-revoked",
};

export default function AstroAffiliate() {
  const [data, setData] = useState(null);
  useEffect(() => { apiAstro.get("/astrologer/affiliate").then((r) => setData(r.data)).catch(() => {}); }, []);

  const link = data ? `${window.location.origin}/?ref=${data.affiliate_code}` : "";

  const copy = async () => {
    const ok = await copyToClipboard(link);
    if (ok) toast.success("Link copied");
    else window.prompt("Copy this link:", link);
  };
  const shareWA = () => {
    const t = `✨ Get authentic gemstones & rudraksha at Tredev — hand-picked & certified. Use my link:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, "_blank");
  };

  if (!data) return <div className="text-ink-muted">Loading…</div>;
  const s = data.summary;

  return (
    <div>
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Affiliate</div>
        <h1 className="font-display text-4xl text-ink mt-1">Your link & earnings</h1>
        <p className="text-sm text-ink-muted mt-1">Share this personalised link with your clients. When they purchase, you earn {s.commission_pct}% commission on the pre-tax subtotal.</p>
      </div>

      <div className="mt-6 gold-line-strong bg-ivory p-6">
        <div className="flex items-center gap-2 text-gold-soft text-xs uppercase tracking-widest">
          <LinkSimple size={14} weight="duotone" /> Your personal link
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[280px] gold-line bg-cream px-4 py-3 font-mono text-sm break-all" data-testid="affiliate-link">{link}</div>
          <button onClick={copy} data-testid="affiliate-copy" className="brand-gradient text-ivory px-4 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2">
            <Copy size={13} weight="bold" /> Copy
          </button>
          <button onClick={shareWA} data-testid="affiliate-share-whatsapp" className="border border-verified text-verified hover:bg-verified hover:text-ivory px-4 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2">
            <WhatsappLogo size={13} weight="fill" /> Share
          </button>
        </div>
        <div className="mt-2 text-[11px] text-ink-muted">
          Commission rate: <span className="font-mono text-maroon">{s.commission_pct}%</span> · Attribution window: 30 days
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Clicks", s.visits, Users, "aff-kpi-visits"],
          ["Orders", s.orders, ShoppingCart, "aff-kpi-orders"],
          ["Total earned", formatINR(s.total_commission), Coins, "aff-kpi-total"],
          ["Pending payout", formatINR(s.pending_commission), TrendUp, "aff-kpi-pending"],
        ].map(([label, val, Icon, tid]) => (
          <div key={label} data-testid={tid} className="gold-line bg-ivory p-4">
            <div className="flex items-center gap-2 text-gold-soft text-[10px] uppercase tracking-widest">
              <Icon size={12} weight="duotone" /> {label}
            </div>
            <div className="mt-2 font-display text-2xl text-ink">{val}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 gold-line bg-ivory p-6">
        <div className="text-xs uppercase tracking-widest text-maroon-deep mb-4">Purchases via your link</div>
        {data.commissions.length === 0 ? (
          <div className="text-sm text-ink-muted py-6 text-center">No purchases yet. Share your link to start earning.</div>
        ) : (
          <div className="divide-y divide-gold/20">
            {data.commissions.map((c) => (
              <div key={c.commission_id} data-testid={`affiliate-row-${c.commission_id}`} className="py-3 flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-mono text-xs text-ink-muted">{new Date(c.created_at).toLocaleString()}</div>
                  <div className="text-sm text-ink mt-0.5">Order {c.order_id} · subtotal {formatINR(c.order_subtotal)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border ${STATUS_STYLES[c.status] || ""}`}>{c.status}</span>
                  <span className="font-display text-lg text-maroon-deep">{formatINR(c.commission_amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
