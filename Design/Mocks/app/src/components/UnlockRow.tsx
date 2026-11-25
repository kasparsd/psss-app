/**
 * The password field and the button row of every unlock form (owner, 2026-11-25): Unlock and Use Touch ID (or Face ID) under the field, Unlock first (owner, 2026-11-25): the password is the main way in, Touch ID the alternative people reach for second. Mac and iPad: ONE row, [Unlock] [Use Touch ID]; iPhone: Unlock above, Use Face ID below.
 * Unlock is the default button (accent fill; Return presses it) and is disabled until something is typed. In macOS alerts the default button sits on the trailing side, but this is an in-window form, not an alert. Use Touch ID is a normal push button; it brings the system prompt back after it was cancelled.
 * On the Mac the system prompt (“Psss wants to unlock Passwords”) appears by itself when the window becomes active and Touch ID is on; iPhone and iPad keep their own idiom (Face ID starts by itself).
 */
export function PasswordField({ value, onChange, dim }: { value: string; onChange: (v: string) => void; dim?: boolean }) {
  return (
    <input className="lk-field" type="password" value={value} placeholder="Vault Password" aria-label="Vault Password" autoComplete="off" disabled={dim}
      style={dim ? { opacity: 0.5, borderColor: 'var(--sep)' } : undefined} onChange={(e) => onChange(e.target.value)} />
  );
}

export function UnlockRow({ bio, typed, busy, onUnlock, onBio }: { bio?: 'Touch ID' | 'Face ID'; typed: boolean; busy?: boolean; onUnlock?: () => void; onBio?: () => void }) {
  return (
    <div className="lk-btnrow">
      <button className="btn pri" disabled={!typed || busy} onClick={onUnlock}>Unlock</button>
      {bio && <button className="btn sq" onClick={onBio}>Use {bio}</button>}
    </div>
  );
}
