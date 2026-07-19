import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mediaSrc } from "@/lib/api";
import { toast } from "sonner";
import { Star, ShieldCheck, Trash, ChatCircle } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

export default function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    api.get("/admin/reviews").then((r) => setReviews(r.data)).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  const shown = reviews.filter((r) =>
    matchesQuery(query, [r.product_title, r.author, r.author_email, r.title, r.body]));

  const remove = async (r) => {
    if (!window.confirm(`Delete this ${r.rating}★ review by ${r.author}? This can't be undone.`)) return;
    try {
      await api.delete(`/admin/reviews/${r.review_id}`);
      setReviews((cur) => cur.filter((x) => x.review_id !== r.review_id));
      toast.success("Review deleted");
    } catch (_) {
      toast.error("Couldn't delete the review");
    }
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Community</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-1">Product reviews</h1>
      <p className="text-sm text-ink-muted mb-6">{reviews.length} total · delete anything unwanted.</p>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search reviews by product, author or text…"
        testId="reviews-search"
        className="mb-4 max-w-md"
      />

      {loading ? (
        <div className="gold-line p-10 text-center text-ink-muted">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="gold-line p-10 text-center text-ink-muted">
          {query ? `No reviews match “${query}”.` : "No reviews yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.review_id} className="gold-line bg-ivory p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex gap-0.5 text-gold">
                      {Array.from({ length: 5 }).map((_, k) => (
                        <Star key={k} size={13} weight={k < (r.rating || 0) ? "fill" : "regular"} />
                      ))}
                    </div>
                    {r.product_slug ? (
                      <Link to={`/product/${r.product_slug}`} className="text-sm font-serifd text-maroon underline underline-offset-2">
                        {r.product_title || "—"}
                      </Link>
                    ) : (
                      <span className="text-sm font-serifd text-ink">{r.product_title || "—"}</span>
                    )}
                    {r.verified_buyer && (
                      <span className="text-verified inline-flex items-center gap-1 text-[10px] uppercase tracking-widest">
                        <ShieldCheck size={11} weight="duotone" /> Verified buyer
                      </span>
                    )}
                  </div>
                  {r.title && <div className="font-serifd text-lg text-ink mt-2">{r.title}</div>}
                  {r.body && <p className="mt-1 text-sm text-ink-soft">{r.body}</p>}
                  {Array.isArray(r.photos) && r.photos.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.photos.map((url, k) => (
                        <a key={k} href={mediaSrc(url)} target="_blank" rel="noreferrer" className="block w-16 h-16 gold-line overflow-hidden">
                          <img src={mediaSrc(url)} alt="Review photo" className="w-full h-full object-cover hover:opacity-90" />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                    <ChatCircle size={12} weight="duotone" /> {r.author}
                    {r.author_email && <span>· {r.author_email}</span>}
                    <span>· <span className="font-mono">{new Date(r.created_at).toLocaleString()}</span></span>
                  </div>
                </div>
                <button
                  onClick={() => remove(r)}
                  data-testid={`review-delete-${r.review_id}`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs px-3 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
