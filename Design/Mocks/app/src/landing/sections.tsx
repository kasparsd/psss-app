import type { ReactNode } from 'react';
import { SiteLogo } from './SiteLogo';
import './landing.css';

/* Every component is a pure function of its props. Words come in as props (landing/copy.ts).
   The page is calm on purpose (owner, 2026-11-27) and takes its look from the app:
   one column, one left edge, few text sizes, and grouped lists with a small header
   above each, as in Settings. Only the lead (headline and picture) is centred. */

/** The logo alone, in the middle. */
export function SiteHeader() {
  return (
    <header className="lp-header">
      <SiteLogo />
    </header>
  );
}

/** Headline and lead, centred, with the lead picture across the width below. */
export function Hero({ headline, lead, art }: { headline: string; lead: string; art: ReactNode }) {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-h">
      <div className="lp-wrap lp-wide">
        <div className="lp-intro">
          <h1 className="lp-h1" id="lp-hero-h">{headline}</h1>
          <p className="lp-lead">{lead}</p>
        </div>
        <div className="lp-hero-art">{art}</div>
      </div>
    </section>
  );
}

/** A section's centred heading and the line under it. */
export function Intro({ id, heading, lead }: { id: string; heading: string; lead?: string }) {
  return (
    <div className="lp-intro">
      <h2 className="lp-h2" id={id}>{heading}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </div>
  );
}

/** One row that opens: the browser's own disclosure, so it needs no script. */
export function Row({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <details className="lp-row" id={id}>
      <summary className="lp-row-head">
        <span className="lp-row-label">{label}</span>
        <span className="lp-row-mark" aria-hidden="true" />
      </summary>
      <div className="lp-row-body">{children}</div>
    </details>
  );
}

export function Story({ heading, paragraphs, signature }: { heading: string; paragraphs: string[]; signature: string }) {
  return (
    <section className="lp-section" aria-labelledby="lp-story-h">
      <div className="lp-wrap">
        <Intro id="lp-story-h" heading={heading} />
        {paragraphs.map((p, i) => <p className="lp-body" key={i}>{p}</p>)}
        <p className="lp-body lp-sign">{signature}</p>
      </div>
    </section>
  );
}

/** What is in the app, as the same grouped list as everything else: a few words and a line under them. */
export function WhatYouGet({ heading, lead, items }: {
  heading: string;
  lead?: string;
  items: { title: string; text: string }[];
}) {
  return (
    <section className="lp-section" aria-labelledby="lp-get-h">
      <div className="lp-wrap">
        <Intro id="lp-get-h" heading={heading} lead={lead} />
        <ul className="lp-rows lp-plain" role="list">
          {items.map((it) => (
            <li className="lp-row" key={it.title}>
              <p className="lp-row-label">{it.title}</p>
              <p className="lp-small">{it.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Faq({ heading, items }: { heading: string; items: { q: string; a: string }[] }) {
  return (
    <section className="lp-section" aria-labelledby="lp-faq-h">
      <div className="lp-wrap">
        <Intro id="lp-faq-h" heading={heading} />
        <div className="lp-rows">
          {items.map((it) => (
            <Row key={it.q} label={it.q}><p className="lp-body">{it.a}</p></Row>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ lines }: { lines: string[] }) {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        {lines.map((l) => <p key={l}>{l}</p>)}
      </div>
    </footer>
  );
}
