import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { InfoIcon } from '../icons';

export interface HelpTopic {
  title: string;
  text: string;
  /** At most one reviewed link, marked with an arrow. */
  link?: string;
}

/** The reviewed topics. One source, so every frame says the same thing. */
export const topics = {
  setupKey: {
    title: 'Setup key',
    text: 'When you turn on two-step verification, a site shows a QR code or a setup key. Psss turns it into the six-digit codes, so you do not need a separate app. Keep it secret: anyone who has it can make your codes.',
    link: 'How to add a code',
  },
  passkey: {
    title: 'Passkey',
    text: 'A sign-in without a password that only works on the real site.',
    link: 'About passkeys',
  },
  clipboard: {
    title: 'Copies leave the clipboard',
    text: 'Other apps can read the clipboard, so Psss clears what it copied after 60 seconds. Universal Clipboard is off for copies from Psss.',
  },
} satisfies Record<string, HelpTopic>;

/**
 * The info button. A popover with a title, the explanation and at most one
 * link, leading-aligned in the accent colour. The bubble keeps itself inside
 * the nearest device frame (`.dt`'s positioned ancestor).
 */
export function InfoButton({ topic, open: open0 = false, tip }: { topic: HelpTopic; open?: boolean; tip?: string }) {
  const [open, setOpen] = useState(open0);
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !wrap.current || !bubble.current) return;
    const frame = wrap.current.closest<HTMLElement>('[data-bounds]');
    if (!frame) return;
    const f = frame.getBoundingClientRect();
    const w = wrap.current.getBoundingClientRect();
    const bw = bubble.current.offsetWidth;
    const centre = w.left + w.width / 2;
    const left = Math.max(f.left + 14, Math.min(centre - bw / 2, f.right - 14 - bw));
    bubble.current.style.left = `${left - w.left}px`;
    bubble.current.style.setProperty('--ax', `${centre - left}px`);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <span className="infowrap" ref={wrap}>
      <button className="infob" onClick={() => setOpen(!open)} aria-label={tip ?? `About ${topic.title.toLowerCase()}`} data-tip={tip ?? `About ${topic.title.toLowerCase()}`} aria-expanded={open}>
        <InfoIcon />
      </button>
      {open && (
        <div className="bubble" ref={bubble} role="dialog" aria-label={topic.title}>
          <div className="t">{topic.title}</div>
          <div>{topic.text}</div>
          {topic.link && <button className="linkbtn">{topic.link}&nbsp;↗</button>}
        </div>
      )}
    </span>
  );
}
