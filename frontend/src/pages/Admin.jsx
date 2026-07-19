import React, { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { clearApiCache } from "@/lib/api";
import { toast } from "sonner";
import {
  ChartBar, Package, Stack, Certificate as CertIcon, Truck, SquaresFour, Sparkle, Calendar,
  ChatCircleDots, UsersFour, ShieldStar, ArrowLeft, WhatsappLogo, Image as ImageIcon, MegaphoneSimple, PaintBrush,
  ArrowsClockwise, Diamond, Browser,
} from "@phosphor-icons/react";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminDesigns from "@/pages/admin/AdminDesigns";
import AdminInventory from "@/pages/admin/AdminInventory";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminCerts from "@/pages/admin/AdminCerts";
import AdminCategories from "@/pages/admin/AdminCategories";
import AdminAstrologers from "@/pages/admin/AdminAstrologers";
import AdminConsultations from "@/pages/admin/AdminConsultations";
import AdminQueries from "@/pages/admin/AdminQueries";
import AdminTeam from "@/pages/admin/AdminTeam";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminBroadcast from "@/pages/admin/AdminBroadcast";
import AdminMedia from "@/pages/admin/AdminMedia";
import AdminSiteAssets from "@/pages/admin/AdminSiteAssets";
import AdminWebsite from "@/pages/admin/AdminWebsite";
import AdminEvents from "@/pages/admin/AdminEvents";

const NAV_ITEMS = [
  { to: "dashboard", label: "Dashboard", Icon: ChartBar, ownerOnly: true },
  { to: "products", label: "Products", Icon: Package, perm: "products" },
  { to: "designs", label: "Designs", Icon: Diamond, perm: "products" },
  { to: "inventory", label: "Inventory", Icon: Stack, perm: "inventory" },
  { to: "certificates", label: "Certificates", Icon: CertIcon, perm: "certificates" },
  { to: "orders", label: "Orders", Icon: Truck, perm: "orders" },
  { to: "categories", label: "Categories", Icon: SquaresFour, perm: "categories" },
  { to: "media", label: "Media", Icon: ImageIcon, adminAny: true },
  { to: "site-assets", label: "Site Images", Icon: PaintBrush, adminAny: true },
  { to: "website", label: "Website", Icon: Browser, anyPerm: ["content", "taxonomy"] },
  { to: "events", label: "Events", Icon: MegaphoneSimple, adminAny: true },
  { to: "astrologers", label: "Astrologers", Icon: Sparkle, perm: "astrologers" },
  { to: "consultations", label: "Consultations", Icon: Calendar, perm: "consultations" },
  { to: "queries", label: "Queries", Icon: ChatCircleDots, perm: "queries" },
  { to: "broadcast", label: "WhatsApp", Icon: WhatsappLogo, ownerOnly: true },
  { to: "team", label: "Team", Icon: UsersFour, ownerOnly: true },
  { to: "users", label: "Users", Icon: ShieldStar, ownerOnly: true },
];

function has(user, item) {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (item.ownerOnly) return false;
  if (item.adminAny) return user.role === "staff" || user.role === "owner";
  if (item.anyPerm) return item.anyPerm.some((p) => (user.permissions || []).includes(p));
  if (item.perm) return (user.permissions || []).includes(item.perm);
  return false;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // Bumping this remounts the active tab, so clearing the cache re-fetches fresh
  // data for whatever the admin is currently looking at.
  const [refreshKey, setRefreshKey] = useState(0);

  const clearCache = () => {
    clearApiCache();
    setRefreshKey((k) => k + 1);
    toast.success("Cache cleared — reloading fresh data");
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/login"); return; }
    if (!user.is_admin && user.role !== "owner" && user.role !== "staff") {
      toast.error("Admin only"); nav("/account");
    }
  }, [user, loading, nav]);

  if (loading || !user) return <div className="p-16 text-ink-muted">Loading…</div>;
  if (!user.is_admin && user.role !== "owner" && user.role !== "staff") return null;

  const visibleItems = NAV_ITEMS.filter((it) => has(user, it));
  // Default landing per role
  const defaultLanding = user.role === "owner" ? "dashboard" : (visibleItems[0]?.to || "products");

  return (
    <div className="mx-auto max-w-[1400px] px-4 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <aside className="lg:sticky lg:top-24 h-fit">
        <div className="gold-line bg-ivory p-4">
          <Link to="/account" className="text-xs text-ink-muted hover:text-maroon flex items-center gap-1 mb-3">
            <ArrowLeft size={12} /> Back to account
          </Link>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Admin</div>
          <div className="font-display text-2xl text-maroon-deep mt-1">{user.role === "owner" ? "Owner" : "Staff"}</div>
          <div className="text-xs text-ink-muted mt-1">{user.name}</div>
          <div className="mt-4 space-y-1">
            {visibleItems.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={`/admin/${to}`}
                end={false}
                data-testid={`admin-nav-${to}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 text-sm ${isActive ? "bg-maroon text-ivory" : "text-ink-soft hover:bg-cream hover:text-maroon"}`
                }
              >
                <Icon size={16} weight="duotone" /> {label}
              </NavLink>
            ))}
          </div>
          <button
            onClick={clearCache}
            data-testid="admin-clear-cache"
            className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs uppercase tracking-widest border border-gold/40 text-ink-soft hover:bg-cream hover:text-maroon transition-colors"
          >
            <ArrowsClockwise size={14} weight="bold" /> Clear cache
          </button>
        </div>
      </aside>

      <main className="min-w-0" key={refreshKey}>
        <Routes>
          <Route index element={<Navigate to={defaultLanding} replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="designs" element={<AdminDesigns />} />
          <Route path="inventory" element={<AdminInventory />} />
          <Route path="certificates" element={<AdminCerts />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="media" element={<AdminMedia />} />
          <Route path="site-assets" element={<AdminSiteAssets />} />
          <Route path="website" element={<AdminWebsite />} />
          <Route path="events" element={<AdminEvents />} />
          <Route path="astrologers" element={<AdminAstrologers />} />
          <Route path="consultations" element={<AdminConsultations />} />
          <Route path="queries" element={<AdminQueries />} />
          <Route path="broadcast" element={<AdminBroadcast />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="*" element={<Navigate to={defaultLanding} replace />} />
        </Routes>
      </main>
    </div>
  );
}
