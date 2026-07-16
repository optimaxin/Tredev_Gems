import React, { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function AdminBroadcast() {
  const [body, setBody] = useState("");
  const [tmpl, setTmpl] = useState("");
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState(null);

  const send = async () => {
    if (!body.trim()) { toast.error("Enter the broadcast text"); return; }
    setSending(true);
    try {
      const { data } = await api.post("/admin/promo/broadcast", {
        template: tmpl || undefined,
        body_params: [body.trim()],
      });
      setLast(data);
      toast.success(`Broadcast queued · ${data.sent}/${data.eligible_users} sent`);
    } catch (e) { toast.error(e.response?.data?.detail || "Broadcast failed"); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Growth</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">WhatsApp broadcast</h1>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="gold-line bg-ivory p-6">
          <p className="text-sm text-ink-soft">Uses the marketing template configured via <code className="font-mono text-xs">META_WA_PROMO_TEMPLATE</code>. Body variables are the fields you enter below.</p>
          <label className="block mt-5">
            <div className="text-xs text-ink-muted mb-1">Template name (optional override)</div>
            <input value={tmpl} onChange={(e) => setTmpl(e.target.value)} placeholder="gemora_promo" className="w-full gold-line px-4 py-3 outline-none focus:border-maroon font-mono text-sm" />
          </label>
          <label className="block mt-4">
            <div className="text-xs text-ink-muted mb-1">Body — variable {"{{1}}"} (offer text)</div>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Diwali special: 15% off on Yellow Sapphire this week only" className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
          </label>
          <button onClick={send} disabled={sending} className="mt-5 brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest hover-lift disabled:opacity-50">
            {sending ? "Sending…" : "Send broadcast"}
          </button>
          {last && (
            <div className="mt-5 gold-line bg-cream p-4 text-sm">
              <div className="text-xs uppercase tracking-widest text-verified">Last run · {last.provider}</div>
              <div className="mt-1">Eligible: <span className="font-mono">{last.eligible_users}</span> · Sent: <span className="font-mono text-verified">{last.sent}</span> · Failed: <span className="font-mono text-revoked">{last.failed}</span></div>
            </div>
          )}
        </div>
        <aside className="gold-line-strong bg-cream p-5 text-sm text-ink-soft">
          <div className="text-xs uppercase tracking-widest text-gold-soft">Policy</div>
          <p className="mt-2">Only users who opted in on signup or in Account settings receive marketing. Users who reply STOP on WhatsApp are auto opted-out.</p>
          <div className="mt-4 text-xs uppercase tracking-widest text-gold-soft">Provider</div>
          <p className="mt-2 text-xs">Runs in mock mode until <code className="font-mono">META_WA_PHONE_ID</code> and <code className="font-mono">META_WA_ACCESS_TOKEN</code> are set. Then Meta WhatsApp Cloud API takes over automatically.</p>
        </aside>
      </div>
    </div>
  );
}
