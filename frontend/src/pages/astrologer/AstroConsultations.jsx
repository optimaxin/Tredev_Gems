import React, { useCallback, useEffect, useState } from "react";
import { apiAstro } from "@/context/AstroAuthContext";
import { formatINR } from "@/lib/api";
import { toast } from "sonner";
import { VideoCamera, Note, CheckCircle, XCircle, Phone, EnvelopeSimple } from "@phosphor-icons/react";

const STATUS_STYLES = {
  requested:  "border-suspicious text-suspicious",
  confirmed:  "border-gold-soft text-gold",
  completed:  "border-verified text-verified",
  cancelled:  "border-ink-muted text-ink-muted",
};

export default function AstroConsultations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiAstro.get("/astrologer/consultations");
      setItems(data);
    } catch (e) { toast.error("Failed to load consultations"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (id, patch) => {
    try {
      await apiAstro.patch(`/astrologer/consultations/${id}`, patch);
      toast.success("Updated");
      setEditingId(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Sessions</div>
          <h1 className="font-display text-4xl text-ink mt-1">Consultations</h1>
        </div>
        <div className="flex gap-2">
          {["all", "requested", "confirmed", "completed", "cancelled"].map((s) => (
            <button key={s} onClick={() => setFilter(s)} data-testid={`astro-filter-${s}`}
              className={`text-[10px] uppercase tracking-widest px-3 py-1.5 border ${filter === s ? "border-maroon text-maroon bg-ivory" : "border-gold/40 text-ink-muted"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="gold-line bg-ivory p-16 text-center text-ink-muted">No consultations in this view.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <div key={c.booking_id} data-testid={`astro-cons-${c.booking_id}`} className="gold-line bg-ivory p-5">
              <div className="flex flex-wrap gap-4 items-start">
                <div className="min-w-[180px]">
                  <div className="text-xs text-ink-muted uppercase tracking-widest">Slot</div>
                  <div className="font-display text-lg text-ink">{new Date(c.slot_iso).toLocaleString()}</div>
                  <div className={`mt-2 inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 border ${STATUS_STYLES[c.status] || ""}`}>{c.status}</div>
                </div>
                <div className="flex-1 min-w-[240px]">
                  <div className="font-serifd text-lg">{c.name}</div>
                  <div className="text-xs text-ink-muted flex flex-wrap gap-3 mt-1">
                    <span className="inline-flex items-center gap-1"><Phone size={11} /> {c.phone}</span>
                    <span className="inline-flex items-center gap-1"><EnvelopeSimple size={11} /> {c.email}</span>
                  </div>
                  {c.concern && <div className="mt-2 text-sm text-ink-soft">{c.concern}</div>}
                  {c.notes && (
                    <div className="mt-2 text-xs bg-cream border border-gold/30 p-2">
                      <div className="text-[10px] uppercase tracking-widest text-gold-soft mb-1">Your notes</div>
                      {c.notes}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <div className="text-maroon-deep font-display text-lg">{formatINR(c.amount)}</div>
                  {c.meeting_link && (
                    <a href={c.meeting_link} target="_blank" rel="noreferrer" data-testid={`astro-join-${c.booking_id}`}
                       className="brand-gradient text-ivory px-4 py-2 text-[11px] uppercase tracking-widest inline-flex items-center gap-2">
                      <VideoCamera size={12} weight="duotone" /> Join Jitsi
                    </a>
                  )}
                  <div className="flex gap-1">
                    {c.status !== "completed" && (
                      <button onClick={() => update(c.booking_id, { status: "completed" })} data-testid={`astro-complete-${c.booking_id}`}
                        className="border border-verified text-verified px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-verified hover:text-ivory">
                        <CheckCircle size={10} /> Complete
                      </button>
                    )}
                    {c.status !== "cancelled" && c.status !== "completed" && (
                      <button onClick={() => update(c.booking_id, { status: "cancelled" })}
                        className="border border-ink-muted text-ink-muted px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-ink hover:text-ivory">
                        <XCircle size={10} /> Cancel
                      </button>
                    )}
                    <button onClick={() => { setEditingId(c.booking_id); setNoteDraft(c.notes || ""); }}
                      className="border border-maroon text-maroon px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory">
                      <Note size={10} /> {c.notes ? "Edit notes" : "Add notes"}
                    </button>
                  </div>
                </div>
              </div>
              {editingId === c.booking_id && (
                <div className="mt-3 border-t border-gold/20 pt-3">
                  <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3}
                    data-testid={`astro-notes-input-${c.booking_id}`}
                    className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
                    placeholder="Private session notes — visible only to you." />
                  <div className="mt-2 flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="text-xs text-ink-muted px-3 py-1.5">Cancel</button>
                    <button onClick={() => update(c.booking_id, { notes: noteDraft })} className="brand-gradient text-ivory px-4 py-1.5 text-[10px] uppercase tracking-widest">Save notes</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
