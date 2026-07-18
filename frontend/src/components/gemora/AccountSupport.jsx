import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import {
  ChatCircleDots, PaperPlaneTilt, CheckCircle, Clock, X, UserCircle, Headset, CaretRight,
} from "@phosphor-icons/react";

// The kinds of query a buyer can raise. "order-linked" ones show the order picker.
const CATEGORIES = [
  { key: "order", label: "Order" },
  { key: "payment", label: "Payment" },
  { key: "refund", label: "Refund" },
  { key: "return", label: "Return" },
  { key: "product", label: "Product issue" },
  { key: "other", label: "Other" },
];
const ORDER_LINKED = new Set(["order", "payment", "refund", "return"]);
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const STATUS_STYLE = {
  open: "text-gold-soft", in_progress: "text-maroon", resolved: "text-verified", closed: "text-ink-muted",
};
const STATUS_LABEL = {
  open: "Received", in_progress: "In progress", resolved: "Resolved", closed: "Closed",
};
const fmtDateTime = (s) => {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/* ── Expanded query view: full thread + reply box ──────────────────── */
function QueryModal({ query, onClose, onUpdated }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  // The buyer's own note author_id equals the query's user_id; staff notes differ.
  const mine = (by) => by && query.user_id && by === query.user_id;

  // The original message is the first thing the buyer said; render it as the head
  // of the conversation, then every note in order.
  const thread = [
    { by: query.user_id, at: query.created_at, text: query.message, head: true },
    ...(query.notes || []),
  ];

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      const { data } = await api.post(`/me/queries/${query.query_id}/notes`, { note: text });
      setReply("");
      onUpdated(data); // refresh both the modal and the list
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send your reply");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="query-modal">
      <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-ivory gold-line-strong w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gold/30">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] uppercase tracking-widest ${STATUS_STYLE[query.status] || "text-ink-muted"}`}>
                ● {STATUS_LABEL[query.status] || query.status}
              </span>
              {query.category && <span className="text-[10px] uppercase tracking-widest text-ink-muted">· {CAT_LABEL[query.category] || query.category}</span>}
              {query.order_no && <span className="text-[10px] font-mono text-ink-muted">· {query.order_no}</span>}
            </div>
            <h3 className="font-serifd text-xl text-maroon-deep mt-1 leading-snug truncate">{query.subject}</h3>
            <div className="text-[11px] text-ink-muted mt-0.5 inline-flex items-center gap-1">
              <Clock size={11} weight="duotone" /> Raised {fmtDateTime(query.created_at)}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" data-testid="query-modal-close" className="text-ink-muted hover:text-maroon shrink-0">
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* conversation thread */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-cream/40">
          {thread.map((m, i) => {
            const isMe = mine(m.by);
            return (
              <div key={i} className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
                <div className={`shrink-0 mt-0.5 ${isMe ? "text-maroon" : "text-gold-soft"}`}>
                  {isMe ? <UserCircle size={26} weight="duotone" /> : <Headset size={26} weight="duotone" />}
                </div>
                <div className={`max-w-[78%] ${isMe ? "text-right" : ""}`}>
                  <div className="text-[10px] uppercase tracking-widest text-ink-muted">
                    {isMe ? "You" : "Tredev Support"}{m.at ? ` · ${fmtDateTime(m.at)}` : ""}
                  </div>
                  <div className={`mt-1 inline-block text-left px-4 py-2.5 text-sm leading-relaxed border ${
                    isMe ? "bg-ivory border-gold/40 text-ink" : "bg-maroon-deep/[0.04] border-maroon/30 text-ink"
                  }`}>
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })}

          {query.status === "resolved" && (
            <div className="flex items-center justify-center gap-2 text-verified text-xs pt-2">
              <CheckCircle size={14} weight="duotone" /> This query was marked resolved. Reply to reopen it.
            </div>
          )}
        </div>

        {/* reply box */}
        <div className="border-t border-gold/30 p-4 bg-ivory">
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder="Add a note or reply to support…"
              data-testid="query-reply-input"
              className="flex-1 gold-line bg-ivory px-3 py-2.5 text-sm outline-none focus:border-maroon resize-none"
            />
            <button
              onClick={send}
              disabled={sending || !reply.trim()}
              data-testid="query-reply-send"
              className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-40 shrink-0"
            >
              <PaperPlaneTilt size={15} weight="duotone" /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className="text-[10px] text-ink-muted mt-2">Press ⌘/Ctrl + Enter to send. Our team is notified of every reply.</div>
        </div>
      </div>
    </div>
  );
}

export default function AccountSupport({ user, orders = [] }) {
  const [category, setCategory] = useState("order");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false); // show the confirmation card after submit
  const [queries, setQueries] = useState([]);
  const [openId, setOpenId] = useState(null); // which query is expanded

  const loadQueries = () => api.get("/me/queries").then((r) => setQueries(r.data)).catch(() => {});
  useEffect(() => { loadQueries(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) { toast.error("Please describe your issue"); return; }
    setSubmitting(true);
    try {
      await api.post("/queries", {
        name: user.name, email: user.email, phone: user.phone || null,
        category,
        order_id: ORDER_LINKED.has(category) && orderId ? orderId : null,
        message: message.trim(),
      });
      setDone(true);
      setMessage(""); setOrderId("");
      loadQueries();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not submit your query");
    } finally { setSubmitting(false); }
  };

  const raiseAnother = () => { setDone(false); setCategory("order"); };

  // Merge an updated query (from a reply) back into the list, and keep the modal in sync.
  const applyUpdate = (updated) => {
    setQueries((qs) => qs.map((q) => (q.query_id === updated.query_id ? updated : q)));
  };
  const openQuery = queries.find((q) => q.query_id === openId) || null;

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-10">
      {/* ── Raise a query ── */}
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Need help?</div>
        <h2 className="font-serifd text-2xl text-maroon-deep mt-1">Raise a query</h2>
        <p className="mt-2 text-sm text-ink-soft max-w-lg">
          Tell us what's wrong and we'll sort it out. Pick what it's about, add a few details, and our team takes it from there.
        </p>

        {done ? (
          <div className="mt-6 gold-line-strong bg-cream p-6" data-testid="support-confirmation">
            <div className="flex items-center gap-2 text-verified">
              <CheckCircle size={22} weight="duotone" />
              <span className="font-serifd text-xl text-maroon-deep">Query received</span>
            </div>
            <p className="mt-3 text-ink-soft leading-relaxed">
              Thank you. Your query has been logged and our team is on it.
              We'll resolve it within <strong>24–48 hours</strong>, or our representative will call you for more
              information or with a solution.
            </p>
            <button onClick={raiseAnother} className="mt-5 border border-maroon text-maroon px-5 py-2.5 text-xs uppercase tracking-widest hover:bg-maroon hover:text-ivory transition-colors">
              Raise another query
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 gold-line bg-ivory p-6 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">What is this about?</div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key} type="button" onClick={() => setCategory(c.key)}
                    aria-pressed={category === c.key}
                    data-testid={`support-cat-${c.key}`}
                    className={`px-4 py-2 border text-sm transition-colors ${
                      category === c.key ? "border-maroon bg-cream text-maroon-deep" : "border-gold/40 text-ink-soft hover:border-maroon"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {ORDER_LINKED.has(category) && (
              <label className="block">
                <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Related order {category !== "order" && "(optional)"}</div>
                <select
                  value={orderId} onChange={(e) => setOrderId(e.target.value)}
                  data-testid="support-order"
                  className="w-full gold-line px-3 py-2.5 bg-ivory outline-none focus:border-maroon"
                >
                  <option value="">— select an order —</option>
                  {orders.map((o) => (
                    <option key={o.order_id} value={o.order_id}>
                      {o.order_no || o.order_id.slice(0, 8)} · {formatINR(o.total)} · {new Date(o.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {orders.length === 0 && <div className="text-[10px] text-ink-muted mt-1">You have no orders yet.</div>}
              </label>
            )}

            <label className="block">
              <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Details</div>
              <textarea
                rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue in as much detail as you can…"
                data-testid="support-message"
                className="w-full gold-line px-3 py-2.5 bg-ivory outline-none focus:border-maroon"
              />
            </label>

            <div className="text-[11px] text-ink-muted">
              We'll reply to <span className="font-mono">{user.email}</span>{user.phone ? <> or call <span className="font-mono">{user.phone}</span></> : ""}.
            </div>

            <button
              type="submit" disabled={submitting}
              data-testid="support-submit"
              className="brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-50"
            >
              <PaperPlaneTilt size={15} weight="duotone" /> {submitting ? "Submitting…" : "Submit query"}
            </button>
          </form>
        )}
      </div>

      {/* ── Their past queries — click to expand ── */}
      <aside>
        <div className="text-xs uppercase tracking-widest text-ink-muted mb-3 flex items-center gap-1.5">
          <ChatCircleDots size={14} weight="duotone" /> Your queries
        </div>
        {queries.length === 0 ? (
          <div className="gold-line p-6 text-center text-sm text-ink-muted">Nothing raised yet.</div>
        ) : (
          <div className="space-y-3">
            {queries.map((q) => {
              const lastNote = q.notes?.length ? q.notes[q.notes.length - 1] : null;
              const supportReplied = lastNote && q.user_id && lastNote.by !== q.user_id;
              return (
                <button
                  key={q.query_id}
                  type="button"
                  onClick={() => setOpenId(q.query_id)}
                  data-testid={`support-query-${q.query_id}`}
                  className="w-full text-left gold-line bg-ivory p-4 hover:border-maroon transition-colors group"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-serifd text-ink truncate">{q.subject}</div>
                    <span className={`shrink-0 text-[10px] uppercase tracking-widest ${STATUS_STYLE[q.status] || "text-ink-muted"}`}>
                      {STATUS_LABEL[q.status] || q.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    {q.category && <span className="uppercase tracking-widest">{CAT_LABEL[q.category] || q.category}</span>}
                    {q.order_no && <span className="font-mono">· {q.order_no}</span>}
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {new Date(q.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-2 text-xs text-ink-soft line-clamp-2">{q.message}</p>
                  {lastNote && (
                    <div className={`mt-2 pt-2 border-t border-gold/20 text-xs line-clamp-2 ${supportReplied ? "text-maroon" : "text-ink-muted"}`}>
                      <span className="font-medium">{supportReplied ? "Support:" : "You:"}</span> {lastNote.text}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] uppercase tracking-widest text-gold-soft inline-flex items-center gap-1 group-hover:text-maroon">
                    {supportReplied ? "View reply" : "View & reply"} <CaretRight size={10} weight="bold" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {openQuery && (
        <QueryModal
          query={openQuery}
          onClose={() => setOpenId(null)}
          onUpdated={applyUpdate}
        />
      )}
    </div>
  );
}
