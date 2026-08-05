import React from "react";
import { Reveal } from "@/components/gemora/Editorial";

/**
 * Shared layout for long-form legal documents (Privacy Policy, Terms &
 * Conditions). Deliberately calm — no embers/halo motion here, this is a
 * document people need to read, not a marketing surface.
 *
 * `sections`: [{ id, heading, body: <JSX> }]
 */
export default function LegalPage({ title, effectiveDate, intro, sections }) {
  return (
    <div className="bg-ivory">
      <section className="relative overflow-hidden bg-cream border-b border-gold/30 py-14">
        <div className="grain absolute inset-0 pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h1 className="font-display text-4xl md:text-5xl text-ink">{title}</h1>
          {effectiveDate && (
            <p className="mt-3 text-xs uppercase tracking-[0.3em] text-gold-soft">Effective {effectiveDate}</p>
          )}
          {intro && <p className="mt-5 text-ink-soft leading-relaxed">{intro}</p>}
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-14">
        <nav className="gold-line bg-cream p-5 mb-10 text-sm" aria-label="Sections on this page">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft mb-3">On this page</div>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 list-decimal list-inside text-ink-soft">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-maroon underline decoration-gold-soft/50 underline-offset-4">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <Reveal key={s.id} delay={Math.min(i * 0.03, 0.3)}>
            <section id={s.id} className="mb-10 scroll-mt-24">
              <h2 className="font-display text-2xl text-maroon-deep gold-line-b pb-2">{s.heading}</h2>
              <div className="mt-4 text-sm text-ink-soft leading-relaxed space-y-3">{s.body}</div>
            </section>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
