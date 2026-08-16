import React, { useEffect, useState } from "react";
import LegalPage from "@/components/gemora/LegalPage";
import { api } from "@/lib/api";

// Content is admin-editable (Admin → Legal Pages) — server.py's _DEFAULT_TERMS_CONDITIONS
// mirrors this shape and is what /site-content returns until an admin ever saves an edit.
export default function TermsConditions() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    api.get("/site-content").then(({ data }) => setContent(data?.terms_conditions || {})).catch(() => setContent({}));
  }, []);

  if (!content) return <div className="py-24 text-center text-ink-muted">Loading…</div>;

  return (
    <LegalPage
      title={content.title || "Terms & Conditions"}
      effectiveDate={content.effective_date}
      intro={content.intro}
      html={content.html}
    />
  );
}
