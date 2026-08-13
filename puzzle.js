/**
 * puzzle.js
 * Pure geometry + image utilities — no DOM state, no game state.
 *   - deterministic RNG (for the Daily Puzzle)
 *   - edge-map generation (which side of each piece is a tab / a socket / flat)
 *   - Path2D generation for a real interlocking jigsaw piece shape
 *   - image loading with EXIF-orientation correction + max-size downscaling
 *   - "object-fit: cover" style drawing so photos never get stretched
 */

// ---------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed => same sequence, used so
// the Daily Puzzle looks identical for every player on a given date.
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------
// Edge map: for an R x C grid, decide the tab/socket for every internal
// border. Border edges touching the outside of the image are flat (0).
// Internal vertical borders are shared between piece(r,c).right and
// piece(r,c+1).left (with opposite sign). Same for horizontal borders.
// ---------------------------------------------------------------------
function generateEdgeMap(rows, cols, rng) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols));
    for (let c = 0; c < cols; c++) {
      grid[r][c] = { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }
  // vertical internal borders -> left/right pairs
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const sign = rng() < 0.5 ? 1 : -1;
      grid[r][c].right = sign;
      grid[r][c + 1].left = -sign;
    }
  }
  // horizontal internal borders -> top/bottom pairs
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const sign = rng() < 0.5 ? 1 : -1;
      grid[r][c].bottom = sign;
      grid[r + 1][c].top = -sign;
    }
  }
  return grid;
}

// ---------------------------------------------------------------------
// Build a Path2D for one piece. (x,y,w,h) is the piece's own rectangular
// cell; the tabs/sockets bleed outside that rectangle by `bleed`, which
// callers must account for when clipping/painting so neighbours aren't
// cut off.
// ---------------------------------------------------------------------
function tabAmplitude(w, h) {
  return Math.min(w, h) * 0.28;
}

function edgeCurvePoints(len, amp, sign) {
  // Local coordinates: x along the edge [0, len], y perpendicular
  // (negative = outward / away from piece interior). sign: -1, 0, or 1.
  const t = amp * sign;
  if (sign === 0) {
    return [{ cp1: [len, 0], cp2: [len, 0], end: [len, 0] }];
  }
  const w = len;
  return [
    { cp1: [w * 0.34, 0], cp2: [w * 0.28, -t * 0.42], end: [w * 0.38, -t * 0.42] },
    { cp1: [w * 0.46, -t * 0.42], cp2: [w * 0.40, -t * 1.32], end: [w * 0.50, -t * 1.32] },
    { cp1: [w * 0.60, -t * 1.32], cp2: [w * 0.54, -t * 0.42], end: [w * 0.62, -t * 0.42] },
    { cp1: [w * 0.72, -t * 0.42], cp2: [w * 0.66, 0], end: [w, 0] }
  ];
}

/**
 * Draws one edge of the piece into `path`, going from `p0` to `p1`
 * (both {x,y} in global piece-space), bulging toward `interiorHint`
 * (the rectangle's center) when sign < 0 and away from it when sign > 0.
 */
function drawEdge(path, p0, p1, sign, amp, interiorHint) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len, dirY = dy / len;
  // two perpendicular candidates; pick the one pointing toward the interior
  const perpA = { x: -dirY, y: dirX };
  const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2;
  const towardInteriorX = interiorHint.x - midX, towardInteriorY = interiorHint.y - midY;
  const dot = perpA.x * towardInteriorX + perpA.y * towardInteriorY;
  const perp = dot >= 0 ? perpA : { x: -perpA.x, y: -perpA.y };

  const segs = edgeCurvePoints(len, amp, sign);
  for (const seg of segs) {
    const toGlobal = ([lx, ly]) => ({
      x: p0.x + dirX * lx + perp.x * ly,
      y: p0.y + dirY * lx + perp.y * ly
    });
    const c1 = toGlobal(seg.cp1);
    const c2 = toGlobal(seg.cp2);
    const e = toGlobal(seg.end);
    path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
  }
}

/**
 * Returns a Path2D positioned in *board* coordinates for a piece whose
 * top-left cell corner is (x, y) and whose cell size is (w, h).
 */
function buildPiecePath(x, y, w, h, edges) {
  const path = new Path2D();
  const amp = tabAmplitude(w, h);
  const cx = x + w / 2, cy = y + h / 2;
  const interior = { x: cx, y: cy };

  const TL = { x, y }, TR = { x: x + w, y }, BR = { x: x + w, y: y + h }, BL = { x, y: y + h };

  path.moveTo(TL.x, TL.y);
  drawEdge(path, TL, TR, edges.top, amp, interior);
  drawEdge(path, TR, BR, edges.right, amp, interior);
  drawEdge(path, BR, BL, edges.bottom, amp, interior);
  drawEdge(path, BL, TL, edges.left, amp, interior);
  path.closePath();
  return path;
}

// ---------------------------------------------------------------------
// Image loading: correct EXIF orientation automatically (browsers that
// support createImageBitmap's imageOrientation option handle this for
// us), downscale to a sane maximum, and hand back a ready-to-use canvas.
// ---------------------------------------------------------------------
async function loadImageToCanvas(source, maxDim = 2048) {
  let bitmap = null;
  let width, height;

  if ('createImageBitmap' in window) {
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      bitmap = null;
    }
  }

  if (!bitmap) {
    // Fallback path via <img> (no EXIF auto-rotation, but still works).
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    width = img.naturalWidth;
    height = img.naturalHeight;
    bitmap = img;
    if (source instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, outW, outH);

  if (bitmap.close) bitmap.close();
  return canvas;
}

/**
 * Draws `source` into ctx at (dx,dy,dw,dh) using object-fit:cover
 * semantics, so photos of any aspect ratio fill the board without
 * distortion (center-cropped).
 */
function drawCover(ctx, source, dx, dy, dw, dh) {
  const sw = source.width, sh = source.height;
  const srcRatio = sw / sh;
  const dstRatio = dw / dh;
  let sx, sy, sWidth, sHeight;
  if (srcRatio > dstRatio) {
    sHeight = sh;
    sWidth = sh * dstRatio;
    sx = (sw - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = sw;
    sHeight = sw / dstRatio;
    sx = 0;
    sy = (sh - sHeight) / 2;
  }
  ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}
