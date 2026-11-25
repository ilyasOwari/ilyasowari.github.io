// OpenXML (.docx) template and element builders for WordprocessingML + DrawingML.
export const ptToTwip = (pt) => Math.max(0, Math.round((pt || 0) * 20));
export const ptToEmu = (pt) => Math.round((pt || 0) * 12700);
export const ptToHalfPt = (pt) => Math.max(2, Math.round((pt || 11) * 2));

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));

export function escXml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function rgbToHex6(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  return rgb.slice(0, 3).map((v) => clampByte(v).toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function fillToHex6(fill, fallback = '000000') {
  if (!fill) return fallback;
  if (typeof fill === 'string') {
    const m = fill.trim().match(/^#?([0-9a-f]{6})$/i);
    return m ? m[1].toUpperCase() : fallback;
  }
  if (Array.isArray(fill)) return rgbToHex6(fill) || fallback;
  const args = Array.isArray(fill.args) ? fill.args : null;
  if (!args || !args.length) return fallback;
  const op = fill.op;
  if (op === 'g' || op === 'G') {
    const g = clampByte(args[0] * 255);
    return rgbToHex6([g, g, g]);
  }
  if ((op === 'rg' || op === 'RG') && args.length >= 3) {
    return rgbToHex6([args[0] * 255, args[1] * 255, args[2] * 255]);
  }
  if ((op === 'k' || op === 'K') && args.length >= 4) {
    const [c, m, y, k] = args;
    return rgbToHex6([
      (1 - c) * (1 - k) * 255,
      (1 - m) * (1 - k) * 255,
      (1 - y) * (1 - k) * 255,
    ]);
  }
  if ((op === 'sc' || op === 'scn') && args.length === 1) {
    const g = clampByte(args[0] * 255);
    return rgbToHex6([g, g, g]);
  }
  if ((op === 'sc' || op === 'scn') && args.length >= 3) {
    return rgbToHex6([args[0] * 255, args[1] * 255, args[2] * 255]);
  }
  return fallback;
}

export function contentTypesXml({ hasPng = false, hasJpg = false } = {}) {
  const pngDef = hasPng ? '<Default Extension="png" ContentType="image/png"/>' : '';
  const jpgDef = hasJpg ? '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + pngDef
    + jpgDef
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';
}

export function rootRelsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';
}

export function docRelsXml(media = []) {
  const extra = media.map((m) => (
    `<Relationship Id="${escXml(m.rId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escXml(m.fileName)}"/>`
  )).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + extra
    + '</Relationships>';
}

export function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults>'
    + '<w:rPrDefault><w:rPr>'
    + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
    + '<w:sz w:val="22"/><w:szCs w:val="22"/>'
    + '</w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    + '</w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    + '<w:name w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    + '</w:style>'
    + '</w:styles>';
}

export function sectionPrXml(wPt, hPt, marPt = 36) {
  const orient = wPt > hPt ? ' w:orient="landscape"' : '';
  const m = ptToTwip(marPt);
  return `<w:sectPr><w:pgSz w:w="${ptToTwip(wPt)}" w:h="${ptToTwip(hPt)}"${orient}/>`
    + `<w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="0" w:footer="0" w:gutter="0"/>`
    + '</w:sectPr>';
}

function jcVal(align) {
  if (align === 'center') return 'center';
  if (align === 'right') return 'right';
  if (align === 'justify') return 'both';
  return 'left';
}

export function paraXml(p) {
  const jc = jcVal(p.align);
  const firstInd = p.firstIndentPt ? ` w:firstLine="${ptToTwip(p.firstIndentPt)}"` : '';
  const leftInd = p.leftIndentPt ? ` w:left="${ptToTwip(p.leftIndentPt)}"` : '';
  const ind = (firstInd || leftInd) ? `<w:ind${leftInd}${firstInd}/>` : '';
  const spBefore = ptToTwip(p.spaceBeforePt || 0);
  const spAfter = ptToTwip(p.spaceAfterPt || 0);
  const spLine = p.lineStepPt > 0
    ? ` w:line="${ptToTwip(p.lineStepPt)}" w:lineRule="exact"`
    : ' w:line="240" w:lineRule="auto"';
  const spacing = `<w:spacing w:before="${spBefore}" w:after="${spAfter}"${spLine}/>`;
  const pPr = `<w:pPr>${spacing}${ind}<w:jc w:val="${jc}"/></w:pPr>`;

  const runs = (p.runs || []).filter((r) => r.text !== undefined && r.text !== '').map((r) => {
    const fn = escXml(r.fontName || 'Calibri');
    const sz = ptToHalfPt(r.sizePt || 11);
    const b = r.bold ? '<w:b/><w:bCs/>' : '';
    const i = r.italic ? '<w:i/><w:iCs/>' : '';
    const color = r.colorHex ? `<w:color w:val="${escXml(r.colorHex)}"/>` : '';
    const u = r.underline ? '<w:u w:val="single"/>' : '';
    return `<w:r><w:rPr><w:rFonts w:ascii="${fn}" w:hAnsi="${fn}" w:cs="${fn}"/>${b}${i}${color}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${u}</w:rPr>`
      + `<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');

  return `<w:p>${pPr}${runs}</w:p>`;
}

export function anchorTextBoxXml(box, paras, id) {
  const xEmu = ptToEmu(box.x);
  const yEmu = ptToEmu(box.y);
  const cx = Math.max(12700, ptToEmu(box.w));
  const cy = Math.max(12700, ptToEmu(box.h));
  const content = paras.length ? paras.map(paraXml).join('') : '<w:p/>';
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing>`
    + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
    + '<wp:simplePos x="0" y="0"/>'
    + `<wp:positionH relativeFrom="page"><wp:posOffset>${xEmu}</wp:posOffset></wp:positionH>`
    + `<wp:positionV relativeFrom="page"><wp:posOffset>${yEmu}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + '<wp:wrapNone/>'
    + `<wp:docPr id="${id}" name="TextBox ${id}"/>`
    + '<wp:cNvGraphicFramePr/>'
    + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
    + '<wps:wsp><wps:cNvSpPr txBox="1"/>'
    + `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>'
    + `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>`
    + '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:spAutoFit/></wps:bodyPr>'
    + '</wps:wsp></a:graphicData></a:graphic>'
    + '</wp:anchor></w:drawing></w:r></w:p>';
}

function borderTag(tag, on, szEighthPt, colorHex) {
  if (!on) return `<w:${tag} w:val="none"/>`;
  return `<w:${tag} w:val="single" w:sz="${szEighthPt}" w:space="0" w:color="${escXml(colorHex)}"/>`;
}

export function tableXml(tbl) {
  const totalTwip = tbl.colWidthsPt.reduce((s, w) => s + ptToTwip(w), 0);
  const sz = Math.max(2, Math.round((tbl.borderWidthPt ?? 0.75) * 8));
  const bHex = tbl.borderHex || 'CBD5E1';
  const outOn = tbl.outerBorder !== false && sz > 0;
  const inHOn = tbl.innerH !== false && sz > 0;
  const inVOn = tbl.innerV !== false && sz > 0;
  const borders = '<w:tblBorders>'
    + borderTag('top', outOn, sz, bHex)
    + borderTag('left', outOn, sz, bHex)
    + borderTag('bottom', outOn, sz, bHex)
    + borderTag('right', outOn, sz, bHex)
    + borderTag('insideH', inHOn, sz, bHex)
    + borderTag('insideV', inVOn, sz, bHex)
    + '</w:tblBorders>';
  const tblPr = '<w:tblPr>'
    + `<w:tblW w:w="${totalTwip}" w:type="dxa"/>`
    + borders
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar>'
    + '</w:tblPr>';
  const grid = '<w:tblGrid>' + tbl.colWidthsPt.map((w) => `<w:gridCol w:w="${ptToTwip(w)}"/>`).join('') + '</w:tblGrid>';
  const trs = tbl.rows.map((row, ri) => {
    const rh = ptToTwip(tbl.rowHeightsPt[ri] || 18);
    const tcs = row.map((cell, ci) => {
      const cw = ptToTwip(tbl.colWidthsPt[ci] || 40);
      const shd = cell.fillHex ? `<w:shd w:val="clear" w:color="auto" w:fill="${escXml(cell.fillHex)}"/>` : '';
      const va = cell.vAlign === 'top' || cell.vAlign === 'bottom' ? cell.vAlign : 'center';
      const inner = cell.paras && cell.paras.length ? cell.paras.map(paraXml).join('') : '<w:p/>';
      return `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${shd}<w:vAlign w:val="${va}"/></w:tcPr>${inner}</w:tc>`;
    }).join('');
    return `<w:tr><w:trPr><w:trHeight w:val="${rh}" w:hRule="atLeast"/></w:trPr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl>${tblPr}${grid}${trs}</w:tbl>`
    + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
}

export function layoutRowTableXml(cols, pageContentW) {
  const totalTwip = ptToTwip(pageContentW);
  const borders = '<w:tblBorders>'
    + borderTag('top', false, 0, 'FFFFFF')
    + borderTag('left', false, 0, 'FFFFFF')
    + borderTag('bottom', false, 0, 'FFFFFF')
    + borderTag('right', false, 0, 'FFFFFF')
    + borderTag('insideH', false, 0, 'FFFFFF')
    + borderTag('insideV', false, 0, 'FFFFFF')
    + '</w:tblBorders>';
  const tblPr = '<w:tblPr>'
    + `<w:tblW w:w="${totalTwip}" w:type="dxa"/>`
    + borders
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>'
    + '</w:tblPr>';
  const grid = '<w:tblGrid>' + cols.map((c) => `<w:gridCol w:w="${ptToTwip(c.widthPt)}"/>`).join('') + '</w:tblGrid>';
  const tcs = cols.map((c) => {
    const cw = ptToTwip(c.widthPt);
    const inner = c.innerXml || '<w:p/>';
    return `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${inner}</w:tc>`;
  }).join('');
  return `<w:tbl>${tblPr}${grid}<w:tr>${tcs}</w:tr></w:tbl>`
    + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
}

export function inlineImageXml(img, id) {
  const cx = Math.max(12700, ptToEmu(img.w));
  const cy = Math.max(12700, ptToEmu(img.h));
  const jc = img.align === 'center' ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  return `<w:p>${jc}<w:r><w:drawing>`
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + `<wp:docPr id="${id}" name="Picture ${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${escXml(img.rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic>'
    + '</wp:inline></w:drawing></w:r></w:p>';
}

export function anchorImageXml(img, id) {
  const xEmu = ptToEmu(img.x);
  const yEmu = ptToEmu(img.y);
  const cx = Math.max(12700, ptToEmu(img.w));
  const cy = Math.max(12700, ptToEmu(img.h));
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing>`
    + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
    + '<wp:simplePos x="0" y="0"/>'
    + `<wp:positionH relativeFrom="page"><wp:posOffset>${xEmu}</wp:posOffset></wp:positionH>`
    + `<wp:positionV relativeFrom="page"><wp:posOffset>${yEmu}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + '<wp:wrapNone/>'
    + `<wp:docPr id="${id}" name="Picture ${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${escXml(img.rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic>'
    + '</wp:anchor></w:drawing></w:r></w:p>';
}

export function itemBounds(it) {
  if (it.kind === 'textbox') return it.box;
  if (it.kind === 'image') return it.img;
  const t = it.table;
  return {
    x: t.x || 0,
    y: t.y || 0,
    w: (t.colWidthsPt || []).reduce((a, c) => a + c, 0),
    h: (t.rowHeightsPt || []).reduce((a, c) => a + c, 0),
  };
}

export function renderFlowItems(items, pageW, nextId) {
  if (!items.length) return '<w:p/>';
  const sorted = items.map((it) => ({ it, r: itemBounds(it) }))
    .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x));
  const bands = [];
  for (const entry of sorted) {
    const last = bands[bands.length - 1];
    if (last && entry.r.y < last.maxY - 4) {
      last.entries.push(entry);
      last.maxY = Math.max(last.maxY, entry.r.y + entry.r.h);
    } else {
      bands.push({ entries: [entry], maxY: entry.r.y + entry.r.h });
    }
  }
  const pageContentW = Math.max(120, (pageW || 595) - 72);
  const renderOne = (it, centerOnPage) => {
    if (it.kind === 'textbox') return it.paras.map(paraXml).join('');
    if (it.kind === 'table') return tableXml(it.table);
    if (it.kind === 'image') {
      const centered = centerOnPage && Math.abs((it.img.x + it.img.w / 2) - (pageW || 595) / 2) < 28;
      return inlineImageXml(centered ? { ...it.img, align: 'center' } : it.img, nextId());
    }
    return '';
  };
  const out = [];
  for (const band of bands) {
    if (band.entries.length === 1) {
      out.push(renderOne(band.entries[0].it, true));
      continue;
    }
    const cols = [];
    for (const entry of band.entries.slice().sort((a, b) => a.r.x - b.r.x)) {
      const hit = cols.find((c) => Math.min(c.x1, entry.r.x + entry.r.w) - Math.max(c.x0, entry.r.x) > 4);
      if (hit) {
        hit.entries.push(entry);
        hit.x0 = Math.min(hit.x0, entry.r.x);
        hit.x1 = Math.max(hit.x1, entry.r.x + entry.r.w);
      } else {
        cols.push({ x0: entry.r.x, x1: entry.r.x + entry.r.w, entries: [entry] });
      }
    }
    if (cols.length <= 1) {
      for (const e of band.entries) out.push(renderOne(e.it, true));
      continue;
    }
    cols.sort((a, b) => a.x0 - b.x0);
    const rawWs = cols.map((c) => Math.max(40, c.x1 - c.x0));
    const sumW = rawWs.reduce((a, b) => a + b, 0) || 1;
    const layoutCols = cols.map((c, idx) => {
      c.entries.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
      return {
        widthPt: Math.max(40, (rawWs[idx] / sumW) * pageContentW),
        innerXml: c.entries.map((e) => renderOne(e.it, false)).join('') || '<w:p/>',
      };
    });
    out.push(layoutRowTableXml(layoutCols, pageContentW));
  }
  return out.join('');
}

export function documentXml(bodyXml) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document'
    + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
    + ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
    + ' xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"'
    + ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
    + ' xmlns:v="urn:schemas-microsoft-com:vml"'
    + ' mc:Ignorable="wp14">'
    + `<w:body>${bodyXml}</w:body>`
    + '</w:document>';
}
