import React, { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { SiteAssetsProvider } from "@/context/SiteAssetsContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { AstroAuthProvider } from "@/context/AstroAuthContext";
import Header from "@/components/gemora/Header";
import Footer from "@/components/gemora/Footer";
import EventStrip from "@/components/gemora/EventStrip";
import AffiliateTracker from "@/components/gemora/AffiliateTracker";
import { pageview } from "@/lib/analytics";
import Home from "@/pages/Home";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";
import Verify from "@/pages/Verify";
import JournalPost from "@/pages/JournalPost";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Account from "@/pages/Account";
import OrderConfirmed from "@/pages/OrderConfirmed";
import OrderCancelled from "@/pages/OrderCancelled";
import Admin from "@/pages/Admin";
import CaratRatti from "@/pages/CaratRatti";
import LuckyRudraksha from "@/pages/LuckyRudraksha";
import ShopByPlanet from "@/pages/ShopByPlanet";
import ShopByPurpose from "@/pages/ShopByPurpose";
import Consultation from "@/pages/Consultation";
import Astrologer from "@/pages/Astrologer";
import AstrologerLogin from "@/pages/AstrologerLogin";
import AstrologerSetPassword from "@/pages/AstrologerSetPassword";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import TermsConditions from "@/pages/TermsConditions";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); pageview(); }, [pathname]);
  return null;
}

function AuthRouter() {
  const location = useLocation();
  // The #session_id= hash handler is gone: Google sign-in now happens in-page via a
  // Firebase popup (AuthContext.googleLogin), with no OAuth redirect to catch.

  // Astrologer routes render their own layout (no site header/footer)
  const path = location.pathname;
  if (path.startsWith("/astrologer/login")) return <AstrologerLogin />;
  if (path.startsWith("/astrologer/set-password")) return <AstrologerSetPassword />;
  if (path.startsWith("/astrologer")) {
    // Wrap in Routes so <Astrologer />'s nested relative routes resolve correctly.
    return (
      <Routes>
        <Route path="/astrologer/*" element={<Astrologer />} />
      </Routes>
    );
  }

  return (
    <>
      <EventStrip />
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop-by-planet" element={<ShopByPlanet />} />
        <Route path="/shop-by-purpose" element={<ShopByPurpose />} />
        <Route path="/product/:slug" element={<ProductDetail />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:qrToken" element={<Verify />} />
        <Route path="/journal/:slug" element={<JournalPost />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/account" element={<Account />} />
        <Route path="/order-confirmed/:orderId" element={<OrderConfirmed />} />
        <Route path="/order-cancelled/:orderId" element={<OrderCancelled />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="/tools/carat-ratti" element={<CaratRatti />} />
        <Route path="/tools/lucky-rudraksha" element={<LuckyRudraksha />} />
        <Route path="/consultation" element={<Consultation />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-and-conditions" element={<TermsConditions />} />
        <Route path="/dashboard" element={<Navigate to="/account" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </>
  );
}

function App() {
  // NOTE: previously this fired POST /dev/seed on every page load, which re-inserted
  // the demo catalogue (and re-created any demo product an admin had deleted) on each
  // visit. Seeding is a one-time/dev action, not something the live app should do —
  // removed. Seed manually against a fresh DB if ever needed.
  return (
    <div className="App">
      <BrowserRouter>
        <CurrencyProvider>
          <AuthProvider>
            <AstroAuthProvider>
              <SiteAssetsProvider>
                <CartProvider>
                  <ScrollToTop />
                  <AffiliateTracker />
                  <AuthRouter />
                  <Toaster position="top-center" richColors />
                </CartProvider>
              </SiteAssetsProvider>
            </AstroAuthProvider>
          </AuthProvider>
        </CurrencyProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
