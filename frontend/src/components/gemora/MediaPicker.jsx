import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { absolutize } from "@/context/SiteAssetsContext";
import { toast } from "sonner";
import { X, UploadSimple, Image as ImageIcon, TrashSimple } from "@phosphor-icons/react";

/**
 * MediaPicker
 * - mode="picker" (default) → clicking a tile calls onPick(mediaObj) and closes.
 * - mode="manager" → same UI, tiles are not clickable.
 */
export default function MediaPicker({ open, onClose, onPick, mode = "picker" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      if (!f.type.startsWith("image/")) { toast.error(`${f.name}: not an image`); continue; }
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: max 8MB`); continue; }
      const fd = new FormData(); fd.append("file", f);
      try {
        await api.post("/admin/media/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        ok++;
      } catch (e) {
        toast.error(e?.response?.data?.detail || `${f.name}: upload failed`);
      }
    }
    if (ok) toast.success(`Uploaded ${ok} file${ok > 1 ? "s" : ""}`);
    setBusy(false);
    load();
  };

  const remove = async (media_id) => {
    if (!window.confirm("Delete this image? Any slot using it will be cleared.")) return;
    try {
      await api.delete(`/admin/media/${media_id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" data-testid="media-picker">
      <div className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-ivory gold-line-strong w-full max-w-5xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gold/30">
          <div className="flex items-center gap-2 text-maroon-deep">
            <ImageIcon size={20} weight="duotone" />
            <div className="font-serifd text-xl">{mode === "picker" ? "Choose an image" : "Media library"}</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              data-testid="media-upload-btn"
              className="brand-gradient text-ivory px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50"
            >
              <UploadSimple size={14} weight="bold" /> {busy ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => handleFiles(Array.from(e.target.files || []))}
              data-testid="media-file-input"
            />
            <button onClick={onClose} className="text-ink-muted hover:text-maroon" data-testid="media-picker-close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="text-ink-muted">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-ink-muted">
              <ImageIcon size={48} weight="duotone" className="mx-auto text-gold-soft" />
              <div className="mt-3 text-sm">No images yet. Click Upload to add one.</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {items.map((m) => (
                <div key={m.media_id} className="relative group gold-line bg-cream overflow-hidden">
                  <button
                    onClick={() => onPick?.(m)}
                    disabled={mode !== "picker"}
                    data-testid={`media-item-${m.media_id}`}
                    className="block w-full aspect-square disabled:cursor-default"
                    title={m.original_filename}
                  >
                    <img src={absolutize(m.url)} alt={m.original_filename} className="w-full h-full object-cover" loading="lazy" />
                  </button>
                  <div className="px-2 py-1 text-[10px] text-ink-muted truncate">{m.original_filename}</div>
                  <button
                    onClick={() => remove(m.media_id)}
                    data-testid={`media-delete-${m.media_id}`}
                    className="absolute top-1 right-1 bg-ivory/90 hover:bg-revoked hover:text-ivory text-revoked p-1 border border-gold/40 opacity-0 group-hover:opacity-100 transition"
                    title="Delete"
                  >
                    <TrashSimple size={12} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
