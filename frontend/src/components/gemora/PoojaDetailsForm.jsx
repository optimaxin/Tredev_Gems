import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FlowerLotus } from "@phosphor-icons/react";
import PlaceAutocomplete from "@/components/gemora/PlaceAutocomplete";

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const TODAY = new Date().toISOString().slice(0, 10);

export const EMPTY_POOJA_DETAILS = {
  name: "", dob: "", birth_place: "", birth_time: "", gender: "", gotra: "", purpose: "",
};

// Pure so ProductDetail can gate Add to Cart with exactly the rules this form displays.
export function validatePoojaDetails(v) {
  const errors = {};
  if (!v.name?.trim()) errors.name = "Enter the wearer's name";
  if (!v.dob) errors.dob = "Select a date of birth";
  else if (v.dob > TODAY) errors.dob = "Date of birth can't be in the future";
  if (!v.birth_place?.trim()) errors.birth_place = "Enter the place of birth";
  if (!v.gender) errors.gender = "Select a gender";
  if (!v.purpose) errors.purpose = "Select a purpose";
  return errors;
}

/**
 * Wearer details for a video Pooja Energization — shown inline once the buyer
 * picks a video-based option, so the temple priest can perform the sankalp for
 * the right person. `showErrors` forces every error visible (Add to Cart was
 * clicked while invalid); otherwise a field's error only appears once it's blurred.
 */
export default function PoojaDetailsForm({ value, onChange, showErrors }) {
  const [purposes, setPurposes] = useState([]);
  const [touched, setTouched] = useState({});

  // Admin-editable list — never hardcoded. Fetched here rather than lifted to a
  // shared context: this form is the only consumer, and it only mounts when needed.
  useEffect(() => {
    api.get("/site-content").then(({ data }) => setPurposes(data?.pooja_purposes || [])).catch(() => {});
  }, []);

  const errors = validatePoojaDetails(value);
  const blur = (key) => setTouched((t) => ({ ...t, [key]: true }));
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  const errorFor = (key) => (showErrors || touched[key]) && errors[key];

  const field = (label, key, input) => (
    <label className="block">
      <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">{label}</div>
      {input}
      {errorFor(key) && <div className="mt-1 text-xs text-revoked">{errors[key]}</div>}
    </label>
  );

  const inputClass = "w-full gold-line bg-ivory px-3 py-2.5 outline-none focus:border-maroon";

  return (
    <div className="mt-3 gold-line bg-cream p-5" data-testid="pooja-details-form">
      <div className="flex items-center gap-2 text-maroon-deep">
        <FlowerLotus size={18} weight="duotone" />
        <span className="font-serifd text-lg">Pooja Details</span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Needed so the temple priest can perform the sankalp for the right person.
      </p>

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        {field("Name of Wearer*", "name", (
          <input
            value={value.name}
            onChange={set("name")}
            onBlur={() => blur("name")}
            data-testid="pooja-name"
            className={inputClass}
          />
        ))}
        {field("Date of Birth*", "dob", (
          <input
            type="date"
            value={value.dob}
            max={TODAY}
            onChange={set("dob")}
            onBlur={() => blur("dob")}
            data-testid="pooja-dob"
            className={inputClass}
          />
        ))}
        {/* Coordinates ride along when a suggestion is picked — the priest's sankalp
            is cast against the birthplace, and "Jaipur" alone is ambiguous. */}
        {field("Place of Birth*", "birth_place", (
          <PlaceAutocomplete
            value={value.birth_place}
            onChange={(label, coords) => onChange({
              ...value, birth_place: label,
              birth_lat: coords?.lat ?? null, birth_lon: coords?.lon ?? null,
            })}
            placeholder="Start typing a city…"
            className={inputClass}
            testId="pooja-birth-place"
            inputProps={{ onBlur: () => blur("birth_place") }}
          />
        ))}
        <label className="block">
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-1">Time of Birth</div>
          <input
            type="time"
            value={value.birth_time}
            onChange={set("birth_time")}
            data-testid="pooja-birth-time"
            className={inputClass}
          />
          <div className="mt-1 text-[11px] text-ink-muted">Improves the accuracy of your muhurat/sankalp, if known.</div>
        </label>
        {field("Gender*", "gender", (
          <select
            value={value.gender}
            onChange={set("gender")}
            onBlur={() => blur("gender")}
            data-testid="pooja-gender"
            className={inputClass}
          >
            <option value="">Select gender</option>
            {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        ))}
        {field("Clan/Gotra (If Available)", "gotra", (
          <input
            value={value.gotra}
            onChange={set("gotra")}
            data-testid="pooja-gotra"
            className={inputClass}
          />
        ))}
        <div className="sm:col-span-2">
          {field("Primary Purpose*", "purpose", (
            <select
              value={value.purpose}
              onChange={set("purpose")}
              onBlur={() => blur("purpose")}
              data-testid="pooja-purpose"
              className={`sm:max-w-md ${inputClass}`}
            >
              <option value="" disabled={purposes.length === 0}>{purposes.length ? "Select purpose" : "Loading…"}</option>
              {purposes.map((pp) => <option key={pp.key} value={pp.key}>{pp.label}</option>)}
            </select>
          ))}
        </div>
      </div>
    </div>
  );
}
