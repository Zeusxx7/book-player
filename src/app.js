import {
  AUDIO_ACCEPT_STRING,
  calcSpeedAdjustedTime,
  clampSpeed,
  DEFAULT_SPEED,
  formatDurationHuman,
  formatSpeed,
  formatTime,
} from './formats.js';
import {
  deleteBook,
  deleteBookmark,
  getAllBookmarks,
  getAllBooks,
  getAllSettings,
  getBookmarksForBook,
  getStorageEstimate,
  getTracksForBook,
  putBookmark,
  setSetting,
  updateBook,
} from './db.js';
import {
  collectFilesFromDataTransfer,
  importFiles,
  normalizeInputFileList,
  pickDirectoryWithNativeAPI,
} from './importer.js';
import { LectioPlayer } from './player.js';
import {
  BOOKMARK_CATEGORIES,
  createBookmarkData,
  exportBookmarksToJSON,
  exportBookmarksToMarkdown,
  filterBookmarks,
  parseImportedBookmarksJSON,
  sortBookmarks,
} from './bookmarks.js';

const PRESET_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

const player = new LectioPlayer();

const state = {
  view: 'library',
  books: [],
  bookmarkCountsByBook: new Map(),
  activeBookBookmarks: [],
  libraryQuery: '',
  chapterQuery: '',
  bookmarkQuery: '',
  bookmarkCategory: 'all',
  bookmarkSort: 'position',
  activeTab: 'chapters',
  pinnedSpeeds: [1.15, 1.35, 1.65],
  theme: 'dark',
  editingBookmark: null,
  modalBookmarkTime: 0,
  modalBookmarkCategory: 'important',
  editingBookId: null,
  deferredInstallPrompt: null,
};

const els = {
  brandBtn: document.getElementById('brandBtn'),
  navLibraryBtn: document.getElementById('navLibraryBtn'),
  navPlayerBtn: document.getElementById('navPlayerBtn'),
  installAppBtn: document.getElementById('installAppBtn'),
  shortcutsBtn: document.getElementById('shortcutsBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),

  folderInput: document.getElementById('folderInput'),
  filesInput: document.getElementById('filesInput'),
  appendFolderInput: document.getElementById('appendFolderInput'),
  appendFilesInput: document.getElementById('appendFilesInput'),
  importBookmarksInput: document.getElementById('importBookmarksInput'),

  libraryView: document.getElementById('libraryView'),
  playerView: document.getElementById('playerView'),
  dropZone: document.getElementById('dropZone'),
  uploadFolderBtn: document.getElementById('uploadFolderBtn'),
  uploadFilesBtn: document.getElementById('uploadFilesBtn'),
  librarySearchInput: document.getElementById('librarySearchInput'),
  storageInfo: document.getElementById('storageInfo'),
  libraryEmpty: document.getElementById('libraryEmpty'),
  booksGrid: document.getElementById('booksGrid'),

  backToLibraryBtn: document.getElementById('backToLibraryBtn'),
  playerCoverWrap: document.getElementById('playerCoverWrap'),
  playerChapterBadge: document.getElementById('playerChapterBadge'),
  playerBookTitle: document.getElementById('playerBookTitle'),
  playerSectionName: document.getElementById('playerSectionName'),
  playerTrackTitle: document.getElementById('playerTrackTitle'),
  bookProgressFill: document.getElementById('bookProgressFill'),
  bookProgressText: document.getElementById('bookProgressText'),
  bookRemainingText: document.getElementById('bookRemainingText'),

  scrubMarkers: document.getElementById('scrubMarkers'),
  scrubRange: document.getElementById('scrubRange'),
  currentTimeLabel: document.getElementById('currentTimeLabel'),
  remainingTimeLabel: document.getElementById('remainingTimeLabel'),

  prevTrackBtn: document.getElementById('prevTrackBtn'),
  skipBackBtn: document.getElementById('skipBackBtn'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  skipFwdBtn: document.getElementById('skipFwdBtn'),
  nextTrackBtn: document.getElementById('nextTrackBtn'),

  quickBookmarkBtn: document.getElementById('quickBookmarkBtn'),
  noteBookmarkBtn: document.getElementById('noteBookmarkBtn'),
  sleepTimerSelect: document.getElementById('sleepTimerSelect'),
  sleepCountdownPill: document.getElementById('sleepCountdownPill'),
  muteBtn: document.getElementById('muteBtn'),
  volumeRange: document.getElementById('volumeRange'),

  pitchToggleInput: document.getElementById('pitchToggleInput'),
  speedReadoutBtn: document.getElementById('speedReadoutBtn'),
  speedExactInput: document.getElementById('speedExactInput'),
  resetSpeedBtn: document.getElementById('resetSpeedBtn'),
  speedSlider: document.getElementById('speedSlider'),
  speedPresetsRow: document.getElementById('speedPresetsRow'),
  pinSpeedBtn: document.getElementById('pinSpeedBtn'),
  pinnedSpeedsList: document.getElementById('pinnedSpeedsList'),

  tabChaptersBtn: document.getElementById('tabChaptersBtn'),
  tabBookmarksBtn: document.getElementById('tabBookmarksBtn'),
  chaptersCountBadge: document.getElementById('chaptersCountBadge'),
  bookmarksCountBadge: document.getElementById('bookmarksCountBadge'),
  chaptersPanel: document.getElementById('chaptersPanel'),
  bookmarksPanel: document.getElementById('bookmarksPanel'),
  chapterSearchInput: document.getElementById('chapterSearchInput'),
  appendFolderBtn: document.getElementById('appendFolderBtn'),
  appendFilesBtn: document.getElementById('appendFilesBtn'),
  chaptersList: document.getElementById('chaptersList'),

  bookmarkSearchInput: document.getElementById('bookmarkSearchInput'),
  bookmarkSortSelect: document.getElementById('bookmarkSortSelect'),
  bookmarkFilterChips: document.getElementById('bookmarkFilterChips'),
  exportBookmarksMdBtn: document.getElementById('exportBookmarksMdBtn'),
  exportBookmarksJsonBtn: document.getElementById('exportBookmarksJsonBtn'),
  importBookmarksJsonBtn: document.getElementById('importBookmarksJsonBtn'),
  bookmarksList: document.getElementById('bookmarksList'),

  miniPlayer: document.getElementById('miniPlayer'),
  miniPlayerOpenBtn: document.getElementById('miniPlayerOpenBtn'),
  miniCover: document.getElementById('miniCover'),
  miniBookTitle: document.getElementById('miniBookTitle'),
  miniTrackTitle: document.getElementById('miniTrackTitle'),
  miniSpeedBadge: document.getElementById('miniSpeedBadge'),
  miniBookmarkBtn: document.getElementById('miniBookmarkBtn'),
  miniPlayPauseBtn: document.getElementById('miniPlayPauseBtn'),

  dragOverlay: document.getElementById('dragOverlay'),
  importModal: document.getElementById('importModal'),
  importStatusText: document.getElementById('importStatusText'),
  importProgressBar: document.getElementById('importProgressBar'),
  importFileText: document.getElementById('importFileText'),

  bookmarkModal: document.getElementById('bookmarkModal'),
  bookmarkModalTitle: document.getElementById('bookmarkModalTitle'),
  closeBookmarkModalBtn: document.getElementById('closeBookmarkModalBtn'),
  bookmarkForm: document.getElementById('bookmarkForm'),
  bmTrackLabel: document.getElementById('bmTrackLabel'),
  bmNudgeBackBtn: document.getElementById('bmNudgeBackBtn'),
  bmTimeReadout: document.getElementById('bmTimeReadout'),
  bmNudgeFwdBtn: document.getElementById('bmNudgeFwdBtn'),
  bmUseCurrentBtn: document.getElementById('bmUseCurrentBtn'),
  bmTitleInput: document.getElementById('bmTitleInput'),
  bmCategoryPills: document.getElementById('bmCategoryPills'),
  bmNoteInput: document.getElementById('bmNoteInput'),
  cancelBookmarkBtn: document.getElementById('cancelBookmarkBtn'),

  bookEditModal: document.getElementById('bookEditModal'),
  closeBookEditModalBtn: document.getElementById('closeBookEditModalBtn'),
  bookEditForm: document.getElementById('bookEditForm'),
  editBookTitleInput: document.getElementById('editBookTitleInput'),
  editBookAuthorInput: document.getElementById('editBookAuthorInput'),
  cancelBookEditBtn: document.getElementById('cancelBookEditBtn'),

  shortcutsModal: document.getElementById('shortcutsModal'),
  closeShortcutsBtn: document.getElementById('closeShortcutsBtn'),
  toastContainer: document.getElementById('toastContainer'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bookInitials(title = '') {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'L';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function bookCoverMarkup(book) {
  if (book?.coverDataUrl) {
    return `<img src="${escapeHtml(book.coverDataUrl)}" alt="" loading="lazy" />`;
  }
  return `<span>${escapeHtml(bookInitials(book?.title))}</span>`;
}

function showToast(message, options = {}) {
  const { actionLabel = '', onAction = null, duration = 4200, isError = false } = options;
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) {
    toast.style.borderLeftColor = 'var(--danger)';
  }

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionLabel && typeof onAction === 'function') {
    const actions = document.createElement('div');
    actions.className = 'toast-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-accent btn-xs';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      onAction();
      toast.remove();
    });
    actions.appendChild(btn);
    toast.appendChild(actions);
  }

  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, duration);
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  els.themeIcon.textContent = state.theme === 'light' ? '☾' : '☀';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', state.theme === 'light' ? '#f6f4ee' : '#0f1117');
  }
}

