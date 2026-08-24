// Razorpay checkout.js loader — handles international (non-INR) checkout only;
// Cashfree (see cashfree.js) still handles INR. Same dynamic-script-tag pattern.
let sdkPromise = null;

// Exported so the caller can warm this up ahead of the click (see CurrencyContext) —
// shaves the script-fetch off the click-to-modal gap instead of paying for it after.
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(window.Razorpay);
      s.onerror = () => { sdkPromise = null; reject(new Error("Could not load the payment gateway")); };
      document.body.appendChild(s);
    });
  }
  return sdkPromise;
}

// Opens the Razorpay checkout modal for a Razorpay order. Unlike Cashfree, Razorpay's
// handler callback hands back a signed {razorpay_payment_id, razorpay_order_id,
// razorpay_signature} triple on success — the caller still has to post it to the
// backend's /verify (which checks the signature) before treating payment as confirmed.
export function openRazorpayCheckout({ keyId, amount, currency, orderId, name, email, contact }) {
  return loadRazorpay().then((Razorpay) => new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: keyId,
      amount,
      currency,
      order_id: orderId,
      name: "Tredeva Gems",
      prefill: { name, email, contact },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.on("payment.failed", (response) => reject(new Error(response.error?.description || "Payment failed")));
    rzp.open();
  }));
}
