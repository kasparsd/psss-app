import type { ReactNode } from 'react';
import './vault.css';
import { AllGlyph, BackIcon, CardsGlyph, CodesGlyph, MoreGlyph } from '../../icons';
import type { TabSpec } from '../../components/devices';

/* Pieces the four vault galleries (cards, undo, search, keep vault) share. Pictures only: nothing here has state or a handler. */

/** The bar the owner chose on 2026-11-26 (docs/experience.md, Places): All, Codes, Cards, More, and search at the end. */
export const vaultTabs: TabSpec[] = [
  ['all', 'All', <AllGlyph key="a" />],
  ['codes', 'Codes', <CodesGlyph key="c" />],
  ['cards', 'Cards', <CardsGlyph key="d" />],
  ['more', 'More', <MoreGlyph key="m" />],
];

/** The labelled back button of a navigation bar, as the mock pages draw it. */
export function BackButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn plain" style={{ paddingLeft: 0 }}>
      <span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>{label}
    </button>
  );
}

/** A list row in a picture. `cue` draws the soft ring around the row being touched. */
export function Row({ cue, children }: { cue?: boolean; children: ReactNode }) {
  return <div className={`lpv-row${cue ? ' lpv-cue' : ''}`}>{children}</div>;
}

/** The phone and the one control being touched, which the stylesheet rings (`cue` names it). */
export function VaultDevice({ cue, children }: { cue?: string; children: ReactNode }) {
  return <div className="lpv-dev" data-cue={cue}>{children}</div>;
}

/** The large title of a list screen. */
export const ScreenTitle = ({ children }: { children: ReactNode }) => <div className="lt"><div className="t">{children}</div></div>;

/** For the one library prop that insists on a handler to draw its button (the editor's Move to Recently Deleted). A picture never calls it. */
export const unused = () => {};
