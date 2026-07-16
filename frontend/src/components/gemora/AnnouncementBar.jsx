import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";

const MESSAGES = [
  { text: "100% Lab-Certified · Ed25519 signed · Dispatched in 48h", deva: "प्रमाणित" },
  { text: "Free insured shipping on orders above ₹5,000", deva: "मुफ्त शिपिंग" },
  { text: "5% prepaid discount · WhatsApp assistance daily 9–9", deva: "छूट" },
];

// Shared with EventStrip: while a live event owns the top strip, the static
// announcement bar stands down so the two identical gradient bars never stack.
const DISMISS_KEY = "gemora_event_strip_dismissed";

export default function AnnouncementBar() {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  const [stripActive, setStripActive] = useState(false);

  // Yield to any non-dismissed active event that renders in the top strip.
  useEffect(() => {
    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"); } catch { dismissed = []; }
    api
      .get("/events/active")
      .then(({ data }) => {
        const liveStrip = (data || []).filter((e) => e.show_in_strip && !dismissed.includes(e.event_id));
        setStripActive(liveStrip.length > 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible || stripActive) return;
    const t = setInterval(() => setI((x) => (x + 1) % MESSAGES.length), 5000);
    return () => clearInterval(t);
  }, [visible, stripActive]);

  if (!visible || stripActive) return null;

  return (
    <div className="brand-gradient text-ivory text-xs" data-testid="announcement-bar">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-2 flex items-center gap-3 justify-center relative">
        <span className="font-deva text-sm hidden sm:inline">{MESSAGES[i].deva}</span>
        <span className="tracking-wide">{MESSAGES[i].text}</span>
        <button
          onClick={() => setVisible(false)}
          data-testid="announcement-close"
          className="absolute right-4 text-ivory/70 hover:text-ivory text-lg leading-none"
          aria-label="Dismiss"
        >×</button>
      </div>
    </div>
  );
}
