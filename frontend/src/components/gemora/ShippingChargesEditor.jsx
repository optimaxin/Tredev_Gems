import React from "react";
import { Trash, PlusCircle } from "@phosphor-icons/react";
import { SHIPPING_REGIONS } from "@/lib/shipping";

// Repeatable {region, amount} rows for a product's shipping_charges — USD, only
// charged outside India (shipping within India is always free). `rows` holds
// amount as a string (matches how price/mrp inputs are edited elsewhere in these
// forms); `onChange` receives the full updated array.
export default function ShippingChargesEditor({ rows, onChange }) {
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, { region: SHIPPING_REGIONS[0], amount: "" }]);
  const removeRow = (i) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Shipping charges</div>
      <div className="text-[10px] text-ink-muted mb-3">
        Shipping within India is always free. Set a USD charge per region for orders shipping
        outside India — a region left unset here still ships, but for $0.
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={r.region}
              onChange={(e) => setRow(i, { region: e.target.value })}
              data-testid={`shipping-charge-region-${i}`}
              className="flex-1 gold-line bg-ivory px-2 py-2 text-sm outline-none focus:border-maroon"
            >
              {SHIPPING_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon w-28 shrink-0">
              <span className="px-2 py-2 bg-cream text-ink-soft border-r border-gold/30 font-serifd text-sm">$</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                placeholder="0.00"
                data-testid={`shipping-charge-amount-${i}`}
                className="flex-1 px-2 py-2 outline-none text-sm"
              />
            </div>
            <button type="button" onClick={() => removeRow(i)} className="text-ink-muted hover:text-revoked shrink-0">
              <Trash size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} data-testid="shipping-charge-add" className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1">
        <PlusCircle size={12} /> Add region
      </button>
    </div>
  );
}
