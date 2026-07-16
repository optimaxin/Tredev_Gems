import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, ShieldCheck } from "@phosphor-icons/react";

export default function AdminInventory() {
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [certs, setCerts] = useState([]);
  const [sel, setSel] = useState("");

  const refresh = () => {
    api.get("/products?limit=500").then((r) => setProducts(r.data));
    api.get("/admin/units", { params: sel ? { product_id: sel } : {} }).then((r) => setUnits(r.data));
    api.get("/admin/certificates").then((r) => setCerts(r.data));
  };
  useEffect(() => { refresh(); }, [sel]);

  const addUnits = async (product_id) => {
    const input = prompt("How many pieces to add? (serial numbers are auto-generated)");
    if (input == null) return;
    const quantity = parseInt(input, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error("Enter a whole number of pieces (1 or more)");
      return;
    }
    try {
      const { data } = await api.post("/admin/units/bulk", { product_id, quantity });
      toast.success(`${data.count} piece${data.count === 1 ? "" : "s"} added to inventory`);
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
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Vault</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Inventory</h1>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-widest text-ink-muted">Filter</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="gold-line px-3 py-2 text-sm bg-ivory">
          <option value="">All products</option>
          {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
        </select>
        {sel && <button onClick={() => addUnits(sel)} className="text-xs text-maroon underline inline-flex items-center gap-1"><PlusCircle size={12} /> Add stock</button>}
      </div>

      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>{["Serial", "Product", "Status", "Certificate", "Action"].map((h) => <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-widest text-ink-muted">{h}</th>)}</tr>
          </thead>
          <tbody>
            {units.map((u) => {
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
            {units.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-muted">No units.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
