import React, { useEffect, useState } from "react";
import { api, formatINR, mediaSrc } from "@/lib/api";
import { toast } from "sonner";
import { PencilSimple, PlusCircle, Trash, Stack, Prohibit, CheckCircle, Image as ImageIcon, VideoCamera, LinkSimple, Eye, EyeSlash } from "@phosphor-icons/react";
import SearchBar from "@/components/gemora/SearchBar";
import ShippingChargesEditor from "@/components/gemora/ShippingChargesEditor";
import AsyncButton from "@/components/gemora/AsyncButton";
import MediaPicker from "@/components/gemora/MediaPicker";

const EMPTY = {
  name: "", slug: "", category: "gemstone", subcategory_id: "", description: "", price: "", mrp: "",
  price_usd: "", // shown/charged to visitors outside India
  images: [], video_url: "", devanagari_name: "", attrs: "{}", quantity: "", care_instructions: "", how_to_wear: "", benefits: "",
  groups: [], // option groups, seeded from the category template
  shipping_charges: [], // [{region, amount}] — USD, outside-India only
  hsn_code: "", gst_rate_bp: "", uqc: "", // gst_rate_bp is edited as a percentage here
};

const UQC_OPTIONS = ["PCS", "NOS", "GMS", "CTM", "SET", "PAC"];

