/**
 * app.js
 * Wires storage + puzzle + game + ui together. Owns:
 *  - static catalog (gallery images, difficulties, achievements)
 *  - screen-to-screen flow and all button handlers
 *  - the "custom photo" crop flow
 *  - daily puzzle selection
 *  - stats/records/achievements bookkeeping
 *  - settings application
 *  - save/resume of an in-progress game
 */

const APP_VERSION = '1.0.0';

const CATEGORIES = [
  { key: 'nature', label: 'Природа' },
  { key: 'cities', label: 'Города' },
  { key: 'animals', label: 'Животные' },
  { key: 'space', label: 'Космос' },
  { key: 'abstraction', label: 'Абстракция' }
];

const GALLERY = [
  { id: 'nature-1', category: 'nature', title: 'Горы на закате', file: 'assets/puzzles/nature_1.jpg' },
  { id: 'nature-2', category: 'nature', title: 'Зелёные холмы', file: 'assets/puzzles/nature_2.jpg' },
  { id: 'cities-1', category: 'cities', title: 'Ночной силуэт', file: 'assets/puzzles/cities_1.jpg' },
  { id: 'cities-2', category: 'cities', title: 'Городские огни', file: 'assets/puzzles/cities_2.jpg' },
  { id: 'animals-1', category: 'animals', title: 'Рыжий лис', file: 'assets/puzzles/animals_1.jpg' },
  { id: 'animals-2', category: 'animals', title: 'Серый зверёк', file: 'assets/puzzles/animals_2.jpg' },
  { id: 'space-1', category: 'space', title: 'Далёкая планета', file: 'assets/puzzles/space_1.jpg' },
  { id: 'space-2', category: 'space', title: 'Голубой гигант', file: 'assets/puzzles/space_2.jpg' },
  { id: 'abstraction-1', category: 'abstraction', title: 'Тёплые формы', file: 'assets/puzzles/abstraction_1.jpg' },
  { id: 'abstraction-2', category: 'abstraction', title: 'Контраст', file: 'assets/puzzles/abstraction_2.jpg' }
];

const DIFFICULTIES = [
  { key: 'easy', label: 'Легко', rows: 3, cols: 3 },
  { key: 'normal', label: 'Нормально', rows: 4, cols: 4 },
  { key: 'hard', label: 'Сложно', rows: 5, cols: 5 },
  { key: 'expert', label: 'Эксперт', rows: 6, cols: 6 },
  { key: 'master', label: 'Мастер', rows: 8, cols: 8 }
];

const ACHIEVEMENTS = [
  { id: 'first', icon: '🏆', title: 'Первый пазл', desc: 'Собери первый пазл', check: ctx => ctx.stats.completedGames >= 1 },
  { id: 'speed', icon: '⚡', title: 'Скорость', desc: 'Меньше чем за 60 секунд', check: ctx => ctx.win && ctx.win.timeMs < 60000 },
  { id: 'nohints', icon: '🧠', title: 'Без подсказок', desc: 'Пазл без подсказок', check: ctx => ctx.win && ctx.win.hintsUsed === 0 },
  { id: 'streak3', icon: '🔥', title: 'Серия', desc: '3 пазла подряд', check: ctx => ctx.streak.current >= 3 },
  { id: 'master8', icon: '💎', title: 'Мастер', desc: 'Пазл 8×8', check: ctx => ctx.win && ctx.difficultyKey === 'master' },
  { id: 'photographer', icon: '📸', title: 'Фотограф', desc: 'Своя фотография', check: ctx => ctx.win && ctx.sourceType === 'photo' }
];

function difficultyByKey(key) { return DIFFICULTIES.find(d => d.key === key); }
function galleryById(id) { return GALLERY.find(g => g.id === id); }

/* ------------------------------------------------------------------ state */
const App = {
  game: new PuzzleGame(),
  settings: Storage.getSettings(),
  selection: null,        // { sourceType, sourceRef, title, thumbFile } chosen before difficulty screen
  activePuzzleMeta: null, // meta for the puzzle currently loaded in the game screen
  lastWin: null,
  currentPhotoBlobUrl: null
};

