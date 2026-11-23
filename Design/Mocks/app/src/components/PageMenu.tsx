import { pages } from '../registry';

/** The menu at the top of every page: every mock, the current one marked, plus the older static mocks. */
export function PageMenu({ current }: { current: string }) {
  return (
    <nav className="pagemenu" aria-label="Mock pages">
      <a href="#/" className={current === '' ? 'on' : undefined} aria-current={current === '' ? 'page' : undefined}>All mocks</a>
      <span className="pm-sep" aria-hidden="true" />
      {pages.map((p) => (
        <a key={p.slug} href={`#/${p.slug}`} className={p.slug === current ? 'on' : undefined} aria-current={p.slug === current ? 'page' : undefined} title={p.title}>{p.short}</a>
      ))}
      <span className="pm-sep" aria-hidden="true" />
      <a href="../../index.html" title="The older mocks that are still static pages">Older static mocks</a>
    </nav>
  );
}
