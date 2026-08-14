import React from "react";
import { Link } from "react-router-dom";
import LegalPage from "@/components/gemora/LegalPage";

const linkCls = "text-maroon underline decoration-gold-soft";

const SECTIONS = [
  {
    id: "acceptance-of-terms",
    heading: "Acceptance of terms",
    body: (
      <p>
        These Terms &amp; Conditions ("Terms") are a binding agreement between you and{" "}
        <strong>OptiMaxin Solutions Private Limited</strong> ("Company", "we", "us"), which operates the
        Tredev website, app, and related services (together, the "Services"). By browsing the site, creating
        an account, booking a consultation, or placing an order, you agree to these Terms and to our{" "}
        <Link to="/privacy-policy" className={linkCls}>Privacy Policy</Link>. If you do not agree, please do
        not use the Services.
      </p>
    ),
  },
  {
    id: "about-us",
    heading: "About us",
    body: (
      <p>
        <strong>OptiMaxin Solutions Private Limited</strong> is a company incorporated in India under the
        Companies Act, 2013 (CIN: U62013UP2024PTC211889), with its registered/correspondence address at
        221A, Nalanda Town, Shamshabad Road, Agra, Uttar Pradesh – 282001, India.
      </p>
    ),
  },
  {
    id: "eligibility-and-accounts",
    heading: "Eligibility & accounts",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>You must be at least 18 years old and capable of entering into a binding contract under the Indian Contract Act, 1872, to create an account or place an order.</li>
        <li>You're responsible for keeping your account credentials (password, and access to the phone number or Google account used to sign in) confidential, and for all activity under your account.</li>
        <li>You agree to give accurate information at signup and when placing an order — particularly your shipping address and, where relevant for our astrology tools, your date, time, and place of birth.</li>
      </ul>
    ),
  },
  {
    id: "products-and-authenticity",
    heading: "Products & authenticity",
    body: (
      <p>
        Every gemstone, rudraksha, bracelet, yantra, and idol we sell as a "serialised, signed" product is
        issued a unique, cryptographically signed authenticity record, verifiable via QR code at{" "}
        <Link to="/verify" className={linkCls}>/verify</Link>. Product images and descriptions are as
        accurate as we can make them, but natural stones vary — colour, inclusions, and exact weight may
        differ slightly from photographs.
      </p>
    ),
  },
  {
    id: "astrology-tools-and-consultations-disclaimer",
    heading: "Astrology tools & consultations disclaimer",
    body: (
      <p>
        Our free tools — the Lucky Rudraksha finder and Carat ↔ Ratti converter — and our astrologer
        consultation calls are provided for <strong>spiritual and informational purposes only</strong>. They
        are not a substitute for professional medical, legal, financial, or psychological advice, and we
        make no guarantee of any specific outcome from wearing a gemstone or rudraksha, or from following
        guidance given on a call.
      </p>
    ),
  },
  {
    id: "pricing-and-payments",
    heading: "Pricing & payments",
    body: (
      <p>
        Prices are shown in Indian Rupees (₹) or US Dollars ($) depending on your selected currency, and are
        inclusive of applicable taxes unless stated otherwise. Payments are processed securely by our
        payment gateway partner(s); we reserve the right to cancel and refund an order if payment cannot be
        verified.
      </p>
    ),
  },
  {
    id: "shipping-and-delivery",
    heading: "Shipping & delivery",
    body: (
      <p>
        We ship across India, and internationally where offered at checkout. Delivery timelines shown at
        checkout are estimates, not guarantees — delays can occur due to courier, weather, or customs issues
        beyond our control. Risk in the goods passes to you on delivery.
      </p>
    ),
  },
  {
    id: "cancellations-returns-and-refunds",
    heading: "Cancellations, returns & refunds",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>You may cancel an order before it is dispatched, from Account → Orders or by contacting support; once dispatched, cancellation is no longer possible and the item must instead be returned after delivery.</li>
        <li>
          If an item arrives damaged, defective, or different from what you ordered, contact us via Account
          → Support as soon as possible, ideally with photos or an unboxing video — this helps us resolve it
          quickly given these are verified, serialised items. See our{" "}
          <Link to="/refunds-and-cancellations" className={linkCls}>Refunds &amp; Cancellations</Link> policy
          for the exact return window and process.
        </li>
        <li>Approved refunds are returned to your original payment method and typically reflect within 5–7 business days, depending on your bank.</li>
        <li>Items that have been temple-energised (puja performed) or customised at your request may not be eligible for return once the service has been carried out, except where the item itself is defective.</li>
      </ul>
    ),
  },
  {
    id: "intellectual-property",
    heading: "Intellectual property",
    body: (
      <p>
        All text, images, logos, and the signed-verification system on this site belong to the Company or
        its licensors. You may not copy, resell, or use our content or branding without our written
        permission.
      </p>
    ),
  },
  {
    id: "user-conduct",
    heading: "User conduct",
    body: (
      <p>
        You agree not to: misuse the OTP/verification system, attempt to access another user's account, post
        false reviews, scrape the site, or use the Services for any unlawful purpose. We may suspend or
        terminate accounts that violate this.
      </p>
    ),
  },
  {
    id: "limitation-of-liability",
    heading: "Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, the Company's liability for any claim arising from your use
        of the Services is limited to the amount you paid for the relevant order. We are not liable for
        indirect or consequential losses, or for outcomes attributed to astrological guidance given via our
        tools or consultations.
      </p>
    ),
  },
  {
    id: "indemnification",
    heading: "Indemnification",
    body: (
      <p>
        You agree to indemnify and hold the Company harmless from any claim arising from your misuse of the
        Services or breach of these Terms.
      </p>
    ),
  },
  {
    id: "governing-law-and-jurisdiction",
    heading: "Governing law & jurisdiction",
    body: (
      <p>
        These Terms are governed by the laws of India. Subject to the grievance redressal process below,
        courts at Agra, Uttar Pradesh shall have exclusive jurisdiction over any dispute arising from these
        Terms or your use of the Services.
      </p>
    ),
  },
  {
    id: "grievance-redressal",
    heading: "Grievance redressal",
    body: (
      <>
        <p>
          In accordance with the Information Technology Act, 2000, the Consumer Protection (E-Commerce)
          Rules, 2020, and the rules made thereunder, our Grievance Officer is:
        </p>
        <p>
          <strong className="text-ink">Lubhansh Sharma</strong><br />
          OptiMaxin Solutions Private Limited<br />
          221A, Nalanda Town, Shamshabad Road, Agra, Uttar Pradesh – 282001, India<br />
          Phone: <a href="tel:+917668489528" className={linkCls}>+91 76684 89528</a><br />
          Email: <a href="mailto:lubhansh.sharma@optimaxin.com" className={linkCls}>lubhansh.sharma@optimaxin.com</a>
        </p>
      </>
    ),
  },
  {
    id: "changes-to-these-terms",
    heading: "Changes to these terms",
    body: (
      <p>
        We may revise these Terms from time to time; the "Effective" date above will reflect the latest
        version. Continuing to use the Services after a change means you accept the revised Terms.
      </p>
    ),
  },
  {
    id: "contact-us",
    heading: "Contact us",
    body: (
      <p>
        Questions about these Terms? Write to us at{" "}
        <a href="mailto:hello@gemora.in" className={linkCls}>hello@gemora.in</a>, or reach our Grievance
        Officer using the details above.
      </p>
    ),
  },
];

export default function TermsConditions() {
  return (
    <LegalPage
      title="Terms & Conditions"
      effectiveDate="5 August 2026"
      intro="These Terms & Conditions govern your access to and use of the Tredev website and services, operated by OptiMaxin Solutions Private Limited. By using the Services, you agree to be bound by them."
      sections={SECTIONS}
    />
  );
}
