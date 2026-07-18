import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, ShieldCheck, MagnifyingGlass } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";

export default function AdminInventory() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [certs, setCerts] = useState([]);
  const [sel, setSel] = useState("");
  const [addQty, setAddQty] = useState("");
  const [query, setQuery] = useState("");

  const refresh = () => {
    api.get("/products?limit=500").then((r) => setProducts(r.data));
    api.get("/admin/units", { params: sel ? { product_id: sel } : {} }).then((r) => setUnits(r.data));
    api.get("/admin/certificates").then((r) => setCerts(r.data));
  };
  useEffect(() => { refresh(); }, [sel]);

  const addUnits = async (product_id) => {
    const quantity = Math.max(0, parseInt(addQty, 10) || 0);
    if (!quantity) { toast.error("Enter how many pieces to add"); return; }
    try {
      const { data } = await api.post("/admin/units/bulk", { product_id, quantity });
      toast.success(`${data.count} piece${data.count === 1 ? "" : "s"} added to inventory`);
      setAddQty(""); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  // Search across serial number and product name.
  const shownUnits = units.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = products.find((p) => p.product_id === u.product_id)?.name || "";
    return u.serial.toLowerCase().includes(q) || name.toLowerCase().includes(q);
  });

  const purgeAll = async () => {
    if (!confirm("Purge ALL inventory? Every unsold unit across every product is removed and non-serialized stock is zeroed. Sold units (in completed orders) are kept. This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? This wipes your entire sellable stock.")) return;
    try {
      const { data } = await api.post("/admin/inventory/purge");
      toast.success(`Purged · ${data.units_removed} unit${data.units_removed === 1 ? "" : "s"} removed`);
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const issueCert = async (unit_id) => {
    try {
      await api.post("/admin/certificates/issue", {
        unit_id,
        lab_name: "GJEPC Lab Mumbai",
        lab_report_no: `GJ-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
        temple_name: "Kashi Vishwanath Temple",
        temple_devanagari: "काशी विश्वनाथ मंदिर",
        energization_date: new Date().toISOString().slice(0, 10),
        priest_name: "Pandit Ashok Mishra",
        mantra: "ॐ नमः शिवाय",
      });
      toast.success("Certificate signed"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Vault</div>
          <h1 className="font-display text-4xl text-ink mt-1">Inventory</h1>
        </div>
        {user?.role === "owner" && (
          <button onClick={purgeAll} data-testid="admin-inventory-purge" className="text-xs uppercase tracking-widest border border-revoked text-revoked px-4 py-2 hover:bg-revoked hover:text-ivory transition-colors">
            Purge all inventory
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by serial or product…"
            data-testid="inventory-search"
            className="w-full gold-line pl-9 pr-3 py-2.5 bg-ivory outline-none focus:border-maroon"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-ink-muted">Product</span>
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="gold-line px-3 py-2 text-sm bg-ivory">
            <option value="">All products</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </select>
        </div>
        {sel && (
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" step="1" inputMode="numeric"
              value={addQty} onChange={(e) => setAddQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addUnits(sel)}
              placeholder="Qty" data-testid="inventory-add-qty"
              className="w-20 gold-line px-2 py-1.5 text-sm outline-none focus:border-maroon"
            />
            <button onClick={() => addUnits(sel)} data-testid="inventory-add-btn" className="text-xs uppercase tracking-widest border border-maroon text-maroon px-3 py-1.5 inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory transition-colors">
              <PlusCircle size={12} /> Add units
            </button>
          </div>
        )}
      </div>

      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>{["Serial", "Product", "Status", "Certificate", "Action"].map((h) => <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-widest text-ink-muted">{h}</th>)}</tr>
          </thead>
          <tbody>
            {shownUnits.map((u) => {
              const c = certs.find((x) => x.unit_id === u.unit_id);
              const p = products.find((x) => x.product_id === u.product_id);
              return (
                <tr key={u.unit_id} className="border-t border-gold/20">
                  <td className="px-4 py-3 font-mono">{u.serial}</td>
                  <td className="px-4 py-3">{p?.name}</td>
                  <td className="px-4 py-3 uppercase text-xs">{u.status}</td>
                  <td className="px-4 py-3">{c ? <span className="text-verified inline-flex items-center gap-1"><ShieldCheck size={12} weight="duotone" /> {c.activated ? "active" : "issued"}</span> : "—"}</td>
                  <td className="px-4 py-3">{!c && <button onClick={() => issueCert(u.unit_id)} className="text-xs text-maroon underline">Issue certificate</button>}</td>
                </tr>
              );
            })}
            {shownUnits.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-muted">{query ? `No units match “${query}”.` : "No units."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
