// The device frames take their colours and sizes from the mock library's sheet.
import '@mocks/styles.css';
import { LandingPage } from '@mocks/pages/LandingPage';
import './site.css';

/** The whole page as plain HTML: the galleries are pictures that scroll with CSS, so nothing here needs a script. */
export function Page() {
  return <LandingPage />;
}
