import React, { useEffect, useState } from "react";
import { api, apiErrorMessage, mediaSrc } from "@/lib/api";
import { toast } from "sonner";
import { FloppyDisk, ImageSquare, PencilSimple, X } from "@phosphor-icons/react";
import MediaPicker from "@/components/gemora/MediaPicker";
import AsyncButton from "@/components/gemora/AsyncButton";

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm";

const Section = ({ title, hint, children }) => (
  <section className="gold-line-strong bg-ivory p-6 mb-8">
    <div className="font-serifd text-xl text-maroon-deep">{title}</div>
    {hint && <div className="text-[11px] text-ink-muted mt-1">{hint}</div>}
    <div className="mt-4">{children}</div>
  </section>
);

const toLines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
const fromServer = (d) => ({
  ...d,
  address_lines: (d.address_lines || []).join("\n"),
  declarations: (d.declarations || []).join("\n"),
});

export default function AdminInvoiceSettings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState(null);

  useEffect(() => {
    api.get("/admin/invoice-settings")
      .then((r) => setForm(fromServer(r.data)))
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load invoice settings")));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/invoice-settings", {
        value: { ...form, address_lines: toLines(form.address_lines), declarations: toLines(form.declarations) },
      });
      setForm(fromServer(data));
      toast.success("Invoice details saved");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not save invoice details"), { duration: 12000 });
    } finally { setSaving(false); }
  };

  if (!form) return <div className="text-ink-muted">Loading…</div>;

  const field = (label, key, opts = {}) => (
    <label className="block">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      {opts.area
        ? <textarea rows={opts.rows || 4} value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={opts.ph} data-testid={`invoice-settings-${key}`} className={inputCls} />
        : <input type="text" value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={opts.ph} data-testid={`invoice-settings-${key}`} className={inputCls} />}
      {opts.hint && <div className="text-[10px] text-ink-muted mt-1">{opts.hint}</div>}
    </label>
  );

  const imageField = (label, key, hint) => (
    <div>
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <div className="gold-line bg-cream h-28 flex items-center justify-center overflow-hidden">
        {form[key]
          ? <img src={mediaSrc(form[key])} alt="" className="max-h-full max-w-full object-contain" />
          : <div className="flex flex-col items-center text-ink-muted"><ImageSquare size={24} weight="duotone" /><div className="text-[10px] uppercase tracking-widest mt-1">Not set</div></div>}
      </div>
      <input
        type="text" value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)}
        placeholder="https://… or /api/media/file/…"
        data-testid={`invoice-settings-${key}`}
        className={inputCls + " mt-2 font-mono text-xs"}
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => setPickerFor(key)}
          data-testid={`invoice-settings-${key}-pick`}
          className="flex-1 border border-maroon text-maroon py-2 text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
        >
          <PencilSimple size={12} /> Choose from media
        </button>
        {form[key] && (
          <button onClick={() => set(key, "")} data-testid={`invoice-settings-${key}-clear`} className="px-3 border border-gold/40 text-ink-muted hover:text-revoked"><X size={14} /></button>
        )}
      </div>
      {hint && <div className="text-[10px] text-ink-muted mt-1">{hint}</div>}
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Orders · कर बीजक</div>
        <h1 className="font-display text-4xl text-ink mt-1">Invoice settings</h1>
        <p className="text-sm text-ink-muted mt-1">
          These details are printed on every tax invoice. Changes apply only to invoices issued from now on —
          invoices already issued keep their own frozen copy of these details.
        </p>
      </div>

      <Section title="Legal identity" hint="As registered. The GSTIN is checksum-verified on save.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Legal name", "legal_name")}
          {field("Trade name", "trade_name")}
          {field("GSTIN", "gstin", { hint: "15 characters — must pass the official checksum." })}
          {field("State code", "state_code", { ph: "09", hint: "2-digit GST state code. Must match the first 2 characters of the GSTIN." })}
          {field("PAN", "pan")}
          {field("CIN", "cin")}
        </div>
      </Section>

      <Section title="Registered address" hint="One line per row — each non-empty line is printed as its own address line.">
        {field("Address lines", "address_lines", { area: true, rows: 5, ph: "Shop 12, Gem Bhavan\nMG Road\nLucknow, Uttar Pradesh 226001" })}
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Support email", "support_email")}
          {field("Support phone", "support_phone")}
          {field("Store URL", "store_url")}
          {field("Company URL", "company_url")}
        </div>
      </Section>

      <Section title="Signatory & marks" hint="Printed in the signature block at the foot of the invoice.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Signatory name", "signatory_name")}
          {field("Signatory designation", "signatory_designation")}
          {imageField("Logo", "logo_url")}
          {imageField("Signature", "signature_url", "Transparent PNG works best.")}
        </div>
      </Section>

      <Section title="Invoice numbering & notes">
        <div className="space-y-4">
          {field("Invoice prefix", "invoice_prefix", { ph: "TRE", hint: "2–4 uppercase letters. Used in numbers like TRE/2627/000123." })}
          {field("Footer line", "footer_line")}
          {field("Declarations", "declarations", { area: true, rows: 5, hint: "One declaration per line — printed as the numbered declarations block." })}
          {field("Export declaration", "export_declaration", { area: true, rows: 3, hint: "Printed on export / overseas invoices only." })}
        </div>
      </Section>

      <AsyncButton
        onClick={save}
        loading={saving}
        loadingText="Saving…"
        data-testid="invoice-settings-save"
        className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50"
      >
        <FloppyDisk size={14} weight="duotone" /> Save
      </AsyncButton>

      <MediaPicker
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(m) => { set(pickerFor, m.url); setPickerFor(null); }}
      />
    </div>
  );
}
