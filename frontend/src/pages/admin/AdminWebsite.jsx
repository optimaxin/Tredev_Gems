import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PlusCircle, Trash, FloppyDisk } from "@phosphor-icons/react";
import AsyncButton from "@/components/gemora/AsyncButton";

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm";
// Legacy marketplaces were plain strings; the editor now wants { name, url } objects.
const normHome = (h) => (!h ? h : {
  ...h,
  marketplaces: (h.marketplaces || []).map((m) => (typeof m === "string" ? { name: m, url: "" } : m)),
});
const Section = ({ title, hint, children }) => (
  <section className="gold-line-strong bg-ivory p-6 mb-8">
    <div className="font-serifd text-xl text-maroon-deep">{title}</div>
    {hint && <div className="text-[11px] text-ink-muted mt-1 mb-4">{hint}</div>}
    {children}
  </section>
);
const SaveBtn = ({ onClick, saving }) => (
  <AsyncButton onClick={onClick} loading={saving} loadingText="Saving…" className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
    <FloppyDisk size={14} weight="duotone" /> Save
  </AsyncButton>
);

export default function AdminWebsite() {
  const { user } = useAuth();
  const canContent = user?.role === "owner" || user?.permissions?.includes("content");
  const canTax = user?.role === "owner" || user?.permissions?.includes("taxonomy");

  const [announce, setAnnounce] = useState(null); // { messages: [...] }
  const [footer, setFooter] = useState(null);
  const [home, setHome] = useState(null);
  const [header, setHeader] = useState(null); // { nav: [...], promo: {...}, verify_cta: {...} }
  const [videosContent, setVideosContent] = useState(null); // { title, subtitle, videos: [...] }
  const [products, setProducts] = useState([]); // for the video->product picker
  const [purposes, setPurposes] = useState(null); // [{key,label}]
  const [rashi, setRashi] = useState(null);
  const [poojaPurposes, setPoojaPurposes] = useState(null); // [{key,label}]
  const [saving, setSaving] = useState("");

  useEffect(() => {
    if (canContent) {
      api.get("/admin/site-content").then((r) => {
        setAnnounce(r.data.announcement); setFooter(r.data.footer);
        setHome(normHome(r.data.home)); setHeader(r.data.header);
        setVideosContent(r.data.shoppable_videos);
      }).catch(() => {});
      api.get("/products?limit=500").then((r) => setProducts(r.data)).catch(() => {});
    }
    if (canTax) api.get("/admin/taxonomy").then((r) => { setPurposes(r.data.purposes); setRashi(r.data.rashi); setPoojaPurposes(r.data.pooja_purposes); }).catch(() => {});
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
  const setTax = (setter, i, k, v) => setter((list) => list.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addTax = (setter) => setter((list) => [...(list || []), { key: "", label: "" }]);
  const rmTax = (setter, i) => setter((list) => list.filter((_, j) => j !== i));

  // ── Deep-path editing for a JSONB blob (home, header, …) ──
  const getIn = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const setIn = (obj, path, value) => {
    if (!path.length) return value;
    const [k, ...rest] = path;
    const clone = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
    clone[k] = setIn(clone[k], rest, value);
    return clone;
  };
  // Binds {field, addBtn, rmBtn, upd, addAt, rmAt} to one blob's setState, so every
  // JSONB content block (home, header) gets the same path-based editing without
  // re-deriving setIn/getIn logic per block.
  const makeEditor = (obj, setObj) => {
    const upd = (path, value) => setObj((o) => setIn(o, path, value));
    const addAt = (path, item) => setObj((o) => setIn(o, path, [...(getIn(o, path) || []), item]));
    const rmAt = (path, i) => setObj((o) => setIn(o, path, (getIn(o, path) || []).filter((_, j) => j !== i)));
    // A labelled field bound to obj[...path]. Rendered inline (not a component) so typing keeps focus.
    const field = (label, path, opts = {}) => (
      <label className="block">
        {label && <div className="text-xs text-ink-muted mb-1">{label}</div>}
        {opts.area
          ? <textarea rows={opts.rows || 3} value={getIn(obj, path) ?? ""} onChange={(e) => upd(path, e.target.value)} className={inputCls + (opts.cls || "")} placeholder={opts.ph} />
          : <input type={opts.num ? "number" : "text"} step={opts.step} value={getIn(obj, path) ?? ""} onChange={(e) => upd(path, opts.num ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} className={inputCls + (opts.cls || "")} placeholder={opts.ph} />}
      </label>
    );
    const addBtn = (path, item, text) => (
      <button onClick={() => addAt(path, item)} className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> {text}</button>
    );
    const rmBtn = (path, i) => (
      <button onClick={() => rmAt(path, i)} className="text-ink-muted hover:text-revoked shrink-0"><Trash size={14} /></button>
    );
    return { field, addBtn, rmBtn, upd, addAt, rmAt };
  };

  const { field, addBtn, rmBtn } = makeEditor(home, setHome);
  const homeSave = <SaveBtn saving={saving === "home"} onClick={() => save("home", "/admin/site-content/home", home)} />;

  // ── Header (nav mega-menu + promo card + Verify CTA) ──
  const { field: hfield, addBtn: haddBtn, rmBtn: hrmBtn } = makeEditor(header, setHeader);
  const headerSave = <SaveBtn saving={saving === "header"} onClick={() => save("header", "/admin/site-content/header", header)} />;
  const VERIFY_STYLES = ["text", "outline", "solid"];

  // ── Shoppable videos (homepage autoplay carousel) ──
  const { field: vfield, addBtn: vaddBtn, rmBtn: vrmBtn } = makeEditor(videosContent, setVideosContent);
  const videosSave = <SaveBtn saving={saving === "shoppable_videos"} onClick={() => save("shoppable_videos", "/admin/site-content/shoppable_videos", videosContent)} />;
  const setVideoProduct = (i, product_id) => setVideosContent((v) => ({
    ...v, videos: v.videos.map((it, j) => (j === i ? { ...it, product_id } : it)),
  }));

  const taxEditor = (label, list, setter, url, saveKey, opts = {}) => (
    <Section
      title={label}
      hint={opts.hint
        ? opts.hint
        : opts.mapStone
        ? "Buyers filter the shop by these. New entries appear as filter options; the key is auto-generated from the name. Map each to a stone and, optionally, a page to send buyers to — leave the page blank to use the shop filter."
        : "Buyers filter the shop by these. New entries appear as filter options; the key is auto-generated from the name."}
    >
      <div className="space-y-2 max-w-xl">
        {(list || []).map((it, i) => (
          <div key={i} className={opts.mapStone ? "gold-line bg-cream p-3" : "flex gap-2 items-center"}>
            <div className="flex gap-2 items-center">
              <input value={it.label} onChange={(e) => setTax(setter, i, "label", e.target.value)} placeholder="Name (e.g. Wealth)" className={inputCls} />
              {it.key && <span className="font-mono text-[10px] text-ink-muted w-24 shrink-0 truncate">{it.key}</span>}
              <button onClick={() => rmTax(setter, i)} className="text-ink-muted hover:text-revoked shrink-0"><Trash size={14} /></button>
            </div>
            {opts.mapStone && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={it.stone || ""} onChange={(e) => setTax(setter, i, "stone", e.target.value)} placeholder="Stone (e.g. Yellow Sapphire)" className={inputCls} />
                <input value={it.url || ""} onChange={(e) => setTax(setter, i, "url", e.target.value)} placeholder={`/shop?rashi=${it.key || "..."} or https://…`} className={inputCls + " font-mono text-xs"} />
              </div>
            )}
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

      {/* Header — nav mega-menu, promo card, Verify CTA */}
      {canContent && header && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl text-maroon-deep">Header</h2>
            {headerSave}
          </div>

          <Section title="Navigation menu" hint="The top nav bar. Each menu drops down into columns of links. Menu order here is the order shown on the site.">
            <div className="space-y-3">
              {(header.nav || []).map((m, ni) => (
                <details key={ni} className="gold-line bg-cream p-4" open={false}>
                  <summary className="cursor-pointer flex items-center justify-between gap-4">
                    <span className="font-serifd text-ink">{m.label || "(untitled menu)"}</span>
                    <span className="font-deva text-gold-soft text-xs">{m.hindi}</span>
                  </summary>
                  <div className="mt-4 grid md:grid-cols-3 gap-3">
                    {hfield("Label (shown in the nav bar)", ["nav", ni, "label"])}
                    {hfield("Devanagari (optional)", ["nav", ni, "hindi"], { cls: " font-deva" })}
                    <div className="flex items-end justify-end">{hrmBtn(["nav"], ni)}</div>
                  </div>

                  <div className="mt-4 grid md:grid-cols-3 gap-3">
                    {(m.columns || []).map((col, ci) => (
                      <div key={ci} className="gold-line bg-ivory p-3">
                        <div className="flex gap-1 items-center mb-2">
                          <input value={col.title || ""} onChange={(e) => { const v = e.target.value; setHeader((h) => { const nav = [...h.nav]; nav[ni] = { ...nav[ni], columns: nav[ni].columns.map((c, i) => (i === ci ? { ...c, title: v } : c)) }; return { ...h, nav }; }); }} placeholder="Column title" className={inputCls + " font-medium"} />
                          {hrmBtn(["nav", ni, "columns"], ci)}
                        </div>
                        <div className="space-y-2">
                          {(col.items || []).map((it, ii) => (
                            <div key={ii} className="flex gap-1 items-center">
                              <div className="flex-1 space-y-1">
                                {hfield(null, ["nav", ni, "columns", ci, "items", ii, "label"], { ph: "Label" })}
                                {hfield(null, ["nav", ni, "columns", ci, "items", ii, "href"], { ph: "/shop?…", cls: " font-mono text-xs" })}
                              </div>
                              {hrmBtn(["nav", ni, "columns", ci, "items"], ii)}
                            </div>
                          ))}
                        </div>
                        {haddBtn(["nav", ni, "columns", ci, "items"], { label: "", href: "" }, "Add link")}
                      </div>
                    ))}
                  </div>
                  {haddBtn(["nav", ni, "columns"], { title: "", items: [] }, "Add column")}
                </details>
              ))}
            </div>
            {haddBtn(["nav"], { key: "", label: "New menu", hindi: "", columns: [] }, "Add menu")}
          </Section>

          <Section title="Dropdown promo card" hint="The highlighted card on the right of every open mega-menu.">
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              {hfield("Eyebrow", ["promo", "eyebrow"])}
              {hfield("Title", ["promo", "title"])}
              {hfield("Body", ["promo", "body"], { area: true, rows: 2, cls: " md:col-span-2" })}
              {hfield("Button label", ["promo", "cta_label"])}
              {hfield("Button link", ["promo", "cta_href"], { cls: " font-mono text-xs" })}
            </div>
          </Section>

          <Section title="Verify button" hint="The button in the top-right of the header (and the mega-menu's mobile footer link).">
            <div className="grid md:grid-cols-3 gap-4 max-w-3xl">
              {hfield("Label", ["verify_cta", "label"])}
              {hfield("Link", ["verify_cta", "href"], { cls: " font-mono text-xs" })}
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Style</div>
                <select value={header.verify_cta?.style || "text"} onChange={(e) => setHeader((h) => ({ ...h, verify_cta: { ...h.verify_cta, style: e.target.value } }))} className={inputCls}>
                  {VERIFY_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </Section>

          <div className="flex justify-end mb-10">{headerSave}</div>
        </>
      )}

      {/* Shoppable videos — homepage autoplay carousel */}
      {canContent && videosContent && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl text-maroon-deep">Shoppable videos</h2>
            {videosSave}
          </div>

          <Section title="Section heading">
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              {vfield("Title", ["title"])}
              {vfield("Subtitle", ["subtitle"])}
            </div>
          </Section>

          <Section title="Videos" hint="Each video autoplays (muted) on the homepage and links to one product — pick which one from your live catalog; its photo and price always come from the product itself, never typed here.">
            <div className="space-y-3">
              {(videosContent.videos || []).map((v, i) => (
                <div key={i} className="gold-line bg-cream p-3 grid md:grid-cols-[2fr_2fr_1fr] gap-3 items-start">
                  {vfield("Video URL (mp4)", ["videos", i, "video_url"], { ph: "https://…", cls: " font-mono text-xs" })}
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Product</div>
                    <select value={v.product_id || ""} onChange={(e) => setVideoProduct(i, e.target.value)} className={inputCls}>
                      <option value="">— choose a product —</option>
                      {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end justify-end h-full">{vrmBtn(["videos"], i)}</div>
                </div>
              ))}
            </div>
            {vaddBtn(["videos"], { video_url: "", product_id: "" }, "Add video")}
          </Section>

          <div className="flex justify-end mb-10">{videosSave}</div>
        </>
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

      {/* Homepage */}
      {canContent && home && (
        <>
          <div className="flex items-center justify-between border-t border-gold/30 pt-8 mt-2 mb-4">
            <h2 className="font-display text-2xl text-maroon-deep">Home page</h2>
            {homeSave}
          </div>

          <Section title="Ambassador hero" hint="The full-screen portrait band at the very top. Leave a field blank to hide that line. The photos are managed in Site Images.">
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              {field("Eyebrow (small tag, optional)", ["ambassador", "eyebrow"])}
              {field("Name", ["ambassador", "name"])}
              {field("Role / subtitle", ["ambassador", "role"])}
              {field("Quote", ["ambassador", "quote"], { area: true, rows: 2 })}
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-4 max-w-3xl">
              {field("Primary button label", ["ambassador", "primaryCta", "label"], { ph: "Shop his picks" })}
              {field("Primary button link", ["ambassador", "primaryCta", "href"], { ph: "/shop or https://…", cls: " font-mono text-xs" })}
              {field("Secondary button label", ["ambassador", "secondaryCta", "label"], { ph: "Book a consultation" })}
              {field("Secondary button link", ["ambassador", "secondaryCta", "href"], { ph: "/consultation or https://…", cls: " font-mono text-xs" })}
            </div>
          </Section>

          <Section title="Hero slides" hint="The rotating headline carousel. In a title, wrap words in *asterisks* for the gold highlight and use a new line for a line break. Slide images are in Site Images (Hero 1–3).">
            <div className="space-y-4">
              {(home.hero || []).map((s, i) => (
                <div key={i} className="gold-line bg-cream p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-widest text-ink-muted">Slide {i + 1}</div>
                    {rmBtn(["hero"], i)}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    {field("Tag", ["hero", i, "tag"])}
                    {field("Title (use *…* and line breaks)", ["hero", i, "title"], { area: true, rows: 2 })}
                    {field("Subtitle", ["hero", i, "sub"], { area: true, rows: 2, cls: " md:col-span-2" })}
                    {field("Button 1 label", ["hero", i, "cta1_label"])}
                    {field("Button 1 link", ["hero", i, "cta1_to"], { cls: " font-mono text-xs" })}
                    {field("Button 2 label", ["hero", i, "cta2_label"])}
                    {field("Button 2 link", ["hero", i, "cta2_to"], { cls: " font-mono text-xs" })}
                    {field("Devanagari caption", ["hero", i, "deva"], { cls: " font-deva" })}
                    {field("Caption translation", ["hero", i, "devaSub"])}
                  </div>
                </div>
              ))}
            </div>
            {addBtn(["hero"], { tag: "", title: "", sub: "", cta1_to: "/shop", cta1_label: "Shop", cta2_to: "/verify", cta2_label: "Verify", deva: "", devaSub: "" }, "Add slide")}
          </Section>

          <Section title="Stats band" hint="The big numbers strip. Value is a number; decimals controls how many digits after the point (e.g. 1 for 4.9); suffix is appended (e.g. + or %).">
            <div className="space-y-2">
              {(home.stats || []).map((s, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end gold-line bg-cream p-3">
                  <div className="w-24">{field("Value", ["stats", i, "value"], { num: true, step: "any" })}</div>
                  <div className="w-20">{field("Decimals", ["stats", i, "decimals"], { num: true })}</div>
                  <div className="w-20">{field("Suffix", ["stats", i, "suffix"])}</div>
                  <div className="flex-1 min-w-[140px]">{field("Label", ["stats", i, "label"])}</div>
                  <div className="w-28">{field("Devanagari", ["stats", i, "deva"], { cls: " font-deva" })}</div>
                  {rmBtn(["stats"], i)}
                </div>
              ))}
            </div>
            {addBtn(["stats"], { value: 0, suffix: "", decimals: 0, label: "", deva: "" }, "Add stat")}
          </Section>

          <Section title="Astrologer band" hint="The maroon 'Talk to a real person' section. Use *asterisks* and line breaks in the title. The feature chips keep their icons automatically.">
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              {field("Eyebrow", ["astroBand", "eyebrow"])}
              {field("Title (use *…* and line breaks)", ["astroBand", "title"], { area: true, rows: 2 })}
              {field("Body", ["astroBand", "body"], { area: true, cls: " md:col-span-2" })}
              {field("Name plate", ["astroBand", "name"])}
              {field("Name plate role", ["astroBand", "role"])}
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-4 max-w-3xl">
              {field("Primary button label", ["astroBand", "primaryCta", "label"], { ph: "Book a call" })}
              {field("Primary button link", ["astroBand", "primaryCta", "href"], { ph: "/consultation or https://…", cls: " font-mono text-xs" })}
              {field("Secondary button label", ["astroBand", "secondaryCta", "label"], { ph: "Free carat ↔ ratti tool" })}
              {field("Secondary button link", ["astroBand", "secondaryCta", "href"], { ph: "/tools/carat-ratti or https://…", cls: " font-mono text-xs" })}
            </div>
            <div className="mt-4 max-w-xl">
              <div className="text-xs text-ink-muted mb-1">Feature chips</div>
              <div className="space-y-2">
                {(home.astroBand?.features || []).map((f, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input value={f || ""} onChange={(e) => upd(["astroBand", "features", i], e.target.value)} placeholder="e.g. Scheduled call" className={inputCls} />
                    {rmBtn(["astroBand", "features"], i)}
                  </div>
                ))}
              </div>
              {addBtn(["astroBand", "features"], "", "Add chip")}
            </div>
          </Section>

          <Section title="Category tiles" hint="The 'Our Premium Categories' grid. Key sets the shop link (/shop?category=key) and which Site Image is used; add new keys in Site Images to give them a photo.">
            <div className="space-y-2">
              {(home.categories || []).map((c, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end gold-line bg-cream p-3">
                  <div className="w-40">{field("Label", ["categories", i, "label"])}</div>
                  <div className="w-28">{field("Devanagari", ["categories", i, "hindi"], { cls: " font-deva" })}</div>
                  <div className="w-40">{field("Key (shop filter)", ["categories", i, "key"], { cls: " font-mono text-xs" })}</div>
                  {rmBtn(["categories"], i)}
                </div>
              ))}
            </div>
            {addBtn(["categories"], { key: "", label: "", hindi: "" }, "Add category")}
          </Section>

          <Section title="Planet tiles" hint="The Navagraha grid. Name sets the shop link (/shop?graha=Name).">
            <div className="space-y-2">
              {(home.planets || []).map((p, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end gold-line bg-cream p-3">
                  <div className="w-40">{field("Name", ["planets", i, "name"])}</div>
                  <div className="w-28">{field("Devanagari", ["planets", i, "deva"], { cls: " font-deva" })}</div>
                  <div className="w-44">{field("Stone", ["planets", i, "stone"])}</div>
                  {rmBtn(["planets"], i)}
                </div>
              ))}
            </div>
            {addBtn(["planets"], { name: "", deva: "", stone: "" }, "Add planet")}
          </Section>

          <Section title="House section" hint="The 'Sourced by hand. Signed by us.' block. Each bullet keeps its icon automatically.">
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              {field("Eyebrow", ["house", "eyebrow"])}
              {field("Title (use *…* and line breaks)", ["house", "title"], { area: true, rows: 2 })}
              {field("Body", ["house", "body"], { area: true, rows: 4, cls: " md:col-span-2" })}
            </div>
            <div className="mt-3 space-y-2 max-w-2xl">
              {(home.house?.bullets || []).map((b, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={b || ""} onChange={(e) => upd(["house", "bullets", i], e.target.value)} placeholder="Bullet text" className={inputCls} />
                  {rmBtn(["house", "bullets"], i)}
                </div>
              ))}
            </div>
            {addBtn(["house", "bullets"], "", "Add bullet")}
          </Section>

          <Section title="Mantra ticker" hint="The slow Devanagari strip that scrolls across the page.">
            <div className="space-y-2 max-w-xl">
              {(home.mantras || []).map((m, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={m || ""} onChange={(e) => upd(["mantras", i], e.target.value)} className={inputCls + " font-deva"} />
                  {rmBtn(["mantras"], i)}
                </div>
              ))}
            </div>
            {addBtn(["mantras"], "", "Add mantra")}
          </Section>

          <Section title="Testimonials" hint="The 'People who believed us' cards. Rating is 1–5 stars.">
            <div className="space-y-3">
              {(home.testimonials || []).map((t, i) => (
                <div key={i} className="gold-line bg-cream p-3 grid md:grid-cols-2 gap-3">
                  {field("Author", ["testimonials", i, "by"])}
                  <div className="w-24">{field("Rating", ["testimonials", i, "rating"], { num: true })}</div>
                  {field("Title", ["testimonials", i, "title"], { cls: " md:col-span-2" })}
                  {field("Body", ["testimonials", i, "body"], { area: true, cls: " md:col-span-2" })}
                  <div className="md:col-span-2 flex justify-end">{rmBtn(["testimonials"], i)}</div>
                </div>
              ))}
            </div>
            {addBtn(["testimonials"], { by: "", rating: 5, title: "", body: "" }, "Add testimonial")}
          </Section>

          <Section title="Trust badges" hint="The GJEPC / GIA / IGI / BIS row. Abbreviation shows large; name is the small caption.">
            <div className="space-y-2">
              {(home.trustBadges || []).map((b, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end gold-line bg-cream p-3">
                  <div className="w-32">{field("Abbreviation", ["trustBadges", i, "abbr"])}</div>
                  <div className="flex-1 min-w-[200px]">{field("Full name", ["trustBadges", i, "name"])}</div>
                  {rmBtn(["trustBadges"], i)}
                </div>
              ))}
            </div>
            {addBtn(["trustBadges"], { abbr: "", name: "" }, "Add badge")}
          </Section>

          <Section title="Marketplaces" hint="The 'Also available on' row. Add a link to make each marketplace clickable on the site (leave the link blank to show plain text).">
            <div className="space-y-2">
              {(home.marketplaces || []).map((m, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end gold-line bg-cream p-3">
                  <div className="w-40">{field("Name", ["marketplaces", i, "name"])}</div>
                  <div className="flex-1 min-w-[220px]">{field("Link (optional)", ["marketplaces", i, "url"], { ph: "https://…", cls: " font-mono text-xs" })}</div>
                  {rmBtn(["marketplaces"], i)}
                </div>
              ))}
            </div>
            {addBtn(["marketplaces"], { name: "", url: "" }, "Add marketplace")}
          </Section>

          <div className="flex justify-end mb-10">{homeSave}</div>
        </>
      )}

      {/* Taxonomy */}
      {canTax && purposes && taxEditor("Purposes", purposes, setPurposes, "/admin/taxonomy/purposes", "purposes")}
      {canTax && rashi && taxEditor("Rashi", rashi, setRashi, "/admin/taxonomy/rashi", "rashi", { mapStone: true })}
      {canTax && poojaPurposes && taxEditor(
        "Pooja Purposes", poojaPurposes, setPoojaPurposes,
        "/admin/taxonomy/pooja_purposes", "pooja_purposes",
        { hint: "The \"Primary Purpose\" choices a buyer picks when ordering a video Pooja Energization — the intention the priest names in the sankalp. Separate from Purposes above, which drives shop filtering." },
      )}
    </div>
  );
}
