import React, { useCallback, useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, PencilSimple, Trash, Calendar, Copy, WhatsappLogo, X, LinkSimple, ChartBar, ArrowClockwise } from "@phosphor-icons/react";
import { copyToClipboard } from "@/lib/clipboard";

const EMPTY = {
  name: "", devanagari: "", expertise: "", price: "1500", years: 10, picture: "",
  email: "", commission_pct: 10, bio: "",
};

export default function AdminAstrologers() {
  const [astros, setAstros] = useState([]);
  const [bookings, setBookings] = useState({});
  const [affiliates, setAffiliates] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [welcomeModal, setWelcomeModal] = useState(null); // { name, email, url }

  const refresh = useCallback(async () => {
    const { data } = await api.get("/admin/astrologers");
    setAstros(data);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const loadBookings = async (astro_id) => {
    if (bookings[astro_id]) { setBookings({ ...bookings, [astro_id]: null }); return; }
    const { data } = await api.get(`/admin/consultations?astrologer_id=${astro_id}`);
    setBookings({ ...bookings, [astro_id]: data });
  };
  const loadAffiliate = async (astro_id) => {
    if (affiliates[astro_id]) { setAffiliates({ ...affiliates, [astro_id]: null }); return; }
    const { data } = await api.get(`/admin/astrologers/${astro_id}/affiliate`);
    setAffiliates({ ...affiliates, [astro_id]: data });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const rupees = Number(form.price);
      const payload = {
        ...form,
        price: Math.max(0, Math.round(rupees * 100)),
        years: parseInt(form.years) || 0,
        commission_pct: Math.max(0, Math.min(100, parseFloat(form.commission_pct) || 0)),
        expertise: form.expertise.split(",").map((s) => s.trim()).filter(Boolean),
        email: form.email?.trim() || null,
      };
      if (editing === "new") {
        const { data } = await api.post("/admin/astrologers", payload);
        toast.success("Astrologer added");
        setEditing(null);
        refresh();
        if (data.welcome_url) {
          setWelcomeModal({ name: data.name, email: data.email, url: data.welcome_url, isNew: true });
        }
      } else {
        await api.patch(`/admin/astrologers/${editing.astrologer_id}`, payload);
        toast.success("Saved");
        setEditing(null);
        refresh();
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Deactivate ${a.name}?`)) return;
    await api.delete(`/admin/astrologers/${a.astrologer_id}`);
    toast.success("Deactivated"); refresh();
  };

  const regenWelcome = async (a) => {
    try {
      const { data } = await api.post(`/admin/astrologers/${a.astrologer_id}/welcome-link`);
      setWelcomeModal({ name: a.name, email: data.email, url: data.welcome_url, isNew: false });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const startEdit = (a) => {
    setEditing(a);
    setForm({
      ...EMPTY,
      ...a,
      price: a.price != null ? (a.price / 100).toString() : "1500",
      commission_pct: a.commission_pct ?? 10,
      expertise: (a.expertise || []).join(", "),
      email: a.email || "",
    });
  };
  const startNew = () => { setEditing("new"); setForm(EMPTY); };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Guidance</div>
          <h1 className="font-display text-4xl text-ink mt-1">Astrologers</h1>
          <p className="text-sm text-ink-muted mt-1">Add astrologers, set commission %, share welcome links.</p>
        </div>
        <button onClick={startNew} data-testid="admin-astro-new" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift">
          <PlusCircle size={14} weight="duotone" /> Add astrologer
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">{editing === "new" ? "New astrologer" : `Edit · ${editing.name}`}</div>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Name *</div>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="astro-name" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Login email {editing === "new" && "(welcome link will be generated)"}</div>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="astro-email" placeholder="ravi@example.com" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Devanagari</div>
            <input value={form.devanagari} onChange={(e) => setForm({ ...form, devanagari: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-deva" /></label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Expertise (comma-separated)</div>
            <input value={form.expertise} onChange={(e) => setForm({ ...form, expertise: e.target.value })} placeholder="Vedic, Gemstone, Numerology" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Session price (₹)</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-2 bg-cream border-r border-gold/30 text-ink-soft">₹</span>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="astro-price" className="flex-1 px-3 py-2 outline-none" />
            </div>
          </label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Commission % (affiliate)</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <input type="number" min="0" max="100" step="0.5" value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} data-testid="astro-commission" className="flex-1 px-3 py-2 outline-none" />
              <span className="px-3 py-2 bg-cream border-l border-gold/30 text-ink-soft">%</span>
            </div>
            <div className="text-[10px] text-ink-muted mt-1">Cut this astrologer earns on the pre-tax subtotal of purchases made via their link.</div>
          </label>
          <label className="block"><div className="text-xs text-ink-muted mb-1">Years of experience</div>
            <input type="number" min="0" value={form.years} onChange={(e) => setForm({ ...form, years: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <label className="block md:col-span-2"><div className="text-xs text-ink-muted mb-1">Picture URL</div>
            <input value={form.picture} onChange={(e) => setForm({ ...form, picture: e.target.value })} placeholder="https://…" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <label className="block md:col-span-2"><div className="text-xs text-ink-muted mb-1">Short bio</div>
            <textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" /></label>
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" data-testid="astro-save" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="border border-gold/40 px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {astros.map((a) => (
          <div key={a.astrologer_id} data-testid={`astro-card-${a.astrologer_id}`} className={`gold-line bg-ivory p-4 ${a.is_active === false ? "opacity-60" : ""}`}>
            <div className="flex gap-4">
              {a.picture ? <div className="w-20 h-20 gold-line overflow-hidden shrink-0"><img src={a.picture} alt="" className="w-full h-full object-cover" /></div> : <div className="w-20 h-20 gold-line bg-cream" />}
              <div className="flex-1 min-w-0">
                <div className="font-deva text-gold-soft text-sm">{a.devanagari}</div>
                <div className="font-serifd text-lg truncate">{a.name}</div>
                <div className="text-xs text-ink-muted">{a.years} yrs · {(a.expertise || []).join(", ")}</div>
                <div className="flex items-baseline gap-3 mt-1">
                  <div className="text-maroon-deep font-display text-lg">{formatINR(a.price)}</div>
                  <div className="text-[11px] uppercase tracking-widest text-gold-soft">{a.commission_pct ?? 0}% commission</div>
                </div>
                {a.email && <div className="text-[11px] text-ink-muted mt-1 font-mono">{a.email}</div>}
                {a.affiliate_code && (
                  <div className="text-[10px] text-ink-muted mt-1 font-mono inline-flex items-center gap-1">
                    <LinkSimple size={11} /> /?ref={a.affiliate_code}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-xs flex-wrap">
              <button onClick={() => startEdit(a)} data-testid={`astro-edit-${a.astrologer_id}`} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
              <button onClick={() => loadBookings(a.astrologer_id)} className="text-ink-soft inline-flex items-center gap-1"><Calendar size={12} /> {bookings[a.astrologer_id] ? "Hide" : "Bookings"}</button>
              <button onClick={() => loadAffiliate(a.astrologer_id)} data-testid={`astro-affiliate-${a.astrologer_id}`} className="text-ink-soft inline-flex items-center gap-1"><ChartBar size={12} /> {affiliates[a.astrologer_id] ? "Hide" : "Affiliate"}</button>
              {a.email && <button onClick={() => regenWelcome(a)} data-testid={`astro-welcome-${a.astrologer_id}`} className="text-ink-soft inline-flex items-center gap-1"><ArrowClockwise size={12} /> Welcome link</button>}
              <button onClick={() => remove(a)} className="text-revoked inline-flex items-center gap-1 ml-auto"><Trash size={12} /> Remove</button>
            </div>
            {bookings[a.astrologer_id] && (
              <div className="mt-3 border-t border-gold/20 pt-3 space-y-2 max-h-56 overflow-y-auto">
                {bookings[a.astrologer_id].length === 0 ? <div className="text-xs text-ink-muted">No bookings.</div> : bookings[a.astrologer_id].map((b) => (
                  <div key={b.booking_id} className="text-xs">
                    <div className="font-mono text-ink-muted">{new Date(b.slot_iso).toLocaleString()}</div>
                    <div>{b.name} · {b.phone} · <span className="uppercase tracking-widest text-[10px]">{b.status}</span></div>
                  </div>
                ))}
              </div>
            )}
            {affiliates[a.astrologer_id] && (
              <div className="mt-3 border-t border-gold/20 pt-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Clicks", affiliates[a.astrologer_id].summary.visits],
                    ["Orders", affiliates[a.astrologer_id].summary.orders],
                    ["Total", formatINR(affiliates[a.astrologer_id].summary.total_commission)],
                    ["Pending", formatINR(affiliates[a.astrologer_id].summary.pending_commission)],
                  ].map(([l, v]) => (
                    <div key={l} className="bg-cream border border-gold/30 p-2">
                      <div className="text-[9px] uppercase tracking-widest text-gold-soft">{l}</div>
                      <div className="text-sm text-ink mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>
                {affiliates[a.astrologer_id].commissions.length > 0 && (
                  <div className="mt-3 max-h-40 overflow-y-auto text-xs divide-y divide-gold/20">
                    {affiliates[a.astrologer_id].commissions.map((c) => (
                      <div key={c.commission_id} className="py-1.5 flex justify-between items-baseline">
                        <span className="font-mono text-ink-muted">{new Date(c.created_at).toLocaleDateString()} · {c.order_id}</span>
                        <span className="font-display text-maroon-deep">{formatINR(c.commission_amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {welcomeModal && <WelcomeLinkModal m={welcomeModal} onClose={() => setWelcomeModal(null)} />}
    </div>
  );
}

function WelcomeLinkModal({ m, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareWA = () => {
    const t = `Hello ${m.name},\n\nYou've been added as an astrologer on Tredev. Please set your password and access your dashboard here:\n\n${m.url}\n\nWelcome aboard!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, "_blank");
  };
  const copy = async () => {
    const ok = await copyToClipboard(m.url);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    else { window.prompt("Copy this link:", m.url); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" data-testid="welcome-link-modal">
      <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-ivory gold-line-strong w-full max-w-lg p-6">
        <button onClick={onClose} className="absolute top-3 right-3 text-ink-muted hover:text-maroon"><X size={18} /></button>
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">{m.isNew ? "Astrologer added" : "Fresh welcome link"}</div>
        <div className="font-display text-2xl text-maroon-deep mt-1">Send this to {m.name}</div>
        <div className="text-sm text-ink-muted mt-1">Email: <span className="font-mono">{m.email}</span></div>
        <div className="mt-4 gold-line bg-cream px-3 py-3 font-mono text-xs break-all">{m.url}</div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={copy} data-testid="welcome-copy" className="brand-gradient text-ivory px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2">
            <Copy size={13} /> {copied ? "Copied ✓" : "Copy link"}
          </button>
          <button onClick={shareWA} className="border border-verified text-verified hover:bg-verified hover:text-ivory px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2">
            <WhatsappLogo size={13} weight="fill" /> Share on WhatsApp
          </button>
          <a href={`mailto:${m.email}?subject=${encodeURIComponent("Welcome to Tredev — set your password")}&body=${encodeURIComponent(`Hello ${m.name},\n\nYou've been added as an astrologer on Tredev. Please set your password here:\n\n${m.url}\n\nWelcome aboard!`)}`}
            className="border border-maroon text-maroon hover:bg-maroon hover:text-ivory px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2">
            Email
          </a>
        </div>
        <div className="mt-4 text-[11px] text-ink-muted">
          This link is valid for 7 days. You can regenerate it any time from the astrologer card.
        </div>
      </div>
    </div>
  );
}
