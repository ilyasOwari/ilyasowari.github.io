// Pure helpers: how a table grows horizontally inside / below a text frame.

// 'center' (grow equally to both sides), 'right' (table hugs the text's left edge), 'left' (hugs the right edge)
export function classifyTableExpandMode({ initLeft, initW, refL, refR }) {
  const tblR = initLeft + initW;
  const refW = Math.max(1, refR - refL);
  const leftGap = Math.max(0, initLeft - refL);
  const rightGap = Math.max(0, refR - tblR);
  const nearEdge = Math.max(16, refW * 0.08);
  if (leftGap + rightGap < 4) return 'center';
  if (leftGap <= nearEdge && rightGap > leftGap * 1.8 + 12) return 'right';
  if (rightGap <= nearEdge && leftGap > rightGap * 1.8 + 12) return 'left';
  return 'center';
}

export function computeTableHorizontalLayout({ initLeft, initW, rawTotalW, expandMode = 'center', minPageX, maxPageX, manualWiden = false, pageW = 595 }) {
  const loX = manualWiden ? 6 : minPageX;
  const hiX = manualWiden ? (pageW - 6) : maxPageX;
  const tblCenter = initLeft + initW * 0.5;
  const tblRight = initLeft + initW;
  if (Math.abs(rawTotalW - initW) < 1.5) return { startX: initLeft, maxTotalW: Math.max(initW, hiX - loX), clamped: false };
  if (expandMode === 'right') {
    const maxW = Math.max(initW, hiX - initLeft);
    if (!manualWiden && rawTotalW > maxW) return { startX: initLeft, maxTotalW: maxW, clamped: true };
    const startX = initLeft + rawTotalW > hiX ? Math.max(loX, hiX - rawTotalW) : initLeft;
    return { startX, maxTotalW: maxW, clamped: false };
  }
  if (expandMode === 'left') {
    const maxW = Math.max(initW, tblRight - loX);
    if (!manualWiden && rawTotalW > maxW) return { startX: Math.max(loX, tblRight - maxW), maxTotalW: maxW, clamped: true };
    return { startX: Math.max(loX, tblRight - rawTotalW), maxTotalW: maxW, clamped: false };
  }
  const maxHalf = Math.min(tblCenter - loX, hiX - tblCenter);
  const maxSymW = Math.max(initW, Math.min(hiX - loX, maxHalf * 2));
  if (!manualWiden && rawTotalW > maxSymW) {
    const sx = Math.max(loX, Math.min(hiX - maxSymW, tblCenter - maxSymW * 0.5));
    return { startX: sx, maxTotalW: maxSymW, clamped: true };
  }
  let startX = tblCenter - rawTotalW * 0.5;
  if (startX + rawTotalW > hiX) startX = hiX - rawTotalW;
  if (startX < loX) startX = loX;
  return { startX, maxTotalW: maxSymW, clamped: false };
}