/* ================================================================== INIT */
window.addEventListener('DOMContentLoaded', () => {
  applySettingsToUI();
  applyTheme();
  document.getElementById('app-version').textContent = `Puzzle v${APP_VERSION}`;

  wireMenu();
  wireGallery();
  wireMyPhotos();
  wirePhotoPreview();
  wireDifficulty();
  wireGameScreen();
  wireWinScreen();
  wireStatsScreen();
  wireSettingsScreen();
  wireGlobalOverlays();

  refreshContinueBanner();
  registerServiceWorker();

  window.addEventListener('beforeunload', () => {
    if (UI.currentScreen() === 'game' && App.game.pieces.length && !App.game.isCompleted) persistCurrentGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && UI.currentScreen() === 'game' && !App.game.isCompleted) persistCurrentGame();
  });
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}

/* =============================================================== ROUTING */
document.body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  handleAction(action, t);
});

function handleAction(action, el) {
  switch (action) {
    case 'back': UI.goBack(); break;
    case 'new-game': UI.showScreen('gallery'); break;
    case 'gallery': UI.showScreen('gallery'); break;
    case 'my-photos': UI.showScreen('my-photos'); break;
    case 'stats': renderStats(); UI.showScreen('stats'); break;
    case 'settings': UI.showScreen('settings'); break;
    case 'continue': resumeSavedGame(); break;
    case 'daily': startDailyPuzzle(); break;
    case 'hint': onHint(); break;
    case 'view-original': onToggleViewOriginal(el); break;
    case 'shuffle': onShuffleRequest(); break;
    case 'pause': onPauseGame(); break;
    case 'pause-then-back': onPauseGame(); break;
  }
}

/* ================================================================= MENU */
function wireMenu() {
  UI.setOnLeave('menu', () => {});
}

function refreshContinueBanner() {
  const save = Storage.getSave();
  const banner = document.getElementById('continue-banner');
  const btn = document.getElementById('btn-continue');
  if (!save) { banner.classList.add('hidden'); btn.style.display = 'none'; return; }
  const diff = difficultyByKey(save.difficultyKey);
  const total = save.rows * save.cols;
  const placed = save.groups.find(g => g.id === 'board')?.pieceIds.length || 0;
  const percent = Math.round((placed / total) * 100);
  document.getElementById('continue-title').textContent = 'Продолжить игру?';
  document.getElementById('continue-meta').textContent =
    `${save.title || 'Пазл'} · ${diff ? diff.label : ''} ${save.rows}×${save.cols} · ${UI.formatTime(save.elapsedMs)} · ${percent}%`;
  document.getElementById('continue-progress').style.width = percent + '%';
  banner.classList.remove('hidden');
  btn.style.display = 'flex';
}

/* =============================================================== GALLERY */
function wireGallery() {
  const tabsEl = document.getElementById('gallery-tabs');
  CATEGORIES.forEach((cat, i) => {
    const tab = UI.el('button', 'tab' + (i === 0 ? ' active' : ''), cat.label);
    tab.dataset.category = cat.key;
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderGallery(cat.key);
    });
    tabsEl.appendChild(tab);
  });
  renderGallery(CATEGORIES[0].key);
}

function bestForPuzzle(puzzleId) {
  const records = Storage.getRecords();
  let best = null;
  for (const diff of DIFFICULTIES) {
    const r = records[`${puzzleId}:${diff.key}`];
    if (r && (!best || r.bestTimeMs < best.bestTimeMs)) best = r;
  }
  return best;
}

function renderGallery(category) {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  GALLERY.filter(g => g.category === category).forEach(g => {
    const card = UI.el('div', 'puzzle-card');
    const best = bestForPuzzle(g.id);
    card.innerHTML = `
      <img src="${g.file}" alt="${g.title}" loading="lazy">
      <div class="puzzle-card-body">
        <div class="puzzle-card-title">${g.title}</div>
        <div class="puzzle-card-meta"><span>${CATEGORIES.find(c => c.key === category).label}</span><span>${best ? UI.formatTime(best.bestTimeMs) : '—'}</span></div>
      </div>`;
    card.addEventListener('click', () => {
      App.selection = { sourceType: 'gallery', sourceRef: g.id, title: g.title, thumbFile: g.file };
      goToDifficulty();
    });
    grid.appendChild(card);
  });
}

