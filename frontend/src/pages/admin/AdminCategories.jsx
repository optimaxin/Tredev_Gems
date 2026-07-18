import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, Trash, PencilSimple } from "@phosphor-icons/react";

// Icons the storefront banner can render for a step (mirrors CategoryBanner's ICONS).
const STEP_ICONS = ["sparkle", "drop", "sun", "moon", "leaf", "lotus", "hand", "shield",
  "qr", "compass", "ruler", "package", "clock", "scroll"];

const emptyBanner = () => ({
  image: "", badge_label: "", intro: "",
  cta_primary: { label: "", href: "" }, cta_secondary: { label: "", href: "" },
  about: "", who_should_wear: "", quality: "", price: "",
  how_to_wear: [], how_to_care: [], benefits: [], faqs: [],
});
// Merge a saved banner onto the full shape so every nested field exists in the form.
const bannerToForm = (b) => {
  const base = emptyBanner();
  return {
    ...base, ...(b || {}),
    cta_primary: { ...base.cta_primary, ...(b?.cta_primary || {}) },
    cta_secondary: { ...base.cta_secondary, ...(b?.cta_secondary || {}) },
    how_to_wear: b?.how_to_wear || [], how_to_care: b?.how_to_care || [],
    benefits: b?.benefits || [], faqs: b?.faqs || [],
  };
};

const EMPTY = { key: "", label: "", hindi: "", parent_id: "", order: 100, banner: emptyBanner() };

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon";

