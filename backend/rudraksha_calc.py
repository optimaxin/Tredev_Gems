"""Lucky Rudraksha calculator — moon-sign chart astronomy (Swiss Ephemeris, Lahiri
ayanamsa) + a Moon-sign -> Mukhi recommendation matrix. Embedded directly (no
external astro-calculators service): the moon's zodiac sign only needs a Julian day
and a birth-place timezone, not the full lagna/houses/navamsa chart, so this only
computes what /calculators/lucky-rudraksha actually uses.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import swisseph as swe
from timezonefinder import TimezoneFinder

SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
         "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

NAKSHATRAS = [
    "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
    "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni",
    "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
    "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha",
    "Purva Bhadrapada", "Uttara Bhadrapada", "Revati",
]

SANSKRIT = {
    "Aries": "Mesh", "Taurus": "Vrishabh", "Gemini": "Mithun", "Cancer": "Kark",
    "Leo": "Simha", "Virgo": "Kanya", "Libra": "Tula", "Scorpio": "Vrishchik",
    "Sagittarius": "Dhanu", "Capricorn": "Makar", "Aquarius": "Kumbh", "Pisces": "Meen",
}

# Moon sign -> (ruling_planet, primary_mukhi, alternative_mukhi | None, benefits)
MUKHI_MATRIX = {
    "Aries":       ("Mars",    "3 Mukhi", None,           "Supports confidence, reduces anger"),
    "Taurus":      ("Venus",  "6 Mukhi", "13 Mukhi",       "Supports harmony, luxury, stability"),
    "Gemini":      ("Mercury", "4 Mukhi", None,           "Enhances intellect and clear speech"),
    "Cancer":      ("Moon",    "2 Mukhi", "Gauri Shankar", "Brings emotional calm and family peace"),
    "Leo":         ("Sun",     "1 Mukhi", "12 Mukhi",      "Boosts leadership and recognition"),
    "Virgo":       ("Mercury", "4 Mukhi", "5 Mukhi",       "Improves focus, reduces stress"),
    "Libra":       ("Venus",  "6 Mukhi", "13 Mukhi",       "Attracts charm and social harmony"),
    "Scorpio":     ("Mars",    "3 Mukhi", "9 Mukhi",       "Provides protection and inner strength"),
    "Sagittarius": ("Jupiter", "5 Mukhi", None,           "Encourages wisdom and steady growth"),
    "Capricorn":   ("Saturn",  "7 Mukhi", "14 Mukhi",      "Aids patience and long-term success"),
    "Aquarius":    ("Saturn",  "7 Mukhi", None,           "Helps overcome delays and worries"),
    "Pisces":      ("Jupiter", "5 Mukhi", "11 Mukhi",      "Supports spiritual power and health"),
}

MUKHI_INFO = {
    "1 Mukhi": "Shiva / Sun", "2 Mukhi": "Ardhanareshwara / Moon", "3 Mukhi": "Agni / Mars",
    "4 Mukhi": "Brahma / Mercury", "5 Mukhi": "Kalagni Rudra / Jupiter", "6 Mukhi": "Kartikeya / Venus",
    "7 Mukhi": "Mahalakshmi / Saturn", "9 Mukhi": "Bhairava / Ketu", "11 Mukhi": "Rudra / Jupiter",
    "12 Mukhi": "Surya / Sun", "13 Mukhi": "Kamadeva / Venus", "14 Mukhi": "Hanuman / Saturn",
    "Gauri Shankar": "Shiva-Parvati / Moon",
}

# Extended reference (8-21 Mukhi + Gauri Shankar) — beyond the core matrix, used to
# flesh out alternative-bead notes.
MUKHI_EXTENDED = {
    "8 Mukhi": ("Rahu", "Gemini & Virgo (or Rahu Dasha)", "Removes sudden obstacles; counters illusions."),
    "9 Mukhi": ("Ketu", "Scorpio (or Ketu Dasha)", "Boosts dynamic energy, courage, and fearlessness."),
    "10 Mukhi": ("All 9 Planets (Navagraha)", "Universal (All 12 Zodiac Signs)", "Shields against negative energies and evil eye."),
    "11 Mukhi": ("Jupiter", "Sagittarius & Pisces", "Enhances high-level judgment and meditation."),
    "12 Mukhi": ("Sun", "Leo", "Amplifies professional power and leadership."),
    "13 Mukhi": ("Venus", "Taurus & Libra", "Elevates attraction, charisma, and business luck."),
    "14 Mukhi": ("Saturn", "Capricorn & Aquarius (or Shani Sadesati)", "Activates sharp intuition and safe risk-taking."),
    "15 Mukhi": ("Mercury", "Gemini & Virgo", "Promotes economic focus and heals emotional pain."),
    "16 Mukhi": ("Moon", "Cancer", "Protects physical health and overcomes severe fear."),
    "17 Mukhi": ("Saturn", "Capricorn & Aquarius", "Grants unexpected financial gains and property luck."),
    "18 Mukhi": ("Earth (Bhumadevi)", "Universal (Excellent for Real Estate)", "Grounding energy; anchors massive business growth."),
    "19 Mukhi": ("Sun", "Leo", "Removes scarcity mindsets; attracts continuous wealth."),
    "20 Mukhi": ("All 9 Planets", "Universal (All 12 Zodiac Signs)", "Heightens creative knowledge and deep spiritual vision."),
    "21 Mukhi": ("Venus / Kubera", "Taurus & Libra", "Ensures immense wealth retention and status preservation."),
    "Gauri Shankar": ("Moon & Sun", "Cancer & Leo (or Relationship problems)", "Repairs family disputes and balances partnerships."),
}

UNIVERSAL_SAFE = {"mukhi": "5 Mukhi", "note": "5 Mukhi (ruled by Jupiter) is universally beneficial and safe for anyone to wear."}

DISCLAIMER = "For spiritual and informational purposes; not a substitute for professional advice."

INTERPRETATIONS = {
    "Aries": "With the Moon in Aries, Mars governs your emotional core. Wearing a 3 Mukhi Rudraksha is believed to build confidence and ease anger, inviting balance and positive energy.",
    "Taurus": "With the Moon in Taurus, Venus governs your emotional core. Wearing a 6 Mukhi Rudraksha is believed to support harmony, luxury, and stability, inviting balance and positive energy.",
    "Gemini": "With the Moon in Gemini, Mercury governs your emotional core. Wearing a 4 Mukhi Rudraksha is believed to sharpen intellect and bring clarity to speech, inviting balance and positive energy.",
    "Cancer": "With the Moon in Cancer, the Moon governs your emotional core. Wearing a 2 Mukhi Rudraksha is believed to bring emotional calm and family peace, inviting balance and positive energy.",
    "Leo": "With the Moon in Leo, the Sun governs your emotional core. Wearing a 1 Mukhi Rudraksha is believed to boost leadership and recognition, inviting balance and positive energy.",
    "Virgo": "With the Moon in Virgo, Mercury governs your emotional core. Wearing a 4 Mukhi Rudraksha is believed to improve focus and reduce stress, inviting balance and positive energy.",
    "Libra": "With the Moon in Libra, Venus governs your emotional core. Wearing a 6 Mukhi Rudraksha is believed to attract charm and social harmony, inviting balance and positive energy.",
    "Scorpio": "With the Moon in Scorpio, Mars governs your emotional core. Wearing a 3 Mukhi Rudraksha is believed to provide protection and inner strength, inviting balance and positive energy.",
    "Sagittarius": "With the Moon in Sagittarius, Jupiter governs your emotional core. Wearing a 5 Mukhi Rudraksha is believed to encourage wisdom and steady growth, inviting balance and positive energy.",
    "Capricorn": "With the Moon in Capricorn, Saturn governs your emotional core. Wearing a 7 Mukhi Rudraksha is believed to aid patience and long-term success, inviting balance and positive energy.",
    "Aquarius": "With the Moon in Aquarius, Saturn governs your emotional core. Wearing a 7 Mukhi Rudraksha is believed to steady the mind, ease anxiety about delays, and invite patience and lasting success.",
    "Pisces": "With the Moon in Pisces, Jupiter governs your emotional core. Wearing a 5 Mukhi Rudraksha is believed to support spiritual power and health, inviting balance and positive energy.",
}

_FLAG = swe.FLG_SIDEREAL | swe.FLG_MOSEPH | swe.FLG_SPEED  # Moshier — no ephemeris files to ship/deploy
_tf = TimezoneFinder()


class ChartError(Exception):
    """Raised when the birth date/time/place can't be resolved to a chart position."""


