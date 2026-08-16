import React, { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { FloppyDisk } from "@phosphor-icons/react";
import AsyncButton from "@/components/gemora/AsyncButton";

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm";

// `contact_us` is structured fields (they plug into mailto:/tel:/wa.me hrefs on the
// live page, so free-form HTML would risk breaking those links); the other three are
// one HTML blob each, matching how long-form legal text is actually authored.
const PAGES = [
  { key: "contact_us", label: "Contact Us" },
  { key: "privacy_policy", label: "Privacy Policy" },
  { key: "terms_conditions", label: "Terms & Conditions" },
  { key: "refunds_cancellations", label: "Refunds & Cancellations" },
];

export default function AdminLegalPages() {
  const [active, setActive] = useState("contact_us");
  const [data, setData] = useState(null); // { [key]: value }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/admin/legal-pages")
      .then((r) => setData(r.data))
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load pages")));
  }, []);

  const setField = (key) => (e) =>
    setData((d) => ({ ...d, [active]: { ...d[active], [key]: e.target.value } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data: saved } = await api.put(`/admin/legal-pages/${active}`, { value: data[active] });
      setData((d) => ({ ...d, [active]: saved.value }));
      toast.success("Saved");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not save"), { duration: 12000 });
    } finally { setSaving(false); }
  };

  if (!data) return <div className="text-ink-muted">Loading…</div>;

  const value = data[active] || {};
  const isContact = active === "contact_us";

  const field = (label, key, opts = {}) => (
    <label className="block">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <input type="text" value={value[key] ?? ""} onChange={setField(key)} placeholder={opts.ph} className={inputCls} />
    </label>
  );

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Website</div>
        <h1 className="font-display text-4xl text-ink mt-1">Legal Pages</h1>
        <p className="text-sm text-ink-muted mt-1">
          Contact Us, Privacy Policy, Terms &amp; Conditions, and Refunds &amp; Cancellations — the same
          content shown on the public pages.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setActive(p.key)}
            className={`px-4 py-2 text-sm border transition-colors ${
              active === p.key ? "border-maroon bg-maroon text-ivory" : "border-gold/40 text-ink-soft hover:border-maroon"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <section className="gold-line-strong bg-ivory p-6 mb-6">
        {isContact ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field("Support email", "email")}
            {field("Support phone (display)", "phone", { ph: "+91 76684 89528" })}
            {field("Support phone (tel/WhatsApp, no spaces)", "phone_tel", { ph: "+917668489528" })}
            {field("Hours", "hours")}
            {field("Registered office name", "office_name")}
            {field("Address line 1", "address_line1")}
            {field("Address line 2", "address_line2")}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {field("Title", "title")}
              {field("Effective date", "effective_date", { ph: "5 August 2026" })}
            </div>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Intro</div>
              <textarea rows={2} value={value.intro ?? ""} onChange={setField("intro")} className={inputCls} />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">
                Body (HTML — use &lt;h2&gt; for each section heading so it appears in the page's "On this page" list)
              </div>
              <textarea rows={18} value={value.html ?? ""} onChange={setField("html")} className={inputCls + " font-mono text-xs"} />
            </label>
            <div>
              <div className="text-xs text-ink-muted mb-1">Preview</div>
              <div className="legal-html gold-line bg-cream p-5 text-sm text-ink-soft max-h-96 overflow-y-auto"
                   dangerouslySetInnerHTML={{ __html: value.html || "" }} />
            </div>
          </div>
        )}
      </section>

      <AsyncButton
        onClick={save}
        loading={saving}
        loadingText="Saving…"
        className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50"
      >
        <FloppyDisk size={14} weight="duotone" /> Save
      </AsyncButton>
    </div>
  );
}
