import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { absolutize } from "@/context/SiteAssetsContext";
import { toast } from "sonner";
import { Plus, PencilSimple, TrashSimple, MegaphoneSimple, Image as ImageIcon, X } from "@phosphor-icons/react";
import MediaPicker from "@/components/gemora/MediaPicker";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

const EMPTY = {
  title: "", subtitle: "", description: "", image_url: "",
  cta_text: "", cta_link: "", coupon_code: "",
  starts_at: "", ends_at: "", priority: 0, active: true,
  show_in_strip: true, show_in_section: true,
};

function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function AdminEvents() {
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/events");
      setEvents(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load events"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => setEditing({ ...EMPTY });
  const startEdit = (ev) => setEditing({
    ...ev,
    starts_at: isoToLocal(ev.starts_at),
    ends_at: isoToLocal(ev.ends_at),
  });

  const save = async () => {
    if (!editing.title.trim()) { toast.error("Title is required"); return; }
    const payload = {
      ...editing,
      starts_at: localToIso(editing.starts_at),
      ends_at: localToIso(editing.ends_at),
      priority: Number(editing.priority) || 0,
    };
    try {
      if (editing.event_id) {
        await api.patch(`/admin/events/${editing.event_id}`, payload);
        toast.success("Event updated");
      } else {
        await api.post("/admin/events", payload);
        toast.success("Event created");
      }
      setEditing(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  const remove = async (ev) => {
    if (!window.confirm(`Delete event "${ev.title}"?`)) return;
    try {
      await api.delete(`/admin/events/${ev.event_id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const onPickImage = (m) => {
    setEditing((e) => ({ ...e, image_url: m.url }));
    setShowPicker(false);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Campaigns · अवसर</div>
          <h1 className="font-display text-4xl text-ink mt-1">Events & giveaways</h1>
          <p className="text-sm text-ink-muted mt-1">Ads, giveaways and occasion campaigns that appear on the homepage.</p>
        </div>
        <button onClick={startNew} data-testid="events-new" className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2">
          <Plus size={14} weight="bold" /> New event
        </button>
      </div>

      {events.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search events by title or coupon code…" testId="events-search" className="mb-4 max-w-md" />
      )}
      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : events.length === 0 ? (
        <div className="gold-line bg-ivory p-16 text-center">
          <MegaphoneSimple size={56} weight="duotone" className="mx-auto text-gold-soft" />
          <div className="mt-4 font-serifd text-xl text-maroon-deep">No events yet</div>
          <div className="text-sm text-ink-muted mt-2">Create an event to run a giveaway, festival sale or announcement.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {events.filter((ev) => matchesQuery(query, [ev.title, ev.subtitle, ev.coupon_code, ev.cta_text])).length === 0 && (
            <div className="gold-line p-10 text-center text-ink-muted">No events match “{query}”.</div>
          )}
          {events.filter((ev) => matchesQuery(query, [ev.title, ev.subtitle, ev.coupon_code, ev.cta_text])).map((ev) => (
            <div key={ev.event_id} data-testid={`event-row-${ev.event_id}`} className="gold-line bg-ivory p-4 flex gap-4 items-start">
              <div className="w-32 h-20 bg-cream overflow-hidden shrink-0 border border-gold/30">
                {ev.image_url ? (
                  <img src={absolutize(ev.image_url)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-muted"><ImageIcon size={20} /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <div className="font-serifd text-lg text-ink">{ev.title}</div>
                  <div className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border ${ev.active ? "border-verified text-verified" : "border-ink-muted text-ink-muted"}`}>
                    {ev.active ? "Active" : "Paused"}
                  </div>
                  {ev.coupon_code && <div className="text-[10px] font-mono uppercase text-maroon border border-gold/40 px-2 py-0.5">CODE · {ev.coupon_code}</div>}
                  <div className="text-[10px] text-ink-muted">priority {ev.priority}</div>
                </div>
                {ev.subtitle && <div className="text-sm text-ink-soft mt-1">{ev.subtitle}</div>}
                <div className="text-[11px] text-ink-muted mt-1">
                  {ev.starts_at ? `From ${new Date(ev.starts_at).toLocaleString()}` : "No start"} · {ev.ends_at ? `Until ${new Date(ev.ends_at).toLocaleString()}` : "No end"}
                </div>
                <div className="text-[10px] text-ink-muted mt-1">
                  {ev.show_in_strip ? "Top strip · yes" : "Top strip · no"} · {ev.show_in_section ? "Home section · yes" : "Home section · no"}
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => startEdit(ev)} data-testid={`event-edit-${ev.event_id}`} className="border border-maroon text-maroon px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory">
                  <PencilSimple size={11} /> Edit
                </button>
                <button onClick={() => remove(ev)} data-testid={`event-delete-${ev.event_id}`} className="border border-revoked/60 text-revoked px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-revoked hover:text-ivory">
                  <TrashSimple size={11} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="event-editor">
          <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative bg-ivory gold-line-strong w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gold/30">
              <div className="font-serifd text-xl text-maroon-deep">{editing.event_id ? "Edit event" : "New event"}</div>
              <button onClick={() => setEditing(null)} className="text-ink-muted hover:text-maroon"><X size={18} /></button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Title *</div>
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} data-testid="event-title" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Subtitle</div>
                <input value={editing.subtitle} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Description</div>
                <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>

              <div className="sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Cover image</div>
                <div className="flex items-start gap-3">
                  <div className="w-40 h-24 bg-cream border border-gold/30 overflow-hidden shrink-0">
                    {editing.image_url ? (
                      <img src={absolutize(editing.image_url)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-ink-muted"><ImageIcon size={22} /></div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => setShowPicker(true)} data-testid="event-pick-image" className="border border-maroon text-maroon px-3 py-1.5 text-[10px] uppercase tracking-widest hover:bg-maroon hover:text-ivory">Pick from library</button>
                    {editing.image_url && <button type="button" onClick={() => setEditing({ ...editing, image_url: "" })} className="text-[10px] text-ink-muted hover:text-revoked underline">Clear</button>}
                  </div>
                </div>
              </div>

              <label className="block">
                <div className="text-xs text-ink-muted mb-1">CTA button text</div>
                <input value={editing.cta_text} onChange={(e) => setEditing({ ...editing, cta_text: e.target.value })} placeholder="Shop now" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">CTA link</div>
                <input value={editing.cta_link} onChange={(e) => setEditing({ ...editing, cta_link: e.target.value })} placeholder="/shop?category=gemstone" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Coupon code (optional)</div>
                <input value={editing.coupon_code} onChange={(e) => setEditing({ ...editing, coupon_code: e.target.value.toUpperCase() })} placeholder="DIWALI25" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-mono" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Priority (higher = shown first)</div>
                <input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Starts at</div>
                <input type="datetime-local" value={editing.starts_at || ""} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Ends at</div>
                <input type="datetime-local" value={editing.ends_at || ""} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
              </label>

              <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} data-testid="event-active" className="w-4 h-4 accent-maroon" />
                <span className="text-sm text-ink-soft">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.show_in_strip} onChange={(e) => setEditing({ ...editing, show_in_strip: e.target.checked })} className="w-4 h-4 accent-maroon" />
                <span className="text-sm text-ink-soft">Show top strip</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.show_in_section} onChange={(e) => setEditing({ ...editing, show_in_section: e.target.checked })} className="w-4 h-4 accent-maroon" />
                <span className="text-sm text-ink-soft">Show homepage section</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gold/30 flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs uppercase tracking-widest text-ink-muted hover:text-maroon">Cancel</button>
              <button onClick={save} data-testid="event-save" className="brand-gradient text-ivory px-6 py-2 text-xs uppercase tracking-widest">Save event</button>
            </div>
          </div>
          <MediaPicker open={showPicker} onClose={() => setShowPicker(false)} onPick={onPickImage} />
        </div>
      )}
    </div>
  );
}
