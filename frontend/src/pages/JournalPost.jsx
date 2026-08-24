import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, slugify } from "@/lib/api";
import { ArrowLeft } from "@phosphor-icons/react";
import { useSiteAssets } from "@/context/SiteAssetsContext";

// Renders one "From the Tredeva journal" article. Posts have no separate
// content store — they live inside the same site-content `home.posts` blob
// that the homepage cards and the admin editor read/write, keyed by a slug
// derived from the title (see slugify in lib/api).
export default function JournalPost() {
  const { slug } = useParams();
  const { getAsset } = useSiteAssets();
  const [post, setPost] = useState(undefined); // undefined = loading, null = not found

  useEffect(() => {
    let alive = true;
    api.get("/site-content").then(({ data }) => {
      if (!alive) return;
      const posts = data.home?.posts || [];
      const i = posts.findIndex((p) => slugify(p.title) === slug);
      setPost(i >= 0 ? { ...posts[i], img: getAsset(`home_blog_${i + 1}`, null) } : null);
    }).catch(() => alive && setPost(null));
    window.scrollTo(0, 0);
    return () => { alive = false; };
  }, [slug, getAsset]);

  if (post === undefined) {
    return <div className="p-16 text-center text-ink-muted">Loading…</div>;
  }
  if (!post) {
    return (
      <div className="p-16 text-center">
        <p className="text-ink-muted">This journal entry couldn't be found.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 text-sm text-maroon">
          <ArrowLeft size={14} /> Back home
        </Link>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-6 lg:px-10 py-16">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-maroon mb-8">
        <ArrowLeft size={12} /> Back to journal
      </Link>
      {post.tag && <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">{post.tag}</div>}
      <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">{post.title}</h1>
      {post.img && (
        <div className="mt-8 aspect-[16/9] overflow-hidden gold-line">
          <img src={post.img} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="mt-8 space-y-4 text-base text-ink-soft leading-relaxed">
        {(post.body || "").split("\n").filter(Boolean).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </article>
  );
}
