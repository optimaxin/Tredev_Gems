import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import AsyncButton from "@/components/gemora/AsyncButton";
import {
  MapPin, Phone, EnvelopeSimple, Clock, WhatsappLogo, PaperPlaneTilt, CheckCircle,
} from "@phosphor-icons/react";

const linkCls = "text-maroon underline decoration-gold-soft";

// Same categories the account-side support form uses (server.py's _QUERY_CATEGORIES) —
// kept in sync manually since the list is small and rarely changes.
const CATEGORIES = [
  { key: "order", label: "Order" },
  { key: "payment", label: "Payment" },
  { key: "refund", label: "Refund" },
  { key: "return", label: "Return" },
  { key: "product", label: "Product issue" },
  { key: "other", label: "Other" },
];

// Shown until /site-content resolves — mirrors server.py's _DEFAULT_CONTACT_US, which
// is also what's returned if an admin has never saved an edit (Admin → Legal Pages).
const FALLBACK_CONTACT = {
  email: "hello@gemora.in", phone: "+91 76684 89528", phone_tel: "+917668489528",
  hours: "Daily, 9 AM – 9 PM IST", office_name: "OptiMaxin Solutions Private Limited",
  address_line1: "221A, Nalanda Town, Shamshabad Road",
  address_line2: "Agra, Uttar Pradesh – 282001, India",
};

function InfoRow({ Icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-gold-soft shrink-0"><Icon size={18} weight="duotone" /></div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-muted">{label}</div>
        <div className="text-sm text-ink mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export default function ContactUs() {
  const { user } = useAuth();
  const [contact, setContact] = useState(FALLBACK_CONTACT);
  const [form, setForm] = useState({
    name: user?.name || "", email: user?.email || "", phone: user?.phone || "",
    category: "other", message: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get("/site-content").then(({ data }) => {
      if (data?.contact_us) setContact(data.contact_us);
    }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      toast.error("Please fill in your name, email, and message");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/queries", {
        name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
        category: form.category, message: form.message.trim(),
      });
      setDone(true);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not send your message"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-ivory">
      <section className="relative overflow-hidden bg-cream border-b border-gold/30 py-14">
        <div className="grain absolute inset-0 pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h1 className="font-display text-4xl md:text-5xl text-ink">Contact Us</h1>
          <p className="mt-5 text-ink-soft leading-relaxed">
            Questions about an order, a return, or anything else — we usually reply within 24–48 hours.
            For order-specific issues, signing in first lets us pull up your order automatically.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-14 grid md:grid-cols-[320px_1fr] gap-10">
        {/* ── Contact details ── */}
        <aside className="gold-line bg-cream p-6 h-fit space-y-6">
          <InfoRow Icon={EnvelopeSimple} label="Email">
            <a href={`mailto:${contact.email}`} className={linkCls}>{contact.email}</a>
          </InfoRow>
          <InfoRow Icon={Phone} label="Phone">
            <a href={`tel:${contact.phone_tel}`} className={linkCls}>{contact.phone}</a>
          </InfoRow>
          <InfoRow Icon={WhatsappLogo} label="WhatsApp">
            <a href={`https://wa.me/${contact.phone_tel.replace("+", "")}`} className={linkCls} target="_blank" rel="noopener noreferrer">
              {contact.phone}
            </a>
          </InfoRow>
          <InfoRow Icon={Clock} label="Hours">
            {contact.hours}
          </InfoRow>
          <InfoRow Icon={MapPin} label="Registered office">
            <span className="font-semibold">{contact.office_name}</span><br />
            {contact.address_line1}<br />
            {contact.address_line2}
          </InfoRow>
          <div className="text-[11px] text-ink-muted pt-2 border-t border-gold/30">
            Already have an account? <Link to="/account" className={linkCls}>Raise a query from Account → Support</Link> to track it alongside your orders.
          </div>
        </aside>

        {/* ── Message form ── */}
        <div>
          {done ? (
            <div className="gold-line-strong bg-cream p-6" data-testid="contact-confirmation">
              <div className="flex items-center gap-2 text-verified">
                <CheckCircle size={22} weight="duotone" />
                <span className="font-serifd text-xl text-maroon-deep">Message received</span>
              </div>
              <p className="mt-3 text-ink-soft leading-relaxed">
                Thank you, {form.name.split(" ")[0] || "there"}. We've logged your message and will reply to{" "}
                <span className="font-mono">{form.email}</span> within 24–48 hours.
              </p>
              <button
                onClick={() => setDone(false)}
                className="mt-5 border border-maroon text-maroon px-5 py-2.5 text-xs uppercase tracking-widest hover:bg-maroon hover:text-ivory transition-colors"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="gold-line bg-ivory p-6 space-y-5" data-testid="contact-form">
              <div className="grid sm:grid-cols-2 gap-5">
                <label className="block">
                  <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Name</div>
                  <input
                    type="text" value={form.name} onChange={set("name")} required
                    data-testid="contact-name"
                    className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
                  />
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Email</div>
                  <input
                    type="email" value={form.email} onChange={set("email")} required
                    data-testid="contact-email"
                    className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
                  />
                </label>
              </div>

              <label className="block">
                <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Phone (optional)</div>
                <input
                  type="tel" value={form.phone} onChange={set("phone")}
                  data-testid="contact-phone"
                  className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
                />
              </label>

              <div>
                <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">What is this about?</div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key} type="button"
                      onClick={() => setForm((f) => ({ ...f, category: c.key }))}
                      aria-pressed={form.category === c.key}
                      data-testid={`contact-cat-${c.key}`}
                      className={`px-4 py-2 border text-sm transition-colors ${
                        form.category === c.key ? "border-maroon bg-cream text-maroon-deep" : "border-gold/40 text-ink-soft hover:border-maroon"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Message</div>
                <textarea
                  rows={6} value={form.message} onChange={set("message")} required
                  placeholder="Tell us what's going on — include your order number if this is about a specific order."
                  data-testid="contact-message"
                  className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
                />
              </label>

              <AsyncButton
                type="submit" loading={submitting} loadingText="Sending…"
                data-testid="contact-submit"
                className="brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-50"
              >
                <PaperPlaneTilt size={15} weight="duotone" /> Send message
              </AsyncButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
