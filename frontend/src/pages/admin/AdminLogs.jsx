import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, clearApiCache } from "@/lib/api";
import { toast } from "sonner";
import { ArrowsClockwise, CaretLeft, CaretRight, ClockCounterClockwise } from "@phosphor-icons/react";
import SearchBar from "@/components/gemora/SearchBar";

const PAGE_SIZE = 50;

// Colour-code by the verb so destructive actions are scannable at a glance.
const toneOf = (action = "") => {
  if (/(delete|revoke|purge|deactivate|clear)/.test(action)) return "text-revoked border-revoked/40 bg-revoked/5";
  if (/(create|issue|upload|set)/.test(action)) return "text-verified border-verified/40 bg-verified/5";
  return "text-maroon border-maroon/30 bg-maroon/5";
};

const ROLE_LABEL = { owner: "Owner", staff: "Staff", customer: "Customer" };

// "3 minutes ago" — the log is read newest-first, so relative time is what matters;
// the exact timestamp stays available in the title attribute.
const relTime = (iso) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

// meta is free-form jsonb per action — render it as compact key:value pairs rather
// than raw JSON, and fall back to JSON for nested values.
const renderMeta = (meta) => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  if (!entries.length) return null;
  return entries.map(([k, v]) => {
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    return (
      <span key={k} className="inline-flex items-baseline gap-1 mr-3 whitespace-nowrap">
        <span className="text-ink-muted">{k}:</span>
        <span className="font-mono text-[11px] text-ink-soft" title={val}>
          {val.length > 40 ? `${val.slice(0, 40)}…` : val}
        </span>
      </span>
    );
  });
};

export default function AdminLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters. `query` is debounced into `q` so typing doesn't fire a request per key.
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [actions, setActions] = useState([]);
  const [actors, setActors] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    api.get("/admin/audit-log/filters")
      .then((r) => { setActions(r.data.actions || []); setActors(r.data.actors || []); })
      .catch(() => { /* filters are a convenience — the table still works without them */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (q) params.q = q;
      if (action) params.action = action;
      if (actorId) params.actor_id = actorId;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.get("/admin/audit-log", { params });
      setRows(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not load the activity log");
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, q, action, actorId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { clearApiCache(); load(); };

  const resetFilters = () => {
    setQuery(""); setQ(""); setAction(""); setActorId("");
    setDateFrom(""); setDateTo(""); setPage(0);
  };

  const hasFilters = !!(q || action || actorId || dateFrom || dateTo);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  const actorLabel = useMemo(
    () => (a) => (a.name && a.name !== "" ? a.name : a.email || a.actor_id?.slice(0, 8)),
    []
  );

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Audit trail</div>
      <div className="flex items-center justify-between gap-4 mt-1 mb-2 flex-wrap">
        <h1 className="font-display text-4xl text-ink flex items-center gap-3">
          <ClockCounterClockwise size={30} weight="duotone" className="text-gold-soft" />
          Activity Log
        </h1>
        <button
          onClick={refresh}
          data-testid="logs-refresh"
          className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-widest border border-gold/40 text-ink-soft hover:bg-cream hover:text-maroon transition-colors"
        >
          <ArrowsClockwise size={14} weight="bold" /> Refresh
        </button>
      </div>
      <p className="text-sm text-ink-muted mb-5">
        Every action taken by owners and staff, newest first. Owner-only.
      </p>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search by person, action, target or details…"
        testId="logs-search"
        className="mb-3 max-w-xl"
      />

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select
          value={actorId}
          onChange={(e) => { setActorId(e.target.value); setPage(0); }}
          data-testid="logs-filter-actor"
          className="gold-line bg-ivory px-3 py-2 text-sm outline-none focus:border-maroon"
        >
          <option value="">All people</option>
          {actors.map((a) => (
            <option key={a.actor_id} value={a.actor_id}>{actorLabel(a)}</option>
          ))}
        </select>

        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0); }}
          data-testid="logs-filter-action"
          className="gold-line bg-ivory px-3 py-2 text-sm outline-none focus:border-maroon"
        >
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <label className="flex items-center gap-1 text-xs text-ink-muted">
          From
          <input
            type="date" value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            data-testid="logs-filter-from"
            className="gold-line bg-ivory px-2 py-2 text-sm outline-none focus:border-maroon"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          To
          <input
            type="date" value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            data-testid="logs-filter-to"
            className="gold-line bg-ivory px-2 py-2 text-sm outline-none focus:border-maroon"
          />
        </label>

        {hasFilters && (
          <button
            onClick={resetFilters}
            data-testid="logs-reset"
            className="text-xs px-3 py-2 border border-gold/40 text-ink-soft hover:border-maroon hover:text-maroon"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>
              {["Who", "Action", "Target", "Details", "When"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-widest text-ink-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.event_id} className="border-t border-gold/20 align-top">
                <td className="px-4 py-3">
                  <div className="font-serifd text-ink">{e.actor_name}</div>
                  <div className="text-[11px] text-ink-muted">
                    {e.actor_role && (
                      <span className="uppercase tracking-widest mr-2">{ROLE_LABEL[e.actor_role] || e.actor_role}</span>
                    )}
                    {e.actor_email}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block border px-2 py-0.5 text-[11px] font-mono ${toneOf(e.action)}`}>
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-ink-soft break-all max-w-[180px]">
                  {e.target || "—"}
                </td>
                <td className="px-4 py-3 text-[11px] max-w-[380px]">
                  {renderMeta(e.meta) || <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-ink-muted" title={e.at ? new Date(e.at).toLocaleString() : ""}>
                  {relTime(e.at)}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-muted">
                  {hasFilters ? "No activity matches these filters." : "No admin activity recorded yet."}
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-ink-muted">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-ink-muted">
        <div data-testid="logs-count">
          {total === 0 ? "No entries" : `Showing ${from}–${to} of ${total}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            data-testid="logs-prev"
            className="flex items-center gap-1 px-3 py-1.5 border border-gold/40 disabled:opacity-40 disabled:cursor-not-allowed hover:border-maroon hover:text-maroon"
          >
            <CaretLeft size={12} /> Prev
          </button>
          <span>Page {page + 1} of {lastPage + 1}</span>
          <button
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage || loading}
            data-testid="logs-next"
            className="flex items-center gap-1 px-3 py-1.5 border border-gold/40 disabled:opacity-40 disabled:cursor-not-allowed hover:border-maroon hover:text-maroon"
          >
            Next <CaretRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
