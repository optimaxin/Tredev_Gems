import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { toast } from "sonner";
import { Plus, PencilSimple, TrashSimple, Tag, X, UsersThree, MagnifyingGlass } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";
import AsyncButton from "@/components/gemora/AsyncButton";

const EMPTY = {
  code: "", name: "", description: "",
  discount_type: "percentage", discount_value: "", max_discount_amount: "",
  min_order_amount: "", min_quantity: 1, currency: "",
  scope: "all_products", applies_to_product_ids: [], applies_to_categories: [],
  audience: "all_users", trigger_type: "manual", auto_apply_priority: 0,
  is_stackable: false, starts_at: "", ends_at: "",
  usage_limit: "", usage_limit_per_user: 1, is_active: true,
};

const DISCOUNT_TYPES = [
  ["percentage", "Percentage off"],
  ["fixed_amount", "Flat amount off"],
  ["free_shipping", "Free shipping"],
];
const SCOPES = [
  ["all_products", "All products", "Discounts the whole cart."],
  ["specific_products", "Specific products", "Only the listed products are discounted."],
  ["specific_categories", "Specific categories", "Only items in these categories are discounted."],
];
const AUDIENCES = [
  ["all_users", "All users", "Anyone with an account."],
  ["first_purchase", "First-time buyers only", "Rejected once the buyer has one paid order."],
  ["employees", "Tredeva employees only", "Add staff to the list after saving."],
  ["specific_users", "Specific users only", "Add the exact accounts after saving."],
];

function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
// Money crosses this API in minor units (paise/cents), like every other amount.
const toMinor = (v) => (v === "" || v === null || v === undefined ? null : Math.round(Number(v) * 100));
const fromMinor = (v) => (v === null || v === undefined || v === 0 ? "" : v / 100);

