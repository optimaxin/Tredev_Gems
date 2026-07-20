import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PlusCircle, Trash, FloppyDisk, ArrowSquareOut } from "@phosphor-icons/react";

const inputCls = "w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm";

// The journal cards live inside the single `home` content blob (as `posts`), so we
// load the whole blob, edit only `posts`, and save it back intact. Card images are
// still managed under Site Images (Blog 1–3).
export default function AdminJournal() {
  const { user } = useAuth();
  const canContent = user?.role === "owner" || user?.permissions?.includes("content");

  const [home, setHome] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (canContent) api.get("/admin/site-content").then((r) => setHome(r.data.home || {})).catch(() => setHome({}));
  }, [canContent]);

  const posts = home?.posts || [];
  const setPosts = (next) => setHome((h) => ({ ...(h || {}), posts: next }));
  const setPost = (i, k, v) => setPosts(posts.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const addPost = () => setPosts([...posts, { title: "", tag: "", link: "" }]);
  const rmPost = (i) => setPosts(posts.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/site-content/home", { value: home });
      toast.success("Journal saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (!canContent) {
    return <div className="gold-line p-10 text-center text-ink-muted">You don't have permission to edit journal content.</div>;
  }

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Content</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-1">Journal</h1>
      <p className="text-sm text-ink-muted mb-6">
        The “From the Tredev journal” cards on the homepage. Add a link to make a card clickable — an internal
        path like <span className="font-mono">/verify</span> or a full <span className="font-mono">https://…</span> URL.
        Card images are set under <span className="text-maroon">Site Images</span> (Blog 1–3).
      </p>

      {home === null ? (
        <div className="gold-line p-10 text-center text-ink-muted">Loading…</div>
      ) : (
        <div className="gold-line-strong bg-ivory p-6">
          <div className="space-y-3">
            {posts.length === 0 && <div className="text-sm text-ink-muted">No journal cards yet.</div>}
            {posts.map((p, i) => (
              <div key={i} className="gold-line bg-cream p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-widest text-ink-muted">Card {i + 1}</div>
                  <button onClick={() => rmPost(i)} className="text-ink-muted hover:text-revoked shrink-0" aria-label="Remove card"><Trash size={14} /></button>
                </div>
                <div className="grid md:grid-cols-[160px_1fr] gap-3">
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Tag</div>
                    <input value={p.tag || ""} onChange={(e) => setPost(i, "tag", e.target.value)} placeholder="Guides" className={inputCls} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-muted mb-1">Title</div>
                    <input value={p.title || ""} onChange={(e) => setPost(i, "title", e.target.value)} placeholder="How to wear a Yellow Sapphire…" className={inputCls} />
                  </label>
                </div>
                <label className="block mt-3">
                  <div className="text-xs text-ink-muted mb-1 flex items-center gap-1">Link <ArrowSquareOut size={11} /></div>
                  <input value={p.link || ""} onChange={(e) => setPost(i, "link", e.target.value)} placeholder="/journal/pukhraj-guide or https://…" className={inputCls + " font-mono text-xs"} />
                </label>
              </div>
            ))}
          </div>

          <button onClick={addPost} className="mt-4 text-xs text-maroon underline inline-flex items-center gap-1">
            <PlusCircle size={12} /> Add journal card
          </button>

          <div className="mt-6 flex justify-end">
            <button onClick={save} disabled={saving} className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
              <FloppyDisk size={14} weight="duotone" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
