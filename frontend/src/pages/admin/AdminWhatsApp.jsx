import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, clearApiCache } from "@/lib/api";
import { toast } from "sonner";
import {
  WhatsappLogo, ChatCircleDots, Notepad, Lightning, MegaphoneSimple, PlugsConnected,
  PaperPlaneRight, CheckCircle, XCircle, ArrowClockwise, FloppyDisk, PaperPlaneTilt,
  PlusCircle, Trash, X,
} from "@phosphor-icons/react";
import SearchBar from "@/components/gemora/SearchBar";

const TABS = [
  { key: "inbox", label: "Inbox", Icon: ChatCircleDots },
  { key: "templates", label: "Templates", Icon: Notepad },
  { key: "automations", label: "Automations", Icon: Lightning },
  { key: "campaigns", label: "Campaigns", Icon: MegaphoneSimple },
  { key: "connection", label: "Connection", Icon: PlugsConnected },
];

const CATEGORY_TONE = {
  transactional: "text-verified border-verified/40 bg-verified/5",
  consultation: "text-maroon border-maroon/30 bg-maroon/5",
  astrologer: "text-gold-soft border-gold/40 bg-gold/5",
  marketing: "text-ink border-ink/20 bg-cream",
};

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return d.toLocaleDateString();
};

// ── Connection banner (shared across tabs) ──────────────────────────────────
function ConnectionPill({ status }) {
  const map = {
    ready: ["Connected", "text-verified", CheckCircle],
    unreachable: ["Gateway offline", "text-revoked", XCircle],
    not_configured: ["Not configured", "text-ink-muted", XCircle],
  };
  const [label, tone, Icon] = map[status?.status] || [status?.status || "…", "text-ink-muted", PlugsConnected];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}>
      <Icon size={14} weight="fill" /> {label}
      {status?.phone && <span className="font-mono text-ink-muted">· {status.phone}</span>}
    </span>
  );
}