/* ============================================================= MY PHOTOS */
function wireMyPhotos() {
  document.getElementById('btn-add-photo').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await openCropForFile(file);
  });
  UI.setOnLeave('my-photos', () => {});
}

async function renderMyPhotos() {
  const grid = document.getElementById('my-photos-grid');
  const empty = document.getElementById('my-photos-empty');
  grid.innerHTML = '';
  if (!PhotoDB.isSupported()) { empty.textContent = 'Хранилище фотографий недоступно в этом браузере.'; empty.style.display = 'block'; return; }
  let photos = [];
  try { photos = await PhotoDB.getAll(); } catch (e) { console.warn(e); }
  empty.style.display = photos.length ? 'none' : 'block';
  photos.forEach(photo => {
    const url = URL.createObjectURL(photo.blob);
    const card = UI.el('div', 'puzzle-card');
    const best = bestForPuzzle('photo-' + photo.id);
    card.innerHTML = `
      <img src="${url}" alt="${photo.name}">
      <button class="puzzle-card-delete" title="Удалить">✕</button>
      <div class="puzzle-card-body">
        <div class="puzzle-card-title">${photo.name}</div>
        <div class="puzzle-card-meta"><span>Своя фотография</span><span>${best ? UI.formatTime(best.bestTimeMs) : '—'}</span></div>
      </div>`;
    card.querySelector('img').addEventListener('click', () => {
      App.selection = { sourceType: 'photo', sourceRef: photo.id, title: photo.name, thumbFile: url };
      goToDifficulty();
    });
    card.querySelector('.puzzle-card-delete').addEventListener('click', (ev) => {
      ev.stopPropagation();
      pendingPhotoDeleteId = photo.id;
      UI.showOverlay('confirm-delete-photo-overlay');
    });
    grid.appendChild(card);
  });
}

let pendingPhotoDeleteId = null;
function wireGlobalOverlaysPhotoDelete() {
  document.getElementById('btn-cancel-delete-photo').addEventListener('click', () => UI.hideOverlay('confirm-delete-photo-overlay'));
  document.getElementById('btn-confirm-delete-photo').addEventListener('click', async () => {
    if (pendingPhotoDeleteId != null) {
      try { await PhotoDB.remove(pendingPhotoDeleteId); } catch (e) { console.warn(e); }
      pendingPhotoDeleteId = null;
      renderMyPhotos();
    }
    UI.hideOverlay('confirm-delete-photo-overlay');
  });
}

/* ============================================================ CROP FLOW */
let cropSourceCanvas = null;
let cropView = { w: 0, h: 0, baseScale: 1, panX: 0, panY: 0, zoom: 100 };
let cropDrag = null;

async function openCropForFile(file) {
  try {
    cropSourceCanvas = await loadImageToCanvas(file, 2048);
  } catch (e) {
    console.error(e);
    UI.toast('Не удалось открыть фото');
    return;
  }
  document.getElementById('crop-zoom').value = 100;
  UI.showScreen('photo-preview');
  requestAnimationFrame(() => setupCropStage());
}

function setupCropStage() {
  const stage = document.getElementById('crop-stage');
  const canvas = document.getElementById('crop-canvas');
  const ctx = canvas.getContext('2d');
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cropView.w = rect.width; cropView.h = rect.height;
  cropView.baseScale = Math.max(rect.width / cropSourceCanvas.width, rect.height / cropSourceCanvas.height);
  cropView.zoom = 100; cropView.panX = 0; cropView.panY = 0;
  drawCrop();
}

function clampCropPan() {
  const scale = cropView.baseScale * (cropView.zoom / 100);
  const imgW = cropSourceCanvas.width * scale;
  const imgH = cropSourceCanvas.height * scale;
  const maxPanX = Math.max(0, (imgW - cropView.w) / 2);
  const maxPanY = Math.max(0, (imgH - cropView.h) / 2);
  cropView.panX = Math.max(-maxPanX, Math.min(maxPanX, cropView.panX));
  cropView.panY = Math.max(-maxPanY, Math.min(maxPanY, cropView.panY));
}

