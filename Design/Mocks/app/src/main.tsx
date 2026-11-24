import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Home } from './pages/Home';
import { pages } from './registry';
import { PageMenu } from './components/PageMenu';

/** Slugs that moved, so old links and the static redirect pages keep working. */
const aliases: Record<string, string> = {
  'tab-bar-and-codes': 'places',
  'tabs-on-mac-and-ipad': 'places',
  'one-list': 'filter-and-sort',
  'rows-filter-sort': 'list-rows',
  'toolbar-and-edit': 'item-page',
};

/** A small hash router: `#/slug`. Works from file:// with no server. */
function currentSlug(): string {
  const h = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return aliases[h] ?? h;
}

function App() {
  const [slug, setSlug] = useState(currentSlug());
  useEffect(() => {
    const on = () => {
      setSlug(currentSlug());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const entry = pages.find((p) => p.slug === slug);
  useEffect(() => {
    document.title = entry ? `Psss mock: ${entry.title}` : 'Psss design mocks';
  }, [entry]);
  const Page = entry?.component;
  return (
    <>
      <PageMenu current={entry ? entry.slug : ''} />
      {!slug ? <Home /> : !entry ? <Home missing={slug} /> : Page && <Page />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
