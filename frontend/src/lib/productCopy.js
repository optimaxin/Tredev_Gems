/**
 * Category-aware editorial copy for the product page.
 *
 * The product API only carries facts (attrs, care_instructions, variant_options) —
 * it has no marketing prose. These maps supply the story per category, and every
 * section falls back to DEFAULT so a brand-new category still renders a complete
 * page instead of blank space. Icons are referenced by key and resolved in the
 * component, keeping this file data-only.
 */

export const CATEGORY_LABEL = {
  gemstone: "Gemstone",
  rudraksha: "Rudraksha",
  bracelet: "Bracelet",
  gemstone_jewellery: "Gemstone Jewellery",
  mala: "Mala",
  yantra: "Yantra",
  idol: "Idol",
  prashad: "Temple Prashad",
  pooja_kit: "Pooja Kit",
  book: "Spiritual Book",
  digital: "Digital",
};

export const CATEGORY_DEVA = {
  gemstone: "रत्न",
  rudraksha: "रुद्राक्ष",
  bracelet: "कड़ा",
  gemstone_jewellery: "आभूषण",
  mala: "माला",
  yantra: "यंत्र",
  idol: "मूर्ति",
  prashad: "प्रसाद",
  pooja_kit: "पूजा सामग्री",
  book: "ग्रंथ",
  digital: "डिजिटल",
};

const DEFAULT = {
  ritualTitle: "How to receive it",
  ritualDeva: "विधि",
  ritual: [
    { icon: "drop", title: "Purify first", body: "Rinse with clean water or Ganga jal before first use, and let it dry naturally." },
    { icon: "sun", title: "Begin at sunrise", body: "Start on a Monday or an auspicious morning during shukla paksha." },
    { icon: "lotus", title: "Set an intention", body: "Hold it a moment, name your sankalpa, and let the object carry it." },
    { icon: "leaf", title: "Keep it clean", body: "Handle with clean hands and a settled mind. Reverence is the practice." },
  ],
  benefitsTitle: "Why this piece",
  benefits: [
    { icon: "shield", title: "Provably authentic", body: "Serialised, certified and Ed25519-signed — you never have to take our word for it." },
    { icon: "lotus", title: "Temple energised", body: "A recorded pooja at a partner temple before it is ever packed for you." },
    { icon: "hand", title: "Ethically sourced", body: "First-party stock with a traced lineage — we own every unit we sell." },
    { icon: "qr", title: "Verifiable forever", body: "Scan the per-unit QR any time, from anywhere, to prove it is the same piece." },
  ],
  care: [
    { icon: "drop", title: "Keep it dry", body: "Remove before bathing or swimming; moisture dulls the finish over time." },
    { icon: "leaf", title: "Clean gently", body: "Wipe with a soft, dry cloth. Never use chemical cleaners or ultrasonic baths." },
    { icon: "package", title: "Store safely", body: "Keep it in the pouch it arrived in, away from direct sunlight and hard objects." },
    { icon: "hand", title: "Handle with care", body: "Avoid knocks and rough handling — natural material chips more easily than it looks." },
  ],
  faq: [],
};

