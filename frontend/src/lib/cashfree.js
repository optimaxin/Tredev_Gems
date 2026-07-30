// Cashfree Checkout JS SDK loader, shared by Checkout.jsx, Consultation.jsx and
// Account.jsx's "Pay now" retry — same dynamic-script-tag pattern all three used
// individually for Razorpay's checkout.js, now centralized since it's the same
// gateway everywhere.
let sdkPromise = null;

function loadCashfree() {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      s.onload = () => resolve(window.Cashfree);
      s.onerror = () => { sdkPromise = null; reject(new Error("Could not load the payment gateway")); };
      document.body.appendChild(s);
    });
  }
  return sdkPromise;
}

// Opens the Cashfree checkout modal for an existing payment session. Resolves once
// the modal closes (payment attempted or abandoned) — the caller still has to ask
// the backend to confirm the payment actually succeeded (POST .../verify), same as
// Razorpay's handler callback never proved payment on its own either.
export async function openCashfreeCheckout(paymentSessionId) {
  const Cashfree = await loadCashfree();
  const cashfree = Cashfree({ mode: process.env.REACT_APP_CASHFREE_MODE || "sandbox" });
  return cashfree.checkout({ paymentSessionId, redirectTarget: "_modal" });
}
