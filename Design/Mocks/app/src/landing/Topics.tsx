import { Gallery, type Pictures } from './Gallery';
import { Intro, Row } from './sections';

/** One thing that goes wrong, and how Psss handles it: a row that opens to its pictures. */
export interface Topic {
  /** Anchor id, and the gallery's id. */
  id: string;
  /** The row: the moment in the visitor's own words. */
  quote: string;
  /** One sentence on what goes wrong elsewhere. Names nobody without a source. */
  elsewhere: string;
  source?: { label: string; href: string };
  /** One line on what it saves the visitor. */
  saves: string;
  /** Names the gallery for a screen reader. */
  title: string;
  /** Not shown on the page (owner, 2026-11-27: no built / not built flags). The record of what runs in a build today. */
  status: 'works' | 'coming';
  statusNote?: string;
  pictures: Pictures;
}

/** Topics that belong to one place: the app, AutoFill, the browser, the menu bar. */
export interface TopicGroup {
  id: string;
  heading: string;
  /** Where this is, in a few words. */
  lead?: string;
  topics: Topic[];
}

/**
 * The calm list (owner, 2026-11-27): groups of rows, every row closed, each group
 * with its heading and one line above its card of rows (owner, 2026-11-27).
 * A row opens to what goes wrong and what it saves, then the pictures.
 */
export function Topics({ heading, lead, groups }: { heading: string; lead?: string; groups: TopicGroup[] }) {
  return (
    <section className="lp-section" aria-labelledby="lp-topics-h">
      <div className="lp-wrap">
        <Intro id="lp-topics-h" heading={heading} lead={lead} />
        {groups.map((g) => (
          <div className="lp-group" key={g.id} id={g.id}>
            <h3 className="lp-group-head">{g.heading}</h3>
            {g.lead && <p className="lp-group-lead">{g.lead}</p>}
            <div className="lp-rows">
              {g.topics.map((t) => (
                <Row key={t.id} id={`about-${t.id}`} label={t.quote}>
                  <p className="lp-body">
                    {t.elsewhere} {t.saves}
                    {t.source && <> (<a className="lp-link" href={t.source.href} rel="noopener noreferrer">{t.source.label}</a>)</>}
                  </p>
                  <Gallery id={t.id} title={t.title} pictures={t.pictures} />
                </Row>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
