// Re-emits an original fill colour (exact operators) for redrawn text / fills.
import { serializeArg, fmtNum } from '../pdf/lexer.js';

export function fillColorOps(fill, rgbFallback, csAvailable) {
  if (!fill) return rgbOps(rgbFallback);
  const args = (fill.args || []).map(serializeArg).join(' ');
  if (fill.op === 'g' || fill.op === 'rg' || fill.op === 'k') return `${args} ${fill.op}`;
  if ((fill.op === 'sc' || fill.op === 'scn') && fill.cs) {
    if (/^Device/.test(fill.cs)) return `/${fill.cs} cs ${args} ${fill.op}`;
    if (csAvailable(fill.cs)) return `/${fill.cs} cs ${args} ${fill.op}`;
  }
  return rgbOps(rgbFallback);
}
export function rgbOps(rgb) {
  if (!rgb) return '0 g';
  return `${fmtNum(rgb[0] / 255)} ${fmtNum(rgb[1] / 255)} ${fmtNum(rgb[2] / 255)} rg`;
}
