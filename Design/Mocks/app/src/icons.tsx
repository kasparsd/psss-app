import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const CopyIcon = () => (
  <svg {...base}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.2}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);
export const EyeIcon = () => (
  <svg {...base} viewBox="0 0 24 16"><path d="M1.5 8S5.5 1.5 12 1.5 22.5 8 22.5 8 18.5 14.5 12 14.5 1.5 8 1.5 8z" /><circle cx="12" cy="8" r="3" /></svg>
);
export const EyeOffIcon = () => (
  <svg {...base} viewBox="0 0 24 16"><path d="M1.5 8S5.5 1.5 12 1.5 22.5 8 22.5 8 18.5 14.5 12 14.5 1.5 8 1.5 8z" /><circle cx="12" cy="8" r="3" /><path d="M3 15L21 1" /></svg>
);
export const InfoIcon = () => (
  <svg {...base} strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></svg>
);
export const SearchIcon = () => (
  <svg {...base} strokeWidth={2.2}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></svg>
);
export const SidebarIcon = () => (
  <svg {...base}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M9 4.5v15" /></svg>
);
export const GearIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
);
export const ChevronIcon = () => (
  <svg {...base} strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
);
export const BackIcon = () => (
  <svg {...base} strokeWidth={2}><path d="M15 5l-7 7 7 7" /></svg>
);
export const CloseIcon = () => (
  <svg {...base} strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
// Tab glyphs
export const AllGlyph = () => (
  <svg {...base}><rect x="3.5" y="9" width="13" height="11.5" rx="2.5" /><path d="M7 6h10.5a3 3 0 0 1 3 3v8.5" /></svg>
);
export const CodesGlyph = () => (
  <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 1.8" /></svg>
);
export const CardsGlyph = () => (
  <svg {...base}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>
);
// Proposal 2026-11-24: filled glyphs for what a login has, and the sort symbol.
export const PasskeyGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="9" cy="7" r="4" />
    <path d="M2 20.5c0-3.9 3.1-6.5 7-6.5 1.4 0 2.7.3 3.8.9-.5.9-.8 1.9-.8 3 0 .9.2 1.8.6 2.6z" />
    <path fillRule="evenodd" d="M18.5 10.5a3.5 3.5 0 0 0-1.25 6.77v4.23l1.25 1.25 1.25-1.25v-1l-.75-.75.75-.75v-1.73a3.5 3.5 0 0 0-1.25-6.77zm0 1.7a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z" />
  </svg>
);
export const CodeTraitGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" fillRule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-.9 4.2h1.8v4.3l3 1.7-.9 1.56-3.9-2.2z" />
  </svg>
);
export const SortIcon = () => (
  <svg {...base} strokeWidth={2}><path d="M8 19V5M8 5L4.5 8.5M8 5l3.5 3.5M16 5v14M16 19l-3.5-3.5M16 19l3.5-3.5" /></svg>
);
// Proposal 2026-11-24 (one list): the filter symbol and a plus.
export const FilterIcon = () => (
  <svg {...base} strokeWidth={2}><path d="M4 7h16M7 12h10M10 17h4" /></svg>
);

// Proposal 2026-11-24: places beyond the three tabs of today.
export const WifiGlyph = () => (
  <svg {...base}><path d="M2.5 9.5a14 14 0 0 1 19 0M5.5 13a9.5 9.5 0 0 1 13 0M8.6 16.4a5 5 0 0 1 6.8 0" /><circle cx="12" cy="19.5" r="1" fill="currentColor" /></svg>
);
export const TrashGlyph = () => (
  <svg {...base}><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" /></svg>
);
export const MoreGlyph = () => (
  <svg {...base}><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></svg>
);
