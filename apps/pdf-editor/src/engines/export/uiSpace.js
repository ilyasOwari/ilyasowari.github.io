// helpers for drawing in page-UI coordinates (y down) inside a PDF page
import { fmtNum as f } from '../pdf/lexer.js';
export const mstrOf = (m) => m.map(f).join(' ');
