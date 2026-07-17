import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PencilSimple, PlusCircle, Trash, Diamond } from "@phosphor-icons/react";

// Designs are a shared catalog, not per-product: every gemstone automatically offers
// these once the buyer picks Ring or Pendant. Making charges are a % of that stone's
// base price, so one design works across the whole catalog regardless of stone value.
const EMPTY = {
  code: "", applies_to: "ring", image_url: "", making_charge_pct: "",
  metals: [], note: "", is_active: true, sort_order: "0",
};

export default function AdminDesigns() {
  const [designs, setDesigns] = useState([]);
  const [metals, setMetals] = useState([]);
  const [editing, setEditing] = useState(null); // design | "new" | null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => api.get("/admin/designs").then((r) => setDesigns(r.data));
  useEffect(() => {
    refresh();
    api.get("/admin/metals").then((r) => setMetals(r.data.metals)).catch(() => {});
  }, []);

  const startNew = () => { setEditing("new"); setForm(EMPTY); };
  const startEdit = (d) => {
    setEditing(d);
    setForm({
      code: d.code,
      applies_to: d.applies_to,
      image_url: d.image_url || "",
      making_charge_pct: d.making_charge_pct ? String(d.making_charge_pct) : "",
      metals: d.metals || [],
      note: d.note || "",
      is_active: d.is_active,
      sort_order: String(d.sort_order ?? 0),
    });
  };

  const toggleMetal = (m) =>
    setForm((f) => ({
      ...f,
      metals: f.metals.includes(m) ? f.metals.filter((x) => x !== m) : [...f.metals, m],
    }));

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        making_charge_pct: form.making_charge_pct ? Number(form.making_charge_pct) : 0,
        sort_order: parseInt(form.sort_order, 10) || 0,
        image_url: form.image_url.trim() || null,
        note: form.note.trim() || null,
      };
      if (payload.making_charge_pct < 0) throw new Error("Making charge can't be negative");
      if (editing === "new") {
        await api.post("/admin/designs", payload);
        toast.success("Design added");
      } else {
        await api.patch(`/admin/designs/${editing.design_id}`, payload);
        toast.success("Design updated");
      }
      setEditing(null); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const del = async (d) => {
    if (!confirm(`Delete design ${d.code}? Past orders keep the design they recorded.`)) return;
    try {
      await api.delete(`/admin/designs/${d.design_id}`);
      toast.success("Design deleted"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const byForm = (f) => designs.filter((d) => d.applies_to === f);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Catalog</div>
          <h1 className="font-display text-4xl text-ink mt-1">Designs</h1>
        </div>
        <button onClick={startNew} data-testid="admin-design-new" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift">
          <PlusCircle size={14} weight="duotone" /> New design
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-6">
        Offered on every gemstone once the buyer chooses Ring or Pendant. The making charge is a
        percentage of that stone's own price, so one design fits the whole catalog.
      </p>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">
            {editing === "new" ? "New design" : `Edit · ${editing.code}`}
          </div>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Code</div>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. R14" required data-testid="design-code-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Applies to</div>
            <select value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}
              data-testid="design-applies-select"
              className="w-full gold-line px-3 py-2 bg-ivory">
              <option value="ring">Ring</option>
              <option value="pendant">Pendant</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Making charge (% of stone price)</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <input type="number" min="0" step="0.5" inputMode="decimal"
                value={form.making_charge_pct}
                onChange={(e) => setForm({ ...form, making_charge_pct: e.target.value })}
                placeholder="e.g. 15" data-testid="design-pct-input"
                className="flex-1 px-3 py-2 outline-none" />
              <span className="px-3 py-2 bg-cream text-ink-soft border-l border-gold/30 font-serifd">%</span>
            </div>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Sort order</div>
            <input type="number" step="1" value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Image URL</div>
            <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              placeholder="https://…" data-testid="design-image-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-mono text-xs" />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Note (optional)</div>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder='e.g. "21k Advance only"'
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <div className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Metals — leave all unticked to offer it in every metal</div>
            <div className="flex flex-wrap gap-2">
              {metals.map((m) => (
                <button key={m} type="button" onClick={() => toggleMetal(m)}
                  data-testid={`design-metal-${m}`}
                  className={`px-3 py-1.5 border text-xs ${form.metals.includes(m)
                    ? "border-maroon bg-cream text-maroon-deep" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 md:col-span-2 text-sm">
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span className="text-ink-soft">Active — shown to buyers</span>
          </label>
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" data-testid="design-save" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="border border-gold/40 text-ink-soft px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      {["ring", "pendant"].map((f) => (
        <div key={f} className="mb-8">
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-3 flex items-center gap-1.5">
            <Diamond size={13} weight="duotone" /> {f === "ring" ? "Ring designs" : "Pendant designs"} ({byForm(f).length})
          </div>
          {byForm(f).length === 0 ? (
            <div className="gold-line p-8 text-center text-ink-muted text-sm">
              No {f} designs yet. Buyers need at least two before the picker appears.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
              {byForm(f).map((d) => (
                <div key={d.design_id} data-testid={`design-${d.code}`}
                  className={`gold-line bg-ivory p-2 ${d.is_active ? "" : "opacity-50"}`}>
                  <div className="aspect-square overflow-hidden bg-cream">
                    {d.image_url
                      ? <img src={d.image_url} alt={d.code} loading="lazy" className="w-full h-full object-contain" />
                      : <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-muted">No image</div>}
                  </div>
                  <div className="mt-1.5 text-xs font-medium">{d.code}</div>
                  <div className="text-[10px] text-ink-muted">
                    +{d.making_charge_pct}% making
                    {!d.is_active && " · hidden"}
                  </div>
                  {d.note && <div className="text-[10px] text-ink-muted truncate">{d.note}</div>}
                  {d.metals?.length > 0 && (
                    <div className="text-[10px] text-maroon truncate">{d.metals.join(", ")}</div>
                  )}
                  <div className="mt-1.5 flex gap-3 text-[11px]">
                    <button onClick={() => startEdit(d)} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={11} /> Edit</button>
                    <button onClick={() => del(d)} className="text-revoked inline-flex items-center gap-1 ml-auto"><Trash size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
