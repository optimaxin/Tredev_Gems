import React from "react";
import LegalPage from "@/components/gemora/LegalPage";

const linkCls = "text-maroon underline decoration-gold-soft";

const SECTIONS = [
  {
    id: "who-we-are",
    heading: "Who we are",
    body: (
      <>
        <p>
          Tredev ("<strong>we</strong>", "<strong>us</strong>", "<strong>our</strong>") is a website and
          service operated by <strong>OptiMaxin Solutions Private Limited</strong> ("the Company"), a
          company incorporated under the Companies Act, 2013 (CIN: <strong>U62013UP2024PTC211889</strong>),
          with its registered/correspondence address at 221A, Nalanda Town, Shamshabad Road, Agra, Uttar
          Pradesh – 282001, India.
        </p>
        <p>
          This Privacy Policy applies to the Tredev website, our ordering and account systems, our free
          astrology tools (Lucky Rudraksha finder, Carat ↔ Ratti converter), and our consultation booking
          service.
        </p>
      </>
    ),
  },
  {
    id: "information-we-collect",
    heading: "Information we collect",
    body: (
      <>
        <p>We collect information you give us directly, information created when you use our tools, and limited technical information about how you browse.</p>
        <ul className="list-disc list-inside space-y-2 pl-1">
          <li><strong className="text-ink">Account details</strong> — name, email address, phone number, and password (stored as a salted hash, never in plain text).</li>
          <li><strong className="text-ink">Identity verification</strong> — a one-time password (OTP) sent to your phone via Firebase Authentication to confirm you own the number; if you sign in with Google, we receive your name, email, and profile photo from your Google account.</li>
          <li><strong className="text-ink">Order &amp; shipping details</strong> — delivery address, PIN code, and the items you buy.</li>
          <li><strong className="text-ink">Astrology tool inputs</strong> — if you use the Lucky Rudraksha finder or book a consultation, we ask for your date of birth, time of birth, and place of birth (as coordinates) so we can compute your Moon sign and Nakshatra. This is used only to generate your reading.</li>
          <li><strong className="text-ink">Communication preferences</strong> — whether you've opted in to WhatsApp updates about orders, offers, or temple pooja recordings.</li>
          <li><strong className="text-ink">Reviews and questions</strong> — anything you post publicly on a product page.</li>
          <li><strong className="text-ink">Usage data</strong> — pages visited, device/browser type, and approximate location (from IP), collected automatically through analytics tooling.</li>
        </ul>
        <p>We do <strong>not</strong> collect or store your card, UPI, or net-banking credentials — those are entered directly on our payment partner's secure page (see "Payment information" below).</p>
      </>
    ),
  },
  {
    id: "how-we-use-your-information",
    heading: "How we use your information",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>To create and secure your account, and to verify your identity via phone OTP or Google sign-in.</li>
        <li>To process, ship, and support your orders, including generating your item's signed authenticity certificate and QR verification record.</li>
        <li>To compute results for the Lucky Rudraksha finder and Carat ↔ Ratti converter, and to prepare for a consultation call you've booked.</li>
        <li>To send order updates, WhatsApp messages (only if you've opted in), and — where legally permitted — offers on new arrivals.</li>
        <li>To detect fraud, prevent abuse of our OTP and payment systems, and comply with legal obligations.</li>
        <li>To understand, in aggregate, how the site is used, so we can improve it.</li>
      </ul>
    ),
  },
  {
    id: "sharing-with-third-parties",
    heading: "Sharing with third parties",
    body: (
      <>
        <p>We do not sell your personal information. We share it only with the service providers who help us run Tredev, each engaged only for the purpose stated:</p>
        <ul className="list-disc list-inside space-y-2 pl-1">
          <li><strong className="text-ink">Firebase (Google)</strong> — phone OTP delivery and Google sign-in.</li>
          <li><strong className="text-ink">Razorpay</strong>, and where applicable other RBI-authorised payment aggregators — to process your payment. We never see or store your full card number.</li>
          <li><strong className="text-ink">Supabase</strong> — our database and file-storage infrastructure, which holds your account, order, and certificate records.</li>
          <li>Product analytics tooling (such as PostHog) — to understand aggregate site usage, not to build an advertising profile of you.</li>
          <li>Courier and logistics partners — to deliver your order, receiving only the shipping details needed to do so.</li>
          <li>Law enforcement or regulators, if we're legally required to disclose information.</li>
        </ul>
      </>
    ),
  },
  {
    id: "cookies-and-tracking",
    heading: "Cookies & tracking",
    body: (
      <p>
        We use your browser's local storage to keep you signed in, and cookies or similar technologies from
        our analytics provider to understand how the site is used. You can clear these at any time from your
        browser settings; doing so will sign you out and reset anonymous usage tracking, but won't affect
        your account or orders.
      </p>
    ),
  },
  {
    id: "payment-information",
    heading: "Payment information",
    body: (
      <p>
        All payments are processed by our payment gateway partner(s) (currently Razorpay) on their own
        PCI-DSS-compliant systems. Tredev never receives or stores your full card number, CVV, or
        net-banking password — we only receive confirmation that a payment succeeded or failed, plus a
        reference ID for support purposes.
      </p>
    ),
  },
  {
    id: "data-retention",
    heading: "Data retention",
    body: (
      <p>
        We keep your account and order data for as long as your account is active, and for a reasonable
        period after (typically up to 7 years for order and financial records) to meet our tax, accounting,
        and consumer-dispute obligations under Indian law. You can ask us to delete your account and
        personal data at any time, subject to what we're legally required to retain — see "Your rights and
        choices" below.
      </p>
    ),
  },
  {
    id: "data-security",
    heading: "Data security",
    body: (
      <p>
        We use industry-standard safeguards — encrypted connections (HTTPS), hashed passwords, and
        access-controlled infrastructure — to protect your information. No system is 100% secure; if we
        become aware of a breach affecting your personal data, we will notify you and the relevant
        authorities as required by law.
      </p>
    ),
  },
  {
    id: "your-rights-and-choices",
    heading: "Your rights and choices",
    body: (
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>Access or correct your account details from Account → Settings.</li>
        <li>Opt out of WhatsApp marketing (Account → Settings, or reply STOP on WhatsApp) — you'll still receive essential order updates.</li>
        <li>Request a copy of the personal data we hold about you, or ask us to delete it, by writing to our Grievance Officer below.</li>
        <li>Withdraw consent for optional data uses (like the astrology tools) simply by not using those features.</li>
      </ul>
    ),
  },
  {
    id: "childrens-privacy",
    heading: "Children's privacy",
    body: (
      <p>
        Tredev is intended for users who are 18 years of age or older, or who are using the site with the
        involvement of a parent or guardian for the purpose of placing an order or entering into a payment.
        We do not knowingly collect personal information from children. If you believe a child has provided
        us with personal data, please contact our Grievance Officer and we will remove it.
      </p>
    ),
  },
  {
    id: "changes-to-this-policy",
    heading: "Changes to this policy",
    body: (
      <p>
        We may update this Privacy Policy from time to time, for example as we add new features or as the
        law changes. We'll update the "Effective" date at the top of this page, and for material changes,
        we'll make reasonable efforts to let you know (such as an email or an on-site notice).
      </p>
    ),
  },
  {
    id: "grievance-officer",
    heading: "Grievance Officer",
    body: (
      <>
        <p>In accordance with the Information Technology Act, 2000 and the rules made thereunder, the Grievance Officer for Tredev is:</p>
        <p>
          <strong className="text-ink">Lubhansh Sharma</strong><br />
          OptiMaxin Solutions Private Limited<br />
          221A, Nalanda Town, Shamshabad Road, Agra, Uttar Pradesh – 282001, India<br />
          Phone: <a href="tel:+917668489528" className={linkCls}>+91 76684 89528</a><br />
          Email: <a href="mailto:lubhansh.sharma@optimaxin.com" className={linkCls}>lubhansh.sharma@optimaxin.com</a>
        </p>
        <p>We will acknowledge and address grievances as promptly as possible, and in line with statutory timelines where applicable.</p>
      </>
    ),
  },
  {
    id: "contact-us",
    heading: "Contact us",
    body: (
      <p>
        For general questions about this Privacy Policy or your data, write to us at{" "}
        <a href="mailto:hello@gemora.in" className={linkCls}>hello@gemora.in</a>, or reach our Grievance
        Officer directly using the details above.
      </p>
    ),
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy Policy"
      effectiveDate="5 August 2026"
      intro="This Privacy Policy explains what personal information Tredev collects, why, and how you can control it. By using this website you agree to the practices described here."
      sections={SECTIONS}
    />
  );
}