export default function AdminCategories() {
  const [cats, setCats] = useState([]);
  const [editing, setEditing] = useState(null); // "new" | cat | null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => api.get("/admin/categories").then((r) => setCats(r.data));
  useEffect(() => { refresh(); }, []);

  const startNew = () => { setEditing("new"); setForm(EMPTY); };
  const startEdit = (c) => {
    setEditing(c);
    setForm({ ...EMPTY, ...c, parent_id: c.parent_category_id || "", banner: bannerToForm(c.banner) });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, order: parseInt(form.order) || 100, parent_id: form.parent_id || null };
      if (editing === "new") await api.post("/admin/categories", payload);
      else await api.patch(`/admin/categories/${editing.category_id}`, payload);
      toast.success("Saved"); setEditing(null); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const remove = async (c) => {
    if (!confirm(`Delete category ${c.label}?`)) return;
    await api.delete(`/admin/categories/${c.category_id}`);
    toast.success("Deleted"); refresh();
  };

  // Banner-field helpers.
  const setB = (k, v) => setForm((f) => ({ ...f, banner: { ...f.banner, [k]: v } }));
  const setCta = (which, k, v) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, [which]: { ...f.banner[which], [k]: v } } }));
  const setStep = (sec, i, k, v) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, [sec]: f.banner[sec].map((s, j) => (j === i ? { ...s, [k]: v } : s)) } }));
  const addStep = (sec) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, [sec]: [...f.banner[sec], { icon: "sparkle", title: "", body: "" }] } }));
  const rmStep = (sec, i) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, [sec]: f.banner[sec].filter((_, j) => j !== i) } }));
  const setFaq = (i, k, v) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, faqs: f.banner.faqs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) } }));
  const addFaq = () =>
    setForm((f) => ({ ...f, banner: { ...f.banner, faqs: [...f.banner.faqs, { q: "", a: "" }] } }));
  const rmFaq = (i) =>
    setForm((f) => ({ ...f, banner: { ...f.banner, faqs: f.banner.faqs.filter((_, j) => j !== i) } }));

  const parents = cats.filter((c) => !c.parent_category_id);
  const asTree = parents.map((p) => ({ ...p, subs: cats.filter((c) => c.parent_category_id === p.category_id) }));
  const isSub = !!form.parent_id; // creating/editing a subcategory

  // Repeatable icon+title+body editor for How to Wear / How to Care / Benefits.
  // A render function, not a component, so React doesn't remount it (and drop input
  // focus) on every keystroke.
  const renderSteps = (sec, label) => (
    <div className="md:col-span-2 gold-line bg-cream p-3">
      <div className="text-xs uppercase tracking-widest text-maroon mb-2">{label}</div>
      <div className="space-y-3">
        {form.banner[sec].map((s, i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-2 items-start">
            <select value={s.icon} onChange={(e) => setStep(sec, i, "icon", e.target.value)} className="gold-line px-2 py-2 bg-ivory text-sm">
              {STEP_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
            </select>
            <div className="space-y-2">
              <input value={s.title} onChange={(e) => setStep(sec, i, "title", e.target.value)} placeholder="Step title" className={inputCls + " text-sm"} />
              <textarea rows={2} value={s.body} onChange={(e) => setStep(sec, i, "body", e.target.value)} placeholder="Step description" className={inputCls + " text-sm"} />
            </div>
            <button type="button" onClick={() => rmStep(sec, i)} className="text-ink-muted hover:text-revoked mt-2"><Trash size={14} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => addStep(sec)} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> Add step</button>
      {form.banner[sec].length === 0 && <div className="text-[10px] text-ink-muted mt-1">Empty → the built-in steps for this category are shown.</div>}
    </div>
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Taxonomy</div>
          <h1 className="font-display text-4xl text-ink mt-1">Categories</h1>
        </div>
        <button onClick={startNew} className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2">
          <PlusCircle size={14} weight="duotone" /> New category
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">{editing === "new" ? "New category" : `Edit · ${editing.label}`}</div>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Parent (leave blank for a top-level category)</div>
            <select value={form.parent_id || ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory" data-testid="category-parent-select">
              <option value="">— none (top-level)</option>
              {parents.filter((p) => p.category_id !== editing?.category_id).map((p) => <option key={p.category_id} value={p.category_id}>{p.label}</option>)}
            </select>
            {isSub && <div className="text-[10px] text-ink-muted mt-1">A subcategory inherits its parent's type &amp; product options.</div>}
          </label>
          {!isSub && (
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Key (type — fixed set)</div>
              <input required disabled={editing !== "new"} value={form.key || ""} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase() })} className={inputCls + " font-mono disabled:bg-cream"} placeholder="e.g. gemstone" />
            </label>
          )}
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Label ({isSub ? "subcategory" : "banner"} title)</div>
            <input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Devanagari (shown above the title)</div>
            <input value={form.hindi || ""} onChange={(e) => setForm({ ...form, hindi: e.target.value })} className={inputCls + " font-deva"} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Order</div>
            <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} className={inputCls} />
          </label>

          {/* ── Collection banner ── */}
          <div className="md:col-span-2 pt-3 mt-1 border-t border-gold/20">
            <div className="text-xs uppercase tracking-widest text-gold-soft mb-1">Collection banner</div>
            <div className="text-[10px] text-ink-muted mb-4">
              Shown on the shop page for this category. Leave any field blank to fall back to the built-in copy.
            </div>
          </div>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Banner image URL</div>
            <input value={form.banner.image} onChange={(e) => setB("image", e.target.value)} placeholder="https://…" className={inputCls + " font-mono text-xs"} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Badge text</div>
            <input value={form.banner.badge_label} onChange={(e) => setB("badge_label", e.target.value)} placeholder="Certified collection" className={inputCls} />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-ink-muted mb-1">Description (intro under the title)</div>
            <textarea rows={3} value={form.banner.intro} onChange={(e) => setB("intro", e.target.value)} className={inputCls} />
          </label>
          <div className="md:col-span-2 grid md:grid-cols-2 gap-4">
            {[["cta_primary", "Primary button"], ["cta_secondary", "Secondary button"]].map(([which, lbl]) => (
              <div key={which} className="gold-line bg-cream p-3">
                <div className="text-xs uppercase tracking-widest text-maroon mb-2">{lbl}</div>
                <input value={form.banner[which].label} onChange={(e) => setCta(which, "label", e.target.value)} placeholder="Label" className={inputCls + " text-sm mb-2"} />
                <input value={form.banner[which].href} onChange={(e) => setCta(which, "href", e.target.value)} placeholder="Link (e.g. /consultation or #collection-grid)" className={inputCls + " text-sm font-mono"} />
              </div>
            ))}
          </div>
          {[["about", "About"], ["who_should_wear", "Who Should Wear"], ["quality", "Quality"], ["price", "Price"]].map(([k, lbl]) => (
            <label key={k} className="block md:col-span-2">
              <div className="text-xs text-ink-muted mb-1">{lbl}</div>
              <textarea rows={3} value={form.banner[k]} onChange={(e) => setB(k, e.target.value)} className={inputCls} />
            </label>
          ))}
          {renderSteps("how_to_wear", "How to Wear (steps)")}
          {renderSteps("how_to_care", "How to Care (steps)")}
          {renderSteps("benefits", "Benefits (steps)")}
          <div className="md:col-span-2 gold-line bg-cream p-3">
            <div className="text-xs uppercase tracking-widest text-maroon mb-2">FAQs</div>
            <div className="space-y-3">
              {form.banner.faqs.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <div className="space-y-2">
                    <input value={f.q} onChange={(e) => setFaq(i, "q", e.target.value)} placeholder="Question" className={inputCls + " text-sm"} />
                    <textarea rows={2} value={f.a} onChange={(e) => setFaq(i, "a", e.target.value)} placeholder="Answer" className={inputCls + " text-sm"} />
                  </div>
                  <button type="button" onClick={() => rmFaq(i)} className="text-ink-muted hover:text-revoked mt-2"><Trash size={14} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addFaq} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> Add FAQ</button>
            <div className="text-[10px] text-ink-muted mt-1">Your FAQs appear first; the standard authenticity/returns FAQs are always appended.</div>
          </div>

          <div className="md:col-span-2 flex gap-3">
            <button type="submit" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="border border-gold/40 px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {asTree.map((c) => (
          <div key={c.category_id} className="gold-line bg-ivory p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="font-serifd text-lg">{c.label}</span>
                <span className="ml-2 font-mono text-xs text-ink-muted">{c.key}</span>
                <span className="ml-2 font-deva text-gold-soft">{c.hindi}</span>
                {c.banner && Object.keys(c.banner).length > 0 && <span className="ml-2 text-[10px] uppercase tracking-widest text-verified">banner set</span>}
              </div>
              <div className="flex gap-3 text-xs">
                <button onClick={() => startEdit(c)} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
                <button onClick={() => remove(c)} className="text-revoked inline-flex items-center gap-1"><Trash size={12} /> Delete</button>
              </div>
            </div>
            {c.subs.length > 0 && (
              <div className="mt-3 pl-4 border-l-2 border-gold/30 space-y-2">
                {c.subs.map((s) => (
                  <div key={s.category_id} className="flex items-baseline justify-between">
                    <div className="text-sm">{s.label} <span className="font-mono text-xs text-ink-muted">{s.key}</span></div>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => startEdit(s)} className="text-maroon">Edit</button>
                      <button onClick={() => remove(s)} className="text-revoked">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
