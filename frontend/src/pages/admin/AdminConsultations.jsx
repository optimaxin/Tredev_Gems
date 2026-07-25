import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

const STATUSES = ["requested", "confirmed", "completed", "cancelled"];

export default function AdminConsultations() {
  const [bookings, setBookings] = useState([]);
  const [astros, setAstros] = useState([]);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [feeRupees, setFeeRupees] = useState("");
  const [assignPick, setAssignPick] = useState({}); // booking_id -> astrologer_id being chosen
  const refresh = () => api.get("/admin/consultations", { params: filter ? { status: filter } : {} }).then((r) => setBookings(r.data));
  useEffect(() => { refresh(); }, [filter]);
  useEffect(() => {
    api.get("/admin/astrologers").then((r) => setAstros(r.data.filter((a) => a.is_active)));
    api.get("/admin/site-content").then((r) => setFeeRupees(String((r.data.consultation?.fee_paise ?? 39900) / 100)));
  }, []);

  const saveFee = async () => {
    const paise = Math.round(parseFloat(feeRupees) * 100);
    if (!paise || paise < 0) { toast.error("Enter a valid fee"); return; }
    await api.put("/admin/site-content/consultation", { value: { fee_paise: paise } });
    toast.success("Consultation fee updated");
  };

  const assign = async (id) => {
    const astrologer_id = assignPick[id];
    if (!astrologer_id) { toast.error("Pick an astrologer first"); return; }
    try {
      await api.patch(`/admin/consultations/${id}`, { astrologer_id });
      toast.success("Astrologer assigned — both parties notified on WhatsApp");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not assign"); }
  };

  const shown = bookings.filter((b) => matchesQuery(query, [b.astrologer_name, b.name, b.phone, b.email, b.concern]));

  const setStatus = async (id, status) => {
    await api.patch(`/admin/consultations/${id}`, { status });
    toast.success(`Marked ${status}`); refresh();
  };

  const joinMeeting = async (id) => {
    try {
      const { data } = await api.post(`/admin/consultations/${id}/join-link`);
      window.open(data.url, "_blank", "noopener");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not get a meeting link"); }
  };

  const openRecording = async (id) => {
    try {
      const { data } = await api.get(`/admin/consultations/${id}/recording`);
      window.open(data.url, "_blank", "noopener");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not open recording"); }
  };

  const RECORDING_LABEL = {
    none: null, pending: "Recording pending", processing: "Processing recording…",
    ready: null, failed: "Recording failed",
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Bookings</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Consultations</h1>

      <div className="gold-line bg-ivory p-4 mb-6 flex items-end gap-3 max-w-sm">
        <label className="flex-1">
          <div className="text-xs text-ink-muted mb-1">Consultation fee (₹)</div>
          <input value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)} type="number" min="0" step="1"
                 className="w-full gold-line px-3 py-2 text-sm outline-none focus:border-maroon" />
        </label>
        <button onClick={saveFee} className="brand-gradient text-ivory text-xs px-4 py-2 uppercase tracking-widest">Save</button>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder="Search by astrologer, customer, phone or email…" testId="consultations-search" className="mb-4 max-w-md" />
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`text-xs px-3 py-1.5 border ${filter === s ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
            {s || "All"}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {shown.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">{query ? `No bookings match “${query}”.` : "No bookings."}</div>}
        {shown.map((b) => (
          <div key={b.booking_id} className="gold-line bg-ivory p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serifd text-lg">{b.astrologer_name || "Unassigned"}</div>
                <div className="text-xs font-mono text-ink-muted">
                  {b.preferred_date ? new Date(b.preferred_date).toLocaleDateString() : new Date(b.slot_iso).toLocaleString()}
                  {b.time_of_day && ` · ${b.time_of_day}`}
                </div>
                <div className="text-sm mt-1">{b.name} · <span className="font-mono">{b.phone}</span> · <span className="text-ink-muted">{b.email}</span></div>
                {b.concern && <div className="mt-1 text-xs text-ink-soft italic">"{b.concern}"</div>}
              </div>
              <div className="text-right">
                <div className="font-display text-xl text-maroon-deep">{formatINR(b.amount)}</div>
                <div className="text-[10px] uppercase tracking-widest text-ink-muted mt-0.5">{b.payment_status === "paid" ? "Paid" : "Payment pending"}</div>
                <select value={b.status} onChange={(e) => setStatus(b.booking_id, e.target.value)} className="mt-1 gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {!b.astrologer_id && (
              <div className="mt-3 pt-3 border-t border-gold/20 flex items-center gap-2">
                <select value={assignPick[b.booking_id] || ""} onChange={(e) => setAssignPick((p) => ({ ...p, [b.booking_id]: e.target.value }))}
                        className="gold-line text-xs bg-ivory px-2 py-1.5 flex-1 max-w-xs">
                  <option value="">Assign an astrologer…</option>
                  {astros.map((a) => <option key={a.astrologer_id} value={a.astrologer_id}>{a.name}</option>)}
                </select>
                <button onClick={() => assign(b.booking_id)} className="brand-gradient text-ivory text-xs px-3 py-1.5 uppercase tracking-widest">Assign</button>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gold/20 flex items-center gap-4 text-xs flex-wrap">
              {b.pnm_room_id && (
                <button onClick={() => joinMeeting(b.booking_id)} data-testid={`consult-join-${b.booking_id}`} className="text-maroon inline-flex items-center gap-1">
                  Join meeting
                </button>
              )}
              {b.recording_ready ? (
                <button onClick={() => openRecording(b.booking_id)} data-testid={`consult-recording-${b.booking_id}`} className="text-verified inline-flex items-center gap-1">
                  Download recording
                </button>
              ) : RECORDING_LABEL[b.recording_status] && (
                <span className="text-ink-muted">{RECORDING_LABEL[b.recording_status]}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
