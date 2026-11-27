import { formatSpeed, formatTime } from './formats.js';

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKeyToUtcMs(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function recordListeningSeconds(stats, deltaSeconds = 0, dateKey = getLocalDateKey()) {
  const base = stats && typeof stats === 'object' ? stats : {};
  let totalSeconds = Math.max(0, Number(base.totalSeconds) || 0);
  let todayDate = typeof base.todayDate === 'string' && base.todayDate ? base.todayDate : dateKey;
  let todaySeconds = Math.max(0, Number(base.todaySeconds) || 0);
  let streakDays = Math.max(0, Math.floor(Number(base.streakDays) || 0));
  let lastActiveDate = typeof base.lastActiveDate === 'string' ? base.lastActiveDate : '';

  if (todayDate !== dateKey) {
    todayDate = dateKey;
    todaySeconds = 0;
  }

  const delta = Math.max(0, Number(deltaSeconds) || 0);
  const lastMs = parseDateKeyToUtcMs(lastActiveDate);
  const curMs = parseDateKeyToUtcMs(dateKey);
  const dayDiff = lastMs !== null && curMs !== null ? Math.round((curMs - lastMs) / 86_400_000) : null;

  if (delta > 0) {
    totalSeconds += delta;
    todaySeconds += delta;
    if (!lastActiveDate) {
      streakDays = 1;
    } else if (dayDiff === 0) {
      streakDays = Math.max(1, streakDays);
    } else if (dayDiff === 1) {
      streakDays += 1;
    } else if (dayDiff === null || dayDiff > 1) {
      streakDays = 1;
    }
    lastActiveDate = dateKey;
  } else if (dayDiff !== null && dayDiff > 1) {
    streakDays = 0;
  }

  return {
    totalSeconds,
    todayDate,
    todaySeconds,
    streakDays,
    lastActiveDate,
  };
}

const BACKUP_SETTING_KEYS = [
  'theme',
  'pinnedSpeeds',
  'preservesPitch',
  'autoRewind',
  'voiceBoost',
  'skipBackSeconds',
  'skipForwardSeconds',
  'librarySort',
  'lastPlaybackRate',
  'speedConsoleOpen',
  'listeningStats',
];

export function buildLibraryBackup({ books = [], bookmarks = [], settings = {} } = {}) {
  const booksById = new Map((books || []).map((b) => [b.id, b]));
  const safeSettings = {};
  for (const key of BACKUP_SETTING_KEYS) {
    if (settings && settings[key] !== undefined) {
      safeSettings[key] = settings[key];
    }
  }

  const exportedBooks = (books || []).map((b) => ({
    id: b.id,
    title: b.title || '',
    author: b.author || '',
    trackCount: b.trackCount || 0,
    totalDuration: b.totalDuration || 0,
    currentTrackIndex: b.currentTrackIndex || 0,
    currentTime: b.currentTime || 0,
    bookTime: b.bookTime || 0,
    playbackRate: b.playbackRate || 1.0,
    completed: Boolean(b.completed),
    lastPlayedAt: b.lastPlayedAt || 0,
  }));

  const exportedBookmarks = (bookmarks || []).map((bm) => {
    const book = booksById.get(bm.bookId);
    return {
      id: bm.id,
      bookId: bm.bookId,
      bookTitle: book?.title || '',
      trackId: bm.trackId || '',
      trackOrder: bm.trackOrder ?? 0,
      trackTitle: bm.trackTitle || 'Chapter',
      time: Math.max(0, Number(bm.time) || 0),
      bookTime: Math.max(0, Number(bm.bookTime) || 0),
      speed: Number(bm.speed) || 1.0,
      title: bm.title || `${bm.trackTitle || 'Chapter'} · ${formatTime(bm.time || 0)}`,
      note: bm.note || '',
      category: bm.category || 'important',
      createdAt: bm.createdAt || Date.now(),
      updatedAt: bm.updatedAt || Date.now(),
    };
  });

  return JSON.stringify(
    {
      schemaVersion: 1,
      app: 'Lectio',
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      books: exportedBooks,
      bookmarks: exportedBookmarks,
      summary: {
        bookCount: exportedBooks.length,
        bookmarkCount: exportedBookmarks.length,
        speedNote: formatSpeed(safeSettings.lastPlaybackRate || 1.0),
      },
    },
    null,
    2
  );
}

export function parseLibraryBackup(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) {
    throw new Error('Unsupported or invalid Lectio backup schema.');
  }

  if (!Array.isArray(parsed.books) || !Array.isArray(parsed.bookmarks)) {
    throw new Error('Backup file is missing books or bookmarks arrays.');
  }

  const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  return {
    settings,
    books: parsed.books,
    bookmarks: parsed.bookmarks,
  };
}
