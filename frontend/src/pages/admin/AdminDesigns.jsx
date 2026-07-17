import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PencilSimple, PlusCircle, Trash, Diamond } from "@phosphor-icons/react";

// Designs belong to one gemstone: pick Sapphire and you see Sapphire's designs, not
// every stone's. There's one row per metal, each carrying that mounting's full price —
// which is why Form and Metal carry no charge on the product form. The buyer's total is
// simply the gemstone's price + the chosen design's price.
const EMPTY = {
  product_id: "", code: "", applies_to: "ring", metal: "18k Gold", price: "",
  image_url: "", note: "", is_active: true, sort_order: "0",
};

export default function AdminDesigns() {
  const [designs, setDesigns] = useState([]);
  const [products, setProducts] = useState([]);
  const [metals, setMetals] = useState([]);
  const [filter, setFilter] = useState(""); // product_id filter
  const [editing, setEditing] = useState(null); // design | "new" | null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => api.get("/admin/designs").then((r) => setDesigns(r.data));
  useEffect(() => {
    refresh();
    api.get("/admin/metals").then((r) => setMetals(r.data.metals)).catch(() => {});
    // Designs only apply to gemstones — that's the only category with Ring/Pendant.
    api.get("/products?category=gemstone&limit=500")
      .then((r) => setProducts(r.data))
      .catch(() => {});
  }, []);

  const startNew = () => {
    setEditing("new");
    // Prefill the gemstone being filtered on — that's almost always the one being worked on.
    setForm({ ...EMPTY, product_id: filter || products[0]?.product_id || "" });
  };
  const startEdit = (d) => {
    setEditing(d);
    setForm({
      product_id: d.product_id,
      code: d.code,
      applies_to: d.applies_to,
      metal: d.metal,
      price: d.price ? (d.price / 100).toString() : "",
      image_url: d.image_url || "",
      note: d.note || "",
      is_active: d.is_active,
      sort_order: String(d.sort_order ?? 0),
    });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (!form.product_id) throw new Error("Pick which gemstone this design is for");
      const n = form.price === "" ? 0 : Number(form.price);
      if (isNaN(n) || n < 0) throw new Error("Enter a valid price in rupees");
      const payload = {
        ...form,
        price: Math.round(n * 100), // rupees -> paise
        sort_order: parseInt(form.sort_order, 10) || 0,
        image_url: form.image_url.trim() || null,
        note: form.note.trim() || null,
      };
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
    if (!confirm(`Delete ${d.code} (${d.metal})? Past orders keep the design they recorded.`)) return;
    try {
      await api.delete(`/admin/designs/${d.design_id}`);
      toast.success("Design deleted"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const shown = filter ? designs.filter((d) => d.product_id === filter) : designs;
  const byForm = (f) => shown.filter((d) => d.applies_to === f);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Catalog</div>
          <h1 className="font-display text-4xl text-ink mt-1">Designs</h1>
        </div>
        <button onClick={startNew} disabled={!products.length} data-testid="admin-design-new"
          className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-40">
          <PlusCircle size={14} weight="duotone" /> New design
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Ring and pendant designs for a specific gemstone. Add one row per metal — its price is the
        full mounting cost and gets added to that gemstone's price at checkout.
      </p>

      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs uppercase tracking-widest text-ink-muted">Gemstone</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="design-product-filter"
          className="gold-line px-3 py-2 text-sm bg-ivory">
          <option value="">All gemstones</option>
          {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
        </select>
      </div>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">
            {editing === "new" ? "New design" : `Edit · ${editing.code} (${editing.metal})`}
          </div>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Gemstone this design is for</div>
            <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              required data-testid="design-product-select" className="w-full gold-line px-3 py-2 bg-ivory">
              <option value="" disabled>Select a gemstone…</option>
              {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Code</div>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. R14" required data-testid="design-code-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Applies to</div>
            <select value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}
              data-testid="design-applies-select" className="w-full gold-line px-3 py-2 bg-ivory">
              <option value="ring">Ring</option>
              <option value="pendant">Pendant</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Metal</div>
            <select value={form.metal} onChange={(e) => setForm({ ...form, metal: e.target.value })}
              data-testid="design-metal-select" className="w-full gold-line px-3 py-2 bg-ivory">
              {metals.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Design price (₹) — added to the gemstone</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd">₹</span>
              <input type="number" min="0" step="0.01" inputMode="decimal"
                value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="e.g. 8000" data-testid="design-price-input"
                className="flex-1 px-3 py-2 outline-none" />
            </div>
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Image URL</div>
            <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              placeholder="https://…" data-testid="design-image-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-mono text-xs" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Note (optional)</div>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder='e.g. "21k Advance only"'
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Sort order</div>
            <input type="number" step="1" value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
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
              No {f} designs{filter ? " for this gemstone" : ""} yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
              {byForm(f).map((d) => (
                <div key={d.design_id} data-testid={`design-${d.code}-${d.metal}`}
                  className={`gold-line bg-ivory p-2 ${d.is_active ? "" : "opacity-50"}`}>
                  <div className="aspect-square overflow-hidden bg-cream">
                    {d.image_url
                      ? <img src={d.image_url} alt={d.code} loading="lazy" className="w-full h-full object-contain" />
                      : <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-muted">No image</div>}
                  </div>
                  <div className="mt-1.5 text-xs font-medium">{d.code} · {d.metal}</div>
                  <div className="text-[11px] text-maroon-deep">{formatINR(d.price)}</div>
                  {!filter && <div className="text-[10px] text-ink-muted truncate">{d.product_name}</div>}
                  {d.note && <div className="text-[10px] text-ink-muted truncate">{d.note}</div>}
                  {!d.is_active && <div className="text-[10px] text-ink-muted">hidden</div>}
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
