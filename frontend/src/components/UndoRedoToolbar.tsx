interface UndoRedoToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
}

/**
 * Compact undo/redo controls for the page editor.
 *
 * Counts are exposed visually (and via aria-label) so authors can see how many
 * steps are available. Keyboard shortcuts are wired in the editor; this toolbar
 * is the discoverable equivalent.
 */
export function UndoRedoToolbar({
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  onUndo,
  onRedo,
  disabled = false,
}: UndoRedoToolbarProps) {
  return (
    <div className="undo-redo" role="group" aria-label="Undo and redo">
      <button
        type="button"
        className="btn small"
        onClick={onUndo}
        disabled={disabled || !canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        aria-label={`Undo${undoCount ? ` (${undoCount} available)` : ''}`}
      >
        <span aria-hidden="true">↶</span> Undo
        <span className="undo-redo-count" aria-hidden="true">
          {undoCount}
        </span>
      </button>
      <button
        type="button"
        className="btn small"
        onClick={onRedo}
        disabled={disabled || !canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
        aria-label={`Redo${redoCount ? ` (${redoCount} available)` : ''}`}
      >
        <span aria-hidden="true">↷</span> Redo
        <span className="undo-redo-count" aria-hidden="true">
          {redoCount}
        </span>
      </button>
      <span className="muted small undo-redo-hint">
        Text edits coalesce for 750 ms; structural changes are separate steps.
      </span>
    </div>
  );
}
