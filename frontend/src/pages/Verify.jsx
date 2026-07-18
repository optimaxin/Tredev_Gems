import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ShieldCheck, ShieldWarning, ShieldSlash, Certificate, QrCode, Fingerprint, HandHeart, Play, ArrowRight } from "@phosphor-icons/react";
import CryptoFingerprint from "@/components/gemora/CryptoFingerprint";

const STATUS_MAP = {
  AUTHENTIC: { color: "text-verified", bg: "bg-verified", border: "border-verified", icon: ShieldCheck, label: "AUTHENTIC", sub: "Signature verified against Tredev's public key" },
  SUSPICIOUS: { color: "text-suspicious", bg: "bg-suspicious", border: "border-suspicious", icon: ShieldWarning, label: "SUSPICIOUS", sub: "This label cannot be verified — treat with caution" },
  REVOKED: { color: "text-revoked", bg: "bg-revoked", border: "border-revoked", icon: ShieldSlash, label: "REVOKED", sub: "This certificate was revoked (returned/refunded unit)" },
};

function Field({ label, value, mono = false, deva = false }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-muted">{label}</div>
      <div className={`mt-1 text-ink ${mono ? "font-mono text-sm break-all" : deva ? "font-deva text-lg" : "text-base"}`}>{value}</div>
    </div>
  );
}

