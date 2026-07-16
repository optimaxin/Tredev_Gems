import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { EnvelopeSimple } from "@phosphor-icons/react";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export default function AdminQueries() {
  const [queries, setQueries] = useState([]);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");

  const refresh = () => api.get("/admin/queries", { params: filter ? { status: filter } : {} }).then((r) => setQueries(r.data));
  useEffect(() => { refresh(); }, [filter]);

  const update = async (id, patch) => {
    await api.patch(`/admin/queries/${id}`, patch);
    toast.success("Saved"); setNote(""); refresh();
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Support inbox</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">User queries</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`text-xs px-3 py-1.5 border ${filter === s ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
            {s || "All"}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {queries.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No queries.</div>}
        {queries.map((q) => (
          <div key={q.query_id} className="gold-line bg-ivory p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-serifd text-lg">{q.subject}</div>
                <div className="text-xs text-ink-muted">{q.name} · {q.email}{q.phone ? ` · ${q.phone}` : ""} · <span className="font-mono">{new Date(q.created_at).toLocaleString()}</span></div>
                <p className="mt-2 text-sm text-ink-soft">{q.message}</p>
              </div>
              <select value={q.status} onChange={(e) => update(q.query_id, { status: e.target.value })} className="gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {(q.notes && q.notes.length > 0) && (
              <div className="mt-3 border-t border-gold/20 pt-3 space-y-2">
                {q.notes.map((n, i) => (
                  <div key={i} className="text-xs text-ink-soft"><span className="font-mono text-ink-muted">{new Date(n.at).toLocaleString()}</span> · {n.text}</div>
                ))}
              </div>
            )}
            <button onClick={() => setOpenId(openId === q.query_id ? null : q.query_id)} className="mt-2 text-xs text-maroon underline">
              {openId === q.query_id ? "Cancel" : "Add note"}
            </button>
            {openId === q.query_id && (
              <div className="mt-2 flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note or resolution…" className="flex-1 gold-line px-3 py-2 text-sm" />
                <button onClick={() => { update(q.query_id, { note }); setOpenId(null); }} className="brand-gradient text-ivory text-xs px-3">Save</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