function switchView(view) {
  if (view === 'player' && !player.book) return;
  state.view = view;
  const isLibrary = view === 'library';
  els.libraryView.classList.toggle('hidden', !isLibrary);
  els.playerView.classList.toggle('hidden', isLibrary);
  els.navLibraryBtn.classList.toggle('active', isLibrary);
  els.navPlayerBtn.classList.toggle('active', !isLibrary);
  els.navPlayerBtn.disabled = !player.book;
  updateMiniPlayer();
}

function switchPanelTab(tab) {
  state.activeTab = tab;
  const isChapters = tab === 'chapters';
  els.tabChaptersBtn.classList.toggle('active', isChapters);
  els.tabBookmarksBtn.classList.toggle('active', !isChapters);
  els.tabChaptersBtn.setAttribute('aria-selected', String(isChapters));
  els.tabBookmarksBtn.setAttribute('aria-selected', String(!isChapters));
  els.chaptersPanel.classList.toggle('hidden', !isChapters);
  els.bookmarksPanel.classList.toggle('hidden', isChapters);
}

async function refreshStorageInfo() {
  const est = await getStorageEstimate();
  if (!est || !Number.isFinite(est.usage)) {
    els.storageInfo.textContent = 'Offline IndexedDB Ready';
    return;
  }
  const mb = (est.usage / (1024 * 1024)).toFixed(1);
  if (est.quota) {
    const gb = (est.quota / (1024 * 1024 * 1024)).toFixed(1);
    els.storageInfo.textContent = `${mb} MB used · ${gb} GB available`;
  } else {
    els.storageInfo.textContent = `${mb} MB stored offline`;
  }
}