function drawCrop() {
  const canvas = document.getElementById('crop-canvas');
  const ctx = canvas.getContext('2d');
  clampCropPan();
  const scale = cropView.baseScale * (cropView.zoom / 100);
  const imgW = cropSourceCanvas.width * scale;
  const imgH = cropSourceCanvas.height * scale;
  const left = (cropView.w - imgW) / 2 + cropView.panX;
  const top = (cropView.h - imgH) / 2 + cropView.panY;
  ctx.clearRect(0, 0, cropView.w, cropView.h);
  ctx.drawImage(cropSourceCanvas, left, top, imgW, imgH);
}

function wirePhotoPreview() {
  const canvas = document.getElementById('crop-canvas');
  canvas.addEventListener('pointerdown', (e) => {
    cropDrag = { x: e.clientX, y: e.clientY, panX: cropView.panX, panY: cropView.panY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cropDrag) return;
    cropView.panX = cropDrag.panX + (e.clientX - cropDrag.x);
    cropView.panY = cropDrag.panY + (e.clientY - cropDrag.y);
    drawCrop();
  });
  ['pointerup', 'pointercancel'].forEach(evt => canvas.addEventListener(evt, () => { cropDrag = null; }));

  document.getElementById('crop-zoom').addEventListener('input', (e) => {
    cropView.zoom = Number(e.target.value);
    drawCrop();
  });

  document.getElementById('btn-confirm-photo').addEventListener('click', async () => {
    const OUT = 1400;
    const out = document.createElement('canvas');
    out.width = OUT; out.height = OUT;
    const octx = out.getContext('2d');
    const scale = cropView.baseScale * (cropView.zoom / 100);
    const imgW = cropSourceCanvas.width * scale, imgH = cropSourceCanvas.height * scale;
    const left = (cropView.w - imgW) / 2 + cropView.panX;
    const top = (cropView.h - imgH) / 2 + cropView.panY;
    const srcScale = OUT / cropView.w; // frame is square (aspect-ratio:1/1)
    octx.save();
    octx.scale(srcScale, srcScale);
    octx.drawImage(cropSourceCanvas, left, top, imgW, imgH);
    octx.restore();

    out.toBlob(async (blob) => {
      if (!blob) { UI.toast('Не удалось обработать фото'); return; }
      const photo = { id: Date.now(), name: 'Фото ' + new Date().toLocaleDateString('ru-RU'), blob, width: OUT, height: OUT, createdAt: Date.now() };
      try {
        if (PhotoDB.isSupported()) await PhotoDB.add(photo);
      } catch (err) { console.warn('Could not persist photo', err); }
      App.selection = { sourceType: 'photo', sourceRef: photo.id, title: photo.name, thumbFile: URL.createObjectURL(blob), canvasOverride: out };
      goToDifficulty();
    }, 'image/jpeg', 0.9);
  });
}

/* ============================================================ DIFFICULTY */
function goToDifficulty() {
  const preview = document.getElementById('difficulty-preview');
  preview.innerHTML = `<img src="${App.selection.thumbFile}" alt="">`;
  UI.showScreen('difficulty');
}

function wireDifficulty() {
  const list = document.getElementById('difficulty-list');
  DIFFICULTIES.forEach(d => {
    const item = UI.el('div', 'difficulty-item');
    item.innerHTML = `
      <div>
        <div class="difficulty-name">${d.label}</div>
        <div class="difficulty-sub">${d.rows} × ${d.cols} = ${d.rows * d.cols} деталей</div>
      </div>
      <div class="difficulty-best" data-best></div>`;
    item.addEventListener('click', () => startNewGame(d.key));
    item.dataset.key = d.key;
    list.appendChild(item);
  });
  UI.setOnLeave('difficulty', () => {});
}

function refreshDifficultyBests() {
  if (!App.selection) return;
  const puzzleId = App.selection.sourceType === 'photo' ? 'photo-' + App.selection.sourceRef : App.selection.sourceRef;
  const records = Storage.getRecords();
  document.querySelectorAll('#difficulty-list .difficulty-item').forEach(item => {
    const key = item.dataset.key;
    const r = records[`${puzzleId}:${key}`];
    item.querySelector('[data-best]').innerHTML = r ? `⏱ ${UI.formatTime(r.bestTimeMs)}<br>${r.bestMoves} ходов` : '';
  });
}
const _origGoToDifficulty = goToDifficulty;
goToDifficulty = function () { _origGoToDifficulty(); refreshDifficultyBests(); };

