// Turn a long cryptographic hex value (public key, hash, signature) into something a
// normal person can actually understand and remember: a little picture (identicon),
// a handful of emoji, and a short word phrase. All are pure, deterministic functions of
// the value — the same hex always yields the same picture/emoji/words, so a buyer can
// recognise "mine looks like the peacock-lotus one" and spot a fake that doesn't match.
// These are a human-recognition aid layered on top of the real proof (the full
// signature), not a replacement for it.

const EMOJI = [
  "🦚", "🪷", "🐯", "🦁", "🐘", "🦌", "🦅", "🐬", "🐢", "🐼", "🐎", "🐫",
  "🦩", "🦉", "🕊️", "🦋", "🌸", "🌺", "🌻", "🌙", "⭐", "☀️", "💎", "👑",
  "🔔", "🪔", "🏛️", "🌈", "⚓", "🧭", "🪶", "🎏", "🥭", "🍋", "🌿", "🍯",
  "🌵", "🎋", "🪸", "🐚", "🔱", "☂️", "🏵️", "🪘", "🎺", "🔮", "🕯️", "🗝️",
];

const WORDS = [
  "mango", "lotus", "river", "tiger", "gold", "moon", "star", "sun", "pearl", "coral",
  "ivory", "amber", "jade", "ruby", "opal", "topaz", "peacock", "swan", "deer", "eagle",
  "falcon", "dolphin", "turtle", "rabbit", "panda", "lion", "horse", "camel", "temple",
  "bamboo", "cedar", "maple", "willow", "jasmine", "marigold", "saffron", "cardamom",
  "ginger", "honey", "mint", "basil", "clove", "almond", "cashew", "walnut", "apricot",
  "cherry", "plum", "peach", "lemon", "olive", "copper", "silver", "bronze", "marble",
  "granite", "crystal", "velvet", "silk", "cotton", "linen", "canyon", "valley", "meadow",
  "harbor", "island", "desert", "glacier", "comet", "planet", "galaxy", "thunder",
  "breeze", "monsoon", "rainbow", "dawn", "dusk", "lantern", "candle", "palace", "garden",
  "fountain", "bridge", "anchor", "compass", "feather", "ribbon", "drum", "flute", "bell",
  "mirror", "crown", "throne", "petal", "ember",
];

const PALETTE = ["#722F37", "#C9A227", "#B8860B", "#8B5E3C", "#5B7B5B", "#3F5E78", "#7A4B6B", "#A85C32"];

function hexBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

// Pick `n` items spread across the value's bytes so the whole value influences the result.
function pick(list, bytes, n) {
  if (!bytes.length) return [];
  const step = Math.max(1, Math.floor(bytes.length / n));
  return Array.from({ length: n }, (_, i) => list[bytes[(i * step) % bytes.length] % list.length]);
}

export const emojiFingerprint = (hex, n = 5) => pick(EMOJI, hexBytes(hex), n);
export const wordFingerprint = (hex, n = 4) => pick(WORDS, hexBytes(hex), n);

// A 5×5 horizontally-mirrored grid (like a GitHub identicon) + a brand colour.
export function identicon(hex) {
  const b = hexBytes(hex);
  if (!b.length) return { cells: [], color: "#999" };
  const color = PALETTE[b[0] % PALETTE.length];
  let bit = 0;
  const nextBit = () => {
    const v = (b[(1 + Math.floor(bit / 8)) % b.length] >> (bit % 8)) & 1;
    bit += 1;
    return !!v;
  };
  const cells = [];
  for (let r = 0; r < 5; r++) {
    const half = [nextBit(), nextBit(), nextBit()];
    cells.push([half[0], half[1], half[2], half[1], half[0]]); // mirror
  }
  return { cells, color };
}