async function refreshLibrary() {
  const [books, allBookmarks] = await Promise.all([getAllBooks(), getAllBookmarks()]);
  state.books = books;
  const counts = new Map();
  for (const bm of allBookmarks) {
    counts.set(bm.bookId, (counts.get(bm.bookId) || 0) + 1);
  }
  state.bookmarkCountsByBook = counts;
  renderBooksGrid();
  refreshStorageInfo();
}

function renderBooksGrid() {
  const query = state.libraryQuery.trim().toLowerCase();
  const filtered = state.books.filter((book) => {
    if (!query) return true;
    return (
      (book.title || '').toLowerCase().includes(query) ||
      (book.author || '').toLowerCase().includes(query)
    );
  });

  els.libraryEmpty.classList.toggle('hidden', state.books.length > 0);
  els.booksGrid.innerHTML = '';

  for (const book of filtered) {
    const total = book.totalDuration || 0;
    const approxCurrent = book.currentTime || 0;
    const pct = total > 0
      ? Math.min(100, Math.round(((approxCurrent + (book.currentTrackIndex || 0) * (total / Math.max(1, book.trackCount || 1))) / total) * 100))
      : 0;
    const bmCount = state.bookmarkCountsByBook.get(book.id) || 0;
    const isActive = player.book?.id === book.id;

    const card = document.createElement('article');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="book-card-top">
        <div class="book-cover">${bookCoverMarkup(book)}</div>
        <div class="book-card-info">
          <h3 class="book-card-title">${escapeHtml(book.title)}</h3>
          <p class="book-card-author">${escapeHtml(book.author || 'Unknown Author')}</p>
          <div class="book-badges">
            <span class="meta-badge">${book.trackCount || 0} chapters</span>
            <span class="meta-badge">${formatDurationHuman(total)}</span>
            <span class="meta-badge accent mono">${formatSpeed(book.playbackRate || 1)}</span>
            ${bmCount > 0 ? `<span class="meta-badge">★ ${bmCount}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="book-progress-wrap">
        <div class="book-progress-bar">
          <div class="book-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="book-progress-labels">
          <span>Ch ${(book.currentTrackIndex || 0) + 1} of ${book.trackCount || 1}</span>
          <span>${formatTime(book.currentTime || 0)}</span>
        </div>
      </div>
      <div class="book-card-actions">
        <button class="btn btn-primary btn-sm btn-resume" data-action="open" type="button">
          ${isActive && player.isPlaying ? 'Playing…' : 'Open & Listen'}
        </button>
        <button class="btn btn-secondary btn-sm" data-action="edit" type="button" title="Edit Title/Author">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete" type="button" title="Delete Textbook">Delete</button>
      </div>
    `;

    card.querySelector('[data-action="open"]').addEventListener('click', () => openBookInPlayer(book.id, true));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openBookEditModal(book));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteBook(book));

    els.booksGrid.appendChild(card);
  }
}

async function openBookInPlayer(bookId, autoplay = false) {
  const book = state.books.find((b) => b.id === bookId) || (await getAllBooks()).find((b) => b.id === bookId);
  if (!book) return;

  const [tracks, bookmarks] = await Promise.all([
    getTracksForBook(book.id),
    getBookmarksForBook(book.id),
  ]);

  state.activeBookBookmarks = bookmarks;
  state.chapterQuery = '';
  els.chapterSearchInput.value = '';
  els.navPlayerBtn.disabled = false;

  await player.openBook(book, tracks, { autoplay });
  switchView('player');
  renderPlayerAll();
}

async function handleDeleteBook(book) {
  const confirmed = window.confirm(`Delete "${book.title}" and all ${book.trackCount || 0} audio chapters and bookmarks from offline storage?`);
  if (!confirmed) return;

  if (player.book?.id === book.id) {
    player.unloadBook();
    switchView('library');
  }

  await deleteBook(book.id);
  await refreshLibrary();
  showToast(`Deleted "${book.title}"`);
}

function renderPlayerAll() {
  const s = player.getState();
  if (!s.book) return;

  els.playerCoverWrap.innerHTML = bookCoverMarkup(s.book);
  els.playerBookTitle.textContent = s.book.title;
  els.playerTrackTitle.textContent = s.currentTrack?.title || 'No chapter loaded';
  els.playerChapterBadge.textContent = `Chapter ${s.currentTrackIndex + 1} / ${s.tracks.length}`;

  if (s.currentTrack?.section) {
    els.playerSectionName.textContent = s.currentTrack.section;
    els.playerSectionName.classList.remove('hidden');
  } else {
    els.playerSectionName.classList.add('hidden');
  }

  els.playPauseBtn.textContent = s.isPlaying ? '⏸' : '▶';
  els.muteBtn.textContent = s.muted || s.volume === 0 ? '🔇' : '🔊';
  els.volumeRange.value = String(s.volume);
  els.pitchToggleInput.checked = s.preservesPitch;

  renderTimeAndProgress(s);
  renderSpeedControls(s.playbackRate);
  renderScrubMarkers();
  renderChaptersList();
  renderBookmarksPanel();
  updateMiniPlayer();
}

function renderTimeAndProgress(s) {
  const dur = s.duration || 0;
  const cur = s.currentTime || 0;
  const rate = clampSpeed(s.playbackRate);

  els.scrubRange.max = String(dur > 0 ? dur : 100);
  els.scrubRange.value = String(dur > 0 ? Math.min(cur, dur) : 0);

  els.currentTimeLabel.textContent = formatTime(cur);
  const rawRemaining = Math.max(0, dur - cur);
  if (Math.abs(rate - 1.0) > 0.004 && rawRemaining > 0) {
    const adjRemaining = calcSpeedAdjustedTime(rawRemaining, rate);
    els.remainingTimeLabel.textContent = `−${formatTime(rawRemaining)} (${formatTime(adjRemaining)} at ${formatSpeed(rate)})`;
  } else {
    els.remainingTimeLabel.textContent = `−${formatTime(rawRemaining)}`;
  }

  const bp = s.bookProgress;
  const pct = Math.round(bp.percent || 0);
  els.bookProgressFill.style.width = `${bp.percent || 0}%`;
  els.bookProgressText.textContent = `${pct}% complete`;

  const bookRemAdj = calcSpeedAdjustedTime(bp.remainingBookTime, rate);
  if (Math.abs(rate - 1.0) > 0.004 && bp.remainingBookTime > 0) {
    els.bookRemainingText.textContent = `${formatDurationHuman(bookRemAdj)} left at ${formatSpeed(rate)}`;
  } else {
    els.bookRemainingText.textContent = `${formatDurationHuman(bp.remainingBookTime)} left`;
  }
}

