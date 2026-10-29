import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const WHITE = 235;

// Charge une version reduite en niveaux de gris pour la detection.
async function loadGreyscale(file, maxSide = 1400) {
  const meta = await sharp(file).metadata();
  const scale = Math.min(1, maxSide / Math.max(meta.width, meta.height));
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const { data, info } = await sharp(file)
    .greyscale()
    .resize(w, h)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    fullWidth: meta.width,
    fullHeight: meta.height,
    scale: info.width / meta.width,
  };
}

function isBlankRow(g, y, ratio = 0.93) {
  let bright = 0;
  for (let x = 0; x < g.width; x++) if (g.data[y * g.width + x] >= WHITE) bright++;
  return bright / g.width >= ratio;
}

function isBlankCol(g, x, y0, y1, ratio = 0.93) {
  let bright = 0;
  const n = y1 - y0;
  for (let y = y0; y < y1; y++) if (g.data[y * g.width + x] >= WHITE) bright++;
  return n > 0 && bright / n >= ratio;
}

function findRowGaps(g, y0, y1) {
  const gaps = [];
  let start = -1;
  const minRun = Math.max(3, Math.round(g.height * 0.008));
  for (let y = y0; y < y1; y++) {
    if (isBlankRow(g, y)) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start >= minRun) gaps.push([start, y]);
      start = -1;
    }
  }
  if (start >= 0 && y1 - start >= minRun) gaps.push([start, y1]);
  return gaps;
}

function findColGaps(g, x0, x1, y0, y1) {
  const gaps = [];
  let start = -1;
  const minRun = Math.max(3, Math.round(g.width * 0.008));
  for (let x = x0; x < x1; x++) {
    if (isBlankCol(g, x, y0, y1)) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start >= minRun) gaps.push([start, x]);
      start = -1;
    }
  }
  if (start >= 0 && x1 - start >= minRun) gaps.push([start, x1]);
  return gaps;
}

// XY-cut recursif : decoupe d'abord par bandes horizontales blanches,
// puis chaque bande par colonnes blanches, profondeur limitee.
function xyCut(g, x0, y0, x1, y1, depth, out) {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < g.width * 0.08 || h < g.height * 0.05 || depth > 4) {
    out.push({ x: x0, y: y0, w, h });
    return;
  }
  const rowGaps = findRowGaps(g, y0, y1);
  if (rowGaps.length > 0) {
    let prev = y0;
    const bands = [];
    for (const [gs, ge] of rowGaps) {
      if (gs - prev > g.height * 0.05) bands.push([prev, gs]);
      prev = ge;
    }
    if (y1 - prev > g.height * 0.05) bands.push([prev, y1]);
    if (bands.length > 1) {
      for (const [by0, by1] of bands) xyCut(g, x0, by0, x1, by1, depth + 1, out);
      return;
    }
  }
  const colGaps = findColGaps(g, x0, x1, y0, y1);
  if (colGaps.length > 0) {
    let prev = x0;
    const strips = [];
    for (const [gs, ge] of colGaps) {
      if (gs - prev > g.width * 0.06) strips.push([prev, gs]);
      prev = ge;
    }
    if (x1 - prev > g.width * 0.06) strips.push([prev, x1]);
    if (strips.length > 1) {
      for (const [sx0, sx1] of strips) xyCut(g, sx0, y0, sx1, y1, depth + 1, out);
      return;
    }
  }
  out.push({ x: x0, y: y0, w, h });
}

function inRect(a, b, margin = 0) {
  return (
    a.x >= b.x - margin &&
    a.y >= b.y - margin &&
    a.x + a.w <= b.x + b.w + margin &&
    a.y + a.h <= b.y + b.h + margin
  );
}

// Detection des bulles : composantes claires par parcours BFS.
export async function detectBubbles(file, g) {
  const visited = new Uint8Array(g.width * g.height);
  const bubbles = [];
  const minArea = g.width * g.height * 0.003;
  const maxArea = g.width * g.height * 0.25;
  const queue = new Int32Array(g.width * g.height);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const start = y * g.width + x;
      if (visited[start] || g.data[start] < 200) continue;
      let qs = 0;
      let qe = 0;
      queue[qe++] = start;
      visited[start] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0, bright = 0;
      while (qs < qe) {
        const idx = queue[qs++];
        const px = idx % g.width;
        const py = (idx / g.width) | 0;
        area++;
        if (g.data[idx] >= WHITE) bright++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px > 0 && !visited[idx - 1] && g.data[idx - 1] >= 200) { visited[idx - 1] = 1; queue[qe++] = idx - 1; }
        if (px < g.width - 1 && !visited[idx + 1] && g.data[idx + 1] >= 200) { visited[idx + 1] = 1; queue[qe++] = idx + 1; }
        if (py > 0 && !visited[idx - g.width] && g.data[idx - g.width] >= 200) { visited[idx - g.width] = 1; queue[qe++] = idx - g.width; }
        if (py < g.height - 1 && !visited[idx + g.width] && g.data[idx + g.width] >= 200) { visited[idx + g.width] = 1; queue[qe++] = idx + g.width; }
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const fill = bright / (w * h);
      // une bulle : zone claire, assez remplie, pas trop grande, plus large que haute
      if (area >= minArea && area <= maxArea && fill >= 0.55 && h < g.height * 0.4 && w > h * 0.5) {
        bubbles.push({ x: minX, y: minY, w, h, fill });
      }
    }
  }
  return bubbles;
}

