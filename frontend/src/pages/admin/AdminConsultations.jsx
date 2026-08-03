import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { toast } from "sonner";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";
import AsyncButton from "@/components/gemora/AsyncButton";

const STATUSES = ["requested", "confirmed", "completed", "cancelled"];

export default function AdminConsultations() {
  const [bookings, setBookings] = useState([]);
  const [astros, setAstros] = useState([]);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [feeRupees, setFeeRupees] = useState("");
  const [assignPick, setAssignPick] = useState({}); // booking_id -> astrologer_id being chosen
  const [assignTime, setAssignTime] = useState({}); // booking_id -> "HH:MM" confirmed time being chosen
  const [assignLink, setAssignLink] = useState({}); // booking_id -> meeting link being entered
  const [savingFee, setSavingFee] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const refresh = () => api.get("/admin/consultations", { params: filter ? { status: filter } : {} }).then((r) => setBookings(r.data));
  useEffect(() => { refresh(); }, [filter]);
  useEffect(() => {
    api.get("/admin/astrologers").then((r) => setAstros(r.data.filter((a) => a.is_active)));
    api.get("/admin/site-content").then((r) => setFeeRupees(String((r.data.consultation?.fee_paise ?? 39900) / 100)));
  }, []);

  const saveFee = async () => {
    const paise = Math.round(parseFloat(feeRupees) * 100);
    if (!paise || paise < 0) { toast.error("Enter a valid fee"); return; }
    setSavingFee(true);
    try {
      await api.put("/admin/site-content/consultation", { value: { fee_paise: paise } });
      toast.success("Consultation fee updated");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update fee"); }
    finally { setSavingFee(false); }
  };

  const assign = async (id, needsTime) => {
    const astrologer_id = assignPick[id];
    if (!astrologer_id) { toast.error("Pick an astrologer first"); return; }
    const confirmed_time = assignTime[id];
    if (needsTime && !confirmed_time) { toast.error("Enter the confirmed time first"); return; }
    const meeting_link = (assignLink[id] || "").trim();
    if (!meeting_link) { toast.error("Enter the meeting link first"); return; }
    setAssigningId(id);
    try {
      await api.patch(`/admin/consultations/${id}`, { astrologer_id, meeting_link, ...(needsTime ? { confirmed_time } : {}) });
      toast.success("Astrologer assigned — both parties notified on WhatsApp");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not assign"); }
    finally { setAssigningId((cur) => (cur === id ? null : cur)); }
  };

  const shown = bookings
    .filter((b) => matchesQuery(query, [b.astrologer_name, b.name, b.phone, b.email, b.concern]));

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/admin/consultations/${id}`, { status });
      toast.success(`Marked ${status}`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update status"); }
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
        <AsyncButton onClick={saveFee} loading={savingFee} loadingText="Saving…" className="brand-gradient text-ivory text-xs px-4 py-2 uppercase tracking-widest">Save</AsyncButton>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder="Search by astrologer, customer, phone or email…" testId="consultations-search" className="mb-4 max-w-md" />
      <div className="flex gap-2 mb-3 flex-wrap">
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
                  {b.astrologer_id
                    ? new Date(b.slot_iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                    : b.preferred_date
                      ? `${new Date(b.preferred_date).toLocaleDateString()} · ${b.time_of_day || "time TBC"} (unconfirmed)`
                      : new Date(b.slot_iso).toLocaleString()}
                </div>
                <div className="text-sm mt-1">{b.name} · <span className="font-mono">{b.phone}</span> · <span className="text-ink-muted">{b.email}</span></div>
                {b.concern && <div className="mt-1 text-xs text-ink-soft italic">"{b.concern}"</div>}
              </div>
              <div className="text-right">
                {/* bookings are priced per region too — render in the booking's own currency */}
                <div className="font-display text-xl text-maroon-deep">{formatPrice(b.amount, b.currency)}</div>
                <div className={`text-[10px] uppercase tracking-widest mt-0.5 ${b.payment_status === "paid" ? "text-verified" : "text-revoked"}`}>
                  {b.payment_status === "paid" ? "Paid" : "Payment pending"}
                </div>
                <select value={b.status} onChange={(e) => setStatus(b.booking_id, e.target.value)} className="mt-1 gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {!b.astrologer_id && (
              <div className="mt-3 pt-3 border-t border-gold/20 flex items-center gap-2 flex-wrap">
                <select value={assignPick[b.booking_id] || ""} onChange={(e) => setAssignPick((p) => ({ ...p, [b.booking_id]: e.target.value }))}
                        className="gold-line text-xs bg-ivory px-2 py-1.5 flex-1 max-w-xs">
                  <option value="">Assign an astrologer…</option>
                  {astros.map((a) => <option key={a.astrologer_id} value={a.astrologer_id}>{a.name}</option>)}
                </select>
                {b.preferred_date && (
                  <input type="time" value={assignTime[b.booking_id] || ""}
                         onChange={(e) => setAssignTime((t) => ({ ...t, [b.booking_id]: e.target.value }))}
                         className="gold-line text-xs bg-ivory px-2 py-1.5" title="Confirmed time (30 min session)" />
                )}
                <input type="text" value={assignLink[b.booking_id] || ""}
                       onChange={(e) => setAssignLink((l) => ({ ...l, [b.booking_id]: e.target.value }))}
                       placeholder="Meeting link" className="gold-line text-xs bg-ivory px-2 py-1.5 flex-1 max-w-xs" />
                <AsyncButton onClick={() => assign(b.booking_id, !!b.preferred_date)} loading={assigningId === b.booking_id} loadingText="Assigning…" className="brand-gradient text-ivory text-xs px-3 py-1.5 uppercase tracking-widest">Assign</AsyncButton>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gold/20 flex items-center gap-4 text-xs flex-wrap">
              {b.meeting_link && (
                <a href={b.meeting_link} target="_blank" rel="noreferrer"
                   data-testid={`consult-join-${b.booking_id}`} className="text-maroon inline-flex items-center gap-1">
                  Join meeting
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