const Pill = ({ children, tone = "muted" }) => (
  <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border ${
    tone === "on" ? "border-verified text-verified"
    : tone === "warn" ? "border-gold/60 text-maroon"
    : "border-ink-muted/50 text-ink-muted"}`}>{children}</span>
);

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [cats, setCats] = useState([]);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState(null); // the coupon whose ACL is open

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/coupons");
      setCoupons(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load coupons"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.get("/categories").then((r) => setCats(r.data.categories.filter((c) => !c.is_sub))).catch(() => {});
    // Admin list, not the public /products — a coupon should still be restrictable
    // to a product that's currently hidden (e.g. being prepped pre-launch).
    api.get("/admin/products?limit=500").then((r) => setProducts(r.data)).catch(() => {});
  }, [load]);

  const startEdit = (c) => setEditing({
    ...EMPTY, ...c,
    discount_value: c.discount_type === "fixed_amount" ? fromMinor(c.discount_value) : (c.discount_value ?? ""),
    max_discount_amount: fromMinor(c.max_discount_amount),
    min_order_amount: fromMinor(c.min_order_amount),
    usage_limit: c.usage_limit ?? "",
    usage_limit_per_user: c.usage_limit_per_user ?? "",
    currency: c.currency ? c.currency.trim() : "",
    starts_at: isoToLocal(c.starts_at), ends_at: isoToLocal(c.ends_at),
  });

  const save = async () => {
    const e = editing;
    if (!e.code.trim() || !e.name.trim()) { toast.error("Code and name are required"); return; }
    const payload = {
      ...e,
      code: e.code.trim().toUpperCase(),
      description: e.description || null,
      // Percentage stays a plain number; a flat amount is money, so it converts.
      discount_value: e.discount_type === "free_shipping" ? null
        : e.discount_type === "fixed_amount" ? toMinor(e.discount_value) : Number(e.discount_value),
      max_discount_amount: toMinor(e.max_discount_amount),
      min_order_amount: toMinor(e.min_order_amount) ?? 0,
      min_quantity: Number(e.min_quantity) || 1,
      currency: e.currency || null,
      auto_apply_priority: Number(e.auto_apply_priority) || 0,
      usage_limit: e.usage_limit === "" ? null : Number(e.usage_limit),
      usage_limit_per_user: e.usage_limit_per_user === "" ? null : Number(e.usage_limit_per_user),
      starts_at: localToIso(e.starts_at), ends_at: localToIso(e.ends_at),
    };
    setSaving(true);
    try {
      if (e.coupon_id) { await api.patch(`/admin/coupons/${e.coupon_id}`, payload); toast.success("Coupon updated"); }
      else { await api.post("/admin/coupons", payload); toast.success("Coupon created"); }
      setEditing(null);
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete coupon ${c.code}?`)) return;
    try {
      const { data } = await api.delete(`/admin/coupons/${c.coupon_id}`);
      toast.success(data.deactivated ? data.detail : "Deleted");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Delete failed"); }
  };

  const set = (k) => (ev) => setEditing((c) => ({
    ...c, [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value,
  }));
  const toggleIn = (k, v) => setEditing((c) => ({
    ...c,
    [k]: (c[k] || []).includes(v) ? c[k].filter((x) => x !== v) : [...(c[k] || []), v],
  }));

  const shown = coupons.filter((c) => matchesQuery(query, [c.code, c.name, c.description]));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Offers · छूट</div>
          <h1 className="font-display text-4xl text-ink mt-1">Coupons</h1>
          <p className="text-sm text-ink-muted mt-1">
            Who can use it, what it covers, and whether it applies itself.
          </p>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })} data-testid="coupons-new"
                className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2">
          <Plus size={14} weight="bold" /> New coupon
        </button>
      </div>

      {coupons.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search by code or name…"
                   testId="coupons-search" className="mb-4 max-w-md" />
      )}

      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : coupons.length === 0 ? (
        <div className="gold-line bg-ivory p-16 text-center">
          <Tag size={56} weight="duotone" className="mx-auto text-gold-soft" />
          <div className="mt-4 font-serifd text-xl text-maroon-deep">No coupons yet</div>
          <div className="text-sm text-ink-muted mt-2">
            Create one for a festival sale, a welcome offer, or your team.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No coupons match “{query}”.</div>}
          {shown.map((c) => (
            <div key={c.coupon_id} data-testid={`coupon-row-${c.code}`} className="gold-line bg-ivory p-4 flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-lg text-maroon-deep uppercase">{c.code}</span>
                  <span className="font-serifd text-ink">{c.name}</span>
                  <Pill tone={c.is_active ? "on" : "muted"}>{c.is_active ? "Active" : "Paused"}</Pill>
                  {c.trigger_type === "auto_apply" && <Pill tone="warn">Auto · p{c.auto_apply_priority}</Pill>}
                  <Pill>{c.is_stackable ? "Stackable" : "Exclusive"}</Pill>
                </div>
                <div className="text-sm text-ink-soft mt-1.5">
                  {c.discount_type === "percentage" && `${c.discount_value}% off`}
                  {c.discount_type === "fixed_amount" && `${formatPrice(c.discount_value, c.currency || "INR")} off`}
                  {c.discount_type === "free_shipping" && "Free shipping"}
                  {c.max_discount_amount ? ` · cap ${formatPrice(c.max_discount_amount, c.currency || "INR")}` : ""}
                  {c.min_order_amount ? ` · min ${formatPrice(c.min_order_amount, c.currency || "INR")}` : ""}
                  {c.min_quantity > 1 ? ` · min ${c.min_quantity} items` : ""}
                </div>
                <div className="text-[11px] text-ink-muted mt-1">
                  {SCOPES.find((s) => s[0] === c.scope)?.[1]}
                  {c.scope === "specific_categories" && `: ${(c.applies_to_categories || []).join(", ")}`}
                  {c.scope === "specific_products" && `: ${(c.applies_to_product_ids || []).length} product(s)`}
                  {" · "}{AUDIENCES.find((a) => a[0] === c.audience)?.[1]}
                  {c.audience === "employees" && ` (${c.employee_count})`}
                  {c.audience === "specific_users" && ` (${c.whitelist_count})`}
                </div>
                <div className="text-[11px] text-ink-muted mt-1">
                  Used {c.usage_count}{c.usage_limit ? ` / ${c.usage_limit}` : ""} ·
                  {c.usage_limit_per_user ? ` ${c.usage_limit_per_user} per buyer` : " unlimited per buyer"} ·
                  {c.ends_at ? ` until ${new Date(c.ends_at).toLocaleDateString()}` : " no expiry"}
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => startEdit(c)} data-testid={`coupon-edit-${c.code}`}
                        className="border border-maroon text-maroon px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory">
                  <PencilSimple size={11} /> Edit
                </button>
                {(c.audience === "employees" || c.audience === "specific_users") && (
                  <button onClick={() => setMembers(c)} data-testid={`coupon-members-${c.code}`}
                          className="border border-gold/60 text-ink-soft px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-cream">
                    <UsersThree size={11} /> Members
                  </button>
                )}
                <button onClick={() => remove(c)} data-testid={`coupon-delete-${c.code}`}
                        className="border border-revoked/60 text-revoked px-3 py-1.5 text-[10px] uppercase tracking-widest inline-flex items-center gap-1 hover:bg-revoked hover:text-ivory">
                  <TrashSimple size={11} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="coupon-editor">
          <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative bg-ivory gold-line-strong w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gold/30 sticky top-0 bg-ivory z-10">
              <div className="font-serifd text-xl text-maroon-deep">{editing.coupon_id ? `Edit ${editing.code}` : "New coupon"}</div>
              <button onClick={() => setEditing(null)} className="text-ink-muted hover:text-maroon"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-xs text-ink-muted mb-1">Code *</div>
                  <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                         placeholder="DIWALI25" data-testid="coupon-code"
                         className="w-full gold-line px-3 py-2 font-mono outline-none focus:border-maroon" />
                  {editing.trigger_type === "auto_apply" && (
                    <div className="text-[10px] text-ink-muted mt-1">Auto-apply coupons still need a code — buyers just never see it.</div>
                  )}
                </label>
                <label className="block">
                  <div className="text-xs text-ink-muted mb-1">Name (admin label) *</div>
                  <input value={editing.name} onChange={set("name")} placeholder="Diwali 25% off" data-testid="coupon-name"
                         className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                </label>
                <label className="block sm:col-span-2">
                  <div className="text-xs text-ink-muted mb-1">Internal note</div>
                  <input value={editing.description || ""} onChange={set("description")}
                         className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                </label>
              </div>

              {/* ── Discount ── */}
              <section>
                <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Discount</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Type</div>
                    <select value={editing.discount_type} onChange={set("discount_type")} data-testid="coupon-type"
                            className="w-full gold-line bg-ivory px-3 py-2 outline-none focus:border-maroon">
                      {DISCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  {editing.discount_type !== "free_shipping" && (
                    <label className="block">
                      <div className="text-xs text-ink-muted mb-1">
                        {editing.discount_type === "percentage" ? "Percent off (1–100)" : "Amount off"}
                      </div>
                      <input type="number" step="0.01" value={editing.discount_value} onChange={set("discount_value")}
                             data-testid="coupon-value" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                    </label>
                  )}
                  {editing.discount_type === "percentage" && (
                    <label className="block">
                      <div className="text-xs text-ink-muted mb-1">Maximum discount (cap, blank = none)</div>
                      <input type="number" step="0.01" value={editing.max_discount_amount} onChange={set("max_discount_amount")}
                             className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                    </label>
                  )}
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">
                      Currency {editing.discount_type === "fixed_amount" ? "*" : "(blank = any)"}
                    </div>
                    <select value={editing.currency} onChange={set("currency")} data-testid="coupon-currency"
                            className="w-full gold-line bg-ivory px-3 py-2 outline-none focus:border-maroon">
                      <option value="">Any currency</option>
                      <option value="INR">INR — India</option>
                      <option value="USD">USD — outside India</option>
                    </select>
                    {editing.discount_type === "fixed_amount" && (
                      <div className="text-[10px] text-ink-muted mt-1">A flat amount is ₹ or $, never both — pick one.</div>
                    )}
                  </label>
                </div>
              </section>

              {/* ── Cart rules ── */}
              <section>
                <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Cart requirements</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Minimum order value (blank = none)</div>
                    <input type="number" step="0.01" value={editing.min_order_amount} onChange={set("min_order_amount")}
                           data-testid="coupon-min-order" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Minimum eligible items</div>
                    <input type="number" min="1" value={editing.min_quantity} onChange={set("min_quantity")}
                           className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                </div>
              </section>

              {/* ── Scope ── */}
              <section>
                <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Applies to</div>
                <div className="space-y-2">
                  {SCOPES.map(([v, l, hint]) => (
                    <label key={v} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="scope" checked={editing.scope === v} data-testid={`coupon-scope-${v}`}
                             onChange={() => setEditing({ ...editing, scope: v })} className="mt-1 accent-maroon" />
                      <span><span className="text-sm text-ink-soft">{l}</span>
                        <span className="block text-[11px] text-ink-muted">{hint}</span></span>
                    </label>
                  ))}
                </div>
                {editing.scope === "specific_categories" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cats.map((c) => (
                      <button key={c.key} type="button" onClick={() => toggleIn("applies_to_categories", c.key)}
                              className={`text-xs px-3 py-1.5 border ${
                                (editing.applies_to_categories || []).includes(c.key)
                                  ? "bg-maroon text-ivory border-maroon" : "border-gold/50 text-ink-soft hover:bg-cream"}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {editing.scope === "specific_products" && (
                  <div className="mt-3 max-h-52 overflow-y-auto gold-line p-2 space-y-1">
                    {products.map((p) => (
                      <label key={p.product_id} className="flex items-center gap-2 text-sm px-1 py-0.5 hover:bg-cream cursor-pointer">
                        <input type="checkbox" className="accent-maroon"
                               checked={(editing.applies_to_product_ids || []).includes(p.product_id)}
                               onChange={() => toggleIn("applies_to_product_ids", p.product_id)} />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Audience ── */}
              <section>
                <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Who can use it</div>
                <div className="space-y-2">
                  {AUDIENCES.map(([v, l, hint]) => (
                    <label key={v} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="audience" checked={editing.audience === v} data-testid={`coupon-audience-${v}`}
                             onChange={() => setEditing({ ...editing, audience: v })} className="mt-1 accent-maroon" />
                      <span><span className="text-sm text-ink-soft">{l}</span>
                        <span className="block text-[11px] text-ink-muted">{hint}</span></span>
                    </label>
                  ))}
                </div>
              </section>

              {/* ── Trigger & stacking ── */}
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">How it activates</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="trigger" checked={editing.trigger_type === "manual"}
                           onChange={() => setEditing({ ...editing, trigger_type: "manual" })} className="accent-maroon" />
                    <span className="text-sm text-ink-soft">Manual — buyer types the code</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input type="radio" name="trigger" checked={editing.trigger_type === "auto_apply"} data-testid="coupon-trigger-auto"
                           onChange={() => setEditing({ ...editing, trigger_type: "auto_apply" })} className="accent-maroon" />
                    <span className="text-sm text-ink-soft">Auto-apply — no code needed</span>
                  </label>
                  {editing.trigger_type === "auto_apply" && (
                    <label className="block mt-3">
                      <div className="text-xs text-ink-muted mb-1">Priority (higher wins when several compete)</div>
                      <input type="number" value={editing.auto_apply_priority} onChange={set("auto_apply_priority")}
                             className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                    </label>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Combining</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="stack" checked={!editing.is_stackable}
                           onChange={() => setEditing({ ...editing, is_stackable: false })} className="accent-maroon" />
                    <span className="text-sm text-ink-soft">Exclusive — replaces other coupons</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input type="radio" name="stack" checked={editing.is_stackable} data-testid="coupon-stackable"
                           onChange={() => setEditing({ ...editing, is_stackable: true })} className="accent-maroon" />
                    <span className="text-sm text-ink-soft">Stackable — combines with other stackables</span>
                  </label>
                  <div className="text-[11px] text-ink-muted mt-2">
                    Free shipping is usually stackable — left exclusive it would block every other offer.
                  </div>
                </div>
              </section>

              {/* ── Validity & limits ── */}
              <section>
                <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Validity & limits</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Starts at (blank = now)</div>
                    <input type="datetime-local" value={editing.starts_at} onChange={set("starts_at")}
                           className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Ends at (blank = never)</div>
                    <input type="datetime-local" value={editing.ends_at} onChange={set("ends_at")}
                           className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Total uses (blank = unlimited)</div>
                    <input type="number" value={editing.usage_limit} onChange={set("usage_limit")}
                           className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Uses per buyer (blank = unlimited)</div>
                    <input type="number" value={editing.usage_limit_per_user} onChange={set("usage_limit_per_user")}
                           data-testid="coupon-per-user" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
                  </label>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-4">
                  <input type="checkbox" checked={editing.is_active} onChange={set("is_active")} data-testid="coupon-active"
                         className="w-4 h-4 accent-maroon" />
                  <span className="text-sm text-ink-soft">Active</span>
                </label>
              </section>
            </div>

            <div className="px-6 py-4 border-t border-gold/30 flex justify-end gap-3 sticky bottom-0 bg-ivory">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs uppercase tracking-widest text-ink-muted hover:text-maroon">Cancel</button>
              <AsyncButton onClick={save} loading={saving} loadingText="Saving…" data-testid="coupon-save"
                           className="brand-gradient text-ivory px-6 py-2 text-xs uppercase tracking-widest">Save coupon</AsyncButton>
            </div>
          </div>
        </div>
      )}

      {members && <MembersModal coupon={members} onClose={() => { setMembers(null); load(); }} />}
    </div>
  );
}

// Removing someone here revokes their access on their very next request — the
// validator reads this list live. That is the whole "an employee left" procedure.
function MembersModal({ coupon, onClose }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const isStaff = coupon.audience === "employees";

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/coupons/${coupon.coupon_id}/members`);
      setRows(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load members"); }
  }, [coupon.coupon_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => {
      api.get("/admin/coupons/user-search", { params: { q } })
        .then((r) => setFound(r.data)).catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (u) => {
    try {
      await api.post(`/admin/coupons/${coupon.coupon_id}/members`, { user_id: u.user_id });
      toast.success(`${u.name} added`);
      setQ(""); setFound([]); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add"); }
  };

  const drop = async (u) => {
    try {
      await api.delete(`/admin/coupons/${coupon.coupon_id}/members/${u.user_id}`);
      toast.success(`${u.name} removed — ${coupon.code} no longer works for them`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not remove"); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="coupon-members-modal">
      <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-ivory gold-line-strong w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gold/30">
          <div>
            <div className="font-serifd text-xl text-maroon-deep">
              {isStaff ? "Employees" : "Allowed users"} · {coupon.code}
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              Removing someone revokes {coupon.code} for them immediately.
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-maroon"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs text-ink-muted mb-1">Add by name, email or phone</div>
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="coupon-member-search"
                     className="w-full gold-line pl-9 pr-3 py-2 outline-none focus:border-maroon" />
            </div>
            {found.length > 0 && (
              <div className="mt-2 gold-line divide-y divide-gold/20">
                {found.map((u) => (
                  <button key={u.user_id} onClick={() => add(u)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-cream flex justify-between gap-3">
                    <span className="truncate">{u.name}</span>
                    <span className="text-xs text-ink-muted truncate">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-ink-muted text-center py-8">Nobody added yet — this coupon works for no one.</div>
          ) : (
            <div className="gold-line divide-y divide-gold/20">
              {rows.map((u) => (
                <div key={u.user_id} data-testid={`coupon-member-${u.user_id}`} className="px-3 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{u.name}</div>
                    <div className="text-[11px] text-ink-muted truncate">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                  </div>
                  <button onClick={() => drop(u)} className="text-ink-muted hover:text-revoked" aria-label={`Remove ${u.name}`}>
                    <TrashSimple size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