function renderSpeedControls(rate) {
  const formatted = formatSpeed(rate);
  els.speedReadoutBtn.textContent = formatted;
  els.speedSlider.value = String(rate);
  els.pinSpeedBtn.textContent = `+ Pin ${formatted}`;
  els.miniSpeedBadge.textContent = formatted;

  // Render preset speeds
  els.speedPresetsRow.innerHTML = '';
  for (const preset of PRESET_SPEEDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-pill ${Math.abs(rate - preset) < 0.001 ? 'active' : ''}`;
    btn.textContent = formatSpeed(preset);
    btn.addEventListener('click', () => player.setSpeed(preset));
    els.speedPresetsRow.appendChild(btn);
  }

  // Render pinned custom speeds
  els.pinnedSpeedsList.innerHTML = '';
  for (const pinned of state.pinnedSpeeds) {
    const chip = document.createElement('span');
    chip.className = 'pinned-chip';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'pinned-chip-btn';
    applyBtn.textContent = formatSpeed(pinned);
    if (Math.abs(rate - pinned) < 0.001) {
      applyBtn.style.color = 'var(--accent)';
    }
    applyBtn.addEventListener('click', () => player.setSpeed(pinned));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'pinned-chip-del';
    delBtn.title = 'Remove pinned speed';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      state.pinnedSpeeds = state.pinnedSpeeds.filter((v) => Math.abs(v - pinned) >= 0.001);
      setSetting('pinnedSpeeds', state.pinnedSpeeds).catch(() => {});
      renderSpeedControls(player.playbackRate);
    });

    chip.appendChild(applyBtn);
    chip.appendChild(delBtn);
    els.pinnedSpeedsList.appendChild(chip);
  }
}

function renderScrubMarkers() {
  els.scrubMarkers.innerHTML = '';
  const track = player.getCurrentTrack();
  const dur = player.duration || track?.duration || 0;
  if (!track || dur <= 0) return;

  const trackBookmarks = state.activeBookBookmarks.filter((bm) => bm.trackId === track.id);
  for (const bm of trackBookmarks) {
    const pct = Math.max(0, Math.min(100, (bm.time / dur) * 100));
    const cat = BOOKMARK_CATEGORIES[bm.category] || BOOKMARK_CATEGORIES.important;
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'scrub-marker';
    dot.style.left = `${pct}%`;
    dot.style.background = cat.color;
    dot.title = `${bm.title} (${formatTime(bm.time)})`;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      player.seekTo(bm.time);
    });
    els.scrubMarkers.appendChild(dot);
  }
}

function renderChaptersList() {
  const tracks = player.tracks || [];
  els.chaptersCountBadge.textContent = String(tracks.length);

  const bmPerTrack = new Map();
  for (const bm of state.activeBookBookmarks) {
    bmPerTrack.set(bm.trackId, (bmPerTrack.get(bm.trackId) || 0) + 1);
  }

  const query = state.chapterQuery.trim().toLowerCase();
  els.chaptersList.innerHTML = '';

  let lastSection = null;
  tracks.forEach((track, idx) => {
    if (query) {
      const hay = `${track.title} ${track.section || ''} ${track.fileName}`.toLowerCase();
      if (!hay.includes(query)) return;
    }

    if (track.section && track.section !== lastSection) {
      lastSection = track.section;
      const heading = document.createElement('div');
      heading.className = 'section-heading';
      heading.textContent = track.section;
      els.chaptersList.appendChild(heading);
    }

    const isActive = idx === player.currentTrackIndex;
    const bmCount = bmPerTrack.get(track.id) || 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `chapter-row ${isActive ? 'active' : ''}`;
    row.innerHTML = `
      <span class="chapter-num">${isActive && player.isPlaying ? '▶' : idx + 1}</span>
      <div class="chapter-info">
        <div class="chapter-title">${escapeHtml(track.title)}</div>
        <div class="chapter-sub">
          <span class="format-tag">${escapeHtml(track.format || 'AUDIO')}</span>
          ${bmCount > 0 ? `<span>★ ${bmCount}</span>` : ''}
        </div>
      </div>
      <span class="chapter-duration">${track.duration ? formatTime(track.duration) : '--:--'}</span>
    `;
    row.addEventListener('click', () => {
      player.loadTrack(idx, 0, true);
    });
    els.chaptersList.appendChild(row);
  });
}

function renderBookmarksPanel() {
  els.bookmarksCountBadge.textContent = String(state.activeBookBookmarks.length);

  // Filter category chips
  els.bookmarkFilterChips.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `filter-chip ${state.bookmarkCategory === 'all' ? 'active' : ''}`;
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => {
    state.bookmarkCategory = 'all';
    renderBookmarksPanel();
  });
  els.bookmarkFilterChips.appendChild(allChip);

  for (const cat of Object.values(BOOKMARK_CATEGORIES)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `filter-chip ${state.bookmarkCategory === cat.id ? 'active' : ''}`;
    chip.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}`;
    chip.addEventListener('click', () => {
      state.bookmarkCategory = cat.id;
      renderBookmarksPanel();
    });
    els.bookmarkFilterChips.appendChild(chip);
  }

  const filtered = filterBookmarks(state.activeBookBookmarks, {
    query: state.bookmarkQuery,
    category: state.bookmarkCategory,
  });
  const sorted = sortBookmarks(filtered, state.bookmarkSort);

  els.bookmarksList.innerHTML = '';
  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 14px';
    empty.textContent = state.activeBookBookmarks.length === 0
      ? 'No bookmarks yet. Press B for a quick bookmark or Shift+B to add a study note.'
      : 'No bookmarks match your filter.';
    els.bookmarksList.appendChild(empty);
    return;
  }

  for (const bm of sorted) {
    const cat = BOOKMARK_CATEGORIES[bm.category] || BOOKMARK_CATEGORIES.important;
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.innerHTML = `
      <div class="bookmark-card-top">
        <span class="bookmark-cat-label">
          <span class="cat-dot" style="background:${cat.color}"></span>
          ${escapeHtml(cat.label)} · ${formatSpeed(bm.speed || 1)}
        </span>
        <button class="bookmark-jump-btn" type="button" title="Jump to timestamp">${formatTime(bm.time)}</button>
      </div>
      <div class="bookmark-title">${escapeHtml(bm.title)}</div>
      <div class="bookmark-chapter-sub">${escapeHtml(bm.trackTitle)}</div>
      ${bm.note ? `<p class="bookmark-note">${escapeHtml(bm.note)}</p>` : ''}
      <div class="bookmark-actions">
        <button class="btn btn-secondary btn-xs" data-action="edit" type="button">Edit</button>
        <button class="btn btn-danger btn-xs" data-action="delete" type="button">Delete</button>
      </div>
    `;

    card.querySelector('.bookmark-jump-btn').addEventListener('click', () => {
      const idx = player.tracks.findIndex((t) => t.id === bm.trackId);
      const safeIdx = idx >= 0 ? idx : Math.max(0, Math.min(bm.trackOrder || 0, player.tracks.length - 1));
      player.jumpToPosition(safeIdx, bm.time, true);
    });
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openBookmarkModal(bm));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteBookmark(bm));

    els.bookmarksList.appendChild(card);
  }
}