/* =========================================================== START GAME */
async function loadSourceCanvasForSelection(sel) {
  if (sel.canvasOverride) return sel.canvasOverride;
  if (sel.sourceType === 'gallery' || sel.sourceType === 'daily') {
    const g = galleryById(sel.sourceRef);
    const resp = await fetch(g.file);
    const blob = await resp.blob();
    return loadImageToCanvas(blob, 2048);
  }
  if (sel.sourceType === 'photo') {
    const photo = await PhotoDB.get(sel.sourceRef);
    if (!photo) throw new Error('photo missing');
    return loadImageToCanvas(photo.blob, 2048);
  }
  throw new Error('unknown source type');
}

async function startNewGame(difficultyKey, seedOverride) {
  const sel = App.selection;
  if (!sel) return;
  let sourceCanvas;
  try {
    sourceCanvas = await loadSourceCanvasForSelection(sel);
  } catch (e) {
    console.error(e);
    UI.toast('Не удалось загрузить изображение');
    return;
  }
  const diff = difficultyByKey(difficultyKey);
  const puzzleId = sel.sourceType === 'photo' ? 'photo-' + sel.sourceRef : sel.sourceRef;
  const seed = seedOverride ?? hashStringToSeed(puzzleId + ':' + difficultyKey + ':' + Date.now());
  App.activePuzzleMeta = { sourceType: sel.sourceType, sourceRef: sel.sourceRef, title: sel.title, thumbFile: sel.thumbFile, puzzleId, difficultyKey: difficultyKey };

  enterGameScreen();
  App.game.newGame({ puzzleId, sourceCanvas, rows: diff.rows, cols: diff.cols, difficultyKey, seed });
  Storage.clearSave();
  document.getElementById('hud-title').textContent = `${sel.title} · ${diff.rows}×${diff.cols}`;
  maybeShowTutorial();
}

async function startDailyPuzzle() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const idx = hashStringToSeed('daily:' + dateStr) % GALLERY.length;
  const g = GALLERY[idx];
  App.selection = { sourceType: 'daily', sourceRef: g.id, title: `Пазл дня · ${dateStr}`, thumbFile: g.file };
  const seed = hashStringToSeed('daily-seed:' + dateStr);
  await startNewGame('normal', seed);
  App.activePuzzleMeta.puzzleId = 'daily-' + g.id; // keep daily records separate from free-play on same image
  const daily = Storage.getDailyMeta();
  daily.lastPlayedDate = dateStr;
  Storage.saveDailyMeta(daily);
}

async function resumeSavedGame() {
  const save = Storage.getSave();
  if (!save) return;
  let sourceCanvas;
  try {
    if (save.sourceType === 'photo') {
      const photo = await PhotoDB.get(save.sourceRef);
      if (!photo) throw new Error('missing photo');
      sourceCanvas = await loadImageToCanvas(photo.blob, 2048);
    } else {
      const g = galleryById(save.sourceRef);
      const resp = await fetch((g && g.file) || save.thumbFile);
      const blob = await resp.blob();
      sourceCanvas = await loadImageToCanvas(blob, 2048);
    }
  } catch (e) {
    console.error(e);
    UI.toast('Не удалось восстановить фото. Начните новую игру.');
    Storage.clearSave();
    refreshContinueBanner();
    return;
  }
  App.activePuzzleMeta = {
    sourceType: save.sourceType, sourceRef: save.sourceRef, title: save.title,
    thumbFile: save.thumbFile, puzzleId: save.puzzleId, difficultyKey: save.difficultyKey
  };
  enterGameScreen();
  App.game.restoreFromSave(save, sourceCanvas);
  const diff = difficultyByKey(save.difficultyKey);
  document.getElementById('hud-title').textContent = `${save.title} · ${diff ? diff.rows : save.rows}×${diff ? diff.cols : save.cols}`;
}

function enterGameScreen() {
  App.game.settings = App.settings;
  AudioFX.unlock();
  UI.showScreen('game');
  requestAnimationFrame(() => App.game.handleResize(true));
}