// Surcharges travel as paise/cents; the form edits rupees/dollars.
const groupsToForm = (groups) =>
  (groups || []).map((g) => ({
    ...g, // keeps show_if / optional intact for the round-trip back to the API
    choices: (g.choices || []).map((c) => ({
      ...c,
      surcharge: c.surcharge ? (c.surcharge / 100).toString() : "",
      surcharge_usd: c.surcharge_usd ? (c.surcharge_usd / 100).toString() : "",
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
  const [saving, setSaving] = useState(false);
  const [addingUnitsFor, setAddingUnitsFor] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [videoPromptOpen, setVideoPromptOpen] = useState(false);
  const [videoDraft, setVideoDraft] = useState("");

  const refresh = () => {
    // The admin list, not the public /products — that one filters to status='active'
    // only, so a product toggled off would vanish from this screen too and have no
    // way back short of the database.
    api.get("/admin/products?limit=500").then((r) => setProducts(r.data));
    api.get("/categories").then((r) => setCats(r.data.categories));
    api.get("/admin/products/stock").then((r) => setStock(r.data)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  // Add more units to an existing serialized product, right from this page — serials
  // are auto-generated, so there's no re-entering them one by one.
  const addUnits = async (p) => {
    const qty = Math.max(0, parseInt(addQty[p.product_id], 10) || 0);
    if (!qty) { toast.error("Enter how many pieces to add"); return; }
    setAddingUnitsFor(p.product_id);
    try {
      const { data } = await api.post("/admin/units/bulk", { product_id: p.product_id, quantity: qty });
      toast.success(`${data.count} piece${data.count === 1 ? "" : "s"} added to ${p.name}`);
      setAddQty((s) => ({ ...s, [p.product_id]: "" }));
      api.get("/admin/products/stock").then((r) => setStock(r.data)).catch(() => {});
    } catch (e) { toast.error(e.response?.data?.detail || "Could not add units"); }
    finally { setAddingUnitsFor((id) => (id === p.product_id ? null : id)); }
  };

  // Manual override — works for serialized and non-serialized products alike, unlike
  // the automatic "0 units left" signal, which only applies to serialized stock.
  // attrs is fully replaced on PATCH, so the current value has to be spread through.
  const toggleOutOfStock = async (p) => {
    const next = !p.attrs?.out_of_stock;
    const prevProducts = products;
    setProducts((cur) => cur.map((x) =>
      x.product_id === p.product_id ? { ...x, attrs: { ...x.attrs, out_of_stock: next } } : x));
    try {
      await api.patch(`/admin/products/${p.product_id}`, { attrs: { ...p.attrs, out_of_stock: next } });
      toast.success(next ? `${p.name} marked out of stock` : `${p.name} marked back in stock`);
    } catch (e) {
      setProducts(prevProducts);
      toast.error(e.response?.data?.detail || "Could not update stock status");
    }
  };

  // Live/hidden — is_active drives whether the product shows up anywhere on the
  // public site (product.status = 'active' vs 'archived'). Unlike out-of-stock,
  // this hides the listing entirely rather than just blocking purchase.
  const toggleLive = async (p) => {
    const next = !p.is_active;
    const prevProducts = products;
    setProducts((cur) => cur.map((x) =>
      x.product_id === p.product_id ? { ...x, is_active: next } : x));
    try {
      await api.patch(`/admin/products/${p.product_id}`, { is_active: next });
      toast.success(next ? `${p.name} is now live on the site` : `${p.name} is now hidden from the site`);
    } catch (e) {
      setProducts(prevProducts);
      toast.error(e.response?.data?.detail || "Could not update visibility");
    }
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
      // DB stores paise/cents; UI shows rupees/dollars.
      price: p.price != null ? (p.price / 100).toString() : "",
      price_usd: p.price_usd != null ? (p.price_usd / 100).toString() : "",
      mrp: p.mrp != null ? (p.mrp / 100).toString() : "",
      // Stored in basis points; the form edits percent.
      hsn_code: p.hsn_code || "",
      gst_rate_bp: p.gst_rate_bp != null ? (p.gst_rate_bp / 100).toString() : "",
      uqc: p.uqc || "",
      video_url: p.video_url || "",
      images: p.images || [],
      attrs: JSON.stringify(p.attrs || {}, null, 2),
      care_instructions: (p.care_instructions || []).join("\n"),
      how_to_wear: (p.how_to_wear || []).join("\n"),
      benefits: (p.benefits || []).join("\n"),
      groups: groupsToForm(p.variant_options?.groups),
      shipping_charges: Object.entries(p.shipping_charges || {}).map(([region, amount]) => ({
        region, amount: amount.toString(),
      })),
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
    setSaving(true);
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
      // Unlike surcharge, blank here means "no USD price set" (null), not "free" (0) —
      // _compute_variant_price treats those very differently for USD checkout.
      const surchargeUsdToCents = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error("Enter a valid USD surcharge");
        return Math.round(n * 100);
      };
      // Blank means "no USD price set" (null), not "free" (0) — a product with no
      // price_usd falls back to showing its ₹ price outside India.
      const priceUsdToCents = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error("Enter a valid USD price");
        return Math.round(n * 100);
      };
      // The form edits a percentage (3, 0.25, 12); the API stores basis points.
      const percentToBp = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error("Enter a valid GST rate in percent");
        return Math.round(n * 100);
      };
      const { groups, shipping_charges, ...rest } = form;
      const payload = {
        ...rest,
        price: rupeesToPaise(form.price) || 0,
        price_usd: priceUsdToCents(form.price_usd),
        mrp: form.mrp ? rupeesToPaise(form.mrp) : null,
        hsn_code: form.hsn_code.trim() || null,
        gst_rate_bp: percentToBp(form.gst_rate_bp),
        uqc: form.uqc || null,
        video_url: form.video_url.trim() || null,
        // Region label -> USD amount (major unit, dollars — this is jsonb on the
        // product row, not paise like price/mrp above).
        shipping_charges: Object.fromEntries(
          shipping_charges
            .filter((r) => r.region && r.amount !== "")
            .map((r) => {
              const n = Number(r.amount);
              if (isNaN(n) || n < 0) throw new Error(`Enter a valid shipping charge for ${r.region}`);
              return [r.region, n];
            })),
        images: form.images.filter(Boolean),
        attrs: JSON.parse(form.attrs || "{}"),
        // Number of pieces in stock — backend auto-generates a serial per unit.
        quantity: form.quantity ? Math.max(0, parseInt(form.quantity, 10) || 0) : 0,
        // One bullet point per line — shown on the product page under "Care & wear".
        care_instructions: form.care_instructions.split("\n").map((s) => s.trim()).filter(Boolean),
        how_to_wear: form.how_to_wear.split("\n").map((s) => s.trim()).filter(Boolean),
        benefits: form.benefits.split("\n").map((s) => s.trim()).filter(Boolean),
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
              .map((c) => ({
                label: c.label.trim(),
                surcharge: surchargeToPaise(c.surcharge),
                surcharge_usd: surchargeUsdToCents(c.surcharge_usd),
              }))
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
    finally { setSaving(false); }
  };

  const del = async (p) => {
    if (!confirm(`Delete "${p.name}"? Its unsold inventory will be removed too. If it was never ordered it's deleted entirely; if it has past orders it's archived (and hidden), with its order history kept.`)) return;
    const prevProducts = products;
    setProducts((cur) => cur.filter((x) => x.product_id !== p.product_id));
    try {
      const { data } = await api.delete(`/admin/products/${p.product_id}`);
      const stock = data.units_removed ? ` · ${data.units_removed} unit${data.units_removed === 1 ? "" : "s"} removed` : "";
      toast.success((data.mode === "deleted" ? "Product deleted" : "Product archived") + stock);
    } catch (e) {
      setProducts(prevProducts);
      toast.error(e.response?.data?.detail || "Could not delete");
    }
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
      groups: f.groups.map((g, i) => (i !== gi ? g : { ...g, choices: [...g.choices, { label: "", surcharge: "", surcharge_usd: "" }] })),
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
            <div className="text-xs text-ink-muted mb-1">USD price — shown/charged outside India, optional</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd">$</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={form.price_usd} onChange={(e) => setForm({ ...form, price_usd: e.target.value })}
                placeholder="e.g. 105" data-testid="product-price-usd-input"
                className="flex-1 px-3 py-2 outline-none"
              />
            </div>
            <div className="text-[10px] text-ink-muted mt-1">Left blank, visitors outside India see the ₹ price instead.</div>
          </label>

          <div className="md:col-span-2 pt-2 border-t border-gold/20">
            <ShippingChargesEditor
              rows={form.shipping_charges}
              onChange={(shipping_charges) => setForm((f) => ({ ...f, shipping_charges }))}
            />
          </div>

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

          <div className="md:col-span-2 pt-2 border-t border-gold/20">
            <div className="text-xs uppercase tracking-widest text-gold-soft mt-3 mb-2">GST / Tax</div>
            <div className="text-[10px] text-ink-muted mb-3">
              A product without all three of these set can't be invoiced — the tax invoice is blocked until they're filled in.
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">HSN code</div>
                <input
                  value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
                  maxLength={8} placeholder="e.g. 71031029" data-testid="product-hsn-code-input"
                  className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
                />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">GST rate (%)</div>
                <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    value={form.gst_rate_bp} onChange={(e) => setForm({ ...form, gst_rate_bp: e.target.value })}
                    placeholder="e.g. 3" data-testid="product-gst-rate-input"
                    className="flex-1 px-3 py-2 outline-none"
                  />
                  <span className="px-3 py-2 bg-cream text-ink-soft border-l border-gold/30 font-serifd">%</span>
                </div>
                {form.gst_rate_bp !== "" && !isNaN(Number(form.gst_rate_bp)) && (
                  <div className="text-[10px] font-mono text-ink-muted mt-1">
                    = {Math.round(Number(form.gst_rate_bp) * 100)} basis points (stored)
                  </div>
                )}
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Unit (UQC)</div>
                <select value={form.uqc} onChange={(e) => setForm({ ...form, uqc: e.target.value })} data-testid="product-uqc-select" className="w-full gold-line px-3 py-2 bg-ivory">
                  <option value="">—</option>
                  {UQC_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            </div>
          </div>

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
                              {priced && !isDefault && (
                                <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon w-28 shrink-0" title="USD price — for international checkout. Left blank, this choice can't be added to a USD checkout.">
                                  <span className="px-2 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd text-sm">$</span>
                                  <input
                                    type="number" min="0" step="0.01" inputMode="decimal"
                                    value={c.surcharge_usd}
                                    onChange={(e) => setChoice(gi, ci, "surcharge_usd", e.target.value)}
                                    placeholder="—"
                                    data-testid={`product-${g.key}-surcharge-usd-${ci}`}
                                    className="flex-1 px-2 py-2 outline-none text-sm"
                                  />
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
          <div className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Images</div>
            <div className="flex flex-wrap gap-3">
              {form.images.map((url, i) => (
                <div key={i} className="relative w-24 h-24 gold-line bg-cream overflow-hidden group shrink-0">
                  <img src={mediaSrc(url)} alt="" className="w-full h-full object-cover" />
                  <button type="button"
                    onClick={() => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}
                    className="absolute top-1 right-1 bg-ivory/90 hover:bg-revoked hover:text-ivory text-revoked p-1 border border-gold/40 opacity-0 group-hover:opacity-100 transition"
                    title="Remove">
                    <Trash size={11} weight="bold" />
                  </button>
                  {i === 0 && <div className="absolute bottom-0 inset-x-0 bg-maroon-deep/80 text-ivory text-[9px] text-center py-0.5">Cover</div>}
                </div>
              ))}
              {form.video_url && (
                <div className="relative w-24 h-24 gold-line bg-maroon-deep/90 overflow-hidden group shrink-0 flex flex-col items-center justify-center gap-1 text-ivory">
                  <VideoCamera size={22} weight="duotone" />
                  <span className="text-[9px] uppercase tracking-widest">Video</span>
                  <button type="button"
                    onClick={() => setForm((f) => ({ ...f, video_url: "" }))}
                    className="absolute top-1 right-1 bg-ivory/90 hover:bg-revoked hover:text-ivory text-revoked p-1 border border-gold/40 opacity-0 group-hover:opacity-100 transition"
                    title="Remove video">
                    <Trash size={11} weight="bold" />
                  </button>
                </div>
              )}
              <div className="relative shrink-0">
                <button type="button" onClick={() => setAddMenuOpen((o) => !o)} data-testid="product-add-image"
                  className="w-24 h-24 border border-dashed border-gold/50 text-ink-muted hover:border-maroon hover:text-maroon flex flex-col items-center justify-center gap-1">
                  <PlusCircle size={20} />
                  <span className="text-[10px] uppercase tracking-widest">Add</span>
                </button>
                {addMenuOpen && (
                  <div className="absolute z-10 top-full left-0 mt-1 w-40 bg-ivory gold-line-strong shadow-lg py-1">
                    <button type="button"
                      onClick={() => { setAddMenuOpen(false); setShowPicker(true); }}
                      data-testid="product-add-image-option"
                      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-cream text-ink">
                      <ImageIcon size={14} /> Add image
                    </button>
                    <button type="button"
                      onClick={() => { setAddMenuOpen(false); setVideoDraft(form.video_url || ""); setVideoPromptOpen(true); }}
                      data-testid="product-add-video-option"
                      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-cream text-ink">
                      <VideoCamera size={14} /> Add video
                    </button>
                  </div>
                )}
              </div>
            </div>
            {videoPromptOpen && (
              <div className="mt-2 flex items-center gap-2">
                <LinkSimple size={14} className="text-ink-muted shrink-0" />
                <input
                  autoFocus
                  value={videoDraft}
                  onChange={(e) => setVideoDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setForm((f) => ({ ...f, video_url: videoDraft.trim() })); setVideoPromptOpen(false); } }}
                  placeholder="Paste a video link — e.g. an unlisted YouTube URL"
                  data-testid="product-video-link-input"
                  className="flex-1 gold-line px-3 py-2 text-sm outline-none focus:border-maroon"
                />
                <button type="button"
                  onClick={() => { setForm((f) => ({ ...f, video_url: videoDraft.trim() })); setVideoPromptOpen(false); }}
                  data-testid="product-video-link-submit"
                  className="brand-gradient text-ivory px-4 py-2 text-xs uppercase tracking-widest">
                  Save
                </button>
                <button type="button" onClick={() => setVideoPromptOpen(false)} className="text-ink-muted hover:text-maroon px-2">
                  Cancel
                </button>
              </div>
            )}
            <div className="text-[10px] text-ink-muted mt-1">First image is the cover shown on product cards.</div>
          </div>
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
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">How to wear (one bullet point per line)</div>
            <textarea
              rows={4} value={form.how_to_wear}
              onChange={(e) => setForm({ ...form, how_to_wear: e.target.value })}
              placeholder={"e.g.\nWear on a Monday morning after a bath.\nChant the mantra 108 times before the first wear.\nKeep it against the skin."}
              data-testid="product-how-to-wear-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
            />
            <div className="text-[10px] text-ink-muted mt-1">Shown as bullet points on the product page.</div>
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Benefits (one bullet point per line)</div>
            <textarea
              rows={4} value={form.benefits}
              onChange={(e) => setForm({ ...form, benefits: e.target.value })}
              placeholder={"e.g.\nStrengthens focus and clarity of mind.\nSupports a calmer, steadier practice.\nCarries the intention it was chosen for."}
              data-testid="product-benefits-input"
              className="w-full gold-line px-3 py-2 outline-none focus:border-maroon"
            />
            <div className="text-[10px] text-ink-muted mt-1">Shown as bullet points on the product page.</div>
          </label>
          <div className="md:col-span-2 flex gap-3">
            <AsyncButton type="submit" loading={saving} loadingText="Saving…" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</AsyncButton>
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
            {p.images?.[0] && <div className="w-24 h-24 gold-line overflow-hidden shrink-0"><img src={mediaSrc(p.images[0])} alt="" className="w-full h-full object-cover" /></div>}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="font-serifd text-lg truncate">{p.name}</div>
                <span className={`shrink-0 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 ${p.is_active ? "text-verified" : "text-ink-muted"}`}>
                  ● {p.is_active ? "Live" : "Hidden"}
                </span>
              </div>
              <div className="text-xs font-mono text-ink-muted">
                {p.category}{p.subcategory ? ` · ${p.subcategory}` : ""}
              </div>
              <div className="text-sm text-maroon-deep">{formatINR(p.price)}</div>
              {p.is_serialized && (
                <div className="mt-1 text-xs text-ink-muted">In stock: <span className="text-ink font-medium">{stock[p.product_id] || 0}</span></div>
              )}
              {p.attrs?.out_of_stock && (
                <div className="mt-1 text-xs text-revoked uppercase tracking-widest">Marked out of stock</div>
              )}
              <div className="mt-2 flex gap-3 text-xs">
                <button onClick={() => startEdit(p)} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
                <button onClick={() => del(p)} className="text-revoked inline-flex items-center gap-1 ml-auto"><Trash size={12} /> Remove</button>
              </div>
              <button
                onClick={() => toggleLive(p)}
                data-testid={`toggle-live-${p.product_id}`}
                className={`mt-2 w-full text-xs uppercase tracking-widest border px-3 py-1.5 inline-flex items-center justify-center gap-1 transition-colors ${
                  p.is_active
                    ? "border-revoked text-revoked hover:bg-revoked hover:text-ivory"
                    : "border-verified text-verified hover:bg-verified hover:text-ivory"
                }`}
              >
                {p.is_active
                  ? <><EyeSlash size={12} weight="duotone" /> Hide from site</>
                  : <><Eye size={12} weight="duotone" /> Make live</>}
              </button>
              <button
                onClick={() => toggleOutOfStock(p)}
                data-testid={`toggle-out-of-stock-${p.product_id}`}
                className={`mt-2 w-full text-xs uppercase tracking-widest border px-3 py-1.5 inline-flex items-center justify-center gap-1 transition-colors ${
                  p.attrs?.out_of_stock
                    ? "border-verified text-verified hover:bg-verified hover:text-ivory"
                    : "border-revoked text-revoked hover:bg-revoked hover:text-ivory"
                }`}
              >
                {p.attrs?.out_of_stock
                  ? <><CheckCircle size={12} weight="duotone" /> Mark back in stock</>
                  : <><Prohibit size={12} weight="duotone" /> Mark out of stock</>}
              </button>
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
                  <AsyncButton
                    onClick={() => addUnits(p)}
                    loading={addingUnitsFor === p.product_id}
                    loadingText="Adding…"
                    data-testid={`add-units-btn-${p.product_id}`}
                    className="text-xs uppercase tracking-widest border border-maroon text-maroon px-3 py-1.5 inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory transition-colors"
                  >
                    <Stack size={12} weight="duotone" /> Add units
                  </AsyncButton>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <MediaPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onPick={(m) => { setForm((f) => ({ ...f, images: [...f.images, m.url] })); setShowPicker(false); }}
      />
    </div>
  );
}