def _sign_of(longitude: float) -> str:
    return SIGNS[int(longitude // 30) % 12]


def _nakshatra_of(longitude: float) -> str:
    return NAKSHATRAS[int(longitude // (360 / 27)) % 27]


def _nakshatra_pada_of(longitude: float) -> int:
    span = 360 / 27
    return int((longitude % span) // (span / 4)) + 1


def moon_position(dob: str, tob: str, lat: float, lon: float) -> dict:
    """Moon's sidereal (Lahiri) ecliptic longitude at birth, and what it resolves to.

    Only the Moon — the ascendant/houses/other planets a full D1/D9 chart carries
    are never used by the rudraksha recommendation, so this skips them rather than
    computing (and discarding) a whole birth chart per request.
    """
    tz_name = _tf.timezone_at(lat=lat, lng=lon)
    if not tz_name:
        raise ChartError(f"Could not resolve a timezone for ({lat}, {lon})")
    try:
        local_dt = datetime.strptime(f"{dob} {tob}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(tz_name))
    except ValueError as e:
        raise ChartError(str(e))
    utc_dt = local_dt.astimezone(ZoneInfo("UTC"))
    ut_hours = utc_dt.hour + utc_dt.minute / 60 + utc_dt.second / 3600
    jd = swe.julday(utc_dt.year, utc_dt.month, utc_dt.day, ut_hours)

    swe.set_sid_mode(swe.SIDM_LAHIRI)
    (longitude, *_rest), _flag = swe.calc_ut(jd, swe.MOON, _FLAG)

    sign = _sign_of(longitude)
    return {
        "sign": sign,
        "sign_sanskrit": SANSKRIT[sign],
        "nakshatra": _nakshatra_of(longitude),
        "nakshatra_pada": _nakshatra_pada_of(longitude),
        "longitude": round(longitude, 4),
    }


def _mukhi_note(mukhi: str) -> str:
    if mukhi == "5 Mukhi":
        return UNIVERSAL_SAFE["note"]
    ruling_planet, favorable_rashi, benefits = MUKHI_EXTENDED[mukhi]
    return f"{mukhi} (ruled by {ruling_planet}, favorable for {favorable_rashi}) — {benefits}"


def recommend(moon_sign: str) -> dict:
    ruling_planet, primary_mukhi, alt_mukhi, benefits = MUKHI_MATRIX[moon_sign]

    primary = {
        "mukhi": primary_mukhi,
        "ruling_planet": ruling_planet,
        "deity": MUKHI_INFO[primary_mukhi].split(" / ")[0],
        "benefits": f"{benefits[0].upper()}{benefits[1:]}.",
    }
    alternative = {"mukhi": alt_mukhi, "note": _mukhi_note(alt_mukhi)} if alt_mukhi else None

    return {
        "ruling_planet": ruling_planet,
        "recommendation": {
            "primary": primary,
            "alternative": alternative,
            "universal_safe": UNIVERSAL_SAFE,
        },
        "interpretation": INTERPRETATIONS[moon_sign],
        "disclaimer": DISCLAIMER,
    }
