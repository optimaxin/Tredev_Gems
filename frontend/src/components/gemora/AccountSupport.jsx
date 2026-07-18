import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { ChatCircleDots, PaperPlaneTilt, CheckCircle, Clock } from "@phosphor-icons/react";

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

export default function AccountSupport({ user, orders = [] }) {
  const [category, setCategory] = useState("order");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false); // show the confirmation card after submit
  const [queries, setQueries] = useState([]);

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

      {/* ── Their past queries ── */}
      <aside>
        <div className="text-xs uppercase tracking-widest text-ink-muted mb-3 flex items-center gap-1.5">
          <ChatCircleDots size={14} weight="duotone" /> Your queries
        </div>
        {queries.length === 0 ? (
          <div className="gold-line p-6 text-center text-sm text-ink-muted">Nothing raised yet.</div>
        ) : (
          <div className="space-y-3">
            {queries.map((q) => (
              <div key={q.query_id} className="gold-line bg-ivory p-4" data-testid={`support-query-${q.query_id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-serifd text-ink">{q.subject}</div>
                  <span className={`text-[10px] uppercase tracking-widest ${STATUS_STYLE[q.status] || "text-ink-muted"}`}>
                    {STATUS_LABEL[q.status] || q.status}
                  </span>
                </div>
                <div className="text-[10px] text-ink-muted mt-0.5 flex items-center gap-2">
                  {q.category && <span className="uppercase tracking-widest">{CAT_LABEL[q.category] || q.category}</span>}
                  {q.order_no && <span className="font-mono">· {q.order_no}</span>}
                  <span className="inline-flex items-center gap-1"><Clock size={10} /> {new Date(q.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-2 text-xs text-ink-soft line-clamp-3">{q.message}</p>
                {q.notes?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gold/20 text-xs text-maroon">
                    <span className="font-medium">Reply:</span> {q.notes[q.notes.length - 1].text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
