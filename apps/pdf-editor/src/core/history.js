// Patch-based undo/redo: every entry stores the plain-data state of ONE page
// before and after the change (block lists are small JSON, no images).
const LIMIT = 200;

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() { const e = this.undoStack.pop(); if (e) this.redoStack.push(e); return e; }
  redo() { const e = this.redoStack.pop(); if (e) this.undoStack.push(e); return e; }
  clear() { this.undoStack = []; this.redoStack = []; }
}

export function snapshotPage(p) {
  return structuredClone({ blocks: p.blocks, deleted: p.deleted, erase: p.erase, whiteBg: p.whiteBg, keepOriginal: p.keepOriginal || [] });
}
export function restorePage(p, snap) {
  const s = structuredClone(snap);
  p.blocks = s.blocks; p.deleted = s.deleted; p.erase = s.erase; p.whiteBg = s.whiteBg; p.keepOriginal = s.keepOriginal || [];
  p.version = (p.version || 0) + 1;
}