// ── Inbox ───────────────────────────────────────────────────────────────────
function Inbox() {
  const [chats, setChats] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadChats = useCallback(() => {
    api.get(`/admin/whatsapp/chats${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => setChats(r.data)).catch(() => {});
  }, [q]);
  useEffect(() => { loadChats(); }, [loadChats]);

  const openChat = async (c) => {
    setActive(c);
    try {
      const r = await api.get(`/admin/whatsapp/chats/${c.chat_row_id}/messages`);
      setMessages(r.data);
      if (c.unread_count > 0) {
        api.post(`/admin/whatsapp/chats/${c.chat_row_id}/read`).then(loadChats).catch(() => {});
      }
      setTimeout(() => endRef.current?.scrollIntoView(), 50);
    } catch { setMessages([]); }
  };

  const send = async () => {
    if (!draft.trim() || !active) return;
    setSending(true);
    try {
      await api.post("/admin/whatsapp/send", { chat_id: active.chat_id, text: draft });
      setDraft("");
      await openChat(active);
      toast.success("Sent");
    } catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
    finally { setSending(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-[560px]">
      <div className="gold-line bg-ivory flex flex-col min-h-0">
        <div className="p-3 border-b border-gold/20">
          <SearchBar value={q} onChange={setQ} placeholder="Search conversations…" testId="wa-inbox-search" />
        </div>
        <div className="overflow-y-auto flex-1">
          {chats.map((c) => (
            <button key={c.chat_row_id} onClick={() => openChat(c)}
              className={`w-full text-left px-3 py-3 border-b border-gold/10 hover:bg-cream ${active?.chat_row_id === c.chat_row_id ? "bg-cream" : ""}`}>
              <div className="flex justify-between items-baseline gap-2">
                <span className="font-serifd text-ink truncate">{c.customer_name || c.display_name || c.phone}</span>
                <span className="text-[10px] text-ink-muted shrink-0">{fmtTime(c.last_message_at)}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs text-ink-muted truncate">{c.last_message_preview || "—"}</span>
                {c.unread_count > 0 && <span className="shrink-0 text-[10px] bg-maroon text-ivory rounded-full px-1.5 py-0.5">{c.unread_count}</span>}
              </div>
            </button>
          ))}
          {chats.length === 0 && <div className="p-6 text-center text-xs text-ink-muted">No customer conversations yet.</div>}
        </div>
      </div>

      <div className="gold-line bg-ivory flex flex-col min-h-0 min-w-0">
        {!active ? (
          <div className="flex-1 grid place-items-center text-ink-muted text-sm">Select a conversation</div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gold/20">
              <div className="font-display text-lg text-maroon-deep">{active.customer_name || active.display_name || active.phone}</div>
              <div className="text-xs text-ink-muted font-mono">{active.phone}</div>
            </div>
            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 space-y-2 bg-cream/30">
              {messages.map((m) => (
                // break-words: templates can carry long unbroken tokens (welcome-link JWTs,
                // tracking URLs) that whitespace-pre-wrap alone won't wrap, which used to
                // stretch the bubble past its container and push the whole page into
                // horizontal scroll.
                <div key={m.message_id} className={`max-w-[75%] px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.direction === "out" ? "ml-auto bg-verified/10 border border-verified/30" : "bg-ivory border border-gold/20"}`}>
                  {m.body}
                  <div className="text-[10px] text-ink-muted mt-1 flex gap-2">
                    <span>{fmtTime(m.wa_timestamp)}</span>
                    {m.direction === "out" && <span>{m.status}{m.sent_by_name ? ` · ${m.sent_by_name}` : ""}</span>}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="p-3 border-t border-gold/20 flex gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                placeholder="Type a reply…" className="flex-1 gold-line bg-ivory px-3 py-2 text-sm outline-none focus:border-maroon" />
              <button onClick={send} disabled={sending || !draft.trim()}
                className="px-4 bg-maroon text-ivory disabled:opacity-40 flex items-center gap-1">
                <PaperPlaneRight size={16} weight="fill" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────
function useWaMeta() {
  const [meta, setMeta] = useState({ trigger_events: [], categories: [] });
  useEffect(() => { api.get("/admin/whatsapp/meta").then((r) => setMeta(r.data)).catch(() => {}); }, []);
  return meta;
}

// New-template / new-automation form. Shared by the Templates tab (defaults to a
// manual, reusable message) and the Automations tab (opened pre-bound to one event —
// staff and admins with the `whatsapp` permission can use either entry point).
function NewTemplateForm({ meta, initialEvent = "manual", onDone, onCancel }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(initialEvent === "manual" ? "marketing" : "transactional");
  const [triggerEvent, setTriggerEvent] = useState(initialEvent);
  const [body, setBody] = useState("");
  const [includeCalendar, setIncludeCalendar] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !body.trim()) return toast.error("Name and message body are required");
    setBusy(true);
    try {
      await api.post("/admin/whatsapp/templates", {
        name: name.trim(), category, trigger_event: triggerEvent,
        body, include_calendar: includeCalendar,
      });
      toast.success(triggerEvent === "manual" ? "Template created" : "Automation created — it will fire on that event immediately");
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not create it"); }
    finally { setBusy(false); }
  };

  return (
    <div className="gold-line-strong bg-ivory p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-display text-lg text-maroon-deep">New message</div>
        <button onClick={onCancel} className="text-ink-muted hover:text-maroon"><X size={16} /></button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="block"><div className="text-xs text-ink-muted mb-1">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali offer"
            className="w-full gold-line bg-cream/40 px-3 py-2 text-sm outline-none focus:border-maroon" /></label>
        <label className="block"><div className="text-xs text-ink-muted mb-1">Category</div>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full gold-line bg-cream/40 px-3 py-2 text-sm outline-none focus:border-maroon">
            {meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
      </div>
      <label className="block">
        <div className="text-xs text-ink-muted mb-1">Sends automatically on</div>
        <select value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}
          className="w-full gold-line bg-cream/40 px-3 py-2 text-sm outline-none focus:border-maroon">
          <option value="manual">Manual only — Campaigns / Test send, never automatic</option>
          {meta.trigger_events.map((ev) => <option key={ev.key} value={ev.key}>{ev.label} ({ev.to})</option>)}
        </select>
      </label>
      <label className="block">
        <div className="text-xs text-ink-muted mb-1">
          Message — use <code className="bg-cream px-1">{"{{variable}}"}</code> for values filled in at send time (e.g. {"{{name}}"}, {"{{order_id}}"})
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
          className="w-full gold-line bg-cream/40 p-3 text-sm font-mono outline-none focus:border-maroon" />
      </label>
      {triggerEvent === "consultation.booked" && (
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={includeCalendar} onChange={(e) => setIncludeCalendar(e.target.checked)} />
          Includes an "add to calendar" link (use {"{{calendar_link}}"} in the body)
        </label>
      )}
      <div className="flex gap-2">
        <button onClick={create} disabled={busy} className="text-xs inline-flex items-center gap-1 bg-maroon text-ivory px-4 py-2 disabled:opacity-40">
          <PlusCircle size={14} weight="fill" /> Create
        </button>
        <button onClick={onCancel} className="text-xs text-ink-muted px-2">Cancel</button>
      </div>
    </div>
  );
}

function Templates() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const meta = useWaMeta();
  const load = () => api.get("/admin/whatsapp/templates").then((r) => setTemplates(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const startEdit = (t) => { setEditing(t.key); setBody(t.body); };

  const save = async (t) => {
    try {
      await api.put(`/admin/whatsapp/templates/${t.key}`, { body });
      toast.success("Template saved"); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const toggle = async (t) => {
    try { await api.put(`/admin/whatsapp/templates/${t.key}`, { enabled: !t.enabled }); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try { await api.delete(`/admin/whatsapp/templates/${t.key}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const testSend = async (t) => {
    const phone = prompt(`Send a test "${t.name}" to which number? (with country code)`);
    if (!phone) return;
    try {
      await api.post(`/admin/whatsapp/templates/${t.key}/test`, { phone });
      toast.success("Test message sent");
    } catch (e) { toast.error(e.response?.data?.detail || "Test send failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-ink-muted max-w-2xl">
          Free-text messages with <code className="bg-cream px-1">{"{{variables}}"}</code> filled in automatically when sent.
          Turn a template off to pause its automation. Edits take effect immediately.
        </p>
        {!creating && (
          <button onClick={() => setCreating(true)} data-testid="wa-new-template"
            className="shrink-0 text-xs inline-flex items-center gap-1.5 bg-maroon text-ivory px-3 py-2">
            <PlusCircle size={15} weight="fill" /> New template
          </button>
        )}
      </div>

      {creating && (
        <NewTemplateForm meta={meta} initialEvent="manual"
          onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
      )}

      {templates.map((t) => (
        <div key={t.key} className="gold-line bg-ivory p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg text-ink">{t.name}</span>
                <span className={`text-[10px] uppercase tracking-widest border px-1.5 py-0.5 ${CATEGORY_TONE[t.category] || ""}`}>{t.category}</span>
              </div>
              <code className="text-[11px] text-ink-muted">{t.key} · trigger: {t.trigger_event}</code>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => testSend(t)} className="text-xs inline-flex items-center gap-1 text-ink-soft hover:text-maroon">
                <PaperPlaneTilt size={13} /> Test
              </button>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} />
                {t.enabled ? "On" : "Off"}
              </label>
              <button onClick={() => remove(t)} className="text-xs inline-flex items-center gap-1 text-revoked hover:underline">
                <Trash size={13} /> Delete
              </button>
            </div>
          </div>
          {editing === t.key ? (
            <div className="mt-3">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
                className="w-full gold-line bg-cream/40 p-3 text-sm font-mono outline-none focus:border-maroon" />
              <div className="flex gap-2 mt-2 items-center">
                <button onClick={() => save(t)} className="text-xs inline-flex items-center gap-1 bg-maroon text-ivory px-3 py-1.5">
                  <FloppyDisk size={13} /> Save
                </button>
                <button onClick={() => setEditing(null)} className="text-xs text-ink-muted">Cancel</button>
                <span className="text-[11px] text-ink-muted ml-auto">Variables: {(t.variables || []).map((v) => `{{${v}}}`).join(" ")}</span>
              </div>
            </div>
          ) : (
            <pre onClick={() => startEdit(t)} className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-soft bg-cream/30 p-3 cursor-text hover:bg-cream/60 font-sans">{t.body}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Automations ──────────────────────────────────────────────────────────────
// Grouped by real event hook. Each event can have zero, one, or several bound
// templates — every ENABLED one fires when the event happens. Staff/admin with the
// `whatsapp` permission can add a new message straight onto any event here.
function Automations() {
  const [rows, setRows] = useState([]);
  const [addingTo, setAddingTo] = useState(null); // event key, or null
  const meta = useWaMeta();
  const load = () => api.get("/admin/whatsapp/automations").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggle = async (tpl) => {
    try { await api.put(`/admin/whatsapp/templates/${tpl.key}`, { enabled: !tpl.enabled }); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const remove = async (tpl) => {
    if (!window.confirm(`Remove "${tpl.name}" from this automation?`)) return;
    try { await api.delete(`/admin/whatsapp/templates/${tpl.key}`); toast.success("Removed"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted max-w-2xl">
        These fire automatically on the events below — every <b>On</b> message bound to an
        event sends when it happens. Add as many messages per event as you like (e.g. a
        Hindi and an English version); edit the wording under Templates.
      </p>
      <div className="space-y-3">
        {rows.map((ev) => (
          <div key={ev.event} className="gold-line bg-ivory p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serifd text-lg text-ink">{ev.label}</div>
                <div className="text-xs text-ink-muted">{ev.when} · sends to {ev.to}</div>
              </div>
              {addingTo !== ev.event && (
                <button onClick={() => setAddingTo(ev.event)}
                  className="shrink-0 text-xs inline-flex items-center gap-1 border border-gold/40 px-2.5 py-1.5 hover:border-maroon hover:text-maroon">
                  <PlusCircle size={14} /> Add message
                </button>
              )}
            </div>

            {ev.templates.length > 0 && (
              <div className="mt-3 divide-y divide-gold/10 border-t border-gold/10">
                {ev.templates.map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      {t.enabled
                        ? <CheckCircle size={14} weight="fill" className="text-verified shrink-0" />
                        : <XCircle size={14} className="text-ink-muted shrink-0" />}
                      <span className={t.enabled ? "text-ink" : "text-ink-muted"}>{t.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} />
                        {t.enabled ? "On" : "Off"}
                      </label>
                      <button onClick={() => remove(t)} className="text-xs text-revoked hover:underline inline-flex items-center gap-1">
                        <Trash size={12} /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ev.templates.length === 0 && addingTo !== ev.event && (
              <div className="mt-2 text-xs text-ink-muted italic">No message bound — nothing sends for this event yet.</div>
            )}

            {addingTo === ev.event && (
              <div className="mt-3">
                <NewTemplateForm meta={meta} initialEvent={ev.event}
                  onDone={() => { setAddingTo(null); load(); }} onCancel={() => setAddingTo(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Campaigns ───────────────────────────────────────────────────────────────
function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/admin/whatsapp/campaigns").then((r) => setCampaigns(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const launch = async () => {
    if (!name.trim() || !body.trim()) return toast.error("Name and message are required");
    if (!confirm("Send this campaign to every opted-in customer with a verified phone?")) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/whatsapp/campaigns", { name, body });
      toast.success(`Queued to ${data.recipients} recipients`);
      setName(""); setBody(""); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const refresh = async (c) => {
    try { await api.post(`/admin/whatsapp/campaigns/${c.campaign_id}/refresh`); load(); }
    catch { /* best effort */ }
  };

  return (
    <div className="space-y-6">
      <div className="gold-line bg-ivory p-4">
        <div className="font-display text-lg text-ink mb-3">New campaign</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name (internal)"
          className="w-full gold-line bg-cream/40 px-3 py-2 text-sm mb-2 outline-none focus:border-maroon" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Message to send…"
          className="w-full gold-line bg-cream/40 px-3 py-2 text-sm outline-none focus:border-maroon" />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-ink-muted">Sends only to customers who opted in and have a verified phone. Paced by the gateway to reduce ban risk.</span>
          <button onClick={launch} disabled={busy} className="bg-maroon text-ivory px-4 py-2 text-sm disabled:opacity-40 inline-flex items-center gap-1">
            <MegaphoneSimple size={15} weight="fill" /> Launch
          </button>
        </div>
      </div>

      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>{["Campaign", "Status", "Sent / Recipients", "By", "When", ""].map((h) => <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-widest text-ink-muted">{h}</th>)}</tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-t border-gold/20">
                <td className="px-4 py-3 font-serifd">{c.name}</td>
                <td className="px-4 py-3 text-xs uppercase tracking-widest">{c.status}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.sent_count} / {c.recipient_count}{c.failed_count > 0 && <span className="text-revoked"> ({c.failed_count} failed)</span>}</td>
                <td className="px-4 py-3 text-ink-soft">{c.created_by_name || "—"}</td>
                <td className="px-4 py-3 text-ink-muted text-xs">{fmtTime(c.created_at)}</td>
                <td className="px-4 py-3">
                  {c.status === "running" && <button onClick={() => refresh(c)} className="text-xs text-maroon inline-flex items-center gap-1"><ArrowClockwise size={12} /> Refresh</button>}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted">No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Connection ──────────────────────────────────────────────────────────────
function Connection({ status, onRefresh }) {
  return (
    <div className="gold-line bg-ivory p-6 max-w-lg">
      <div className="font-display text-xl text-maroon-deep mb-4">Gateway connection</div>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between"><dt className="text-ink-muted">Status</dt><dd><ConnectionPill status={status} /></dd></div>
        <div className="flex justify-between"><dt className="text-ink-muted">Number</dt><dd className="font-mono">{status?.phone || "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-muted">Connected</dt><dd className="text-ink-soft">{status?.connected_at ? new Date(status.connected_at).toLocaleString() : "—"}</dd></div>
        {status?.last_error && <div className="flex justify-between"><dt className="text-ink-muted">Last error</dt><dd className="text-revoked text-xs">{status.last_error}</dd></div>}
      </dl>
      <button onClick={onRefresh} className="mt-5 text-xs inline-flex items-center gap-1 border border-gold/40 px-3 py-2 hover:bg-cream hover:text-maroon">
        <ArrowClockwise size={13} /> Refresh
      </button>
      <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
        Pairing and re-connection are managed on the OpenWA gateway. If the status shows disconnected, the session may need restarting on the server.
      </p>
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────
export default function AdminWhatsApp() {
  const [tab, setTab] = useState("inbox");
  const [status, setStatus] = useState(null);
  const loadStatus = useCallback(() => {
    clearApiCache();
    api.get("/admin/whatsapp/status").then((r) => setStatus(r.data)).catch(() => setStatus({ status: "unreachable" }));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const Body = useMemo(() => ({
    inbox: <Inbox />, templates: <Templates />, automations: <Automations />,
    campaigns: <Campaigns />, connection: <Connection status={status} onRefresh={loadStatus} />,
  }), [status, loadStatus]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Messaging</div>
        <ConnectionPill status={status} />
      </div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-5 flex items-center gap-3">
        <WhatsappLogo size={30} weight="duotone" className="text-verified" /> WhatsApp
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
