// Turn a long cryptographic hex value (public key, hash, signature) into a short,
// professional-looking verification code a normal person can read and remember —
// e.g. "K7M-2X9". Deterministic: the same value always yields the same code, so a buyer
// can recognise their item's code and spot a fake whose code doesn't match. This is a
// human-recognition aid on top of the real proof (the full signature), not a
// replacement for it.

// Crockford-style alphabet: no 0/O/1/I/L/U to avoid look-alike confusion.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function hexBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

// A `len`-char code where every byte of the value influences every character (good
// mixing), so two different values almost never collide on the short code.
export function shortCode(hex, len = 6) {
  const b = hexBytes(hex);
  if (!b.length) return "";
  let out = "";
  for (let i = 0; i < len; i++) {
    let acc = (i * 2654435761) >>> 0;
    for (let j = 0; j < b.length; j++) acc = ((acc * 31) + b[j] + ((i + 1) * (j + 3))) >>> 0;
    out += ALPHABET[acc % ALPHABET.length];
  }
  return out;
}

// "K7M2X9" -> "K7M-2X9" for readability.
export const formatCode = (code) =>
  !code ? "" : code.length <= 3 ? code : `${code.slice(0, Math.ceil(code.length / 2))}-${code.slice(Math.ceil(code.length / 2))}`;