/* =========================================================== GAME SCREEN */
function wireGameScreen() {
  App.game.attachCanvas(document.getElementById('game-canvas'));

  App.game.on('tick', updateHud);
  App.game.on('move', () => { AudioFX.click(); });
  App.game.on('win', onWin);

  App.game.on('save-request', () => { if (App.settings.autoSave) persistCurrentGame(); });

  window.addEventListener('resize', () => { if (UI.currentScreen() === 'game') App.game.handleResize(); });

  document.getElementById('btn-resume').addEventListener('click', () => { UI.hideOverlay('pause-overlay'); App.game.resume(); });
  document.getElementById('btn-exit-to-menu').addEventListener('click', () => {
    UI.hideOverlay('pause-overlay');
    if (!App.game.isCompleted) { persistCurrentGame(); resetStreak(); }
    UI.resetStack('menu');
    refreshContinueBanner();
  });
  document.getElementById('btn-restart-from-pause').addEventListener('click', () => {
    UI.hideOverlay('pause-overlay');
    UI.showOverlay('confirm-restart-overlay');
  });
  document.getElementById('btn-cancel-restart').addEventListener('click', () => UI.hideOverlay('confirm-restart-overlay'));
  document.getElementById('btn-confirm-restart').addEventListener('click', () => {
    UI.hideOverlay('confirm-restart-overlay');
    App.game.shuffle({ silent: false, resetStats: true });
    App.game.resume();
    persistCurrentGame();
  });

  document.getElementById('btn-tutorial-close').addEventListener('click', () => {
    UI.hideOverlay('tutorial-overlay');
    localStorage.setItem('puzzle:tutorialSeen', '1');
  });
}

function maybeShowTutorial() {
  if (!localStorage.getItem('puzzle:tutorialSeen')) UI.showOverlay('tutorial-overlay');
}

function updateHud() {
  if (App.settings.showTimer) document.getElementById('hud-timer').textContent = UI.formatTime(App.game.getElapsedMs());
  if (App.settings.showMoves) document.getElementById('hud-moves').textContent = String(App.game.moves);
  document.getElementById('hud-progress').textContent = App.game.progressPercent() + '%';
}

function onHint() {
  if (App.game.isPaused || App.game.isCompleted) return;
  const piece = App.game.hintHighlight();
  if (piece) UI.toast('💡 Вот одна из недостающих деталей');
  persistCurrentGame();
}

function onToggleViewOriginal(btn) {
  const on = !btn.classList.contains('active');
  btn.classList.toggle('active', on);
  App.game.setViewOriginal(on);
}

function onShuffleRequest() {
  if (App.game.moves > 0 || App.game.progressPercent() > 0) {
    UI.showOverlay('confirm-restart-overlay');
  } else {
    App.game.shuffle({ silent: false, resetStats: true });
  }
}

function onPauseGame() {
  if (App.game.isCompleted) { UI.goBack(); return; }
  App.game.pause();
  persistCurrentGame();
  UI.showOverlay('pause-overlay');
}

function persistCurrentGame() {
  if (!App.game.pieces.length || App.game.isCompleted || !App.activePuzzleMeta) return;
  const save = App.game.getSaveState();
  save.sourceType = App.activePuzzleMeta.sourceType;
  save.sourceRef = App.activePuzzleMeta.sourceRef;
  save.title = App.activePuzzleMeta.title;
  save.thumbFile = App.activePuzzleMeta.thumbFile;
  save.puzzleId = App.activePuzzleMeta.puzzleId;
  Storage.saveGame(save);
}

/* =============================================================== WINNING */
let streakState = Storage.getStreak();
function resetStreak() { streakState = { current: 0, lastCompletedAt: streakState.lastCompletedAt }; Storage.saveStreak(streakState); }

