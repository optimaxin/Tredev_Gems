import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Certificate } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

export default function AdminCerts() {
  const [certs, setCerts] = useState([]);
  const [query, setQuery] = useState("");
  const refresh = () => api.get("/admin/certificates").then((r) => setCerts(r.data));
  useEffect(() => { refresh(); }, []);

  const shown = certs.filter((c) => matchesQuery(query, [c.product_name, c.serial, c.qr_token]));

  const revoke = async (c) => {
    if (!confirm(`Revoke certificate for ${c.serial}? This is permanent.`)) return;
    await api.post(`/admin/certificates/revoke/${c.cert_id}`);
    toast.success("Revoked"); refresh();
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Trust</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Certificates</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search by product, serial or QR token…" testId="certs-search" className="mb-4 max-w-md" />
      <div className="grid md:grid-cols-2 gap-4">
        {shown.map((c) => (
          <div key={c.cert_id} className={`gold-line bg-ivory p-5 ${c.revoked ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 text-maroon-deep"><Certificate size={18} weight="duotone" /> <span className="font-serifd text-lg">{c.product_name}</span></div>
            <div className="mt-1 text-xs font-mono text-ink-muted">{c.serial}</div>
            <div className="mt-2 text-xs">
              QR: <span className="font-mono">{c.qr_token}</span> · {c.revoked ? <span className="text-revoked">REVOKED</span> : c.activated ? <span className="text-verified">ACTIVATED</span> : <span className="text-suspicious">pending dispatch</span>}
            </div>
            <div className="mt-2 text-[11px] font-mono break-all text-ink-muted">{c.signature_ed25519_hex?.slice(0, 40)}…</div>
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
