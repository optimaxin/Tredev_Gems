import React, { useEffect, useRef, useState } from "react";

// Idle label -> in-progress label. Matched against the button's own text, so a
// single map covers the whole app instead of every call site inventing its own.
export const LOADING_LABELS = {
  "Buy Now": "Processing…",
  "Add to Cart": "Adding…",
  "Pay Securely": "Securing payment…",
  "Pay now": "Starting…",
  "Enroll Now": "Enrolling…",
  "Book Session": "Booking…",
  "Book a consultation": "Booking…",
  "Book consultation": "Booking…",
  "Apply Coupon": "Applying…",
  "Apply": "Applying…",
  "Subscribe": "Setting up…",
  "Start Free": "Getting started…",
  "Sign in": "Signing in…",
  "Login": "Signing in…",
  "Create account": "Creating account…",
  "Create Account": "Creating account…",
  "Send OTP": "Sending…",
  "Verify OTP": "Verifying…",
  "Save": "Saving…",
  "Save changes": "Saving…",
  "Upload": "Uploading…",
  "Submit": "Submitting…",
  "Cancel order": "Cancelling…",
  "Delete": "Deleting…",
};

/**
 * Drop-in replacement for a plain <button> with an async onClick: spinner +
 * contextual label swap, disabled, aria-busy, and a locked width so the layout
 * doesn't jump when the label changes.
 *
 * `loading` is controlled by the caller, not owned internally — this stays a
 * dumb presentational component so it composes with whatever loading-state
 * shape a given screen already has (a single boolean, a per-row "which id is
 * busy" string, etc.) rather than forcing every call site onto one hook.
 */
export default function AsyncButton({
  loading = false,
  loadingText,
  children,
  className = "",
  disabled = false,
  as: As = "button",
  onClick,
  ...rest
}) {
  const ref = useRef(null);
  const [lockedWidth, setLockedWidth] = useState(null);

  useEffect(() => {
    if (loading && ref.current && lockedWidth === null) {
      setLockedWidth(ref.current.offsetWidth);
    } else if (!loading && lockedWidth !== null) {
      setLockedWidth(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const idleLabel = typeof children === "string" ? children : null;
  // ?? (not ||) so an explicit loadingText="" (icon-only buttons — spinner, no text)
  // is respected instead of falling through to the default label.
  const text = loading ? (loadingText ?? (idleLabel && LOADING_LABELS[idleLabel]) ?? "Please wait…") : children;

  return (
    <As
      ref={ref}
      disabled={As === "button" ? disabled || loading : undefined}
      aria-busy={loading}
      aria-disabled={As !== "button" ? disabled || loading : undefined}
      className={`${className} ${loading ? "is-loading" : ""}`.trim()}
      style={lockedWidth ? { minWidth: lockedWidth } : undefined}
      onClick={(e) => {
        if (loading || disabled) { e.preventDefault(); return; }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {text}
    </As>
  );
}

/** Optional convenience hook for screens with a single in-flight async button. */
export function useAsyncButton() {
  const [isLoading, setIsLoading] = useState(false);
  const trigger = async (asyncFn) => {
    if (isLoading) return;
    setIsLoading(true);
    try { await asyncFn(); } finally { setIsLoading(false); }
  };
  return [isLoading, trigger];
}
