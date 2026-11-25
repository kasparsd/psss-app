import { FaceGlyph, Fingerprint } from '../pages/UnlockScreen';

/**
 * The system's Face ID or Touch ID prompt, drawn over a screen (AutoFill and browser stories). `device` is where it sits: on iPhone it dims the
 * sheet it belongs to and shows a small card in the middle; on the Mac it is a dialog over the page, because the popup has already closed.
 * It is the system's, not Psss's: the words are `reason`. `sheet` (Mac): the dialog hangs from the top of the window it belongs to, as the system's sheet does, over the unlock form.
 */
export function BioPrompt({ bio, reason, mac, sheet }: { bio: 'Face ID' | 'Touch ID'; reason: string; mac?: boolean; sheet?: boolean }) {
  const glyph = <span style={{ display: 'inline-grid', width: mac ? 36 : 48, height: mac ? 36 : 48, color: 'var(--accent)' }}>{bio === 'Face ID' ? <FaceGlyph /> : <Fingerprint />}</span>;
  return (
    <div style={{ position: 'absolute', inset: 0, background: mac ? 'transparent' : 'var(--dim)', display: 'grid', placeItems: sheet ? 'start center' : 'center', zIndex: 80, pointerEvents: sheet ? 'none' : undefined }} role="dialog" aria-label={bio}>
      <div style={{ width: mac ? 280 : 200, borderRadius: sheet ? '0 0 14px 14px' : mac ? 14 : 24, background: 'var(--glass)', backdropFilter: 'blur(20px)', boxShadow: 'var(--shadow)', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
        {glyph}
        <div className="t">{bio}</div>
        <div className="s">{reason}</div>
        {mac && <button className="btn sq" style={{ pointerEvents: 'auto' }}>Cancel</button>}
      </div>
    </div>
  );
}