export default function Verify() {
  const { qrToken } = useParams();
  const nav = useNavigate();
  const [token, setToken] = useState(qrToken || "");
  const [state, setState] = useState("idle"); // idle | scanning | done
  const [result, setResult] = useState(null);
  const [pubKey, setPubKey] = useState("");

  useEffect(() => {
    api.get("/").then(({ data }) => setPubKey(data.public_key_ed25519_hex));
  }, []);

  useEffect(() => {
    if (!qrToken) return;
    runVerify(qrToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  const runVerify = async (t) => {
    setState("scanning"); setResult(null);
    // small delay for the scanning animation
    await new Promise((r) => setTimeout(r, 1100));
    try {
      const { data } = await api.get(`/verify/${t}`);
      setResult(data);
    } catch (e) {
      setResult({ status: "SUSPICIOUS", reason: "Server error while verifying" });
    } finally {
      setState("done");
    }
  };

  const submit = (e) => { e.preventDefault(); if (token) nav(`/verify/${token}`); };

  const status = result ? STATUS_MAP[result.status] || STATUS_MAP.SUSPICIOUS : null;
  const StatusIcon = status?.icon;

  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{
        backgroundImage: "url('https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg')",
        backgroundSize: "cover", backgroundPosition: "center"
      }} />

      <div className="relative mx-auto max-w-5xl px-6 lg:px-10 py-16">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-gold-soft border border-gold/40 px-3 py-1.5">
            <Fingerprint size={12} weight="duotone" /> Public verification portal
          </div>
          <h1 className="mt-6 font-display text-5xl md:text-6xl text-ink leading-tight">Prove <span className="brand-gradient-text">it</span> — right here.</h1>
          <p className="mt-4 text-ink-soft max-w-2xl mx-auto">
            Every Tredev stone carries a QR that decodes to a public token. Enter it below (or scan the QR on your certificate) and we'll re-verify the Ed25519 signature against our public key.
          </p>
        </div>

        {!qrToken && (
          <form onSubmit={submit} className="mt-10 max-w-xl mx-auto flex gap-3">
            <input
              data-testid="verify-token-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="qr_xxxxxxxxxxxxxxxx"
              className="flex-1 gold-line-strong bg-ivory px-5 py-4 outline-none font-mono text-sm placeholder:text-ink-muted"
            />
            <button data-testid="verify-submit-btn" className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2">Verify <ArrowRight size={16} /></button>
          </form>
        )}

        {/* Public key — shown as a memorable seal, not raw hex */}
        {pubKey && (
          <div className="mt-10 gold-line p-5">
            <CryptoFingerprint
              value={pubKey}
              label="Tredev's official seal (Ed25519 public key)"
              description="This is Tredev's one and only signing seal — it's the same on every genuine certificate. Recognise this picture and words, and you'll know a certificate was really signed by us."
            />
          </div>
        )}

        {/* Result / scanner */}
        {qrToken && (
          <div className="mt-12">
            {state === "scanning" && (
              <div className="relative overflow-hidden gold-line-strong h-64 flex items-center justify-center bg-cream">
                <div className="scanline" />
                <div className="text-center">
                  <div className="font-mono text-xs tracking-widest text-gold-soft">DECODING</div>
                  <div className="font-display text-2xl text-maroon-deep mt-2">Verifying signature…</div>
                  <div className="text-xs text-ink-muted mt-1">Recomputing SHA-256 · Checking Ed25519</div>
                </div>
              </div>
            )}

            {state === "done" && result && (
              <div className="fade-up space-y-6">
                {/* Status Card — Bento crown jewel */}
                <div className={`relative border-2 ${status.border} bg-ivory p-8 md:p-10`}>
                  <div className={`absolute inset-x-0 top-0 h-[3px] ${status.bg}`} />
                  <div className="flex items-start gap-6 flex-wrap">
                    <div className={`${status.color}`}>
                      <StatusIcon size={72} weight="duotone" />
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-[0.3em] text-ink-muted">Verification Result</div>
                      <div className={`font-display text-5xl md:text-6xl ${status.color} mt-1`}>{status.label}</div>
                      <div className="text-ink-soft mt-2">{result.reason || status.sub}</div>
                      {result.verified_at && (
                        <div className="mt-3 text-xs font-mono text-ink-muted">Verified at {new Date(result.verified_at).toLocaleString()}</div>
                      )}
                    </div>
                    {result.cert?.qr_token && (
                      <div className="ml-auto">
                        <img
                          alt="QR"
                          src={`${process.env.REACT_APP_BACKEND_URL}/api/verify/qr/${result.cert.qr_token}.png`}
                          className="w-28 h-28 gold-line bg-ivory p-2"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {result.status === "AUTHENTIC" && result.cert && (
                  <>
                    {/* Bento: unit + product */}
                    <div className="grid md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 gold-line bg-ivory p-6">
                        <div className="flex items-center gap-2 text-maroon-deep"><Certificate size={20} weight="duotone" /> <span className="font-serifd text-xl">The Item</span></div>
                        <div className="mt-5 grid grid-cols-2 gap-5">
                          <Field label="Product" value={result.cert.product_name} />
                          <Field label="Serial No." value={result.cert.serial} mono />
                          <Field label="Certificate ID" value={result.cert.cert_id} mono />
                          <Field label="Issued" value={new Date(result.cert.issued_at).toLocaleDateString()} />
                        </div>
                      </div>
                      <div className="gold-line bg-ivory p-6 flex flex-col items-center justify-center text-center">
                        {result.product?.images?.[0] && (
                          <div className="aspect-square w-full overflow-hidden gold-line">
                            <img src={result.product.images[0]} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <Link to={`/product/${result.product?.slug}`} className="mt-4 text-sm text-maroon underline underline-offset-4 decoration-gold-soft">View product page →</Link>
                      </div>
                    </div>

                    {/* Bento: Lab + Temple */}
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="gold-line bg-ivory p-6">
                        <div className="flex items-center gap-2 text-maroon-deep"><Certificate size={20} weight="duotone" /> <span className="font-serifd text-xl">Lab Report</span></div>
                        <div className="mt-5 grid grid-cols-2 gap-5">
                          <Field label="Laboratory" value={result.cert.lab_name} />
                          <Field label="Report No." value={result.cert.lab_report_no} mono />
                        </div>
                        {result.cert.lab_report_url && (
                          <a href={result.cert.lab_report_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-maroon">Open PDF <ArrowRight size={14} /></a>
                        )}
                      </div>
                      <div className="gold-line bg-ivory p-6">
                        <div className="flex items-center gap-2 text-maroon-deep"><HandHeart size={20} weight="duotone" /> <span className="font-serifd text-xl">Temple Energisation</span></div>
                        <div className="mt-5 grid grid-cols-2 gap-5">
                          <Field label="Temple (English)" value={result.cert.temple_name} />
                          <Field label="मंदिर" value={result.cert.temple_devanagari} deva />
                          <Field label="Priest" value={result.cert.priest_name} />
                          <Field label="Date" value={result.cert.energization_date} mono />
                        </div>
                        {result.cert.mantra && (
                          <div className="mt-5 p-4 bg-cream border border-gold/30">
                            <div className="text-[10px] uppercase tracking-widest text-ink-muted">Mantra</div>
                            <div className="font-deva text-2xl text-maroon-deep mt-1">{result.cert.mantra}</div>
                          </div>
                        )}
                        {result.cert.pooja_recording_url && (
                          <a href={result.cert.pooja_recording_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-maroon">
                            <Play size={14} weight="duotone" /> Listen to the pooja
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Ed25519 signature — humanised */}
                    <div className="gold-line bg-maroon-deep text-ivory p-6">
                      <div className="flex items-center gap-2"><Fingerprint size={20} weight="duotone" className="text-gold" /> <span className="font-serifd text-xl text-gold">This item's unique fingerprint</span></div>
                      <p className="mt-2 text-xs text-ivory/70 leading-relaxed max-w-2xl">
                        Every genuine piece has its own one-of-a-kind fingerprint below — no two are ever alike. Remember your item's picture and words; if anyone ever shows you a "copy", its fingerprint won't match.
                      </p>
                      <div className="mt-5 grid md:grid-cols-2 gap-8">
                        <CryptoFingerprint
                          dark
                          value={result.cert.content_hash_sha256}
                          label="This certificate's fingerprint"
                          description="A unique picture of exactly what's written on this certificate. Change a single letter and the whole picture changes."
                        />
                        <CryptoFingerprint
                          dark
                          value={result.cert.signature_ed25519_hex}
                          label="Tredev's signature on this item"
                          description="Tredev's seal applied to this exact item — proof we personally vouched for it."
                        />
                      </div>
                      <div className="mt-6 text-[11px] text-ivory/50 leading-relaxed">
                        For the technically inclined: expand any value above to see the raw hex. Verify independently by canonicalising the certificate JSON (RFC-style sorted keys, no whitespace) and checking the signature against the public key using any Ed25519 library.
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
