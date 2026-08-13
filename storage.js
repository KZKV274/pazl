/**
 * storage.js
 * All persistence for the game.
 * - localStorage  -> settings, stats/records, current save-state (small JSON)
 * - IndexedDB     -> user-uploaded photos (blobs), too big/unsuitable for localStorage
 *
 * Everything here is defensive: if a browser lacks a feature (or it throws,
 * e.g. private-browsing quota errors) we fail soft and keep the game usable.
 */

const LS_KEYS = {
  SETTINGS: 'puzzle:settings',
  STATS: 'puzzle:stats',
  RECORDS: 'puzzle:records',
  SAVE: 'puzzle:save',
  ACHIEVEMENTS: 'puzzle:achievements',
  STREAK: 'puzzle:streak',
  DAILY: 'puzzle:daily'
};

const DEFAULT_SETTINGS = {
  theme: 'dark',           // 'dark' | 'light' | 'system'
  sound: true,
  vibration: true,
  showTimer: true,
  showMoves: true,
  autoSave: true,
  animations: true
};

const DEFAULT_STATS = {
  totalGames: 0,
  completedGames: 0,
  incompleteGames: 0,
  hintsUsedTotal: 0,
  byDifficulty: {} // "4x4" -> { bestTimeMs, bestMoves, plays, completions }
};

function safeParse(json, fallback) {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const Storage = {
  // ---------- settings ----------
  getSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...safeParse(localStorage.getItem(LS_KEYS.SETTINGS), {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  saveSettings(settings) {
    try {
      localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.warn('Storage: failed to save settings', e);
      return false;
    }
  },

  // ---------- stats / records ----------
  getStats() {
    try {
      const s = safeParse(localStorage.getItem(LS_KEYS.STATS), {});
      return { ...DEFAULT_STATS, ...s, byDifficulty: { ...(s.byDifficulty || {}) } };
    } catch {
      return { ...DEFAULT_STATS };
    }
  },
  saveStats(stats) {
    try {
      localStorage.setItem(LS_KEYS.STATS, JSON.stringify(stats));
      return true;
    } catch (e) {
      console.warn('Storage: failed to save stats', e);
      return false;
    }
  },

  getRecords() {
    // key: `${puzzleId}:${difficultyKey}` -> { bestTimeMs, bestMoves, bestScore, completedCount }
    return safeParse(localStorage.getItem(LS_KEYS.RECORDS), {});
  },
  saveRecords(records) {
    try {
      localStorage.setItem(LS_KEYS.RECORDS, JSON.stringify(records));
      return true;
    } catch (e) {
      console.warn('Storage: failed to save records', e);
      return false;
    }
  },

  // ---------- achievements ----------
  getAchievements() {
    return safeParse(localStorage.getItem(LS_KEYS.ACHIEVEMENTS), {});
  },
  saveAchievements(data) {
    try {
      localStorage.setItem(LS_KEYS.ACHIEVEMENTS, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  getStreak() {
    return safeParse(localStorage.getItem(LS_KEYS.STREAK), { current: 0, lastCompletedAt: 0 });
  },
  saveStreak(data) {
    try {
      localStorage.setItem(LS_KEYS.STREAK, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  // ---------- daily puzzle record of "last played date" ----------
  getDailyMeta() {
    return safeParse(localStorage.getItem(LS_KEYS.DAILY), {});
  },
  saveDailyMeta(data) {
    try {
      localStorage.setItem(LS_KEYS.DAILY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  // ---------- in-progress game save ----------
  getSave() {
    return safeParse(localStorage.getItem(LS_KEYS.SAVE), null);
  },
  saveGame(state) {
    try {
      localStorage.setItem(LS_KEYS.SAVE, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('Storage: failed to save game (quota?)', e);
      return false;
    }
  },
  clearSave() {
    try {
      localStorage.removeItem(LS_KEYS.SAVE);
    } catch { /* noop */ }
  },

  // ---------- full reset ----------
  resetAll() {
    try {
      Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
    } catch { /* noop */ }
  }
};

/* ------------------------------------------------------------------ *
 *  IndexedDB: user photos
 * ------------------------------------------------------------------ */

const PhotoDB = (() => {
  const DB_NAME = 'puzzle-photos-db';
  const DB_VERSION = 1;
  const STORE = 'photos';
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB not supported'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function add(photo) {
    // photo: { id, name, blob, width, height, createdAt }
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(photo);
      tx.oncomplete = () => resolve(photo);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  return { add, getAll, get, remove, isSupported: () => 'indexedDB' in window };
})();
