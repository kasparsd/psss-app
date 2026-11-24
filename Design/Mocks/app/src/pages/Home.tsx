import { pages } from '../registry';

export function Home({ missing }: { missing?: string }) {
  return (
    <main className="page">
      <h1>Psss design mocks</h1>
      <div className="prose">
        <p className="muted">One React app with shared components: a phone, a window or a field row is drawn in one place, so a decision changes everywhere at once. Every page shows the current decisions only, and ends with a History: a dated log in words of what was tried, what replaced it and why. Build status is kept in the docs, not here. All data is fictional. Pages not listed here are still static; they are linked from the <a href="../../index.html">old index</a>.</p>
        {missing && <div className="note">There is no page called “{missing}”. Pick one below.</div>}
        <div className="note"><strong>How to read the frames.</strong> System fonts, light and dark follow the system. Blue stands in for the system accent; red is only for deletion. Inside a device there are two text sizes, a title and the body, and every action has a text label except the standard toolbar symbols, the copy icon and the eye. Controls are approximations of the native ones, not pixel-exact. Frames with an iPhone / iPad / Mac switch can be changed one by one, and the switch at the top of a page sets all of them.</div>
        <ul className="home" style={{ marginTop: 18 }}>
          {pages.map((p) => (
            <li key={p.slug}>
              <a href={`#/${p.slug}`}><strong>{p.title}</strong></a> ({p.status}): {p.summary}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
