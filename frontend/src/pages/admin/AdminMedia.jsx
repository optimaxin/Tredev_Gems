import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { absolutize } from "@/context/SiteAssetsContext";
import { toast } from "sonner";
import { UploadSimple, TrashSimple, Copy, Image as ImageIcon } from "@phosphor-icons/react";
import { copyToClipboard } from "@/lib/clipboard";

// Client-side resize + WebP re-encode before upload. A phone photo is often
// 3–8MB at 4000px+; the site never displays media wider than ~1920px, so shrinking
// and re-encoding here removes the bulk of the bytes that make uploads feel slow.
const MAX_DIM = 1920;
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

async function compressImage(file) {
  // Leave SVG (vector) and GIF (animation) alone — rasterizing them loses fidelity.
  if (!COMPRESSIBLE.has(file.type)) return file;
  if (file.size < 300 * 1024) return file; // already small; not worth re-encoding
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.82));
    if (!blob || blob.size >= file.size) return file; // no gain → keep original
    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp" });
  } catch {
    return file; // any decode/encode failure → upload the original, unchanged
  }
}

export default function AdminMedia() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/media");
      setItems(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load media");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);

    // Validate up front so bad files don't hold up the good ones.
    const valid = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) { toast.error(`${f.name}: not an image`); continue; }
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: max 8MB`); continue; }
      valid.push(f);
    }

    // Compress + upload every file concurrently. Compression (resize → WebP) cuts an
    // 8MB photo to a few hundred KB, so far less travels over the browser→backend→
    // storage path — the dominant cost of an upload.
    const results = await Promise.allSettled(valid.map(async (f) => {
      const out = await compressImage(f);
      const fd = new FormData(); fd.append("file", out);
      const { data } = await api.post("/admin/media/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    }));

    const uploaded = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") uploaded.push(r.value);
      else toast.error(r.reason?.response?.data?.detail || `${valid[i].name}: upload failed`);
    });

    // Show the new rows immediately (the upload endpoint returns the created row in
    // the same shape as the list) instead of refetching + re-proxying the whole grid.
    if (uploaded.length) {
      setItems((prev) => [...uploaded, ...prev]);
      toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""}`);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = ""; // let the same file be picked again
  };

  const remove = async (media_id) => {
    if (!window.confirm("Delete this image? Any slot using it will be cleared.")) return;
    try {
      await api.delete(`/admin/media/${media_id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const copyUrl = (url) => {
    const full = absolutize(url);
    navigator.clipboard?.writeText(full);
    toast.success("URL copied");
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Content · मीडिया</div>
          <h1 className="font-display text-4xl text-ink mt-1">Media library</h1>
          <p className="text-sm text-ink-muted mt-1">Upload images once, then reuse them anywhere on the site.</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          data-testid="admin-media-upload-btn"
          className="brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50"
        >
          <UploadSimple size={14} weight="bold" /> {busy ? "Uploading…" : "Upload images"}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden
          data-testid="admin-media-upload"
          onChange={(e) => handleFiles(Array.from(e.target.files || []))}
        />
      </div>

      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="gold-line bg-ivory p-16 text-center">
          <ImageIcon size={56} weight="duotone" className="mx-auto text-gold-soft" />
          <div className="mt-4 font-serifd text-xl text-maroon-deep">No images yet</div>
          <div className="text-sm text-ink-muted mt-2">Upload some images to start building the site.</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((m) => (
            <div key={m.media_id} data-testid={`admin-media-item-${m.media_id}`} className="gold-line bg-ivory overflow-hidden group">
              <div className="aspect-square bg-cream overflow-hidden">
                <img src={absolutize(m.url)} alt={m.original_filename} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="p-2">
                <div className="text-xs text-ink truncate" title={m.original_filename}>{m.original_filename}</div>
                <div className="text-[10px] text-ink-muted mt-0.5 font-mono">{(m.size / 1024).toFixed(0)} KB</div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => copyUrl(m.url)} className="flex-1 text-[10px] uppercase tracking-widest border border-gold/40 py-1 hover:bg-cream inline-flex items-center justify-center gap-1">
                    <Copy size={11} /> URL
                  </button>
                  <button onClick={() => remove(m.media_id)} data-testid={`admin-media-delete-${m.media_id}`} className="text-[10px] uppercase tracking-widest border border-revoked/50 text-revoked py-1 px-2 hover:bg-revoked hover:text-ivory inline-flex items-center justify-center">
                    <TrashSimple size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