function onWin(result) {
  App.lastWin = result;
  Storage.clearSave();

  const meta = App.activePuzzleMeta;
  const key = `${meta.puzzleId}:${meta.difficultyKey}`;
  const records = Storage.getRecords();
  const prev = records[key];
  const isRecord = !prev || result.score > prev.bestScore;
  records[key] = {
    bestTimeMs: prev ? Math.min(prev.bestTimeMs, result.timeMs) : result.timeMs,
    bestMoves: prev ? Math.min(prev.bestMoves, result.moves) : result.moves,
    bestScore: prev ? Math.max(prev.bestScore, result.score) : result.score,
    completedCount: (prev?.completedCount || 0) + 1
  };
  Storage.saveRecords(records);

  const stats = Storage.getStats();
  stats.totalGames += 1;
  stats.completedGames += 1;
  stats.hintsUsedTotal += result.hintsUsed;
  const dKey = meta.difficultyKey;
  stats.byDifficulty[dKey] = stats.byDifficulty[dKey] || { bestTimeMs: null, bestMoves: null, plays: 0, completions: 0 };
  const bd = stats.byDifficulty[dKey];
  bd.plays += 1; bd.completions += 1;
  bd.bestTimeMs = bd.bestTimeMs === null ? result.timeMs : Math.min(bd.bestTimeMs, result.timeMs);
  bd.bestMoves = bd.bestMoves === null ? result.moves : Math.min(bd.bestMoves, result.moves);
  Storage.saveStats(stats);

  streakState.current = (streakState.current || 0) + 1;
  streakState.lastCompletedAt = Date.now();
  Storage.saveStreak(streakState);

  const unlockedBefore = Storage.getAchievements();
  const ctx = { stats, win: result, streak: streakState, difficultyKey: dKey, sourceType: meta.sourceType };
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach(a => {
    if (!unlockedBefore[a.id] && a.check(ctx)) { unlockedBefore[a.id] = Date.now(); newlyUnlocked.push(a); }
  });
  Storage.saveAchievements(unlockedBefore);

  document.getElementById('win-image').src = meta.thumbFile;
  document.getElementById('win-time').textContent = UI.formatTime(result.timeMs);
  document.getElementById('win-moves').textContent = String(result.moves);
  document.getElementById('win-hints').textContent = String(result.hintsUsed);
  document.getElementById('win-score').textContent = result.score.toLocaleString('ru-RU');
  document.getElementById('win-record-badge').classList.toggle('hidden', !isRecord);
  if (isRecord) AudioFX.record();

  const achWrap = document.getElementById('win-achievements');
  achWrap.innerHTML = '';
  newlyUnlocked.forEach(a => {
    const pill = UI.el('div', 'achievement-pill', `${a.icon} ${a.title}`);
    achWrap.appendChild(pill);
  });

  UI.showScreen('win', { replace: true });
}

function wireWinScreen() {
  document.getElementById('btn-next-puzzle').addEventListener('click', () => {
    UI.resetStack('gallery');
    refreshContinueBanner();
  });
  document.getElementById('btn-replay-puzzle').addEventListener('click', () => {
    const meta = App.activePuzzleMeta;
    UI.resetStack('game');
    enterGameScreen();
    App.game.shuffle({ silent: false, resetStats: true });
    document.getElementById('hud-title').textContent = `${meta.title} · ${App.game.rows}×${App.game.cols}`;
  });
  document.getElementById('btn-win-to-menu').addEventListener('click', () => {
    UI.resetStack('menu');
    refreshContinueBanner();
  });
}

/* ================================================================= STATS */
function wireStatsScreen() { UI.setOnLeave('stats', () => {}); }

function renderStats() {
  const stats = Storage.getStats();
  const overview = document.getElementById('stats-overview');
  const boxes = [
    ['Всего игр', stats.totalGames],
    ['Завершено', stats.completedGames],
    ['Собрано пазлов', stats.completedGames],
    ['Подсказок использовано', stats.hintsUsedTotal]
  ];
  overview.innerHTML = boxes.map(([label, val]) => `
    <div class="stat-box"><div class="stat-box-value">${val}</div><div class="stat-box-label">${label}</div></div>
  `).join('');

  const byDiff = document.getElementById('stats-by-difficulty');
  byDiff.innerHTML = '';
  DIFFICULTIES.forEach(d => {
    const bd = stats.byDifficulty[d.key];
    const row = UI.el('div', 'stats-list-row');
    row.innerHTML = bd
      ? `<span>${d.label} (${d.rows}×${d.cols})</span><b>${UI.formatTime(bd.bestTimeMs)} · ${bd.bestMoves} ходов</b>`
      : `<span>${d.label} (${d.rows}×${d.cols})</span><b>—</b>`;
    byDiff.appendChild(row);
  });

  const unlocked = Storage.getAchievements();
  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const isUnlocked = !!unlocked[a.id];
    const card = UI.el('div', 'achievement-card' + (isUnlocked ? ' unlocked' : ''));
    card.innerHTML = `<div class="ach-icon">${a.icon}</div><div class="ach-title">${a.title}</div><div class="ach-desc">${a.desc}</div>`;
    grid.appendChild(card);
  });
}

