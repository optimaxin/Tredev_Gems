import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, Trash, PencilSimple } from "@phosphor-icons/react";

const EMPTY = { key: "", label: "", hindi: "", parent_key: "", order: 100 };

export default function AdminCategories() {
  const [cats, setCats] = useState([]);
  const [editing, setEditing] = useState(null); // "new" | cat | null
  const [form, setForm] = useState(EMPTY);

  const refresh = () => api.get("/admin/categories").then((r) => setCats(r.data));
  useEffect(() => { refresh(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, order: parseInt(form.order) || 100, parent_key: form.parent_key || null };
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

  const parents = cats.filter((c) => !c.parent_key);
  const asTree = parents.map((p) => ({ ...p, subs: cats.filter((c) => c.parent_key === p.key) }));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Taxonomy</div>
          <h1 className="font-display text-4xl text-ink mt-1">Categories</h1>
        </div>
        <button onClick={() => { setEditing("new"); setForm(EMPTY); }} className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2">
          <PlusCircle size={14} weight="duotone" /> New category
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2 font-serifd text-xl text-maroon-deep">{editing === "new" ? "New category" : `Edit · ${editing.label}`}</div>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Key (slug)</div>
            <input required disabled={editing !== "new"} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase() })} className="w-full gold-line px-3 py-2 font-mono outline-none focus:border-maroon disabled:bg-cream" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Label</div>
            <input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Hindi</div>
            <input value={form.hindi || ""} onChange={(e) => setForm({ ...form, hindi: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon font-deva" />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Parent (for subcategory)</div>
            <select value={form.parent_key || ""} onChange={(e) => setForm({ ...form, parent_key: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory">
              <option value="">— none (top-level)</option>
              {parents.filter((p) => p.category_id !== editing?.category_id).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Order</div>
            <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
          </label>
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
              </div>
              <div className="flex gap-3 text-xs">
                <button onClick={() => { setEditing(c); setForm({ ...c, parent_key: c.parent_key || "" }); }} className="text-maroon inline-flex items-center gap-1"><PencilSimple size={12} /> Edit</button>
                <button onClick={() => remove(c)} className="text-revoked inline-flex items-center gap-1"><Trash size={12} /> Delete</button>
              </div>
            </div>
            {c.subs.length > 0 && (
              <div className="mt-3 pl-4 border-l-2 border-gold/30 space-y-2">
                {c.subs.map((s) => (
                  <div key={s.category_id} className="flex items-baseline justify-between">
                    <div className="text-sm">{s.label} <span className="font-mono text-xs text-ink-muted">{s.key}</span></div>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => { setEditing(s); setForm({ ...s, parent_key: s.parent_key || "" }); }} className="text-maroon">Edit</button>
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
