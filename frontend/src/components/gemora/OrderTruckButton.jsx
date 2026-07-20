import React, { useEffect, useRef, useState } from "react";

/**
 * A brand-themed "delivery truck" order button. On click it plays a one-shot
 * choreography — the truck rolls in, a package loads, it drives off with speed
 * lines, then reveals "On its way ✓". Purely presentational; the caller wires the
 * real payment via `onClick` (a normal form submit still fires).
 *
 * The parent should hold navigation until roughly `duration` has elapsed so the
 * animation is seen (see Checkout's mock-pay branch). If the payment fails, the
 * button resets itself so the buyer can retry.
 */
const REVEAL_AT = 0.72; // fraction of duration when the success label appears

export default function OrderTruckButton({
  onClick,
  disabled = false,
  idleLabel = "Pay securely",
  successLabel = "On its way",
  duration = 4200,
  type = "submit",
  "data-testid": testId,
}) {
  const [phase, setPhase] = useState("idle"); // idle | playing | done
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const play = () => {
    if (phase !== "idle" || disabled) return;
    setPhase("playing");
    timers.current.push(setTimeout(() => setPhase("done"), duration * REVEAL_AT));
    // Fallback reset: if the page didn't navigate away (e.g. payment cancelled),
    // return the button to idle so it can be pressed again.
    timers.current.push(setTimeout(() => setPhase("idle"), duration + 1600));
  };

  const handleClick = (e) => {
    // Don't animate if this is a submit button in an invalid form — let native
    // validation surface instead of playing the truck on a blocked submit.
    const form = e.currentTarget.form;
    if (type === "submit" && form && typeof form.checkValidity === "function" && !form.checkValidity()) {
      return;
    }
    play();
    onClick?.(e); // the parent form submit / payment kicks off here (keeps the user gesture)
  };

  const playing = phase === "playing" || phase === "done";

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled || playing}
      data-testid={testId}
      className={`otbtn ${playing ? "is-playing" : ""} ${phase === "done" ? "is-done" : ""}`}
      style={{ "--ot": `${duration}ms` }}
      aria-live="polite"
    >
      <span className="otbtn__label otbtn__label--default">{idleLabel}</span>
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
