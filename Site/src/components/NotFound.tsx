import '@mocks/styles.css';
import { SiteHeader } from '@mocks/landing/sections';
import './site.css';

/** The 404 page, in the landing page's look: the icon, what happened, and the way home. */
export function NotFound() {
  return (
    <div className="lp not-found">
      <SiteHeader />
      <main>
        <div className="lp-wrap">
          <div className="lp-intro">
            <h1 className="lp-h2">Nothing here</h1>
            <p className="lp-lead">There is no page at this address.</p>
          </div>
          <p className="lp-body nf-home"><a className="lp-link" href="/">Go to the front page</a></p>
        </div>
      </main>
    </div>
  );
}
