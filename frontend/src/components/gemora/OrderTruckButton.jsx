import React, { useEffect, useRef, useState } from "react";

/**
 * Brand-themed "delivery truck" order button — controlled by the caller.
 *
 * The truck animation plays ONLY once payment has actually succeeded, driven by
 * the `state` prop, not by the click. States:
 *   • "idle"       → clickable "Pay securely" (a normal form submit fires).
 *   • "loading"    → "Processing…" while the payment (Razorpay / test-pay) runs.
 *   • "delivering" → the truck drives off and reveals "On its way ✓".
 *
 * The parent keeps the page mounted for ~`duration` while state is "delivering"
 * so the animation is seen, then navigates to the confirmation page.
 */
const REVEAL_AT = 0.72; // fraction of duration when the success label appears

export default function OrderTruckButton({
  state = "idle",
  onClick,
  idleLabel = "Pay securely",
  loadingLabel = "Processing…",
  successLabel = "On its way",
  duration = 4200,
  type = "submit",
  disabled = false,
  "data-testid": testId,
}) {
  const [done, setDone] = useState(false);
  const timers = useRef([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  useEffect(() => {
    clearTimers();
    setDone(false);
    if (state === "delivering") {
      timers.current.push(setTimeout(() => setDone(true), duration * REVEAL_AT));
    }
  }, [state, duration]);

  const delivering = state === "delivering";
  const loading = state === "loading";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || state !== "idle"}
      data-testid={testId}
      className={`otbtn ${delivering ? "is-playing" : ""} ${done ? "is-done" : ""} ${loading ? "is-loading" : ""}`}
      style={{ "--ot": `${duration}ms` }}
      aria-live="polite"
      aria-busy={loading || delivering}
    >
      <span className="otbtn__label otbtn__label--default">{idleLabel}</span>
      <span className="otbtn__label otbtn__label--loading">{loadingLabel}</span>
      <span className="otbtn__label otbtn__label--success">
        {successLabel}
        <svg viewBox="0 0 16 14" aria-hidden="true"><polyline points="2 7.5 6.5 12 14 2.5" /></svg>
      </span>

      <span className="otbtn__stage" aria-hidden="true">
        <span className="otbtn__box" />
        <span className="otbtn__lines"><i /><i /><i /></span>
        <span className="otbtn__truck">
          <span className="otbtn__cargo" />
          <span className="otbtn__cab" />
          <span className="otbtn__wheel otbtn__wheel--a" />
          <span className="otbtn__wheel otbtn__wheel--b" />
        </span>
      </span>
    </button>
  );
}
