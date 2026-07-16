import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";

const STATUSES = ["requested", "confirmed", "completed", "cancelled"];

export default function AdminConsultations() {
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState("");
  const refresh = () => api.get("/admin/consultations", { params: filter ? { status: filter } : {} }).then((r) => setBookings(r.data));
  useEffect(() => { refresh(); }, [filter]);

  const setStatus = async (id, status) => {
    await api.patch(`/admin/consultations/${id}`, { status });
    toast.success(`Marked ${status}`); refresh();
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Bookings</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Consultations</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`text-xs px-3 py-1.5 border ${filter === s ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
            {s || "All"}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {bookings.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No bookings.</div>}
        {bookings.map((b) => (
          <div key={b.booking_id} className="gold-line bg-ivory p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serifd text-lg">{b.astrologer_name}</div>
                <div className="text-xs font-mono text-ink-muted">{new Date(b.slot_iso).toLocaleString()}</div>
                <div className="text-sm mt-1">{b.name} · <span className="font-mono">{b.phone}</span> · <span className="text-ink-muted">{b.email}</span></div>
                {b.concern && <div className="mt-1 text-xs text-ink-soft italic">"{b.concern}"</div>}
              </div>
              <div className="text-right">
                <div className="font-display text-xl text-maroon-deep">{formatINR(b.amount)}</div>
                <select value={b.status} onChange={(e) => setStatus(b.booking_id, e.target.value)} className="mt-1 gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
