import React from "react";
import { Trash, PlusCircle } from "@phosphor-icons/react";
import { REGION_CURRENCIES } from "@/lib/currency";

// Repeatable {currency_code, amount} rows for region_pricing overrides — shared by
// AdminProducts and AdminAstrologers. `rows` holds amount as a string (matches how
// price/mrp inputs are edited elsewhere in these forms); `onChange` receives the
// full updated array.
export default function RegionalPricesEditor({ rows, onChange }) {
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, { currency_code: REGION_CURRENCIES[0], amount: "" }]);
  const removeRow = (i) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-gold-soft mb-2">Regional prices</div>
      <div className="text-[10px] text-ink-muted mb-3">
        Visitors browsing from outside India see the price for their currency here, if set — otherwise USD, and
        failing that, the ₹ price above.
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={r.currency_code}
              onChange={(e) => setRow(i, { currency_code: e.target.value })}
              data-testid={`region-price-currency-${i}`}
              className="gold-line bg-ivory px-2 py-2 text-sm outline-none focus:border-maroon"
            >
              {REGION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              value={r.amount}
              onChange={(e) => setRow(i, { amount: e.target.value })}
              placeholder="0.00"
              data-testid={`region-price-amount-${i}`}
              className="flex-1 gold-line bg-ivory px-3 py-2 outline-none focus:border-maroon text-sm"
            />
            <button type="button" onClick={() => removeRow(i)} className="text-ink-muted hover:text-revoked shrink-0">
              <Trash size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} data-testid="region-price-add" className="mt-2 text-xs text-maroon underline inline-flex items-center gap-1">
        <PlusCircle size={12} /> Add currency
      </button>
    </div>
  );
}
