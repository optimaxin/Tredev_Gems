import React from "react";
import { Link } from "react-router-dom";
import LegalPage from "@/components/gemora/LegalPage";

const linkCls = "text-maroon underline decoration-gold-soft";

const SECTIONS = [
  {
    id: "overview",
    heading: "Overview",
    body: (
      <p>
        This policy explains when you can cancel an order, when you can return a delivered item, and how
        refunds are processed. It applies to all orders placed on the Tredev website. For general terms,
        see our <Link to="/terms-and-conditions" className={linkCls}>Terms &amp; Conditions</Link>.
      </p>
    ),
  },
  {
    id: "cancelling-an-order",
    heading: "Cancelling an order",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>You can cancel an order free of charge any time <strong>before it is dispatched</strong>, from Account → Orders, or by <Link to="/contact-us" className={linkCls}>contacting us</Link>.</li>
        <li>Once an order is dispatched, it can no longer be cancelled — you'll instead need to request a return after the item is delivered.</li>
        <li>If your payment was captured but the order could not be placed (a rare gateway/technical error), it is automatically refunded in full — see "Refund timeline" below.</li>
      </ul>
    ),
  },
  {
    id: "return-eligibility",
    heading: "Return eligibility",
    body: (
      <>
        <p>You may request a return within <strong>7 days of delivery</strong> if:</p>
        <ul className="list-disc list-inside space-y-2 pl-1">
          <li>the item arrived damaged or defective,</li>
          <li>you received the wrong product, size, or variant, or</li>
          <li>the item materially differs from what was described on the product page.</li>
        </ul>
        <p className="mt-3">
          Since every gemstone, rudraksha, and idol we sell is a serialised, individually certified item, we
          ask you to keep the original packaging, the authenticity certificate, and — where possible — an
          unboxing video or photos taken within 48 hours of delivery. This isn't a strict condition for
          raising a claim, but it helps us resolve genuine issues quickly without back-and-forth.
        </p>
      </>
    ),
  },
  {
    id: "non-returnable-items",
    heading: "Non-returnable items",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>Items that have been <strong>temple-energised</strong> (a puja performed at your request) or <strong>customised</strong> to your specification — once that service is carried out, the piece is made for you specifically. This does not apply if the item itself is defective.</li>
        <li>Consumables such as Temple Prashad, once opened.</li>
        <li>A simple change of mind after delivery is not, on its own, grounds for a return — our product pages describe each piece as accurately as we can, but natural stones vary slightly in colour and inclusions from photographs.</li>
      </ul>
    ),
  },
  {
    id: "how-to-request-a-return-or-refund",
    heading: "How to request a return or refund",
    body: (
      <ol className="list-decimal list-inside space-y-2 pl-1">
        <li>Go to Account → Orders and raise a query against the order (category "Return" or "Refund"), or use our <Link to="/contact-us" className={linkCls}>Contact Us</Link> page.</li>
        <li>Include your order number, a description of the issue, and photos or an unboxing video if the item arrived damaged, defective, or incorrect.</li>
        <li>Our team reviews the request, usually within 24–48 hours, and confirms the next step — a pickup, a replacement, or a refund.</li>
      </ol>
    ),
  },
  {
    id: "refund-timeline",
    heading: "Refund timeline",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>Once a return is approved (or a cancellation processed), we initiate the refund within <strong>2 business days</strong>.</li>
        <li>Refunds are credited to your original payment method only — we do not offer cash refunds. Prepaid orders are refunded via our payment gateway (Razorpay/Cashfree) to the original card, UPI ID, or bank account used to pay.</li>
        <li>From initiation, funds typically reflect in <strong>5–7 business days</strong>, though this can take longer depending on your bank or card issuer — that part is outside our control once the gateway confirms the refund.</li>
        <li>You'll receive an email/WhatsApp update at each stage: request received, approved, refund initiated.</li>
      </ul>
    ),
  },
  {
    id: "pickup-and-shipping-costs",
    heading: "Pickup & shipping costs",
    body: (
      <p>
        For an approved return due to a damaged, defective, or incorrect item, we arrange and pay for reverse
        pickup. If you're returning an item for any other approved reason, return shipping may be deducted
        from your refund — we'll always confirm this with you before the pickup is scheduled.
      </p>
    ),
  },
  {
    id: "order-cancelled-or-refunded-by-us",
    heading: "If we cancel or refund your order",
    body: (
      <p>
        Occasionally we may need to cancel an order ourselves — for example, if a serialised unit fails a
        final quality check, or stock information was incorrect. In that case we notify you immediately and
        refund the full amount, following the same timeline in "Refund timeline" above, with no action
        required from you.
      </p>
    ),
  },
  {
    id: "non-delivery-or-lost-in-transit",
    heading: "Non-delivery or lost in transit",
    body: (
      <p>
        If a shipment is confirmed lost or undelivered by our courier partner, we will send a replacement at
        no extra cost or issue a full refund, whichever you prefer.
      </p>
    ),
  },
  {
    id: "contact-us",
    heading: "Contact us",
    body: (
      <p>
        Questions about a cancellation, return, or refund? Visit our <Link to="/contact-us" className={linkCls}>Contact Us</Link> page,
        or write to us at <a href="mailto:hello@gemora.in" className={linkCls}>hello@gemora.in</a>.
      </p>
    ),
  },
];

export default function RefundsAndCancellations() {
  return (
    <LegalPage
      title="Refunds & Cancellations"
      effectiveDate="15 August 2026"
      intro="Our policy for cancelling an order, returning a delivered item, and how refunds are processed."
      sections={SECTIONS}
    />
  );
}
