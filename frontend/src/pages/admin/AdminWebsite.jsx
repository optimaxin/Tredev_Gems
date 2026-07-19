import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PlusCircle, Trash, FloppyDisk } from "@phosphor-icons/react";

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm";
const Section = ({ title, hint, children }) => (
  <section className="gold-line-strong bg-ivory p-6 mb-8">
    <div className="font-serifd text-xl text-maroon-deep">{title}</div>
    {hint && <div className="text-[11px] text-ink-muted mt-1 mb-4">{hint}</div>}
    {children}
  </section>
);
const SaveBtn = ({ onClick, saving }) => (
  <button onClick={onClick} disabled={saving} className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
    <FloppyDisk size={14} weight="duotone" /> {saving ? "Saving…" : "Save"}
  </button>
);

export default function AdminWebsite() {
  const { user } = useAuth();
  const canContent = user?.role === "owner" || user?.permissions?.includes("content");
  const canTax = user?.role === "owner" || user?.permissions?.includes("taxonomy");

  const [announce, setAnnounce] = useState(null); // { messages: [...] }
  const [footer, setFooter] = useState(null);
  const [purposes, setPurposes] = useState(null); // [{key,label}]
  const [rashi, setRashi] = useState(null);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    if (canContent) api.get("/admin/site-content").then((r) => { setAnnounce(r.data.announcement); setFooter(r.data.footer); }).catch(() => {});
    if (canTax) api.get("/admin/taxonomy").then((r) => { setPurposes(r.data.purposes); setRashi(r.data.rashi); }).catch(() => {});
  }, [canContent, canTax]);

  const save = async (which, url, value) => {
    setSaving(which);
    try {
      await api.put(url, { value });
      toast.success("Saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save"); }
    finally { setSaving(""); }
  };

  // ── Announcement messages ──
  const setMsg = (i, k, v) => setAnnounce((a) => ({ ...a, messages: a.messages.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  const addMsg = () => setAnnounce((a) => ({ ...a, messages: [...(a.messages || []), { text: "", deva: "" }] }));
  const rmMsg = (i) => setAnnounce((a) => ({ ...a, messages: a.messages.filter((_, j) => j !== i) }));

  // ── Footer ──
  const setF = (k, v) => setFooter((f) => ({ ...f, [k]: v }));
  const setCol = (ci, k, v) => setFooter((f) => ({ ...f, columns: f.columns.map((c, i) => (i === ci ? { ...c, [k]: v } : c)) }));
  const setLink = (ci, li, k, v) => setFooter((f) => ({ ...f, columns: f.columns.map((c, i) => (i !== ci ? c : { ...c, links: c.links.map((l, j) => (j === li ? { ...l, [k]: v } : l)) })) }));
  const addLink = (ci) => setFooter((f) => ({ ...f, columns: f.columns.map((c, i) => (i !== ci ? c : { ...c, links: [...(c.links || []), { label: "", href: "" }] })) }));
  const rmLink = (ci, li) => setFooter((f) => ({ ...f, columns: f.columns.map((c, i) => (i !== ci ? c : { ...c, links: c.links.filter((_, j) => j !== li) })) }));

  // ── Taxonomy (purposes / rashi) ──
  const setTax = (setter, i, v) => setter((list) => list.map((it, j) => (j === i ? { ...it, label: v } : it)));
  const addTax = (setter) => setter((list) => [...(list || []), { key: "", label: "" }]);
  const rmTax = (setter, i) => setter((list) => list.filter((_, j) => j !== i));

  const taxEditor = (label, list, setter, url, saveKey) => (
    <Section title={label} hint="Buyers filter the shop by these. New entries appear as filter options; the key is auto-generated from the name.">
      <div className="space-y-2 max-w-xl">
        {(list || []).map((it, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input value={it.label} onChange={(e) => setTax(setter, i, e.target.value)} placeholder="Name (e.g. Wealth)" className={inputCls} />
            {it.key && <span className="font-mono text-[10px] text-ink-muted w-24 shrink-0 truncate">{it.key}</span>}
            <button onClick={() => rmTax(setter, i)} className="text-ink-muted hover:text-revoked shrink-0"><Trash size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => addTax(setter)} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> Add {label.toLowerCase()}</button>
      <div className="mt-4"><SaveBtn saving={saving === saveKey} onClick={() => save(saveKey, url, list)} /></div>
    </Section>
  );

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Content</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Website</h1>

      {!canContent && !canTax && (
        <div className="gold-line p-10 text-center text-ink-muted">You don't have permission to edit website content.</div>
      )}

      {/* Announcement bar */}
      {canContent && announce && (
        <Section title="Announcement bar" hint="The rotating strip at the very top of every page. Devanagari is optional.">
          <div className="space-y-2">
            {(announce.messages || []).map((m, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={m.deva || ""} onChange={(e) => setMsg(i, "deva", e.target.value)} placeholder="देव" className={inputCls + " font-deva w-28 shrink-0"} />
                <input value={m.text || ""} onChange={(e) => setMsg(i, "text", e.target.value)} placeholder="Message text" className={inputCls} />
                <button onClick={() => rmMsg(i)} className="text-ink-muted hover:text-revoked shrink-0"><Trash size={14} /></button>
              </div>
            ))}
          </div>
          <button onClick={addMsg} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> Add message</button>
          <div className="mt-4"><SaveBtn saving={saving === "announcement"} onClick={() => save("announcement", "/admin/site-content/announcement", announce)} /></div>
        </Section>
      )}

      {/* Footer */}
      {canContent && footer && (
        <Section title="Footer" hint="Brand block, columns and contact shown at the bottom of every page. A link with a blank URL is shown as plain text (e.g. address, phone).">
          <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
            <label className="block"><div className="text-xs text-ink-muted mb-1">Brand name</div>
              <input value={footer.brand || ""} onChange={(e) => setF("brand", e.target.value)} className={inputCls} /></label>
            <label className="block"><div className="text-xs text-ink-muted mb-1">Devanagari</div>
              <input value={footer.devanagari || ""} onChange={(e) => setF("devanagari", e.target.value)} className={inputCls + " font-deva"} /></label>
            <label className="block md:col-span-2"><div className="text-xs text-ink-muted mb-1">Description</div>
              <textarea rows={3} value={footer.description || ""} onChange={(e) => setF("description", e.target.value)} className={inputCls} /></label>
            <label className="block"><div className="text-xs text-ink-muted mb-1">Trust badge line</div>
              <input value={footer.badge || ""} onChange={(e) => setF("badge", e.target.value)} className={inputCls} /></label>
            <label className="block"><div className="text-xs text-ink-muted mb-1">Copyright line (year + brand added automatically)</div>
              <input value={footer.copyright || ""} onChange={(e) => setF("copyright", e.target.value)} className={inputCls} /></label>
          </div>

          <div className="mt-5 grid md:grid-cols-3 gap-4">
            {(footer.columns || []).map((col, ci) => (
              <div key={ci} className="gold-line bg-cream p-3">
                <input value={col.title || ""} onChange={(e) => setCol(ci, "title", e.target.value)} placeholder="Column title" className={inputCls + " font-medium mb-2"} />
                <div className="space-y-2">
                  {(col.links || []).map((l, li) => (
                    <div key={li} className="flex gap-1 items-center">
                      <div className="flex-1 space-y-1">
                        <input value={l.label || ""} onChange={(e) => setLink(ci, li, "label", e.target.value)} placeholder="Label" className={inputCls} />
                        <input value={l.href || ""} onChange={(e) => setLink(ci, li, "href", e.target.value)} placeholder="Link (blank = plain text)" className={inputCls + " font-mono text-xs"} />
                      </div>
                      <button onClick={() => rmLink(ci, li)} className="text-ink-muted hover:text-revoked shrink-0"><Trash size={13} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addLink(ci)} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={11} /> Add link</button>
              </div>
            ))}
          </div>
          <div className="mt-4"><SaveBtn saving={saving === "footer"} onClick={() => save("footer", "/admin/site-content/footer", footer)} /></div>
        </Section>
      )}

      {/* Taxonomy */}
      {canTax && purposes && taxEditor("Purposes", purposes, setPurposes, "/admin/taxonomy/purposes", "purposes")}
      {canTax && rashi && taxEditor("Rashi", rashi, setRashi, "/admin/taxonomy/rashi", "rashi")}
    </div>
  );
}
