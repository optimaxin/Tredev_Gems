import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { absolutize, useSiteAssets } from "@/context/SiteAssetsContext";
import { toast } from "sonner";
import { PencilSimple, X, ImageSquare } from "@phosphor-icons/react";
import MediaPicker from "@/components/gemora/MediaPicker";

// Registry of editable slots across the site. Grouped for a friendly admin UI.
export const SITE_SLOTS = [
  { group: "Branding", items: [
    { key: "logo", label: "Logo (header)", hint: "Ideal ~ 320×80 PNG, transparent." },
    { key: "footer_logo", label: "Footer mark", hint: "Ideal ~ 240×80 PNG, transparent." },
  ]},
  { group: "Homepage · Hero", items: [
    { key: "home_hero_1", label: "Hero slide 1", hint: "Portrait, 1000×1250+" },
    { key: "home_hero_2", label: "Hero slide 2", hint: "Portrait, 1000×1250+" },
    { key: "home_hero_3", label: "Hero slide 3", hint: "Portrait, 1000×1250+" },
  ]},
  { group: "Homepage · Category tiles", items: [
    { key: "home_cat_gemstone", label: "Gemstones tile" },
    { key: "home_cat_rudraksha", label: "Rudraksha tile" },
    { key: "home_cat_bracelet", label: "Bracelets tile" },
    { key: "home_cat_yantra", label: "Yantras tile" },
    { key: "home_cat_idol", label: "Idols tile" },
    { key: "home_cat_prashad", label: "Temple Prashad tile" },
  ]},
  { group: "Homepage · Shop by purpose", items: [
    { key: "home_purpose_wealth", label: "Wealth" },
    { key: "home_purpose_protection", label: "Protection" },
    { key: "home_purpose_love", label: "Love" },
    { key: "home_purpose_career", label: "Career" },
    { key: "home_purpose_health", label: "Health" },
  ]},
  { group: "Homepage · Backgrounds & bands", items: [
    { key: "home_astro_band_bg", label: "Astrologer band background" },
    { key: "home_verify_band_bg", label: "Verify strip background" },
    { key: "home_craft_poster", label: "Craftsmanship video poster" },
  ]},
  { group: "Blog previews", items: [
    { key: "home_blog_1", label: "Blog card 1" },
    { key: "home_blog_2", label: "Blog card 2" },
    { key: "home_blog_3", label: "Blog card 3" },
  ]},
];

const FLAT_SLOTS = SITE_SLOTS.flatMap((g) => g.items);

export default function AdminSiteAssets() {
  const [byslot, setByslot] = useState({}); // slot -> {media_id, url}
  const [pickerFor, setPickerFor] = useState(null); // slot key or null
  const [loading, setLoading] = useState(true);
  const { refresh: refreshPublic } = useSiteAssets();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/site-assets");
      const map = {};
      (data || []).forEach((d) => { map[d.slot] = d; });
      setByslot(map);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load site assets"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setSlot = async (slot, media_id) => {
    try {
      await api.put(`/admin/site-assets/${slot}`, { media_id });
      toast.success(media_id ? "Image assigned" : "Slot cleared");
      await load();
      refreshPublic();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
  };

  const onPick = (m) => {
    if (!pickerFor) return;
    setSlot(pickerFor, m.media_id);
    setPickerFor(null);
  };

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Site content · दृश्य</div>
        <h1 className="font-display text-4xl text-ink mt-1">Site images</h1>
        <p className="text-sm text-ink-muted mt-1">Swap any image on the website. Changes go live instantly for all visitors.</p>
      </div>

      {loading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : (
        <div className="space-y-10">
          {SITE_SLOTS.map((group) => (
            <div key={group.group}>
              <div className="text-xs uppercase tracking-[0.3em] text-maroon-deep border-b border-gold/30 pb-2 mb-4">{group.group}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map((s) => {
                  const cur = byslot[s.key];
                  return (
                    <div key={s.key} data-testid={`slot-${s.key}`} className="gold-line bg-ivory p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <div>
                          <div className="font-serifd text-base text-ink">{s.label}</div>
                          <div className="text-[10px] text-ink-muted font-mono mt-0.5">{s.key}</div>
                        </div>
                        {cur?.url && (
                          <button onClick={() => setSlot(s.key, null)} data-testid={`slot-clear-${s.key}`} title="Clear" className="text-ink-muted hover:text-revoked">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <div className="mt-3 aspect-video bg-cream border border-gold/30 overflow-hidden relative">
                        {cur?.url ? (
                          <img src={absolutize(cur.url)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-ink-muted">
                            <ImageSquare size={28} weight="duotone" />
                            <div className="text-[10px] uppercase tracking-widest mt-1">Using default</div>
                          </div>
                        )}
                      </div>
                      {s.hint && <div className="text-[10px] text-ink-muted mt-2">{s.hint}</div>}
                      <button
                        onClick={() => setPickerFor(s.key)}
                        data-testid={`slot-change-${s.key}`}
                        className="mt-3 w-full border border-maroon text-maroon py-2 text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
                      >
                        <PencilSimple size={12} /> {cur?.url ? "Change image" : "Set image"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <MediaPicker open={!!pickerFor} onClose={() => setPickerFor(null)} onPick={onPick} />
    </div>
  );
}

// Export flat list for other files that need to know valid slots (e.g. events use image_url via picker too).
export const SLOT_KEYS = FLAT_SLOTS.map((s) => s.key);
