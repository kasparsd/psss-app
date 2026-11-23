export function UndoBanner({ text, onUndo, above }: { text: string; onUndo?: () => void; above?: 'tabbar' }) {
  return (
    <div className={`undo${above ? ' above-tabbar' : ''}`} role="status">
      <span>{text}</span>
      <button className="btn" onClick={onUndo}>Undo</button>
    </div>
  );
}
