import React, { useCallback, useEffect, useState } from "react";
import { apiAstro } from "@/context/AstroAuthContext";
import { toast } from "sonner";
import { Plus, Trash, CalendarX, FloppyDisk } from "@phosphor-icons/react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AstroAvailability() {
  const [slots, setSlots] = useState([]);
  const [blackout, setBlackout] = useState([]);
  const [newBlackout, setNewBlackout] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiAstro.get("/astrologer/availability");
      setSlots(data.weekly_slots || []);
      setBlackout(data.blackout_dates || []);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addSlot = () => setSlots((s) => [...s, { day: 0, start: "10:00", end: "12:00" }]);
  const rmSlot = (i) => setSlots((s) => s.filter((_, idx) => idx !== i));
  const patch = (i, k, v) => setSlots((s) => s.map((row, idx) => idx === i ? { ...row, [k]: k === "day" ? parseInt(v) : v } : row));

  const addBlackout = () => {
    if (!newBlackout || !/^\d{4}-\d{2}-\d{2}$/.test(newBlackout)) { toast.error("Pick a valid date"); return; }
    if (blackout.includes(newBlackout)) { toast.error("Already added"); return; }
    setBlackout((b) => [...b, newBlackout].sort());
    setNewBlackout("");
  };
  const rmBlackout = (d) => setBlackout((b) => b.filter((x) => x !== d));

  const save = async () => {
    setSaving(true);
    try {
      await apiAstro.put("/astrologer/availability", { weekly_slots: slots, blackout_dates: blackout });
      toast.success("Availability saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Availability</div>
          <h1 className="font-display text-4xl text-ink mt-1">Your weekly hours</h1>
          <p className="text-sm text-ink-muted mt-1">Times when clients can book consultations with you.</p>
        </div>
        <button onClick={save} disabled={saving} data-testid="avail-save"
          className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
          <FloppyDisk size={14} weight="duotone" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="gold-line bg-ivory p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs uppercase tracking-widest text-maroon-deep">Weekly slots</div>
              <button onClick={addSlot} data-testid="avail-add-slot" className="brand-gradient text-ivory px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1">
                <Plus size={11} weight="bold" /> Add slot
              </button>
            </div>
            {slots.length === 0 ? (
              <div className="text-sm text-ink-muted py-6 text-center">Add slots to accept bookings.</div>
            ) : (
              <div className="space-y-2">
                {slots.map((s, i) => (
                  <div key={i} data-testid={`avail-slot-${i}`} className="flex items-center gap-2">
                    <select value={s.day} onChange={(e) => patch(i, "day", e.target.value)} className="gold-line px-2 py-2 bg-ivory text-sm">
                      {DAYS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                    </select>
                    <input type="time" value={s.start} onChange={(e) => patch(i, "start", e.target.value)} className="gold-line px-2 py-2 outline-none bg-ivory" />
                    <span className="text-ink-muted">to</span>
                    <input type="time" value={s.end} onChange={(e) => patch(i, "end", e.target.value)} className="gold-line px-2 py-2 outline-none bg-ivory" />
                    <button onClick={() => rmSlot(i)} className="text-revoked hover:text-ivory hover:bg-revoked border border-revoked/40 p-2">
                      <Trash size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="gold-line bg-ivory p-6">
            <div className="flex items-center gap-2 mb-4">
              <CalendarX size={16} weight="duotone" className="text-gold" />
              <div className="text-xs uppercase tracking-widest text-maroon-deep">Blackout dates</div>
            </div>
            <div className="flex gap-2 mb-4">
              <input type="date" value={newBlackout} onChange={(e) => setNewBlackout(e.target.value)}
                data-testid="avail-blackout-input" className="flex-1 gold-line px-3 py-2 outline-none bg-ivory" />
              <button onClick={addBlackout} data-testid="avail-blackout-add" className="brand-gradient text-ivory px-3 py-2 text-[10px] uppercase tracking-widest inline-flex items-center gap-1">
                <Plus size={11} /> Add
              </button>
            </div>
            {blackout.length === 0 ? (
              <div className="text-sm text-ink-muted py-6 text-center">Days when you're off. No blackout dates set.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {blackout.map((d) => (
                  <div key={d} className="border border-gold/40 px-3 py-1.5 text-xs font-mono inline-flex items-center gap-2">
                    {d}
                    <button onClick={() => rmBlackout(d)} className="text-revoked hover:text-maroon"><Trash size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