export const CATEGORY_COPY = {
  gemstone: {
    ritualTitle: "How to wear your stone",
    ritual: [
      { icon: "drop", title: "Purify overnight", body: "Soak in raw milk, then Ganga jal, and leave it overnight before the first wear." },
      { icon: "sun", title: "Wear on its day", body: "First wear on the weekday ruled by its graha, at sunrise during shukla paksha." },
      { icon: "hand", title: "Let it touch skin", body: "The setting must leave the stone's base open so it rests against your finger." },
      { icon: "lotus", title: "Chant the beej mantra", body: "Recite the graha's beej mantra 108 times as you put it on for the first time." },
    ],
    benefitsTitle: "What this stone carries",
    benefits: [
      { icon: "compass", title: "Planetary alignment", body: "Worn to strengthen the graha that rules it, exactly as prescribed in Vedic jyotish." },
      { icon: "sparkle", title: "Natural & untreated", body: "No heat, no glass filling, no diffusion. The power of a stone is in its purity." },
      { icon: "ruler", title: "Verified weight", body: "Carat and ratti confirmed on the lab report — you know precisely what you wear." },
      { icon: "lotus", title: "Temple energised", body: "A recorded pooja at a partner temple binds the stone to your sankalpa." },
    ],
    care: [
      { icon: "drop", title: "Remove before water", body: "Take it off before bathing, swimming or applying perfume and chemicals." },
      { icon: "leaf", title: "Clean with milk", body: "Once a month, rinse in raw milk and clean water; dry with a soft cloth." },
      { icon: "package", title: "Store apart", body: "Keep it in its own pouch — harder stones will scratch softer ones." },
      { icon: "sun", title: "Re-energise", body: "Place in morning sunlight briefly on its graha's day to refresh the stone." },
    ],
    faq: [
      { q: "Is this stone natural and untreated?", a: "Yes. Every gemstone we sell is natural and untreated unless the listing explicitly says otherwise. The lab report attached to your certificate states the treatment status on record — if it were heated or filled, it would say so." },
      { q: "How do I know the carat weight is real?", a: "The weight is measured at intake and printed on the lab report from a GJEPC-affiliated laboratory. That report number is embedded in your Ed25519-signed certificate, so the weight cannot be quietly changed later." },
      { q: "Which finger and metal should I use?", a: "It depends on the ruling graha — Pukhraj in gold on the index finger, Neelam in silver or panchdhatu on the middle finger, and so on. If you are unsure, book a consultation and an astrologer will confirm before you buy." },
    ],
  },

  rudraksha: {
    ritualTitle: "How to wear your rudraksha",
    ritual: [
      { icon: "drop", title: "Purify before wearing", body: "Dip in raw milk, rinse with Ganga jal, and let it air-dry — never force-dry it." },
      { icon: "moon", title: "Wear on a Monday", body: "Monday morning, facing east, is traditional for the first wear of a rudraksha." },
      { icon: "leaf", title: "Avoid impurities", body: "Remove it during non-vegetarian meals, alcohol, and while visiting cremation grounds." },
      { icon: "sparkle", title: "Use the proper string", body: "String it in silk, or cap it in silver, copper or gold. Never in leather." },
    ],
    benefitsTitle: "What this bead carries",
    benefits: [
      { icon: "compass", title: "Mukhi lineage", body: "Each mukhi answers to its own deity and graha — the face count is the whole point." },
      { icon: "shield", title: "X-ray verified", body: "We X-ray every bead to confirm its internal chambers match its declared mukhi." },
      { icon: "sparkle", title: "Nepal origin", body: "Authentic Nepal-origin beads — no Indonesian lookalikes passed off as the real thing." },
      { icon: "lotus", title: "Temple energised", body: "Energised with a recorded pooja by a priest before it is strung and shipped." },
    ],
    care: [
      { icon: "drop", title: "Keep it oiled", body: "Apply a drop of mustard or olive oil every few months to stop the bead drying out." },
      { icon: "leaf", title: "Clean regularly", body: "Wash in lukewarm water with a soft brush; never use soap or detergent." },
      { icon: "package", title: "Store safely", body: "Keep in a clean cloth pouch at your altar when not worn — never on the floor." },
      { icon: "sun", title: "Avoid harsh sun", body: "Prolonged direct heat cracks the surface. Dry it in shade, not in the sun." },
    ],
    faq: [
      { q: "How do I know the mukhi count is genuine?", a: "We X-ray every bead at intake. The X-ray confirms the number of internal chambers matches the mukhi lines on the surface — the single reliable test. The result is attached to your certificate." },
      { q: "Is this Nepal or Indonesian rudraksha?", a: "The origin is stated on the listing and locked into your signed certificate. Nepali beads are larger with deeper mukhi lines; we never sell Indonesian beads as Nepali." },
      { q: "Can I wear rudraksha every day?", a: "Yes. Remove it while sleeping if it is a mala, during non-vegetarian meals or alcohol, and keep it off during cremation rites — otherwise daily wear is traditional and encouraged." },
    ],
  },

  bracelet: {
    ritualTitle: "How to wear your bracelet",
    ritual: [
      { icon: "drop", title: "Cleanse it first", body: "Rinse with Ganga jal or clean water and let it dry before the first wear." },
      { icon: "hand", title: "Choose the hand", body: "Wear on the left to receive energy, on the right to project it outward." },
      { icon: "sun", title: "Start the right day", body: "Begin on the weekday ruled by the stone's graha, at sunrise." },
      { icon: "lotus", title: "Set your intention", body: "Hold it at the heart, name your sankalpa, then slide it on." },
    ],
    benefitsTitle: "Why this bracelet",
    benefits: [
      { icon: "sparkle", title: "Natural beads", body: "Genuine stone throughout — never dyed glass or reconstituted powder." },
      { icon: "compass", title: "Graha-matched", body: "Strung to serve the planet it belongs to, not just to look good." },
      { icon: "shield", title: "Certified & signed", body: "Serialised and Ed25519-signed, verifiable by anyone with the QR." },
      { icon: "lotus", title: "Temple energised", body: "Energised at a partner temple with a recorded pooja before dispatch." },
    ],
    faq: [
      { q: "Which hand should I wear it on?", a: "As a rule, the left hand receives and the right hand projects. Most wealth and healing intentions are worn on the left; protective and discipline-oriented ones on the right." },
      { q: "Will the beads fade or crack?", a: "Natural stone will dull if it meets perfume, chlorine or soap daily. Remove it before bathing and swimming and it will hold its polish for years." },
    ],
  },

  gemstone_jewellery: {
    ritualTitle: "How to wear your piece",
    ritual: [
      { icon: "drop", title: "Purify overnight", body: "Soak in raw milk, then Ganga jal, before the first wear." },
      { icon: "sun", title: "Wear on its day", body: "First wear at sunrise on the weekday ruled by the stone's graha." },
      { icon: "hand", title: "Skin contact matters", body: "We leave the stone's base open in the setting so it can touch your skin." },
      { icon: "lotus", title: "Chant as you wear", body: "Recite the graha's beej mantra 108 times the first time you put it on." },
    ],
    benefitsTitle: "Why this piece",
    benefits: [
      { icon: "sparkle", title: "Made around the stone", body: "The setting is built to the stone, never the stone cut down to the setting." },
      { icon: "ruler", title: "Open-base setting", body: "Jyotish-correct — the stone's base stays open to rest against your skin." },
      { icon: "shield", title: "Hallmarked metal", body: "The metal is assayed and the stone lab-certified, both bound into one certificate." },
      { icon: "lotus", title: "Temple energised", body: "Energised with a recorded pooja after making, before it ships." },
    ],
    faq: [
      { q: "Is the metal hallmarked?", a: "Yes. The metal purity is assayed and stated on your certificate alongside the stone's lab report — one signed document covers both." },
      { q: "Can I get it resized?", a: "Yes. If the ring size needs changing, contact us within 7 days of delivery and we will resize it once at no making charge." },
    ],
  },

  mala: {
    ritualTitle: "How to use your mala",
    ritualDeva: "जप विधि",
    ritual: [
      { icon: "drop", title: "Purify before japa", body: "Rinse with Ganga jal and let it dry; keep it only for your own practice." },
      { icon: "hand", title: "Hold it correctly", body: "Rest it on the middle finger and move beads with the thumb — never the index." },
      { icon: "lotus", title: "Never cross the sumeru", body: "On reaching the guru bead, turn the mala around rather than crossing over it." },
      { icon: "package", title: "Rest it with respect", body: "Store it in its pouch at your altar. A mala never touches the floor." },
    ],
    benefitsTitle: "Why this mala",
    benefits: [
      { icon: "sparkle", title: "108 counted beads", body: "A true 108 plus sumeru — counted and knotted by hand, not machine-strung." },
      { icon: "compass", title: "Strung with intent", body: "Knotted between beads so each one stops cleanly under the thumb." },
      { icon: "shield", title: "Certified beads", body: "Every bead verified at intake, then serialised and signed as one unit." },
      { icon: "lotus", title: "Temple energised", body: "Energised with a recorded pooja before it is placed in your hands." },
    ],
    faq: [
      { q: "Why must I not cross the sumeru bead?", a: "The sumeru (guru bead) marks the completion of a round. Crossing it is treated as stepping over the guru; instead you turn the mala and count back the other way." },
      { q: "Can someone else use my mala?", a: "Traditionally no. A japa mala absorbs your practice and is kept personal. Keep it in its pouch and use it only for your own sadhana." },
    ],
  },

  yantra: {
    ritualTitle: "How to install your yantra",
    ritualDeva: "स्थापना",
    ritual: [
      { icon: "drop", title: "Cleanse the plate", body: "Wash with Ganga jal and raw milk, then dry it with a clean cloth." },
      { icon: "compass", title: "Face it correctly", body: "Install facing east or north, at eye level or above — never below the waist." },
      { icon: "lotus", title: "Invite the deity", body: "Offer kumkum, akshat and a lamp, and chant the yantra's mantra to install it." },
      { icon: "sun", title: "Keep the lamp daily", body: "A daily diya and a moment of attention keep the yantra alive in the home." },
    ],
    benefitsTitle: "Why this yantra",
    benefits: [
      { icon: "ruler", title: "Geometrically exact", body: "Etched to the classical proportions — an inexact yantra is simply a drawing." },
      { icon: "sparkle", title: "Correct metal", body: "Struck in the metal the tradition prescribes for this deity, not whatever is cheap." },
      { icon: "shield", title: "Certified & signed", body: "Serialised and Ed25519-signed so its provenance travels with it." },
      { icon: "lotus", title: "Pran-pratishtha", body: "Installed with a recorded pooja by a priest before it is dispatched." },
    ],
    faq: [
      { q: "Where should I place the yantra?", a: "In your pooja room or the north-east corner of the home, facing east or north, at or above eye level. It should never sit on the floor or in a bedroom facing the bed." },
      { q: "Does it need daily worship?", a: "A lamp and a moment of attention each day is the tradition. At minimum, keep it clean, keep it raised, and light a diya on the deity's day." },
    ],
  },

  idol: {
    ritualTitle: "How to install your murti",
    ritualDeva: "प्राण-प्रतिष्ठा",
    ritual: [
      { icon: "drop", title: "Abhishek first", body: "Bathe the murti with water, milk and Ganga jal, then dry it gently." },
      { icon: "compass", title: "Place it facing east", body: "Seat it facing east or west in the pooja room — never facing a bathroom or bed." },
      { icon: "lotus", title: "Invite the deity", body: "Offer flowers, kumkum and a lamp, and chant the deity's mantra to install." },
      { icon: "sun", title: "Daily aarti", body: "A lamp each morning keeps the murti in worship rather than on display." },
    ],
    benefitsTitle: "Why this murti",
    benefits: [
      { icon: "ruler", title: "Shilpa-shastra proportions", body: "Carved to the classical measures — proportion is what makes a murti worshipful." },
      { icon: "hand", title: "Hand-finished", body: "Finished by artisans whose families have done this work for generations." },
      { icon: "shield", title: "Certified & signed", body: "Serialised and Ed25519-signed, with its material and origin on record." },
      { icon: "lotus", title: "Pran-pratishtha", body: "Consecrated with a recorded pooja before it leaves the vault." },
    ],
    faq: [
      { q: "Which direction should the murti face?", a: "East or west is ideal, seated in the pooja room or the north-east of the home. Avoid facing a bed, a bathroom, or placing it below waist height." },
      { q: "Has it already been consecrated?", a: "Yes — a priest performs pran-pratishtha with a recorded pooja before dispatch. You can watch the recording from your certificate's QR page." },
    ],
  },

  prashad: {
    ritualTitle: "How to receive prashad",
    ritualDeva: "प्रसाद",
    ritual: [
      { icon: "hand", title: "Receive with both hands", body: "Prashad is taken in the right hand supported by the left, never one-handed." },
      { icon: "lotus", title: "Offer at your altar", body: "Place it before your deity for a moment before you eat it." },
      { icon: "sun", title: "Consume the same day", body: "Prashad is meant to be eaten fresh, ideally on the day it reaches you." },
      { icon: "leaf", title: "Share it", body: "Prashad grows by distribution — share it with family and neighbours." },
    ],
    benefitsTitle: "Why this prashad",
    benefits: [
      { icon: "compass", title: "Temple-sourced", body: "Collected from the temple itself — not a sweet shop's approximation." },
      { icon: "shield", title: "Sealed at source", body: "Sealed at the temple and serialised, so the chain to your door is unbroken." },
      { icon: "sparkle", title: "Fresh dispatch", body: "Dispatched the same day it is collected, with cold-chain where it is needed." },
      { icon: "qr", title: "Traceable", body: "The QR shows the temple, the date and the priest who handed it over." },
    ],
    faq: [
      { q: "How fresh is the prashad?", a: "It is collected at the temple and dispatched the same day, with a stated shelf life on the pack. The collection date is recorded on your certificate's QR page." },
      { q: "Is prashad returnable?", a: "For hygiene reasons consumables cannot be returned once delivered. If it arrives damaged or past its shelf life, we replace it in full." },
    ],
  },

  pooja_kit: {
    ritualTitle: "How to use your kit",
    ritual: [
      { icon: "package", title: "Lay it out first", body: "Set every item out before you begin so the pooja is not interrupted." },
      { icon: "compass", title: "Face east", body: "Seat yourself facing east or north with the lamp to your right." },
      { icon: "lotus", title: "Follow the order", body: "Work through the enclosed vidhi card step by step — the sequence matters." },
      { icon: "leaf", title: "Keep it for pooja only", body: "These items stay at the altar and are not used for anything else." },
    ],
    benefitsTitle: "Why this kit",
    benefits: [
      { icon: "shield", title: "Complete", body: "Everything the vidhi calls for, in one box — nothing missing halfway through." },
      { icon: "sparkle", title: "Ritually correct", body: "Each item is the material the tradition specifies, not a convenient substitute." },
      { icon: "hand", title: "Ethically sourced", body: "Sourced from makers we know, with the lineage traced and on record." },
      { icon: "qr", title: "Verifiable", body: "Serialised and signed, with the contents listed on the QR page." },
    ],
    faq: [
      { q: "Does it include instructions?", a: "Yes — a printed vidhi card with the step-by-step sequence is in every kit, and the same steps are on your certificate's QR page." },
    ],
  },

  book: {
    ritualTitle: "How to keep a sacred text",
    ritual: [
      { icon: "hand", title: "Clean hands", body: "Handle the text with washed hands and a settled mind." },
      { icon: "package", title: "Keep it raised", body: "A grantha never sits on the floor. Keep it on a stand or at the altar." },
      { icon: "sun", title: "Read at a fixed hour", body: "A regular time each day builds the practice more than long, rare sittings." },
      { icon: "leaf", title: "Wrap it when resting", body: "Keep it wrapped in clean cloth between readings to protect the pages." },
    ],
    benefitsTitle: "Why this edition",
    benefits: [
      { icon: "scroll", title: "Faithful text", body: "Devanagari with transliteration and translation — nothing quietly abridged." },
      { icon: "sparkle", title: "Made to last", body: "Sewn binding and archival paper, printed to be read daily for years." },
      { icon: "shield", title: "Certified edition", body: "Serialised and signed so the edition and print run are on record." },
      { icon: "hand", title: "Ethically produced", body: "Printed with partners we know, on responsibly sourced paper." },
    ],
    faq: [
      { q: "Is there a translation included?", a: "Yes — the Devanagari text is set alongside transliteration and an English translation, so it can be read whether or not you read Sanskrit." },
    ],
  },

  digital: {
    ritualTitle: "How to use it",
    ritual: [
      { icon: "qr", title: "Delivered instantly", body: "Your access link arrives by email the moment payment is confirmed." },
      { icon: "clock", title: "Yours to keep", body: "Access does not expire — return to it whenever your practice calls for it." },
      { icon: "hand", title: "For your own use", body: "Licensed for personal practice, not for redistribution." },
      { icon: "lotus", title: "Begin with intention", body: "Set a fixed hour and a quiet corner before you start." },
    ],
    benefitsTitle: "Why this",
    benefits: [
      { icon: "clock", title: "Instant access", body: "No shipping, no waiting — it is in your inbox within moments." },
      { icon: "shield", title: "Signed & verifiable", body: "Your access record is serialised and Ed25519-signed like everything we issue." },
      { icon: "scroll", title: "Made by practitioners", body: "Prepared by the same pandits and astrologers we work with every day." },
      { icon: "sparkle", title: "Updated free", body: "Revisions to the material reach you at no extra cost." },
    ],
    faq: [
      { q: "How is a digital item delivered?", a: "Immediately by email once payment is confirmed. Nothing is shipped, and there is no physical QR — your access record is signed and viewable from your account." },
      { q: "Can I get a refund?", a: "Digital items cannot be returned once accessed, since access is instant and permanent. If the link fails, we will fix it or refund you in full." },
    ],
  },
};

