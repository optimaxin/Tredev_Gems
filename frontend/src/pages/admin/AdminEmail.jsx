import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, clearApiCache } from "@/lib/api";
import { toast } from "sonner";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import {
  EnvelopeSimple, PaperPlaneTilt, MegaphoneSimple, ClockCounterClockwise, Notepad,
  CaretLeft, CaretRight, X, ArrowClockwise, Pause, Play, PlusCircle, Trash, PencilSimple,
} from "@phosphor-icons/react";
import SearchBar from "@/components/gemora/SearchBar";
import AsyncButton from "@/components/gemora/AsyncButton";

const TABS = [
  { key: "compose", label: "Compose", Icon: PaperPlaneTilt },
  { key: "templates", label: "Templates", Icon: Notepad },
  { key: "campaigns", label: "Campaigns", Icon: MegaphoneSimple },
  { key: "logs", label: "Logs", Icon: ClockCounterClockwise },
];

const QUILL_MODULES = {
  toolbar: [
    [{ header: [2, 3, false] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "image"],
    ["clean"],
  ],
};

// ── Compose ──────────────────────────────────────────────────────────────────
function Compose() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [to, setTo] = useState([]);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [template, setTemplate] = useState("standard");
  const [sending, setSending] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);

  const diagnose = async () => {
    setDiagnosing(true);
    try {
      const { data } = await api.get("/admin/emails/diagnose", { timeout: 20000 });
      if (data.ok) {
        toast.success(`Sent to ${data.from_address} in ${data.elapsed_ms}ms — check that inbox`);
      } else {
        toast.error(data.error || "Test send failed");
      }
      console.info("[email diagnose]", data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Diagnose failed");
    } finally {
      setDiagnosing(false);
    }
  };

  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get("/admin/users/search", { params: { q: query, limit: 10 } })
        .then((r) => setResults(r.data || []))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const addRecipient = (email) => {
    const clean = email.trim().toLowerCase();
    if (clean && !to.includes(clean)) setTo((t) => [...t, clean]);
    setQ(""); setResults([]);
  };
  const removeRecipient = (email) => setTo((t) => t.filter((e) => e !== email));

  const send = async () => {
    if (!to.length) { toast.error("Add at least one recipient"); return; }
    if (!subject.trim() || !content.trim()) { toast.error("Subject and content are required"); return; }
    setSending(true);
    try {
      // Backend processes recipients one at a time, each bounded at ~35s (see
      // SEND_TIMEOUT in email_sender.py) — 45s covers a single test send with
      // headroom; a multi-recipient compose could legitimately take longer than
      // this and would need a background/async redesign, not a bigger timeout.
      const { data } = await api.post("/admin/emails/send", { to, subject, content, template },
        { timeout: 45000 });
      if (data.failedCount) {
        toast.warning(`Sent ${data.sentCount}, failed ${data.failedCount}`);
      } else {
        toast.success(`Sent to ${data.sentCount} recipient${data.sentCount === 1 ? "" : "s"}`);
      }
      setTo([]); setSubject(""); setContent("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send email");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">To</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {to.map((email) => (
            <span key={email} className="inline-flex items-center gap-1 gold-line bg-cream px-2 py-1 text-xs">
              {email}
              <button type="button" onClick={() => removeRecipient(email)} className="text-ink-muted hover:text-maroon">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.includes("@")) { e.preventDefault(); addRecipient(q); } }}
            placeholder="Search by name, email or phone — or paste an email and press Enter"
            className="w-full gold-line px-3 py-2.5 bg-ivory outline-none focus:border-maroon text-sm"
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full gold-line-strong bg-ivory max-h-56 overflow-y-auto">
              {results.map((u) => (
                <button key={u.user_id} type="button" onClick={() => addRecipient(u.email)}
                  className="w-full text-left px-3 py-2 hover:bg-cream text-sm flex flex-col">
                  <span className="font-medium">{u.name || u.email}</span>
                  <span className="text-xs text-ink-muted">{u.email}{u.phone ? ` · ${u.phone}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          className="w-full gold-line px-3 py-2.5 bg-ivory outline-none focus:border-maroon text-sm" />
      </div>

      <div className="mb-4">
        <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Template</label>
        <select value={template} onChange={(e) => setTemplate(e.target.value)}
          className="gold-line bg-ivory px-3 py-2 text-sm outline-none focus:border-maroon">
          <option value="standard">Standard</option>
          <option value="announcement">Announcement</option>
          <option value="promotional">Promotional</option>
        </select>
      </div>

      <div className="mb-5">
        <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Content</label>
        <div className="bg-ivory gold-line">
          <ReactQuill theme="snow" value={content} onChange={setContent} modules={QUILL_MODULES} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <AsyncButton onClick={send} loading={sending} loadingText="Sending…"
          className="brand-gradient text-white px-6 py-2.5 text-sm font-medium tracking-wide">
          Send
        </AsyncButton>
        <AsyncButton onClick={diagnose} loading={diagnosing} loadingText="Testing…"
          className="border border-gold/40 text-ink-soft px-4 py-2.5 text-sm hover:border-maroon hover:text-maroon">
          Send test email to self
        </AsyncButton>
      </div>
    </div>
  );
}

// ── Campaigns ────────────────────────────────────────────────────────────────
const AUDIENCE_OPTIONS = [
  { key: "all_users", label: "All customers" },
  { key: "segment", label: "Segment filter" },
  { key: "csv", label: "Upload CSV" },
  { key: "manual", label: "Manual entry" },
];

function CampaignWizard({ onCreated }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [audienceType, setAudienceType] = useState("all_users");
  const [segment, setSegment] = useState({ signup_after: "", signup_before: "", min_orders: "", state: "" });
  const [manualText, setManualText] = useState("");
  const [csvRows, setCsvRows] = useState([]);
  const [template, setTemplate] = useState("newsletter");
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [creating, setCreating] = useState(false);

  const parseCsv = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((l) => l.split(",").map((c) => c.trim()))
        .filter((c) => c[0] && c[0].toLowerCase() !== "email");
      setCsvRows(rows.map(([email, name]) => ({ email, name: name || "" })));
    };
    reader.readAsText(file);
  };

  const recipientEmails = useMemo(() => {
    if (audienceType === "csv") return csvRows.map((r) => r.email);
    if (audienceType === "manual") {
      return manualText.split(/[\n,]/).map((e) => e.trim()).filter((e) => e.includes("@"));
    }
    return null;
  }, [audienceType, csvRows, manualText]);

  const reset = () => {
    setStep(1); setName(""); setSubject(""); setAudienceType("all_users");
    setSegment({ signup_after: "", signup_before: "", min_orders: "", state: "" });
    setManualText(""); setCsvRows([]); setContent(""); setScheduledAt("");
  };

  const submit = async () => {
    if (!name.trim() || !subject.trim() || !content.trim()) {
      toast.error("Name, subject and content are required"); return;
    }
    setCreating(true);
    try {
      const audience_filter = audienceType === "segment"
        ? Object.fromEntries(Object.entries(segment).filter(([, v]) => v !== ""))
        : undefined;
      const { data } = await api.post("/admin/emails/campaigns", {
        name, subject, content, template, audience_type: audienceType,
        audience_filter, recipient_emails: recipientEmails || undefined,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });
      toast.success(scheduledAt ? `Scheduled for ${recipientEmails ? recipientEmails.length : data.recipients} recipients`
                                : `Sending to ${data.recipients} recipients`);
      reset();
      onCreated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not create campaign");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="gold-line-strong bg-ivory p-6 mb-8">
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((n) => (
          <React.Fragment key={n}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
              step >= n ? "bg-maroon text-white" : "bg-cream text-ink-muted"}`}>{n}</div>
            {n < 4 && <div className={`flex-1 h-px ${step > n ? "bg-maroon" : "bg-gold/30"}`} />}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Campaign name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full gold-line px-3 py-2.5 bg-cream outline-none focus:border-maroon text-sm" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Subject line</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              className="w-full gold-line px-3 py-2.5 bg-cream outline-none focus:border-maroon text-sm" />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 max-w-lg">
          <div className="flex flex-col gap-2">
            {AUDIENCE_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-2 text-sm">
                <input type="radio" checked={audienceType === o.key} onChange={() => setAudienceType(o.key)} />
                {o.label}
              </label>
            ))}
          </div>
          {audienceType === "segment" && (
            <div className="grid grid-cols-2 gap-3">
              <input type="date" placeholder="Signed up after" value={segment.signup_after}
                onChange={(e) => setSegment((s) => ({ ...s, signup_after: e.target.value }))}
                className="gold-line px-3 py-2 bg-cream text-sm" />
              <input type="date" placeholder="Signed up before" value={segment.signup_before}
                onChange={(e) => setSegment((s) => ({ ...s, signup_before: e.target.value }))}
                className="gold-line px-3 py-2 bg-cream text-sm" />
              <input type="number" min="0" placeholder="Min. orders" value={segment.min_orders}
                onChange={(e) => setSegment((s) => ({ ...s, min_orders: e.target.value }))}
                className="gold-line px-3 py-2 bg-cream text-sm" />
              <input placeholder="State (e.g. Uttar Pradesh)" value={segment.state}
                onChange={(e) => setSegment((s) => ({ ...s, state: e.target.value }))}
                className="gold-line px-3 py-2 bg-cream text-sm" />
            </div>
          )}
          {audienceType === "csv" && (
            <div>
              <input type="file" accept=".csv" onChange={(e) => e.target.files[0] && parseCsv(e.target.files[0])} />
              <p className="text-xs text-ink-muted mt-1">Two columns: email[,name]. {csvRows.length} rows parsed.</p>
            </div>
          )}
          {audienceType === "manual" && (
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={5}
              placeholder="Paste emails, one per line or comma-separated"
              className="w-full gold-line px-3 py-2.5 bg-cream outline-none focus:border-maroon text-sm" />
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 max-w-2xl">
          <div>
            <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">Template</label>
            <select value={template} onChange={(e) => setTemplate(e.target.value)}
              className="gold-line bg-cream px-3 py-2 text-sm outline-none focus:border-maroon">
              <option value="newsletter">Newsletter</option>
              <option value="promotional">Sale / Promotion</option>
              <option value="announcement">Announcement</option>
            </select>
          </div>
          <div className="bg-cream gold-line">
            <ReactQuill theme="snow" value={content} onChange={setContent} modules={QUILL_MODULES} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 max-w-lg text-sm">
          <div className="gold-line bg-cream p-4">
            <div><span className="text-ink-muted">Name:</span> {name}</div>
            <div><span className="text-ink-muted">Subject:</span> {subject}</div>
            <div><span className="text-ink-muted">Audience:</span> {AUDIENCE_OPTIONS.find((o) => o.key === audienceType)?.label}
              {recipientEmails ? ` (${recipientEmails.length} addresses)` : ""}</div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-ink-muted mb-1 block">
              Schedule for later (optional)</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="gold-line px-3 py-2 bg-cream text-sm" />
          </div>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}
          className="px-4 py-2 text-sm text-ink-soft disabled:opacity-30">Back</button>
        {step < 4 ? (
          <button type="button" onClick={() => setStep((s) => Math.min(4, s + 1))}
            className="brand-gradient text-white px-6 py-2 text-sm font-medium">Next</button>
        ) : (
          <AsyncButton onClick={submit} loading={creating} loadingText="Starting…"
            className="brand-gradient text-white px-6 py-2 text-sm font-medium">
            {scheduledAt ? "Schedule" : "Send Now"}
          </AsyncButton>
        )}
      </div>
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────
function fieldLabel(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TemplateEditModal({ tpl, meta, onClose, onSaved }) {
  const isSystem = tpl.is_system;
  const [fields, setFields] = useState(() => ({ ...(tpl.field_defaults || {}), ...(tpl.fields || {}) }));
  const [name, setName] = useState(tpl.name || "");
  const [category, setCategory] = useState(tpl.category || "transactional");
  const [subject, setSubject] = useState(tpl.subject || "");
  const [bodyHtml, setBodyHtml] = useState(tpl.body_html || "");
  const [enabled, setEnabled] = useState(tpl.enabled !== false);
  const [testEmail, setTestEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const isNew = tpl.key == null;

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        await api.post("/admin/emails/templates", { name, category, subject, body_html: bodyHtml });
        toast.success("Template created");
      } else if (isSystem) {
        await api.put(`/admin/emails/templates/${tpl.key}`, { fields, enabled });
        toast.success("Template updated");
      } else {
        await api.put(`/admin/emails/templates/${tpl.key}`, { name, category, subject, body_html: bodyHtml, enabled });
        toast.success("Template updated");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save template");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testEmail.includes("@")) { toast.error("Enter a valid email"); return; }
    setTesting(true);
    try {
      await api.post(`/admin/emails/templates/${tpl.key}/test`, { email: testEmail });
      toast.success(`Test sent to ${testEmail}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Test send failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative gold-line-strong bg-ivory p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">{isNew ? "New Template" : tpl.name}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-maroon"><X size={18} /></button>
        </div>

        {isSystem && (
          <div className="mb-4 text-xs text-ink-muted gold-line bg-cream p-3">
            <div>Sent to: {tpl.to}</div>
            <div>Fires on: {tpl.trigger_event}</div>
            {tpl.note && <div className="mt-1 text-revoked">{tpl.note}</div>}
          </div>
        )}

        {!isSystem && (
          <div className="space-y-3 mb-4">
            <input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full gold-line px-3 py-2 bg-cream text-sm" />
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="gold-line bg-cream px-3 py-2 text-sm">
              {(meta?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              className="w-full gold-line px-3 py-2 bg-cream text-sm" />
            <div className="bg-cream gold-line">
              <ReactQuill theme="snow" value={bodyHtml} onChange={setBodyHtml} />
            </div>
          </div>
        )}

        {isSystem && (
          <div className="space-y-3 mb-4">
            {Object.keys(tpl.field_defaults || {}).map((k) => (
              <label key={k} className="block">
                <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">{fieldLabel(k)}</div>
                {k === "greeting" || k === "footer_note" || k === "body_note" || k === "prep_tips" || k === "affiliate_intro" || k === "intro" ? (
                  <textarea value={fields[k] || ""} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                    rows={2} className="w-full gold-line px-3 py-2 bg-cream text-sm" />
                ) : (
                  <input value={fields[k] || ""} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                    className="w-full gold-line px-3 py-2 bg-cream text-sm" />
                )}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled — uncheck to stop this email from sending at all
            </label>
          </div>
        )}

        {!isNew && (
          <div className="flex items-center gap-2 mb-4 gold-line bg-cream p-3">
            <input placeholder="Send a test to…" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
              className="flex-1 gold-line px-3 py-2 bg-ivory text-sm" />
            <AsyncButton onClick={sendTest} loading={testing} loadingText="Sending…"
              className="px-4 py-2 text-xs border border-gold/40 hover:border-maroon whitespace-nowrap">
              Send Test
            </AsyncButton>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-soft">Cancel</button>
          <AsyncButton onClick={save} loading={saving} loadingText="Saving…"
            className="brand-gradient text-white px-6 py-2 text-sm font-medium">
            {isNew ? "Create" : "Save"}
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}

function Templates() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get("/admin/emails/templates"), api.get("/admin/emails/meta")])
      .then(([t, m]) => { setRows(t.data || []); setMeta(m.data); })
      .catch(() => toast.error("Could not load templates"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (row) => {
    try {
      await api.put(`/admin/emails/templates/${row.key}`, { enabled: !row.enabled });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update");
    }
  };

  const remove = async (row) => {
    try {
      await api.delete(`/admin/emails/templates/${row.key}`);
      toast.success(row.is_system ? "Reset to default" : "Template deleted");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not delete");
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-ink-muted max-w-lg">
          System templates fire automatically — edit their copy or turn them off.
          Custom templates are reusable drafts for the Compose tab.
        </p>
        <button onClick={() => setEditing({ key: null, is_system: false, category: "transactional" })}
          className="flex items-center gap-1.5 brand-gradient text-white px-4 py-2 text-sm font-medium whitespace-nowrap">
          <PlusCircle size={16} /> New Template
        </button>
      </div>
      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>
              {["Name", "Type", "Category", "Status", ""].map((h) => (
                <th key={h} className="text-xs uppercase tracking-widest text-ink-muted text-left px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gold/20">
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3">{r.is_system ? "System" : "Custom"}</td>
                <td className="px-4 py-3 capitalize">{r.category}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleEnabled(r)}
                    className={r.enabled ? "text-verified" : "text-revoked"}>
                    {r.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
                <td className="px-4 py-3 flex items-center gap-3">
                  <button onClick={() => setEditing(r)} className="text-ink-muted hover:text-maroon">
                    <PencilSimple size={16} />
                  </button>
                  <button onClick={() => remove(r)} className="text-ink-muted hover:text-revoked"
                    title={r.is_system ? "Reset to default" : "Delete"}>
                    <Trash size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-muted">No templates yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <TemplateEditModal tpl={editing} meta={meta} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}

function Campaigns() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/admin/emails/campaigns").then((r) => setRows(r.data || []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!rows.some((r) => r.status === "sending")) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [rows, load]);

  const pauseResume = async (row) => {
    try {
      await api.post(`/admin/emails/campaigns/${row.campaign_id}/${row.status === "sending" ? "pause" : "resume"}`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update campaign");
    }
  };

  return (
    <div>
      <CampaignWizard onCreated={load} />
      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>
              {["Name", "Status", "Recipients", "Sent", "Failed", "Created", ""].map((h) => (
                <th key={h} className="text-xs uppercase tracking-widest text-ink-muted text-left px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.campaign_id} className="border-t border-gold/20">
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 capitalize">{r.status}</td>
                <td className="px-4 py-3">{r.recipient_count}</td>
                <td className="px-4 py-3">{r.sent_count}</td>
                <td className="px-4 py-3">{r.failed_count}</td>
                <td className="px-4 py-3 text-ink-muted">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {(r.status === "sending" || r.status === "paused") && (
                    <button onClick={() => pauseResume(r)} className="text-ink-muted hover:text-maroon">
                      {r.status === "sending" ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-ink-muted">No campaigns yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Logs ─────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

function Logs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (status) params.status = status;
      const r = await api.get("/admin/emails/logs", { params });
      setRows(r.data.rows || []); setTotal(r.data.total || 0);
    } catch (e) {
      toast.error("Could not load email logs");
    } finally {
      setLoading(false);
    }
  }, [page, status]);
  useEffect(() => { load(); }, [load]);

  const filtered = query
    ? rows.filter((r) => `${r.subject} ${(r.to_emails || []).join(" ")}`.toLowerCase().includes(query.toLowerCase()))
    : rows;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const retry = async (row) => {
    setRetrying(row.id);
    try {
      await api.post(`/admin/emails/logs/${row.id}/retry`);
      toast.success("Email resent");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Resend failed");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <SearchBar value={query} onChange={setQuery} placeholder="Search subject or recipient…" className="max-w-xs" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="gold-line bg-ivory px-3 py-2 text-sm outline-none focus:border-maroon">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <button onClick={() => { clearApiCache(); load(); }} className="text-ink-muted hover:text-maroon">
          <ArrowClockwise size={16} />
        </button>
      </div>
      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>
              {["Type", "To", "Subject", "Status", "Sent", ""].map((h) => (
                <th key={h} className="text-xs uppercase tracking-widest text-ink-muted text-left px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-gold/20">
                <td className="px-4 py-3">{r.type}</td>
                <td className="px-4 py-3">{(r.to_emails || []).join(", ")}</td>
                <td className="px-4 py-3">{r.subject}</td>
                <td className={`px-4 py-3 ${r.status === "sent" ? "text-verified" : "text-revoked"}`}
                  title={r.error || ""}>{r.status}</td>
                <td className="px-4 py-3 text-ink-muted">{r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}</td>
                <td className="px-4 py-3">
                  {r.status === "failed" && (
                    <AsyncButton onClick={() => retry(r)} loading={retrying === r.id} loadingText="Resending…"
                      className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gold/40 text-ink-soft hover:border-maroon hover:text-maroon disabled:opacity-50">
                      <ArrowClockwise size={12} /> Retry
                    </AsyncButton>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-ink-muted">No emails logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-4 text-xs text-ink-muted">
        <div>{total === 0 ? "No entries" : `Showing ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total}`}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}
            className="flex items-center gap-1 px-3 py-1.5 border border-gold/40 disabled:opacity-40">
            <CaretLeft size={12} /> Prev
          </button>
          <span>Page {page + 1} of {lastPage + 1}</span>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage || loading}
            className="flex items-center gap-1 px-3 py-1.5 border border-gold/40 disabled:opacity-40">
            Next <CaretRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────
export default function AdminEmail() {
  const [tab, setTab] = useState("compose");
  const Body = useMemo(() => ({
    compose: <Compose />, templates: <Templates />, campaigns: <Campaigns />, logs: <Logs />,
  }), []);

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft mb-1">Messaging</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-5 flex items-center gap-3">
        <EnvelopeSimple size={30} weight="duotone" className="text-maroon" /> Emails
      </h1>
      <div className="flex gap-1 border-b border-gold/20 mb-6 flex-wrap">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm inline-flex items-center gap-1.5 border-b-2 -mb-px ${tab === key ? "border-maroon text-maroon" : "border-transparent text-ink-soft hover:text-maroon"}`}>
            <Icon size={16} weight="duotone" /> {label}
          </button>
        ))}
      </div>
      {Body[tab]}
    </div>
  );
}
