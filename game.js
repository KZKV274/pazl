/**
 * game.js
 * The playable engine. One Game object owns:
 *  - the piece/group model (positions stored as FRACTIONS of the board,
 *    so window resizes never distort or lose progress)
 *  - the canvas renderer
 *  - pointer/touch input (unified via Pointer Events)
 *  - snapping + connecting pieces into groups
 *  - timer (timestamp based, survives backgrounding) & move counting
 *  - save/restore of the full board state
 *
 * It knows nothing about screens/menus/storage — app.js / ui.js wire it up.
 */

const BOARD_GROUP_ID = 'board';

class PuzzleGame {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.listeners = {};
    this._raf = null;
    this._tweens = [];
    this._resizeObserver = null;
    this.reset();
  }

  on(evt, cb) {
    (this.listeners[evt] ||= []).push(cb);
    return this;
  }
  emit(evt, payload) {
    (this.listeners[evt] || []).forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } });
  }

  reset() {
    this.puzzleId = null;
    this.difficultyKey = null;
    this.rows = 0;
    this.cols = 0;
    this.pieces = [];       // flat array
    this.pieceGrid = [];    // [row][col] -> piece
    this.groups = new Map();
    this.groupOrder = [];
    this.sourceCanvas = null;   // full-resolution source image
    this.boardCanvas = null;    // offscreen, cover-fit to current board pixel size
    this.boardX = 0; this.boardY = 0; this.boardW = 0; this.boardH = 0;
    this.canvasW = 0; this.canvasH = 0;
    this.startTimestamp = 0;
    this.pausedAccumMs = 0;
    this.pauseStartedAt = null;
    this.isPaused = false;
    this.isCompleted = false;
    this.moves = 0;
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.shuffleCount = 1;
    this.dragging = null;
    this.hintPieceId = null;
    this.hintUntil = 0;
    this.viewOriginalAlpha = 0; // 0..1, for "show original" overlay drawn on-canvas
    this.settings = { animations: true, showTimer: true, showMoves: true };
  }

  attachCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._bindInput();
    if ('ResizeObserver' in window) {
      this._resizeObserver = new ResizeObserver(() => this.handleResize());
      this._resizeObserver.observe(canvas.parentElement);
    }
  }

  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._unbindInput?.();
  }

  // -------------------------------------------------------------- setup --
  newGame({ puzzleId, sourceCanvas, rows, cols, difficultyKey, seed }) {
    this.reset();
    this.puzzleId = puzzleId;
    this.difficultyKey = difficultyKey;
    this.sourceCanvas = sourceCanvas;
    this.rows = rows;
    this.cols = cols;

    const rng = mulberry32(seed >>> 0);
    const edgeGrid = generateEdgeMap(rows, cols, rng);

    this.groups.set(BOARD_GROUP_ID, { id: BOARD_GROUP_ID, offsetFracX: 0, offsetFracY: 0, pieceIds: new Set(), locked: true });
    this.groupOrder = [BOARD_GROUP_ID];

    let id = 0;
    for (let r = 0; r < rows; r++) {
      this.pieceGrid.push([]);
      for (let c = 0; c < cols; c++) {
        const piece = {
          id: id++,
          row: r, col: c,
          edges: edgeGrid[r][c],
          correctFracX: c / cols,
          correctFracY: r / rows,
          fracW: 1 / cols,
          fracH: 1 / rows,
          groupId: null,
          homePath: null
        };
        this.pieces.push(piece);
        this.pieceGrid[r].push(piece);
        const gid = `g${piece.id}`;
        this.groups.set(gid, { id: gid, offsetFracX: 0, offsetFracY: 0, pieceIds: new Set([piece.id]), locked: false });
        piece.groupId = gid;
        this.groupOrder.push(gid);
      }
    }

    this.shuffle({ silent: true, resetStats: false });
    this.handleResize(true);
    this.startTimestamp = Date.now();
    this.pausedAccumMs = 0;
    this._ensureLoop();
  }

  // ---------------------------------------------------------- geometry --
  handleResize(force) {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    if (!force && cssW === this._lastCssW && cssH === this._lastCssH) return;
    this._lastCssW = cssW; this._lastCssH = cssH;

    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.canvasW = cssW;
    this.canvasH = cssH;

    const imgRatio = this.sourceCanvas.width / this.sourceCanvas.height;
    const margin = 26;
    const availW = Math.max(40, cssW - margin * 2);
    const availH = Math.max(40, cssH - margin * 2);
    let boardW = availW, boardH = availW / imgRatio;
    if (boardH > availH) { boardH = availH; boardW = availH * imgRatio; }
    this.boardW = boardW;
    this.boardH = boardH;
    this.boardX = (cssW - boardW) / 2;
    this.boardY = (cssH - boardH) / 2;

    this._rebuildBoardTexture();
    this._rebuildHomePaths();
    this.render();
  }

  _rebuildBoardTexture() {
    const w = Math.max(1, Math.round(this.boardW));
    const h = Math.max(1, Math.round(this.boardH));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    drawCover(octx, this.sourceCanvas, 0, 0, w, h);
    this.boardCanvas = off;
  }

  _rebuildHomePaths() {
    for (const piece of this.pieces) {
      const x = this.boardX + piece.correctFracX * this.boardW;
      const y = this.boardY + piece.correctFracY * this.boardH;
      const w = piece.fracW * this.boardW;
      const h = piece.fracH * this.boardH;
      piece.homePath = buildPiecePath(x, y, w, h, piece.edges);
      piece.homeX = x; piece.homeY = y; piece.cellW = w; piece.cellH = h;
    }
  }

  // ------------------------------------------------------------ shuffle --
  shuffle({ silent = false, resetStats = true } = {}) {
    // Scatter every piece into its own group at a random position.
    const margin = 10;
    for (const piece of this.pieces) {
      const gid = `g${piece.id}`;
      if (!this.groups.has(gid)) {
        this.groups.set(gid, { id: gid, offsetFracX: 0, offsetFracY: 0, pieceIds: new Set([piece.id]), locked: false });
      }
      piece.groupId = gid;
    }
    // Drop any old groups other than per-piece + board
    for (const gid of [...this.groups.keys()]) {
      if (gid === BOARD_GROUP_ID) { this.groups.get(gid).pieceIds.clear(); continue; }
      if (!gid.startsWith('g') || !this.groups.get(gid).pieceIds.has(Number(gid.slice(1)))) {
        this.groups.delete(gid);
      }
    }
    this.groupOrder = [BOARD_GROUP_ID, ...this.pieces.map(p => `g${p.id}`)];

    const cssW = this._lastCssW || 800, cssH = this._lastCssH || 600;
    const boardW = this.boardW || cssW * 0.7, boardH = this.boardH || cssH * 0.7;
    const boardX = this.boardX || cssW * 0.15, boardY = this.boardY || cssH * 0.15;

    for (const piece of this.pieces) {
      const homeX = boardX + piece.correctFracX * boardW;
      const homeY = boardY + piece.correctFracY * boardH;
      let rx, ry, tries = 0;
      do {
        rx = margin + Math.random() * Math.max(1, cssW - margin * 2);
        ry = margin + Math.random() * Math.max(1, cssH - margin * 2);
        tries++;
      } while (Math.hypot(rx - homeX, ry - homeY) < Math.min(boardW, boardH) * 0.12 && tries < 8);
      const g = this.groups.get(`g${piece.id}`);
      g.offsetFracX = (rx - homeX) / boardW;
      g.offsetFracY = (ry - homeY) / boardH;
    }

    this.shuffleCount = (this.shuffleCount || 0) + (silent ? 0 : 1);
    if (resetStats) {
      this.moves = 0; this.mistakes = 0; this.hintsUsed = 0;
      this.startTimestamp = Date.now(); this.pausedAccumMs = 0;
      this.isCompleted = false;
    }
    this.render();
  }

  // ------------------------------------------------------------- input --
  _bindInput() {
    const c = this.canvas;
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    this._unbindInput = () => {
      c.removeEventListener('pointerdown', this._onDown);
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('pointercancel', this._onUp);
    };
  }

  _localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _pieceAt(x, y) {
    for (let i = this.groupOrder.length - 1; i >= 0; i--) {
      const gid = this.groupOrder[i];
      if (gid === BOARD_GROUP_ID) continue;
      const group = this.groups.get(gid);
      if (!group) continue;
      const offX = group.offsetFracX * this.boardW;
      const offY = group.offsetFracY * this.boardH;
      const testX = x - offX, testY = y - offY;
      const ids = [...group.pieceIds];
      for (let j = ids.length - 1; j >= 0; j--) {
        const piece = this.pieces[ids[j]];
        if (piece.homePath && this.ctx.isPointInPath(piece.homePath, testX, testY)) {
          return { piece, group };
        }
      }
    }
    return null;
  }

  _pointerDown(e) {
    if (this.isPaused || this.isCompleted || !this.pieces.length) return;
    const p = this._localPoint(e);
    const hit = this._pieceAt(p.x, p.y);
    if (!hit) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.groupOrder = this.groupOrder.filter(g => g !== hit.group.id);
    this.groupOrder.push(hit.group.id);
    this.dragging = {
      groupId: hit.group.id,
      pointerId: e.pointerId,
      startX: p.x, startY: p.y,
      startOffX: hit.group.offsetFracX, startOffY: hit.group.offsetFracY,
      moved: false
    };
    AudioFX.pickUp();
    this.emit('dragstart', hit.piece);
    e.preventDefault();
  }

  _pointerMove(e) {
    if (!this.dragging || e.pointerId !== this.dragging.pointerId) return;
    const p = this._localPoint(e);
    const dx = p.x - this.dragging.startX, dy = p.y - this.dragging.startY;
    if (Math.hypot(dx, dy) > 3) this.dragging.moved = true;
    const group = this.groups.get(this.dragging.groupId);
    if (!group) return;
    group.offsetFracX = this.dragging.startOffX + dx / this.boardW;
    group.offsetFracY = this.dragging.startOffY + dy / this.boardH;
    this.render();
  }

  _pointerUp(e) {
    if (!this.dragging || e.pointerId !== this.dragging.pointerId) return;
    const drag = this.dragging;
    this.dragging = null;
    const group = this.groups.get(drag.groupId);
    if (!group) return;

    if (drag.moved) {
      this.moves++;
      const merged = this._tryMergeCascade(group.id);
      if (!merged) this.mistakes++;
      this.emit('move', { moves: this.moves });
      this.emit('save-request');
    }
    this.render();
  }

  // ------------------------------------------------------- merge logic --
  _cellPixel() {
    return Math.min(this.boardW / this.cols, this.boardH / this.rows);
  }

  _tryMergeCascade(startGroupId) {
    let mergedAny = false;
    let guard = this.pieces.length + 4;
    let currentId = startGroupId;
    while (guard-- > 0) {
      const merged = this._tryMergeOnce(currentId);
      if (!merged) break;
      mergedAny = true;
      currentId = merged; // continue trying to cascade from the resulting group
    }
    if (mergedAny) this._checkWin();
    return mergedAny;
  }

  _tryMergeOnce(groupId) {
    const group = this.groups.get(groupId);
    if (!group || group.locked) return null;
    const threshold = this._cellPixel() * 0.36;

    let best = null; // { targetId, dist }
    // Candidate 1: absolute snap-to-home (board), valid any time.
    {
      const dxPx = group.offsetFracX * this.boardW;
      const dyPx = group.offsetFracY * this.boardH;
      const dist = Math.hypot(dxPx, dyPx);
      if (dist < threshold) best = { targetId: BOARD_GROUP_ID, dist };
    }
    // Candidate 2: align with each unmerged neighbour.
    for (const pid of group.pieceIds) {
      const piece = this.pieces[pid];
      const neighbors = this._neighborsOf(piece);
      for (const n of neighbors) {
        if (!n || n.groupId === groupId) continue;
        const ng = this.groups.get(n.groupId);
        if (!ng) continue;
        const dxPx = (group.offsetFracX - ng.offsetFracX) * this.boardW;
        const dyPx = (group.offsetFracY - ng.offsetFracY) * this.boardH;
        const dist = Math.hypot(dxPx, dyPx);
        if (dist < threshold && (!best || dist < best.dist)) {
          best = { targetId: n.groupId, dist };
        }
      }
    }
    if (!best) return null;

    const target = this.groups.get(best.targetId);
    group.offsetFracX = target.offsetFracX;
    group.offsetFracY = target.offsetFracY;
    for (const pid of group.pieceIds) {
      this.pieces[pid].groupId = target.id;
      target.pieceIds.add(pid);
    }
    this.groups.delete(group.id);
    this.groupOrder = this.groupOrder.filter(g => g !== group.id);

    if (target.id === BOARD_GROUP_ID) {
      AudioFX.place();
      this.emit('place');
    } else {
      AudioFX.connect();
      this.emit('connect');
    }
    return target.id;
  }

  _neighborsOf(piece) {
    const { row, col } = piece;
    return [
      row > 0 ? this.pieceGrid[row - 1][col] : null,
      col < this.cols - 1 ? this.pieceGrid[row][col + 1] : null,
      row < this.rows - 1 ? this.pieceGrid[row + 1][col] : null,
      col > 0 ? this.pieceGrid[row][col - 1] : null
    ];
  }

  _checkWin() {
    const board = this.groups.get(BOARD_GROUP_ID);
    if (board.pieceIds.size === this.pieces.length && !this.isCompleted) {
      this.isCompleted = true;
      const timeMs = this.getElapsedMs();
      const score = this.computeScore(timeMs);
      AudioFX.win();
      this.emit('win', { timeMs, moves: this.moves, hintsUsed: this.hintsUsed, mistakes: this.mistakes, score });
    }
  }

  computeScore(timeMs) {
    const pieces = this.rows * this.cols;
    const base = pieces * 300;
    const seconds = timeMs / 1000;
    const timePenalty = seconds * 4;
    const movesPenalty = Math.max(0, this.moves - pieces) * 8;
    const hintPenalty = this.hintsUsed * 250;
    return Math.max(100, Math.round(base - timePenalty - movesPenalty - hintPenalty));
  }

  // -------------------------------------------------------------- hints --
  hintHighlight() {
    const remaining = this.pieces.filter(p => p.groupId !== BOARD_GROUP_ID);
    if (!remaining.length) return null;
    const piece = remaining[Math.floor(Math.random() * remaining.length)];
    this.hintPieceId = piece.id;
    this.hintUntil = Date.now() + 3000;
    this.hintsUsed++;
    AudioFX.hint();
    this.render();
    return piece;
  }

  hintPlacePiece() {
    const remaining = this.pieces.filter(p => p.groupId !== BOARD_GROUP_ID);
    if (!remaining.length) return null;
    const piece = remaining[Math.floor(Math.random() * remaining.length)];
    const group = this.groups.get(piece.groupId);
    group.offsetFracX = 0; group.offsetFracY = 0;
    this.hintsUsed++;
    this._tryMergeCascade(group.id);
    this.render();
    return piece;
  }

  // -------------------------------------------------------------- timer --
  getElapsedMs() {
    if (this.isCompleted) return this._finalElapsedMs ?? 0;
    if (this.isPaused) return (this.pauseStartedAt || Date.now()) - this.startTimestamp - this.pausedAccumMs;
    return Date.now() - this.startTimestamp - this.pausedAccumMs;
  }

  pause() {
    if (this.isPaused || this.isCompleted) return;
    this.isPaused = true;
    this.pauseStartedAt = Date.now();
  }

  resume() {
    if (!this.isPaused) return;
    this.pausedAccumMs += Date.now() - this.pauseStartedAt;
    this.pauseStartedAt = null;
    this.isPaused = false;
  }

  // --------------------------------------------------------- save/load --
  getSaveState() {
    return {
      puzzleId: this.puzzleId,
      difficultyKey: this.difficultyKey,
      rows: this.rows,
      cols: this.cols,
      edges: this.pieces.map(p => p.edges),
      groups: [...this.groups.values()].map(g => ({
        id: g.id, offsetFracX: g.offsetFracX, offsetFracY: g.offsetFracY,
        pieceIds: [...g.pieceIds], locked: g.locked
      })),
      pieceGroupId: this.pieces.map(p => p.groupId),
      elapsedMs: this.getElapsedMs(),
      moves: this.moves,
      mistakes: this.mistakes,
      hintsUsed: this.hintsUsed,
      shuffleCount: this.shuffleCount,
      savedAt: Date.now()
    };
  }

  restoreFromSave(save, sourceCanvas) {
    this.reset();
    this.puzzleId = save.puzzleId;
    this.difficultyKey = save.difficultyKey;
    this.rows = save.rows;
    this.cols = save.cols;
    this.sourceCanvas = sourceCanvas;

    let id = 0;
    for (let r = 0; r < save.rows; r++) {
      this.pieceGrid.push([]);
      for (let c = 0; c < save.cols; c++) {
        const piece = {
          id: id, row: r, col: c,
          edges: save.edges[id],
          correctFracX: c / save.cols,
          correctFracY: r / save.rows,
          fracW: 1 / save.cols,
          fracH: 1 / save.rows,
          groupId: save.pieceGroupId[id],
          homePath: null
        };
        this.pieces.push(piece);
        this.pieceGrid[r].push(piece);
        id++;
      }
    }
    for (const g of save.groups) {
      this.groups.set(g.id, {
        id: g.id, offsetFracX: g.offsetFracX, offsetFracY: g.offsetFracY,
        pieceIds: new Set(g.pieceIds), locked: g.locked
      });
    }
    this.groupOrder = [...this.groups.keys()];
    this.moves = save.moves || 0;
    this.mistakes = save.mistakes || 0;
    this.hintsUsed = save.hintsUsed || 0;
    this.shuffleCount = save.shuffleCount || 1;
    this.startTimestamp = Date.now() - (save.elapsedMs || 0);
    this.pausedAccumMs = 0;
    this.handleResize(true);
    this._ensureLoop();
  }

  progressPercent() {
    const board = this.groups.get(BOARD_GROUP_ID);
    if (!board || !this.pieces.length) return 0;
    return Math.round((board.pieceIds.size / this.pieces.length) * 100);
  }

  // ------------------------------------------------------------ render --
  _ensureLoop() {
    if (this._raf) return;
    const tick = () => {
      this.render();
      this.emit('tick');
      if (this.hintPieceId !== null && Date.now() > this.hintUntil) this.hintPieceId = null;
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.boardCanvas) return;
    ctx.clearRect(0, 0, this.canvasW, this.canvasH);

    // Board outline / drop zone guide
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.strokeRect(this.boardX, this.boardY, this.boardW, this.boardH);
    ctx.restore();

    for (const gid of this.groupOrder) {
      const group = this.groups.get(gid);
      if (!group || group.pieceIds.size === 0) continue;
      const offX = group.offsetFracX * this.boardW;
      const offY = group.offsetFracY * this.boardH;
      const isDragging = this.dragging && this.dragging.groupId === gid;

      ctx.save();
      ctx.translate(offX, offY);
      if (isDragging) {
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 8;
      } else if (gid !== BOARD_GROUP_ID) {
        ctx.shadowColor = 'rgba(0,0,0,0.30)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;
      }
      for (const pid of group.pieceIds) {
        const piece = this.pieces[pid];
        if (!piece.homePath) continue;
        ctx.save();
        ctx.clip(piece.homePath);
        ctx.drawImage(this.boardCanvas, this.boardX, this.boardY);
        ctx.restore();
        ctx.save();
        ctx.lineWidth = gid === BOARD_GROUP_ID ? 1 : 1.4;
        ctx.strokeStyle = gid === BOARD_GROUP_ID ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.55)';
        ctx.stroke(piece.homePath);
        ctx.restore();

        if (this.hintPieceId === piece.id) {
          ctx.save();
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 130);
          ctx.strokeStyle = `rgba(242,169,59,${0.55 + pulse * 0.45})`;
          ctx.lineWidth = 4;
          ctx.stroke(piece.homePath);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // hint target ghost at home position
    if (this.hintPieceId !== null) {
      const piece = this.pieces[this.hintPieceId];
      if (piece && piece.groupId !== BOARD_GROUP_ID) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(Date.now() / 130);
        ctx.strokeStyle = '#f2a93b';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.stroke(piece.homePath);
        ctx.restore();
      }
    }

    if (this.viewOriginalAlpha > 0.001) {
      ctx.save();
      ctx.globalAlpha = this.viewOriginalAlpha;
      ctx.drawImage(this.boardCanvas, this.boardX, this.boardY);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.boardX, this.boardY, this.boardW, this.boardH);
      ctx.restore();
    }
  }

  setViewOriginal(on) {
    this.viewOriginalAlpha = on ? 1 : 0;
    this.render();
  }
}