function updateMiniPlayer() {
  const show = state.view === 'library' && Boolean(player.book);
  els.miniPlayer.classList.toggle('hidden', !show);
  if (!show) return;

  els.miniCover.innerHTML = bookCoverMarkup(player.book);
  els.miniBookTitle.textContent = player.book.title;
  els.miniTrackTitle.textContent = `${player.getCurrentTrack()?.title || ''} · ${formatTime(player.currentTime)}`;
  els.miniSpeedBadge.textContent = formatSpeed(player.playbackRate);
  els.miniPlayPauseBtn.textContent = player.isPlaying ? '⏸' : '▶';
}

async function createQuickBookmark() {
  const track = player.getCurrentTrack();
  if (!player.book || !track) return;

  const bm = createBookmarkData({
    book: player.book,
    track,
    time: player.currentTime,
    bookTime: player.getBookProgress().currentBookTime,
    speed: player.playbackRate,
    category: 'important',
  });

  await putBookmark(bm);
  state.activeBookBookmarks.push(bm);
  renderScrubMarkers();
  renderChaptersList();
  renderBookmarksPanel();
  refreshLibrary();

  showToast(`Bookmarked at ${formatTime(bm.time)}`, {
    actionLabel: 'Add Note',
    onAction: () => openBookmarkModal(bm),
  });
}

function openBookmarkModal(existingBookmark = null) {
  const track = player.getCurrentTrack();
  if (!player.book || !track) return;

  state.editingBookmark = existingBookmark;
  if (existingBookmark) {
    els.bookmarkModalTitle.textContent = 'Edit Study Bookmark';
    state.modalBookmarkTime = existingBookmark.time;
    state.modalBookmarkCategory = existingBookmark.category || 'important';
    els.bmTrackLabel.textContent = existingBookmark.trackTitle;
    els.bmTitleInput.value = existingBookmark.title || '';
    els.bmNoteInput.value = existingBookmark.note || '';
  } else {
    els.bookmarkModalTitle.textContent = 'Add Study Bookmark';
    state.modalBookmarkTime = player.currentTime;
    state.modalBookmarkCategory = 'important';
    els.bmTrackLabel.textContent = track.title;
    els.bmTitleInput.value = '';
    els.bmNoteInput.value = '';
  }

  renderBookmarkModalMeta();
  els.bookmarkModal.classList.remove('hidden');
  els.bmTitleInput.focus();
}