/* ============================================================== SETTINGS */
function applySettingsToUI() {
  const s = App.settings;
  document.querySelectorAll('#theme-segmented button').forEach(b => b.classList.toggle('active', b.dataset.value === s.theme));
  document.getElementById('setting-sound').checked = s.sound;
  document.getElementById('setting-vibration').checked = s.vibration;
  document.getElementById('setting-timer').checked = s.showTimer;
  document.getElementById('setting-moves').checked = s.showMoves;
  document.getElementById('setting-autosave').checked = s.autoSave;
  document.getElementById('setting-animations').checked = s.animations;
  AudioFX.setEnabled(s.sound);
  AudioFX.setVibrationEnabled(s.vibration);
  document.getElementById('hud-timer-chip').classList.toggle('hidden', !s.showTimer);
  document.getElementById('hud-moves-chip').classList.toggle('hidden', !s.showMoves);
  document.documentElement.dataset.anim = s.animations ? 'on' : 'off';
}

function applyTheme() {
  const s = App.settings;
  let effective = s.theme;
  if (effective === 'system') {
    effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = effective;
}

function wireSettingsScreen() {
  document.querySelectorAll('#theme-segmented button').forEach(b => {
    b.addEventListener('click', () => {
      App.settings.theme = b.dataset.value;
      Storage.saveSettings(App.settings);
      applySettingsToUI(); applyTheme();
    });
  });
  const bind = (id, key, cb) => {
    document.getElementById(id).addEventListener('change', (e) => {
      App.settings[key] = e.target.checked;
      Storage.saveSettings(App.settings);
      cb?.(e.target.checked);
    });
  };
  bind('setting-sound', 'sound', v => AudioFX.setEnabled(v));
  bind('setting-vibration', 'vibration', v => AudioFX.setVibrationEnabled(v));
  bind('setting-timer', 'showTimer', v => document.getElementById('hud-timer-chip').classList.toggle('hidden', !v));
  bind('setting-moves', 'showMoves', v => document.getElementById('hud-moves-chip').classList.toggle('hidden', !v));
  bind('setting-autosave', 'autoSave');
  bind('setting-animations', 'animations', v => { document.documentElement.dataset.anim = v ? 'on' : 'off'; });

  document.getElementById('btn-reset-progress').addEventListener('click', () => UI.showOverlay('confirm-reset-overlay'));
  document.getElementById('btn-cancel-reset').addEventListener('click', () => UI.hideOverlay('confirm-reset-overlay'));
  document.getElementById('btn-confirm-reset').addEventListener('click', async () => {
    Storage.resetAll();
    try {
      if (PhotoDB.isSupported()) {
        const photos = await PhotoDB.getAll();
        for (const p of photos) await PhotoDB.remove(p.id);
      }
    } catch (e) { console.warn(e); }
    App.settings = Storage.getSettings();
    applySettingsToUI(); applyTheme();
    UI.hideOverlay('confirm-reset-overlay');
    UI.toast('Прогресс сброшен');
    UI.resetStack('menu');
    refreshContinueBanner();
  });

  UI.setOnLeave('settings', () => {});
}

/* ============================================================== OVERLAYS */
function wireGlobalOverlays() {
  wireGlobalOverlaysPhotoDelete();
}

/* Hook screen-enter side effects that need fresh data */
const _showScreen = UI.showScreen;
UI.showScreen = function (name, opts) {
  _showScreen(name, opts);
  if (name === 'my-photos') renderMyPhotos();
  if (name === 'stats') renderStats();
};
