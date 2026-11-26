import { formatSpeed, formatTime } from './formats.js';

export const BOOKMARK_CATEGORIES = {
  important: { id: 'important', label: 'Important', color: '#f59e0b' },
  definition: { id: 'definition', label: 'Definition', color: '#38bdf8' },
  review: { id: 'review', label: 'Review', color: '#fb7185' },
  quote: { id: 'quote', label: 'Quote', color: '#34d399' },
  exam: { id: 'exam', label: 'Exam', color: '#a78bfa' },
};

function generateBookmarkId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBookmarkData({
  book,
  track,
  time = 0,
  bookTime = 0,
  speed = 1.0,
  title = '',
  note = '',
  category = 'important',
}) {
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  const safeBookTime = Math.max(0, Number.isFinite(bookTime) ? bookTime : safeTime);
  const trackTitle = track?.title || 'Chapter';
  const cleanTitle = String(title || '').trim();
  const validCategory = BOOKMARK_CATEGORIES[category] ? category : 'important';
  const now = Date.now();

  return {
    id: generateBookmarkId(),
    bookId: book.id,
    trackId: track.id,
    trackOrder: track.order ?? 0,
    trackTitle,
    time: safeTime,
    bookTime: safeBookTime,
    speed,
    title: cleanTitle || `${trackTitle} · ${formatTime(safeTime)}`,
    note: String(note || '').trim(),
    category: validCategory,
    createdAt: now,
    updatedAt: now,
  };
}

export function sortBookmarks(bookmarks, sortBy = 'position') {
  const list = [...(bookmarks || [])];
  if (sortBy === 'newest') {
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  return list.sort((a, b) => {
    const orderDiff = (a.trackOrder ?? 0) - (b.trackOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    const timeDiff = (a.time ?? 0) - (b.time ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

export function filterBookmarks(bookmarks, { query = '', category = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (bookmarks || []).filter((bm) => {
    if (category && category !== 'all' && bm.category !== category) {
      return false;
    }
    if (!q) return true;
    return (
      (bm.title || '').toLowerCase().includes(q) ||
      (bm.note || '').toLowerCase().includes(q) ||
      (bm.trackTitle || '').toLowerCase().includes(q)
    );
  });
}

export function exportBookmarksToMarkdown(book, bookmarks) {
  const sorted = sortBookmarks(bookmarks, 'position');
  const lines = [
    `# ${book?.title || 'Textbook'} — Study Bookmarks`,
    '',
    book?.author ? `**Author:** ${book.author}  ` : '',
    `**Exported:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Total Bookmarks:** ${sorted.length}`,
    '',
    '---',
    '',
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));

  let currentTrack = null;
  for (const bm of sorted) {
    if (bm.trackTitle !== currentTrack) {
      currentTrack = bm.trackTitle;
      lines.push(`## ${currentTrack}`);
      lines.push('');
    }
    const cat = BOOKMARK_CATEGORIES[bm.category]?.label || bm.category;
    const speedTag = bm.speed ? ` · ${formatSpeed(bm.speed)}` : '';
    lines.push(`- **[${formatTime(bm.time)}]** \`${cat}\`${speedTag} — **${bm.title}**`);
    if (bm.note) {
      lines.push(`  > ${bm.note.replace(/\n/g, '\n  > ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function exportBookmarksToJSON(book, bookmarks) {
  const sorted = sortBookmarks(bookmarks, 'position');
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      book: {
        id: book?.id || '',
        title: book?.title || '',
        author: book?.author || '',
      },
      bookmarks: sorted.map((bm) => ({
        trackOrder: bm.trackOrder,
        trackTitle: bm.trackTitle,
        time: bm.time,
        bookTime: bm.bookTime,
        speed: bm.speed,
        title: bm.title,
        note: bm.note,
        category: bm.category,
        createdAt: bm.createdAt,
      })),
    },
    null,
    2
  );
}

export function parseImportedBookmarksJSON(jsonString, bookId, tracks = []) {
  const parsed = JSON.parse(jsonString);
  const rawList = Array.isArray(parsed) ? parsed : parsed?.bookmarks;
  if (!Array.isArray(rawList)) {
    throw new Error('Invalid bookmark JSON format: missing bookmarks array.');
  }

  const byOrder = new Map(tracks.map((t) => [t.order, t]));
  const byTitle = new Map(tracks.map((t) => [String(t.title).toLowerCase(), t]));
  const now = Date.now();

  return rawList.map((item) => {
    const matchedTrack =
      byOrder.get(item.trackOrder) ||
      byTitle.get(String(item.trackTitle || '').toLowerCase()) ||
      tracks[0];

    const time = Math.max(0, Number(item.time) || 0);
    const category = BOOKMARK_CATEGORIES[item.category] ? item.category : 'important';

    return {
      id: generateBookmarkId(),
      bookId,
      trackId: matchedTrack?.id || '',
      trackOrder: matchedTrack?.order ?? (Number(item.trackOrder) || 0),
      trackTitle: matchedTrack?.title || item.trackTitle || 'Chapter',
      time,
      bookTime: Number(item.bookTime) || time,
      speed: Number(item.speed) || 1.0,
      title: String(item.title || '').trim() || `${matchedTrack?.title || 'Chapter'} · ${formatTime(time)}`,
      note: String(item.note || '').trim(),
      category,
      createdAt: Number(item.createdAt) || now,
      updatedAt: now,
    };
  });
}