function renderBookmarkModalMeta() {
  els.bmTimeReadout.textContent = formatTime(state.modalBookmarkTime);
  els.bmCategoryPills.innerHTML = '';
  for (const cat of Object.values(BOOKMARK_CATEGORIES)) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `category-pill ${state.modalBookmarkCategory === cat.id ? 'active' : ''}`;
    pill.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}`;
    pill.addEventListener('click', () => {
      state.modalBookmarkCategory = cat.id;
      renderBookmarkModalMeta();
    });
    els.bmCategoryPills.appendChild(pill);
  }
}

async function handleSaveBookmarkForm(e) {
  e.preventDefault();
  const track = player.getCurrentTrack();
  if (!player.book || !track) return;

  if (state.editingBookmark) {
    const updated = {
      ...state.editingBookmark,
      time: Math.max(0, state.modalBookmarkTime),
      title: els.bmTitleInput.value.trim() || `${state.editingBookmark.trackTitle} · ${formatTime(state.modalBookmarkTime)}`,
      note: els.bmNoteInput.value.trim(),
      category: state.modalBookmarkCategory,
      updatedAt: Date.now(),
    };
    await putBookmark(updated);
    const idx = state.activeBookBookmarks.findIndex((b) => b.id === updated.id);
    if (idx >= 0) state.activeBookBookmarks[idx] = updated;
    showToast('Bookmark updated');
  } else {
    const created = createBookmarkData({
      book: player.book,
      track,
      time: state.modalBookmarkTime,
      bookTime: player.getBookProgress().currentBookTime,
      speed: player.playbackRate,
      title: els.bmTitleInput.value,
      note: els.bmNoteInput.value,
      category: state.modalBookmarkCategory,
    });
    await putBookmark(created);
    state.activeBookBookmarks.push(created);
    showToast(`Saved bookmark at ${formatTime(created.time)}`);
  }

  els.bookmarkModal.classList.add('hidden');
  renderScrubMarkers();
  renderChaptersList();
  renderBookmarksPanel();
  refreshLibrary();
}

async function handleDeleteBookmark(bm) {
  await deleteBookmark(bm.id);
  state.activeBookBookmarks = state.activeBookBookmarks.filter((item) => item.id !== bm.id);
  renderScrubMarkers();
  renderChaptersList();
  renderBookmarksPanel();
  refreshLibrary();
  showToast('Bookmark deleted');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openBookEditModal(book) {
  state.editingBookId = book.id;
  els.editBookTitleInput.value = book.title || '';
  els.editBookAuthorInput.value = book.author || '';
  els.bookEditModal.classList.remove('hidden');
  els.editBookTitleInput.focus();
}

async function handleSaveBookEdit(e) {
  e.preventDefault();
  if (!state.editingBookId) return;
  const title = els.editBookTitleInput.value.trim();
  const author = els.editBookAuthorInput.value.trim() || 'Unknown Author';
  if (!title) return;

  const updated = await updateBook(state.editingBookId, { title, author });
  if (player.book?.id === state.editingBookId && updated) {
    player.book = updated;
    renderPlayerAll();
  }
  els.bookEditModal.classList.add('hidden');
  await refreshLibrary();
  showToast('Textbook details updated');
}

async function runImport(entries, targetBookId = null, bookTitleOverride = '') {
  if (!entries || entries.length === 0) return;

  els.importModal.classList.remove('hidden');
  els.importProgressBar.style.width = '0%';
  els.importStatusText.textContent = 'Scanning audio files…';
  els.importFileText.textContent = '';

  try {
    const result = await importFiles({
      entries,
      targetBookId,
      bookTitleOverride,
      defaultSpeed: player.playbackRate || DEFAULT_SPEED,
      onProgress: ({ stage, current, total, fileName }) => {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        els.importProgressBar.style.width = `${pct}%`;
        els.importStatusText.textContent = stage === 'saving'
          ? 'Saving textbook to offline storage…'
          : `Processing chapter ${current} of ${total}…`;
        els.importFileText.textContent = fileName || '';
      },
    });

    if (result.importedCount === 0) {
      showToast('No supported audio files found in that selection.', { isError: true });
      return;
    }

    await refreshLibrary();
    const skippedNote = result.skippedFiles.length > 0
      ? ` (${result.skippedFiles.length} non-audio skipped)`
      : '';
    showToast(`Imported ${result.importedCount} chapter${result.importedCount === 1 ? '' : 's'}${skippedNote}`);

    if (targetBookId && player.book?.id === targetBookId) {
      const tracks = await getTracksForBook(targetBookId);
      player.tracks = tracks;
      player.book = result.book;
      renderPlayerAll();
    } else if (result.book) {
      await openBookInPlayer(result.book.id, false);
    }
  } catch (err) {
    showToast(`Import failed: ${err?.message || 'Unknown error'}`, { isError: true });
  } finally {
    els.importModal.classList.add('hidden');
  }
}

async function triggerFolderPicker(targetBookId = null) {
  try {
    const native = await pickDirectoryWithNativeAPI();
    if (native) {
      await runImport(native.entries, targetBookId, targetBookId ? '' : native.folderName);
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    // Fall back to <input webkitdirectory> if blocked or unsupported
  }

  const input = targetBookId ? els.appendFolderInput : els.folderInput;
  input.value = '';
  input.click();
}

function wireEvents() {
  els.filesInput.setAttribute('accept', AUDIO_ACCEPT_STRING);
  els.appendFilesInput.setAttribute('accept', AUDIO_ACCEPT_STRING);

  els.brandBtn.addEventListener('click', () => switchView('library'));
  els.navLibraryBtn.addEventListener('click', () => switchView('library'));
  els.navPlayerBtn.addEventListener('click', () => switchView('player'));
  els.backToLibraryBtn.addEventListener('click', () => switchView('library'));

  els.themeToggleBtn.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setSetting('theme', next).catch(() => {});
  });

  els.shortcutsBtn.addEventListener('click', () => els.shortcutsModal.classList.remove('hidden'));
  els.closeShortcutsBtn.addEventListener('click', () => els.shortcutsModal.classList.add('hidden'));
  els.shortcutsModal.addEventListener('click', (e) => {
    if (e.target === els.shortcutsModal) els.shortcutsModal.classList.add('hidden');
  });

  // Upload triggers
  els.uploadFolderBtn.addEventListener('click', () => triggerFolderPicker(null));
  els.uploadFilesBtn.addEventListener('click', () => {
    els.filesInput.value = '';
    els.filesInput.click();
  });
  els.appendFolderBtn.addEventListener('click', () => {
    if (player.book) triggerFolderPicker(player.book.id);
  });
  els.appendFilesBtn.addEventListener('click', () => {
    if (!player.book) return;
    els.appendFilesInput.value = '';
    els.appendFilesInput.click();
  });

  els.folderInput.addEventListener('change', (e) => {
    const entries = normalizeInputFileList(e.target.files);
    runImport(entries, null);
  });
  els.filesInput.addEventListener('change', (e) => {
    const entries = normalizeInputFileList(e.target.files);
    runImport(entries, null);
  });
  els.appendFolderInput.addEventListener('change', (e) => {
    if (!player.book) return;
    const entries = normalizeInputFileList(e.target.files);
    runImport(entries, player.book.id);
  });
  els.appendFilesInput.addEventListener('change', (e) => {
    if (!player.book) return;
    const entries = normalizeInputFileList(e.target.files);
    runImport(entries, player.book.id);
  });

  // Global & Zone Drag-and-Drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    els.dragOverlay.classList.remove('hidden');
    els.dropZone.classList.add('drag-active');
  });
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      els.dragOverlay.classList.add('hidden');
      els.dropZone.classList.remove('drag-active');
    }
  });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth = 0;
    els.dragOverlay.classList.add('hidden');
    els.dropZone.classList.remove('drag-active');

    const entries = await collectFilesFromDataTransfer(e.dataTransfer);
    const appendTarget = state.view === 'player' && player.book ? player.book.id : null;
    await runImport(entries, appendTarget);
  });

  // Library Search
  els.librarySearchInput.addEventListener('input', (e) => {
    state.libraryQuery = e.target.value;
    renderBooksGrid();
  });

  // Scrub Bar
  els.scrubRange.addEventListener('input', (e) => {
    player.seekTo(Number(e.target.value));
  });

  // Transport
  els.prevTrackBtn.addEventListener('click', () => player.prevTrack());
  els.skipBackBtn.addEventListener('click', () => player.seekBy(-15));
  els.playPauseBtn.addEventListener('click', () => player.togglePlay());
  els.skipFwdBtn.addEventListener('click', () => player.seekBy(30));
  els.nextTrackBtn.addEventListener('click', () => player.nextTrack());

  // Mini player
  els.miniPlayerOpenBtn.addEventListener('click', () => switchView('player'));
  els.miniPlayPauseBtn.addEventListener('click', () => player.togglePlay());
  els.miniBookmarkBtn.addEventListener('click', () => createQuickBookmark());

  // Sleep & Volume
  els.sleepTimerSelect.addEventListener('change', (e) => {
    player.setSleepTimer(e.target.value);
  });
  els.muteBtn.addEventListener('click', () => player.toggleMute());
  els.volumeRange.addEventListener('input', (e) => player.setVolume(Number(e.target.value)));

  // Granular Speed Console
  document.querySelectorAll('[data-speed-delta]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.getAttribute('data-speed-delta'));
      player.nudgeSpeed(delta);
    });
  });

  els.resetSpeedBtn.addEventListener('click', () => player.setSpeed(1.0));
  els.speedSlider.addEventListener('input', (e) => player.setSpeed(Number(e.target.value)));
  els.pitchToggleInput.addEventListener('change', (e) => player.setPreservesPitch(e.target.checked));

  els.speedReadoutBtn.addEventListener('click', () => {
    els.speedReadoutBtn.classList.add('hidden');
    els.speedExactInput.classList.remove('hidden');
    els.speedExactInput.value = String(player.playbackRate);
    els.speedExactInput.focus();
    els.speedExactInput.select();
  });

  const commitExactSpeed = () => {
    if (els.speedExactInput.classList.contains('hidden')) return;
    const raw = els.speedExactInput.value;
    if (raw !== '') {
      player.setSpeed(raw);
    }
    els.speedExactInput.classList.add('hidden');
    els.speedReadoutBtn.classList.remove('hidden');
  };

  els.speedExactInput.addEventListener('blur', commitExactSpeed);
  els.speedExactInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitExactSpeed();
    } else if (e.key === 'Escape') {
      els.speedExactInput.classList.add('hidden');
      els.speedReadoutBtn.classList.remove('hidden');
    }
  });

  els.pinSpeedBtn.addEventListener('click', () => {
    const cur = clampSpeed(player.playbackRate);
    if (!state.pinnedSpeeds.some((v) => Math.abs(v - cur) < 0.001)) {
      state.pinnedSpeeds = [...state.pinnedSpeeds, cur].sort((a, b) => a - b);
      setSetting('pinnedSpeeds', state.pinnedSpeeds).catch(() => {});
      renderSpeedControls(cur);
      showToast(`Pinned ${formatSpeed(cur)}`);
    }
  });

  // Panel Tabs & Filters
  els.tabChaptersBtn.addEventListener('click', () => switchPanelTab('chapters'));
  els.tabBookmarksBtn.addEventListener('click', () => switchPanelTab('bookmarks'));
  els.chapterSearchInput.addEventListener('input', (e) => {
    state.chapterQuery = e.target.value;
    renderChaptersList();
  });
  els.bookmarkSearchInput.addEventListener('input', (e) => {
    state.bookmarkQuery = e.target.value;
    renderBookmarksPanel();
  });
  els.bookmarkSortSelect.addEventListener('change', (e) => {
    state.bookmarkSort = e.target.value;
    renderBookmarksPanel();
  });

  // Bookmarks Actions & Modal
  els.quickBookmarkBtn.addEventListener('click', () => createQuickBookmark());
  els.noteBookmarkBtn.addEventListener('click', () => openBookmarkModal(null));
  els.closeBookmarkModalBtn.addEventListener('click', () => els.bookmarkModal.classList.add('hidden'));
  els.cancelBookmarkBtn.addEventListener('click', () => els.bookmarkModal.classList.add('hidden'));
  els.bmNudgeBackBtn.addEventListener('click', () => {
    state.modalBookmarkTime = Math.max(0, state.modalBookmarkTime - 5);
    renderBookmarkModalMeta();
  });
  els.bmNudgeFwdBtn.addEventListener('click', () => {
    const max = player.duration || Infinity;
    state.modalBookmarkTime = Math.min(max, state.modalBookmarkTime + 5);
    renderBookmarkModalMeta();
  });
  els.bmUseCurrentBtn.addEventListener('click', () => {
    state.modalBookmarkTime = player.currentTime || 0;
    renderBookmarkModalMeta();
  });
  els.bookmarkForm.addEventListener('submit', handleSaveBookmarkForm);

  // Bookmark Export / Import
  els.exportBookmarksMdBtn.addEventListener('click', () => {
    if (!player.book) return;
    const md = exportBookmarksToMarkdown(player.book, state.activeBookBookmarks);
    const safeName = (player.book.title || 'bookmarks').replace(/[^\w.-]+/g, '_');
    downloadTextFile(`${safeName}-bookmarks.md`, md, 'text/markdown;charset=utf-8');
  });
  els.exportBookmarksJsonBtn.addEventListener('click', () => {
    if (!player.book) return;
    const json = exportBookmarksToJSON(player.book, state.activeBookBookmarks);
    const safeName = (player.book.title || 'bookmarks').replace(/[^\w.-]+/g, '_');
    downloadTextFile(`${safeName}-bookmarks.json`, json, 'application/json;charset=utf-8');
  });
  els.importBookmarksJsonBtn.addEventListener('click', () => {
    if (!player.book) return;
    els.importBookmarksInput.value = '';
    els.importBookmarksInput.click();
  });
  els.importBookmarksInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !player.book) return;
    try {
      const text = await file.text();
      const imported = parseImportedBookmarksJSON(text, player.book.id, player.tracks);
      for (const bm of imported) {
        await putBookmark(bm);
        state.activeBookBookmarks.push(bm);
      }
      renderScrubMarkers();
      renderChaptersList();
      renderBookmarksPanel();
      refreshLibrary();
      showToast(`Imported ${imported.length} bookmark${imported.length === 1 ? '' : 's'}`);
    } catch (err) {
      showToast(`Bookmark import failed: ${err?.message || 'Invalid JSON'}`, { isError: true });
    }
  });

  // Book Edit Modal
  els.closeBookEditModalBtn.addEventListener('click', () => els.bookEditModal.classList.add('hidden'));
  els.cancelBookEditBtn.addEventListener('click', () => els.bookEditModal.classList.add('hidden'));
  els.bookEditForm.addEventListener('submit', handleSaveBookEdit);

  // Player Events
  player.addEventListener('statechange', () => {
    if (player.book) {
      renderPlayerAll();
    } else {
      updateMiniPlayer();
    }
    renderBooksGrid();
  });

  player.addEventListener('timeupdate', () => {
    if (!player.book) return;
    renderTimeAndProgress(player.getState());
    updateMiniPlayer();
  });

  player.addEventListener('trackchange', () => {
    renderPlayerAll();
  });

  player.addEventListener('speedchange', ({ detail }) => {
    renderSpeedControls(detail.playbackRate);
    renderTimeAndProgress(player.getState());
    updateMiniPlayer();
  });

  player.addEventListener('sleeptimer', ({ detail }) => {
    if (detail.triggered) {
      els.sleepTimerSelect.value = 'off';
      els.sleepCountdownPill.classList.add('hidden');
      showToast('Sleep timer paused playback');
      return;
    }
    if (detail.mode === 'timer' && detail.remainingMs > 0) {
      els.sleepCountdownPill.textContent = formatTime(Math.ceil(detail.remainingMs / 1000));
      els.sleepCountdownPill.classList.remove('hidden');
    } else if (detail.mode === 'end-of-chapter') {
      els.sleepCountdownPill.textContent = 'Ch End';
      els.sleepCountdownPill.classList.remove('hidden');
    } else {
      els.sleepTimerSelect.value = 'off';
      els.sleepCountdownPill.classList.add('hidden');
    }
  });

  player.addEventListener('error', ({ detail }) => {
    showToast(detail.message || 'Playback error', { isError: true });
  });

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      els.shortcutsModal.classList.toggle('hidden');
      return;
    }

    if (e.key === 'Escape') {
      els.bookmarkModal.classList.add('hidden');
      els.bookEditModal.classList.add('hidden');
      els.shortcutsModal.classList.add('hidden');
      return;
    }

    if (!player.book) return;

    if (e.code === 'Space') {
      e.preventDefault();
      player.togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) player.prevTrack();
      else player.seekBy(-15);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) player.nextTrack();
      else player.seekBy(30);
    } else if (e.key === '[' || e.key === '{') {
      e.preventDefault();
      player.nudgeSpeed(e.shiftKey ? -0.1 : -0.01);
    } else if (e.key === ']' || e.key === '}') {
      e.preventDefault();
      player.nudgeSpeed(e.shiftKey ? 0.1 : 0.01);
    } else if (e.key === '0') {
      e.preventDefault();
      player.setSpeed(1.0);
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      if (e.shiftKey) openBookmarkModal(null);
      else createQuickBookmark();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      player.toggleMute();
    }
  });

  // PWA Install Prompt & Service Worker
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    els.installAppBtn.classList.remove('hidden');
  });

  els.installAppBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installAppBtn.classList.add('hidden');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    });
  }
}

async function init() {
  const settings = await getAllSettings();
  applyTheme(settings.theme || 'dark');
  if (Array.isArray(settings.pinnedSpeeds) && settings.pinnedSpeeds.length > 0) {
    state.pinnedSpeeds = settings.pinnedSpeeds;
  }
  if (typeof settings.preservesPitch === 'boolean') {
    player.preservesPitch = settings.preservesPitch;
  }
  if (typeof settings.lastPlaybackRate === 'number') {
    player.playbackRate = clampSpeed(settings.lastPlaybackRate);
  }

  wireEvents();
  await refreshLibrary();
}

init();
