import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PencilSimple, PlusCircle, Trash } from "@phosphor-icons/react";

const EMPTY = { name: "", slug: "", category: "gemstone", description: "", price: "", mrp: "", images: "", devanagari_name: "", attrs: "{}" };

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [editing, setEditing] = useState(null); // product or "new" or null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => {
    api.get("/products?limit=500").then((r) => setProducts(r.data));
    api.get("/categories").then((r) => setCats(r.data.categories));
  };
  useEffect(() => { refresh(); }, []);

  const startEdit = (p) => {
    setEditing(p);
    setForm({
      ...EMPTY,
      ...p,
      // DB stores paise; UI shows rupees.
      price: p.price != null ? (p.price / 100).toString() : "",
      mrp: p.mrp != null ? (p.mrp / 100).toString() : "",
      images: (p.images || []).join("\n"),
      attrs: JSON.stringify(p.attrs || {}, null, 2),
    });
  };
  const startNew = () => { setEditing("new"); setForm(EMPTY); };

  const save = async (e) => {
    e.preventDefault();
    try {
      // Convert rupees → paise. Accepts "8850" or "8850.50".
      const rupeesToPaise = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error("Enter a valid price in rupees");
        return Math.round(n * 100);
      };
      const payload = {
        ...form,
        price: rupeesToPaise(form.price) || 0,
        mrp: form.mrp ? rupeesToPaise(form.mrp) : null,
        images: form.images.split("\n").map((s) => s.trim()).filter(Boolean),
        attrs: JSON.parse(form.attrs || "{}"),
      };
      if (editing === "new") {
        await api.post("/admin/products", payload);
        toast.success("Product created");
      } else {
        await api.patch(`/admin/products/${editing.product_id}`, payload);
        toast.success("Product updated");
      }
      setEditing(null); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const del = async (p) => {
    if (!confirm(`Deactivate ${p.name}?`)) return;
    await api.delete(`/admin/products/${p.product_id}`);
    toast.success("Deactivated"); refresh();
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Catalog</div>
          <h1 className="font-display text-4xl text-ink mt-1">Products</h1>
        </div>
        <button onClick={startNew} data-testid="admin-product-new" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift">
          <PlusCircle size={14} weight="duotone" /> New product
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">{editing === "new" ? "New product" : `Edit · ${editing.name}`}</div>
          {[
            ["name", "Name", "text"], ["slug", "Slug", "text"], ["devanagari_name", "Devanagari", "text"],
          ].map(([k, l]) => (
            <label key={k} className="block">
              <div className="text-xs text-ink-muted mb-1">{l}</div>
              <input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
            </label>
          ))}
          {[
            ["price", "Price (₹)", "e.g. 8500"],
            ["mrp", "MRP (₹)", "optional — strike-through price"],
          ].map(([k, l, hint]) => (
            <label key={k} className="block">
              <div className="text-xs text-ink-muted mb-1">{l}</div>
              <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
                <span className="px-3 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd">₹</span>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  placeholder={hint} data-testid={`product-${k}-input`}
                  className="flex-1 px-3 py-2 outline-none"
                />
              </div>
              {form[k] !== "" && form[k] != null && !isNaN(Number(form[k])) && (
                <div className="text-[10px] font-mono text-ink-muted mt-1">
                  = {Math.round(Number(form[k]) * 100).toLocaleString("en-IN")} paise (stored)
                </div>
              )}
            </label>
          ))}
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Category</div>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory">
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Description</div>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Images (one URL per line)</div>
            <textarea rows={3} value={form.images} onChange={(e) => setForm({ ...form, images: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-mono text-xs" />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Attributes (JSON — e.g. graha, purpose, mukhi, origin)</div>
            <textarea rows={3} value={form.attrs} onChange={(e) => setForm({ ...form, attrs: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-mono text-xs" />
          </label>
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="border border-gold/40 text-ink-soft px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {products.map((p) => (
          <div key={p.product_id} className="gold-line bg-ivory p-4 flex gap-4">
            {p.images?.[0] && <div className="w-24 h-24 gold-line overflow-hidden shrink-0"><img src={p.images[0]} alt="" className="w-full h-full object-cover" /></div>}
            <div className="flex-1 min-w-0">
              <div className="font-serifd text-lg truncate">{p.name}</div>
              <div className="text-xs font-mono text-ink-muted">{p.category}</div>
              <div className="text-sm text-maroon-deep">{formatINR(p.price)}</div>
              <div className="mt-2 flex gap-3 text-xs">
                <button onClick={() => startEdit(p)} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
                <button onClick={() => del(p)} className="text-revoked inline-flex items-center gap-1 ml-auto"><Trash size={12} /> Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