// Ordre de lecture : lignes de haut en bas ; dans une ligne,
// gauche -> droite (occidental) ou droite -> gauche (manga).
export function orderRegions(regions, reading = 'western') {
  const sorted = [...regions].sort((a, b) => a.y - b.y);
  const lines = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const ref = l[0];
      const overlap = Math.min(ref.y + ref.h, r.y + r.h) - Math.max(ref.y, r.y);
      return overlap > Math.min(ref.h, r.h) * 0.4;
    });
    if (line) line.push(r);
    else lines.push([r]);
  }
  const ordered = [];
  for (const line of lines) {
    line.sort((a, b) => (reading === 'manga' ? b.x - a.x : a.x - b.x));
    ordered.push(...line);
  }
  return ordered;
}

export async function ocrRegion(worker, file, rect) {
  const buf = await sharp(file)
    .extract({
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
    })
    .grayscale()
    .normalize()
    .toBuffer();
  const { data } = await worker.recognize(buf);
  const text = String(data.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, confidence: data.confidence || 0 };
}

// Analyse complete d'une page source.
// Retourne les scenes brutes : bulles OCR + cases sans bulle (ambiance).
export async function analyzePage(file, reading = 'western') {
  const g = await loadGreyscale(file);
  const panels = [];
  xyCut(g, 0, 0, g.width, g.height, 0, panels);
  // dedoublonner les rectangles tres proches
  const clean = [];
  for (const p of panels) {
    const dup = clean.find((q) =>
      Math.abs(q.x - p.x) < g.width * 0.03 &&
      Math.abs(q.y - p.y) < g.height * 0.03 &&
      Math.abs(q.w - p.w) < g.width * 0.05 &&
      Math.abs(q.h - p.h) < g.height * 0.05
    );
    if (!dup) clean.push(p);
  }
  if (clean.length === 0) clean.push({ x: 0, y: 0, w: g.width, h: g.height });

  const bubbles = await detectBubbles(file, g);
  const worker = await createWorker('fra');

  const scenes = [];
  const usedBubbles = new Set();
  for (const panel of clean) {
    const panelBubbles = bubbles.filter(
      (b) => inRect(b, panel, g.width * 0.02) && !usedBubbles.has(b)
    );
    if (panelBubbles.length === 0) {
      // case sans bulle -> scene d'ambiance sur la case entiere
      scenes.push({ kind: 'ambiance', crop: rectToFractions(panel, g), dialogue: '' });
      continue;
    }
    const ordered = orderRegions(panelBubbles, reading);
    for (const b of ordered) {
      usedBubbles.add(b);
      // recadrage : la bulle elargie pour garder le dessin autour
      const pad = Math.max(6, Math.round(g.height * 0.02));
      const rx = Math.max(panel.x, b.x - pad);
      const ry = Math.max(panel.y, b.y - pad * 3);
      const rw = Math.min(panel.x + panel.w - rx, b.w + pad * 2);
      const rh = Math.min(panel.y + panel.h - ry, b.h + pad * 4);
      const rect = { x: rx, y: ry, w: rw, h: rh };
      const ocr = await ocrRegion(worker, file, {
        x: Math.round(b.x / g.scale),
        y: Math.round(b.y / g.scale),
        w: Math.round(b.w / g.scale),
        h: Math.round(b.h / g.scale),
      });
      scenes.push({ kind: 'dialogue', crop: rectToFractions(rect, g), dialogue: ocr.text, ocrConfidence: ocr.confidence });
    }
  }
  await worker.terminate();
  return scenes;
}

function rectToFractions(rect, g) {
  return {
    cx: Math.min(1, Math.max(0, (rect.x + rect.w / 2) / g.width)),
    cy: Math.min(1, Math.max(0, (rect.y + rect.h / 2) / g.height)),
    cw: Math.min(1, rect.w / g.width),
    ch: Math.min(1, rect.h / g.height),
  };
}
