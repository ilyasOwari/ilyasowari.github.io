// Ribbon layout: groups -> items. kind: big | stack(small items) | zoom | spacer
export const RIBBON = [
  { id: 'history', label: 'gHistory', items: [{ kind: 'stack', items: [{ cmd: 'undo', icon: 'undo', label: 'undo', tip: 'tipUndo' }, { cmd: 'redo', icon: 'redo', label: 'redo', tip: 'tipRedo' }] }] },
  { id: 'select', label: 'gSelect', items: [
    { cmd: 'tool:select', icon: 'pointer', label: 'select', tip: 'tipSelect' }] },
  { id: 'blocks', label: 'gBlocks', items: [
    { cmd: 'edit', icon: 'edit', label: 'edit', tip: 'tipEdit' },
    { cmd: 'delete', icon: 'trash', label: 'del', tip: 'tipDelete' },
    { cmd: 'tool:split', icon: 'split', label: 'split', tip: 'tipSplit' },
    { cmd: 'tool:crop', icon: 'crop', label: 'crop', tip: 'tipCrop' },
    { cmd: 'tool:cover', icon: 'cover', label: 'cover', tip: 'tipCover' },
    { cmd: 'tool:erase', icon: 'erase', label: 'erase', tip: 'tipErase' },
    { kind: 'stack', items: [{ cmd: 'merge', icon: 'merge', label: 'merge', tip: 'tipMerge' },
      { cmd: 'ungroup', icon: 'ungroup', label: 'ungroup', tip: 'tipUngroup' }] }] },
  { id: 'insert', label: 'gInsert', items: [
    { kind: 'stack', items: [{ cmd: 'insertText', icon: 'text', label: 'insertText', tip: 'tipInsertText' }, { cmd: 'insertImage', icon: 'image', label: 'insertImage', tip: 'tipInsertImage' }] },
    { cmd: 'insertTableMenu', icon: 'table', label: 'insertTable', tip: 'tipInsertTable' },
    { cmd: 'insertFlow', icon: 'toLayout', label: 'insertFlow', tip: 'tipInsertFlow' },
    { cmd: 'blankPage', icon: 'page', label: 'blankPage', tip: 'tipBlank' }] },
  { id: 'bg', label: 'gBg', items: [
    { cmd: 'bgMenu', icon: 'bgRemove', label: 'rbBgRemove', tip: 'tipBgRemove', menu: true },
    { cmd: 'whiteAll', icon: 'bgWhite', label: 'rbWhite', tip: 'tipWhiteAll' }] },
  { id: 'align', label: 'gAlign', items: [
    { cmd: 'alignCenter', icon: 'alignCenter', label: 'alignCenter', tip: 'tipAlignCenter' }] },
  { id: 'page', label: 'gPage', items: [
    { cmd: 'magnet', icon: 'magnet', label: 'magnet', tip: 'tipMagnet' },
    { cmd: 'lockPage', icon: 'lockPage', label: 'lockPage', tip: 'tipLockPage' },
    { cmd: 'pageNums', icon: 'pageNum', label: 'pageNums', tip: 'tipPageNums' },
    { cmd: 'scanPage', icon: 'scanText', label: 'scanPage', tip: 'tipScanPage' },
    { cmd: 'tool:scanArea', icon: 'marquee', label: 'scanArea', tip: 'tipScanArea' },
    { cmd: 'tool:restoreArea', icon: 'reset', label: 'restoreArea', tip: 'tipRestoreArea' },
    { cmd: 'resetPage', icon: 'reset', label: 'resetPage', tip: 'tipReset' },
    { cmd: 'beforeAfter', icon: 'beforeAfter', label: 'beforeAfter', tip: 'tipBefore', hold: true }] },
  { id: 'view', label: 'gView', items: [{ kind: 'zoom' }] },
  { kind: 'spacer' },
  { id: 'file', label: 'gFile', cls: 'rb-file', items: [
    { kind: 'stack', items: [{ cmd: 'open', icon: 'open', label: 'open', tip: 'tipOpen' }, { cmd: 'settings', icon: 'settings', label: 'settings', tip: 'tipSettings' }] },
    { cmd: 'save', icon: 'save', label: 'save', tip: 'tipSave', primary: true },
    { cmd: 'saveAs', icon: 'saveAs', label: 'saveAs', tip: 'tipSaveAs', menu: true }] },
];
