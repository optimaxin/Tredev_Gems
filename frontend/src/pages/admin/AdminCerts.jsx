import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Certificate, User, Package } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";
import { formatCode } from "@/lib/fingerprint";

export default function AdminCerts() {
  const [certs, setCerts] = useState([]);
  const [query, setQuery] = useState("");
  const refresh = () => api.get("/admin/certificates").then((r) => setCerts(r.data));
  useEffect(() => { refresh(); }, []);

  const shown = certs.filter((c) =>
    matchesQuery(query, [c.product_name, c.serial, c.qr_token, c.verify_code, c.buyer_name, c.buyer_email, c.order_no]));

  const revoke = async (c) => {
    if (!confirm(`Revoke certificate for ${c.serial}? This is permanent.`)) return;
    await api.post(`/admin/certificates/revoke/${c.cert_id}`);
    toast.success("Revoked"); refresh();
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Trust</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Certificates</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search by code, product, serial, buyer, order or QR…" testId="certs-search" className="mb-4 max-w-md" />
      <div className="grid md:grid-cols-2 gap-4">
        {shown.map((c) => (
          <div key={c.cert_id} className={`gold-line bg-ivory p-5 ${c.revoked ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-maroon-deep"><Certificate size={18} weight="duotone" /> <span className="font-serifd text-lg truncate">{c.product_name}</span></div>
                <div className="mt-1 text-xs font-mono text-ink-muted">{c.serial}</div>
              </div>
              {c.verify_code && (
                <div className="text-right shrink-0">
                  <div className="text-[9px] uppercase tracking-widest text-ink-muted">Verify code</div>
                  <div className="font-serifd tracking-[0.15em] text-maroon-deep text-lg">{formatCode(c.verify_code)}</div>
                </div>
              )}
            </div>

            {/* Who it's assigned to + which product */}
            <div className="mt-3 border-t border-gold/20 pt-3 space-y-1 text-xs">
              <div className="flex items-center gap-1.5 text-ink-soft">
                <User size={13} weight="duotone" className="text-gold-soft shrink-0" />
                {c.buyer_name || c.buyer_email ? (
                  <span className="truncate">Assigned to <span className="text-ink font-medium">{c.buyer_name || c.buyer_email}</span>{c.buyer_name && c.buyer_email ? <span className="text-ink-muted"> · {c.buyer_email}</span> : ""}</span>
                ) : (
                  <span className="text-ink-muted">Not yet assigned (unsold stock)</span>
                )}
              </div>
              {c.order_no && (
                <div className="flex items-center gap-1.5 text-ink-muted">
                  <Package size={13} weight="duotone" className="text-gold-soft shrink-0" />
                  Order <span className="font-mono text-ink">{c.order_no}</span>
                </div>
              )}
            </div>

            <div className="mt-2 text-xs">
              QR: <span className="font-mono">{c.qr_token}</span> · {c.revoked ? <span className="text-revoked">REVOKED</span> : c.activated ? <span className="text-verified">ACTIVATED</span> : <span className="text-suspicious">pending dispatch</span>}
            </div>
            <div className="mt-3 flex gap-3 items-center">
              <a href={`/verify/${c.qr_token}`} target="_blank" rel="noreferrer" className="text-xs text-maroon underline">Preview verify page</a>
              {!c.revoked && <button onClick={() => revoke(c)} className="text-xs text-revoked underline ml-auto">Revoke</button>}
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="gold-line p-10 text-center text-ink-muted col-span-full">{query ? `No certificates match “${query}”.` : "No certificates yet."}</div>}
      </div>
    </div>
  );
}
