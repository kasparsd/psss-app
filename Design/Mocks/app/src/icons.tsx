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
export const ClockIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const StarIcon = () => (
  <svg {...base}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /></svg>
);
// Tab glyphs
export const AllGlyph = () => (
  <svg {...base}><rect x="4" y="4" width="16" height="4.5" rx="1.5" /><rect x="4" y="10" width="16" height="4.5" rx="1.5" /><rect x="4" y="16" width="16" height="4" rx="1.5" /></svg>
);
export const CodesGlyph = () => (
  <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 1.8" /></svg>
);
export const CardsGlyph = () => (
  <svg {...base}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>
);
