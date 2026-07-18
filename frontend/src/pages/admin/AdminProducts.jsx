import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PencilSimple, PlusCircle, Trash, Stack } from "@phosphor-icons/react";
import SearchBar from "@/components/gemora/SearchBar";

const EMPTY = {
  name: "", slug: "", category: "gemstone", subcategory_id: "", description: "", price: "", mrp: "",
  images: "", devanagari_name: "", attrs: "{}", quantity: "", care_instructions: "",
  groups: [], // option groups, seeded from the category template
};

// Surcharges travel as paise; the form edits rupees.
const groupsToForm = (groups) =>
  (groups || []).map((g) => ({
    ...g, // keeps show_if / optional intact for the round-trip back to the API
    choices: (g.choices || []).map((c) => ({
      ...c,
      surcharge: c.surcharge ? (c.surcharge / 100).toString() : "",
    })),
  }));

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [stock, setStock] = useState({}); // {product_id: in_stock count}
  const [addQty, setAddQty] = useState({}); // {product_id: qty being typed}
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // product or "new" or null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => {
    api.get("/products?limit=500").then((r) => setProducts(r.data));
    api.get("/categories").then((r) => setCats(r.data.categories));
    api.get("/admin/products/stock").then((r) => setStock(r.data)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  // Add more units to an existing serialized product, right from this page — serials
  // are auto-generated, so there's no re-entering them one by one.
  const addUnits = async (p) => {
    const qty = Math.max(0, parseInt(addQty[p.product_id], 10) || 0);
    if (!qty) { toast.error("Enter how many pieces to add"); return; }
    try {
      const { data } = await api.post("/admin/units/bulk", { product_id: p.product_id, quantity: qty });
      toast.success(`${data.count} piece${data.count === 1 ? "" : "s"} added to ${p.name}`);
      setAddQty((s) => ({ ...s, [p.product_id]: "" }));
      api.get("/admin/products/stock").then((r) => setStock(r.data)).catch(() => {});
    } catch (e) { toast.error(e.response?.data?.detail || "Could not add units"); }
  };

  // Client-side product search over name, slug and category.
  const shown = products.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.slug, p.category, p.subcategory].filter(Boolean).some((s) => s.toLowerCase().includes(q));
  });

  // What a product offers is category-driven, so the form pulls that category's
  // template and the admin just fills in the ₹. Used for new products and whenever
  // the category changes.
  const loadTemplate = async (category) => {
    try {
      const { data } = await api.get(`/admin/category-options/${category}`);
      setForm((f) => ({ ...f, groups: groupsToForm(data.groups) }));
    } catch (e) {
      toast.error("Could not load category options");
    }
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({
      ...EMPTY,
      ...p,
      subcategory_id: p.subcategory_id || "",
      // DB stores paise; UI shows rupees.
      price: p.price != null ? (p.price / 100).toString() : "",
      mrp: p.mrp != null ? (p.mrp / 100).toString() : "",
      images: (p.images || []).join("\n"),
      attrs: JSON.stringify(p.attrs || {}, null, 2),
      care_instructions: (p.care_instructions || []).join("\n"),
      groups: groupsToForm(p.variant_options?.groups),
    });
  };
  const startNew = () => { setEditing("new"); setForm(EMPTY); loadTemplate(EMPTY.category); };

  const changeCategory = (category) => {
    // Subcategories belong to one parent, so switching category clears the sub.
    setForm((f) => ({ ...f, category, subcategory_id: "" }));
    loadTemplate(category); // different category -> different selectors
  };

  // Top-level categories for the Category dropdown; subs are chosen separately.
  const topCats = cats.filter((c) => !c.parent_category_id);
  const selectedTop = topCats.find((c) => c.key === form.category);
  const subCats = selectedTop ? cats.filter((c) => c.parent_category_id === selectedTop.category_id) : [];

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
      // Same conversion but optional fields default to 0 (no surcharge), not null —
      // variant_options surcharges are plain (non-optional) ints on the backend.
      const surchargeToPaise = (v) => {
        if (v === "" || v == null) return 0;
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error("Enter a valid surcharge in rupees");
        return Math.round(n * 100);
      };
      const { groups, ...rest } = form;
      const payload = {
        ...rest,
        price: rupeesToPaise(form.price) || 0,
        mrp: form.mrp ? rupeesToPaise(form.mrp) : null,
        images: form.images.split("\n").map((s) => s.trim()).filter(Boolean),
        attrs: JSON.parse(form.attrs || "{}"),
        // Number of pieces in stock — backend auto-generates a serial per unit.
        quantity: form.quantity ? Math.max(0, parseInt(form.quantity, 10) || 0) : 0,
        // One bullet point per line — shown on the product page under "Care & wear".
        care_instructions: form.care_instructions.split("\n").map((s) => s.trim()).filter(Boolean),
        // The product page's selectors. Which groups exist came from the category
        // template; the admin sets each choice's ₹ surcharge. The first choice of a
        // group is the free default (the backend enforces that too). show_if/optional
        // are carried through untouched — they're what makes Metal appear only for a
        // Ring/Pendant, so dropping them here would silently break the product page.
        variant_options: {
          groups: groups.map((g) => ({
            key: g.key,
            label: g.label,
            type: g.type,
            ...(g.show_if ? { show_if: g.show_if } : {}),
            ...(g.optional ? { optional: true } : {}),
            ...(g.priced === false ? { priced: false } : {}),
            choices: (g.choices || [])
              .map((c) => ({ label: c.label.trim(), surcharge: surchargeToPaise(c.surcharge) }))
              .filter((c) => c.label),
          })),
        },
      };
      if (editing === "new") {
        await api.post("/admin/products", payload);
        toast.success(payload.quantity ? `Product created · ${payload.quantity} pieces stocked` : "Product created");
      } else {
        await api.patch(`/admin/products/${editing.product_id}`, payload);
        toast.success("Product updated");
      }
      setEditing(null); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const del = async (p) => {
    if (!confirm(`Delete "${p.name}"? Its unsold inventory will be removed too. If it was never ordered it's deleted entirely; if it has past orders it's archived (and hidden), with its order history kept.`)) return;
    try {
      const { data } = await api.delete(`/admin/products/${p.product_id}`);
      const stock = data.units_removed ? ` · ${data.units_removed} unit${data.units_removed === 1 ? "" : "s"} removed` : "";
      toast.success((data.mode === "deleted" ? "Product deleted" : "Product archived") + stock);
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not delete"); }
  };

  // Option-group editor. Groups come from the category template; the admin prices the
  // choices and can add/remove extra ones (e.g. another size).
  const setChoice = (gi, ci, key, val) =>
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g, i) => (i !== gi ? g : {
        ...g,
        choices: g.choices.map((c, j) => (j === ci ? { ...c, [key]: val } : c)),
      })),
    }));
  const addChoice = (gi) =>
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g, i) => (i !== gi ? g : { ...g, choices: [...g.choices, { label: "", surcharge: "" }] })),
    }));
  const removeChoice = (gi, ci) =>
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g, i) => (i !== gi ? g : { ...g, choices: g.choices.filter((_, j) => j !== ci) })),
    }));

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

      <SearchBar value={query} onChange={setQuery} placeholder="Search products by name, slug or category…" testId="product-search" className="mb-6 max-w-md" />

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
            <select value={form.category} onChange={(e) => changeCategory(e.target.value)} data-testid="product-category-select" className="w-full gold-line px-3 py-2 bg-ivory">
              {topCats.map((c) => <option key={c.category_id} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {subCats.length > 0 && (
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Subcategory (optional)</div>
              <select value={form.subcategory_id} onChange={(e) => setForm({ ...form, subcategory_id: e.target.value })} data-testid="product-subcategory-select" className="w-full gold-line px-3 py-2 bg-ivory">
                <option value="">— none (file under {selectedTop?.label}) —</option>
                {subCats.map((c) => <option key={c.category_id} value={c.category_id}>{c.label}</option>)}
              </select>
            </label>
          )}
          {editing === "new" && (
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Number of pieces in stock</div>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder="e.g. 10" data-testid="product-quantity-input"
                className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
              />
              <div className="text-[10px] text-ink-muted mt-1">
                A serial number is generated automatically for each piece and added to inventory.
              </div>
            </label>
          )}

          {/* Pricing options — which selectors appear is driven by the category */}
          <div className="md:col-span-2 pt-2 border-t border-gold/20">
            <div className="text-xs uppercase tracking-widest text-gold-soft mt-3 mb-2">Pricing options</div>
            <div className="text-[10px] text-ink-muted mb-3">
              These selectors come from the <strong>{cats.find((c) => c.key === form.category)?.label || form.category}</strong> category
              and appear on the product page. The first choice in each is the free default the buyer starts on; set what each
              paid choice adds to the base price. A selector with only one choice isn't shown to buyers.
            </div>

            {form.groups.length === 0 ? (
              <div className="gold-line bg-cream px-3 py-4 text-xs text-ink-muted">
                This category has no buyer-selectable options — the product is sold exactly as listed.
              </div>
            ) : (
              <div className="space-y-4">
                {form.groups.map((g, gi) => {
                  // Form and Metal are unpriced — they only decide which designs apply,
                  // and the design carries the price. No ₹ inputs for those.
                  const priced = g.priced !== false;
                  return (
                    <div key={g.key} className="gold-line bg-cream p-3" data-testid={`product-group-${g.key}`}>
                      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
                        <div className="text-xs uppercase tracking-widest text-maroon">{g.label}</div>
                        <div className="text-[10px] font-mono text-ink-muted">
                          {g.show_if && `shown only for ${g.show_if.values.join(" / ")} · `}{g.type}
                        </div>
                      </div>
                      {!priced && (
                        <div className="text-[10px] text-ink-muted mb-2">
                          No charge here — priced per design in <strong>Designs</strong>.
                        </div>
                      )}
                      <div className="space-y-2">
                        {g.choices.map((c, ci) => {
                          const isDefault = ci === 0;
                          return (
                            <div key={ci} className="flex gap-2 items-center">
                              <input
                                value={c.label}
                                onChange={(e) => setChoice(gi, ci, "label", e.target.value)}
                                placeholder="Option label"
                                data-testid={`product-${g.key}-label-${ci}`}
                                className="flex-1 gold-line bg-ivory px-3 py-2 outline-none focus:border-maroon text-sm"
                              />
                              {priced && (
                                <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon w-36 shrink-0">
                                  <span className="px-2 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd text-sm">₹</span>
                                  {isDefault ? (
                                    <span className="flex-1 px-2 py-2 text-xs text-ink-muted self-center">Included</span>
                                  ) : (
                                    <input
                                      type="number" min="0" step="0.01" inputMode="decimal"
                                      value={c.surcharge}
                                      onChange={(e) => setChoice(gi, ci, "surcharge", e.target.value)}
                                      placeholder="0"
                                      data-testid={`product-${g.key}-surcharge-${ci}`}
                                      className="flex-1 px-2 py-2 outline-none text-sm"
                                    />
                                  )}
                                </div>
                              )}
                              {!isDefault ? (
                                <button type="button" onClick={() => removeChoice(gi, ci)} className="text-ink-muted hover:text-revoked shrink-0">
                                  <Trash size={14} />
                                </button>
                              ) : (
                                <span className="w-[14px] shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" onClick={() => addChoice(gi)} data-testid={`product-${g.key}-add`} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1">
                        <PlusCircle size={12} /> Add option
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Care & wear instructions (one bullet point per line)</div>
            <textarea
              rows={4} value={form.care_instructions}
              onChange={(e) => setForm({ ...form, care_instructions: e.target.value })}
              placeholder={"e.g.\nWear on the correct finger and metal as advised.\nCleanse in raw milk on the first Monday of every month.\nNever share the stone."}
              data-testid="product-care-instructions-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
            />
            <div className="text-[10px] text-ink-muted mt-1">Shown as bullet points on the product page.</div>
          </label>
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="border border-gold/40 text-ink-soft px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      {shown.length === 0 && (
        <div className="gold-line p-10 text-center text-ink-muted">
          {query ? `No products match “${query}”.` : "No products yet."}
        </div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((p) => (
          <div key={p.product_id} className="gold-line bg-ivory p-4 flex gap-4">
            {p.images?.[0] && <div className="w-24 h-24 gold-line overflow-hidden shrink-0"><img src={p.images[0]} alt="" className="w-full h-full object-cover" /></div>}
            <div className="flex-1 min-w-0">
              <div className="font-serifd text-lg truncate">{p.name}</div>
              <div className="text-xs font-mono text-ink-muted">
                {p.category}{p.subcategory ? ` · ${p.subcategory}` : ""}
              </div>
              <div className="text-sm text-maroon-deep">{formatINR(p.price)}</div>
              {p.is_serialized && (
                <div className="mt-1 text-xs text-ink-muted">In stock: <span className="text-ink font-medium">{stock[p.product_id] || 0}</span></div>
              )}
              <div className="mt-2 flex gap-3 text-xs">
                <button onClick={() => startEdit(p)} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
                <button onClick={() => del(p)} className="text-revoked inline-flex items-center gap-1 ml-auto"><Trash size={12} /> Remove</button>
              </div>
              {p.is_serialized && (
                <div className="mt-3 pt-3 border-t border-gold/20 flex items-center gap-2">
                  <input
                    type="number" min="1" step="1" inputMode="numeric"
                    value={addQty[p.product_id] || ""}
                    onChange={(e) => setAddQty((s) => ({ ...s, [p.product_id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addUnits(p)}
                    placeholder="Qty"
                    data-testid={`add-units-qty-${p.product_id}`}
                    className="w-20 gold-line px-2 py-1.5 text-sm outline-none focus:border-maroon"
                  />
                  <button
                    onClick={() => addUnits(p)}
                    data-testid={`add-units-btn-${p.product_id}`}
                    className="text-xs uppercase tracking-widest border border-maroon text-maroon px-3 py-1.5 inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory transition-colors"
                  >
                    <Stack size={12} weight="duotone" /> Add units
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
