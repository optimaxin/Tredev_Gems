import React, { useEffect, useState } from "react";
import LegalPage from "@/components/gemora/LegalPage";
import { api } from "@/lib/api";

// Content is admin-editable (Admin → Legal Pages) — server.py's
// _DEFAULT_REFUNDS_CANCELLATIONS mirrors this shape and is what /site-content
// returns until an admin ever saves an edit.
export default function RefundsAndCancellations() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    api.get("/site-content").then(({ data }) => setContent(data?.refunds_cancellations || {})).catch(() => setContent({}));
  }, []);

  if (!content) return <div className="py-24 text-center text-ink-muted">Loading…</div>;

  return (
    <LegalPage
      title={content.title || "Refunds & Cancellations"}
      effectiveDate={content.effective_date}
      intro={content.intro}
      html={content.html}
    />
  );
}