/** Universal FAQs appended after the category-specific ones. */
export const COMMON_FAQ = [
  { q: "How do I verify this is genuine?", a: "Every unit ships with a per-unit QR. Scanning it opens a public verification page that recomputes the SHA-256 hash of the certificate and checks it against our Ed25519 signature. Our public key is published, so you can verify it independently with any Ed25519 library — you never have to trust us." },
  { q: "Why does the QR read 'suspicious' before delivery?", a: "We mint the QR when the certificate is issued but only activate it when we physically dispatch the item. So a label printed off the internet, or scanned before we ship, correctly reads suspicious. It is how a public scan can flag a fake before your parcel even arrives." },
  { q: "What is your return policy?", a: "7 days from delivery, in original condition with the certificate. On return the certificate is revoked — its QR then reads REVOKED forever, so the old certificate can never vouch for the returned unit again." },
  { q: "Do you ship internationally?", a: "Yes, worldwide via insured logistics. Duties and taxes are borne by the buyer. Certificates travel with the parcel and the QR activates on our dispatch scan." },
];

export function copyFor(category) {
  return { ...DEFAULT, ...(CATEGORY_COPY[category] || {}) };
}

export function faqFor(category) {
  return [...(CATEGORY_COPY[category]?.faq || []), ...COMMON_FAQ];
}

/** "carat_range" -> "Carat Range" — attrs keys are free-form per category. */
export function prettyKey(k) {
  return String(k).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function prettyValue(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") return Object.values(v).join(", ");
  return String(v);
}
