import {
  AUDIO_ACCEPT_STRING,
  clampSpeed,
  DEFAULT_SPEED,
  formatTime,
} from './formats.js';
import {
  deleteBook,
  deleteBookmark,
  getAllBookmarks,
  getAllBooks,
  getAllSettings,
  getBook,
  getBookmarksForBook,
  getTracksForBook,
  putBookmark,
  requestPersistentStorage,
  setSetting,
  updateBook,
} from './db.js';
import {
  collectFilesFromDataTransfer,
  findDuplicateBook,
  importFiles,
  normalizeInputFileList,
  pickDirectoryWithNativeAPI,
} from './importer.js';
import { LectioPlayer } from './player.js';
import {
  createBookmarkData,
  exportBookmarksToJSON,
  exportBookmarksToMarkdown,
  parseImportedBookmarksJSON,
} from './bookmarks.js';
import { downloadTextFile, ICONS, showToast } from './ui-utils.js';
import { initModals } from './modals.js';
import { initShortcuts } from './shortcuts.js';
import { createLibraryView } from './views/library.js';
import { createPlayerView } from './views/player.js';

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
  deferredInstallPrompt: null,
  onPinnedSpeedsChange: (next) => {
    setSetting('pinnedSpeeds', next).catch(() => {});
  },
};

const els = {
  fatalErrorBanner: document.getElementById('fatalErrorBanner'),
  fatalErrorText: document.getElementById('fatalErrorText'),
  retryInitBtn: document.getElementById('retryInitBtn'),

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

  scrubHoverTip: document.getElementById('scrubHoverTip'),
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
  speedToggleBtn: document.getElementById('speedToggleBtn'),
  speedCompactReadout: document.getElementById('speedCompactReadout'),
  speedConsole: document.getElementById('speedConsole'),
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

  duplicateModal: document.getElementById('duplicateModal'),
  closeDuplicateModalBtn: document.getElementById('closeDuplicateModalBtn'),
  duplicateSummaryText: document.getElementById('duplicateSummaryText'),
  dupSkipBtn: document.getElementById('dupSkipBtn'),
  dupMergeBtn: document.getElementById('dupMergeBtn'),
  dupCopyBtn: document.getElementById('dupCopyBtn'),

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

function notify(message, options = {}) {
  showToast(els.toastContainer, message, options);
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  els.themeIcon.innerHTML = state.theme === 'light' ? ICONS.moon : ICONS.sun;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', state.theme === 'light' ? '#f5f1e8' : '#0b0d12');
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
  playerView.updateMiniPlayer();
}

function switchPanelTab(tab, { focus = false } = {}) {
  state.activeTab = tab;
  const isChapters = tab === 'chapters';
  els.tabChaptersBtn.classList.toggle('active', isChapters);
  els.tabBookmarksBtn.classList.toggle('active', !isChapters);
  els.tabChaptersBtn.setAttribute('aria-selected', String(isChapters));
  els.tabBookmarksBtn.setAttribute('aria-selected', String(!isChapters));
  // Roving tabindex: only the selected tab is in the Tab order
  els.tabChaptersBtn.tabIndex = isChapters ? 0 : -1;
  els.tabBookmarksBtn.tabIndex = isChapters ? -1 : 0;
  els.chaptersPanel.classList.toggle('hidden', !isChapters);
  els.bookmarksPanel.classList.toggle('hidden', isChapters);
  if (focus) {
    (isChapters ? els.tabChaptersBtn : els.tabBookmarksBtn).focus();
  }
  if (isChapters) {
    playerView?.scrollActiveChapterIntoView({ force: true });
  }
}

function setSpeedConsoleOpen(open) {
  els.speedConsole.classList.toggle('hidden', !open);
  els.speedToggleBtn.setAttribute('aria-expanded', String(open));
  els.speedToggleBtn.classList.toggle('open', open);
}

let modals;
let libraryView;
let playerView;

async function refreshLibrary() {
  const [books, allBookmarks] = await Promise.all([getAllBooks(), getAllBookmarks()]);
  state.books = books;
  const counts = new Map();
  for (const bm of allBookmarks) {
    counts.set(bm.bookId, (counts.get(bm.bookId) || 0) + 1);
  }
  state.bookmarkCountsByBook = counts;
  libraryView.renderBooksGrid();
  await libraryView.refreshStorageInfo();
}

async function openBookInPlayer(bookId, autoplay = false) {
  const book = state.books.find((b) => b.id === bookId) || (await getBook(bookId));
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
  playerView.renderPlayerAll();
}

async function handleDeleteBook(book) {
  const confirmed = window.confirm(
    `Delete "${book.title}" and all ${book.trackCount || 0} audio chapters and bookmarks from offline storage?`
  );
  if (!confirmed) return;

  if (player.book?.id === book.id) {
    await player.unloadBook({ persist: false });
    switchView('library');
  }

  await deleteBook(book.id);
  await refreshLibrary();
  notify(`Deleted "${book.title}"`);
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
  playerView.renderScrubMarkers();
  playerView.renderChaptersList();
  playerView.renderBookmarksPanel();
  refreshLibrary();

  notify(`Bookmarked at ${formatTime(bm.time)}`, {
    actionLabel: 'Add Note',
    onAction: () => modals.openBookmarkModal(bm),
  });
}

async function handleDeleteBookmark(bm) {
  await deleteBookmark(bm.id);
  state.activeBookBookmarks = state.activeBookBookmarks.filter((item) => item.id !== bm.id);
  playerView.renderScrubMarkers();
  playerView.renderChaptersList();
  playerView.renderBookmarksPanel();
  refreshLibrary();
  notify('Bookmark deleted');
}

async function runImport(entries, targetBookId = null, bookTitleOverride = '') {
  if (!entries || entries.length === 0) return;

  let resolvedTargetBookId = targetBookId;
  // When appending to an existing book, never re-add files it already has
  let skipExistingSignatures = Boolean(targetBookId);

  if (!resolvedTargetBookId && state.books.length > 0) {
    const duplicate = await findDuplicateBook(entries, state.books, getTracksForBook, bookTitleOverride);
    if (duplicate) {
      const choice = await modals.promptDuplicateBook(duplicate);
      if (choice === 'skip') {
        notify(`Skipped duplicate "${duplicate.book.title}"`);
        return;
      }
      if (choice === 'merge') {
        resolvedTargetBookId = duplicate.book.id;
        skipExistingSignatures = true;
      }
    }
  }

  modals.openImportModal();

  try {
    const result = await importFiles({
      entries,
      targetBookId: resolvedTargetBookId,
      bookTitleOverride,
      defaultSpeed: player.playbackRate || DEFAULT_SPEED,
      skipExistingSignatures,
      onProgress: (progress) => modals.updateImportModal(progress),
    });

    if (result.importedCount === 0) {
      if (result.duplicateSkippedCount > 0) {
        notify(`All ${result.duplicateSkippedCount} matching chapters are already in "${result.book?.title}".`);
      } else {
        notify('No supported audio files found in that selection.', { isError: true });
      }
      return;
    }

    await requestPersistentStorage();
    await refreshLibrary();

    const notes = [];
    if (result.duplicateSkippedCount > 0) notes.push(`${result.duplicateSkippedCount} duplicates skipped`);
    if (result.skippedFiles.length > 0) notes.push(`${result.skippedFiles.length} non-audio skipped`);
    const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    notify(`Imported ${result.importedCount} chapter${result.importedCount === 1 ? '' : 's'}${suffix}`);

    if (resolvedTargetBookId && player.book?.id === resolvedTargetBookId) {
      const tracks = await getTracksForBook(resolvedTargetBookId);
      player.tracks = tracks;
      player.book = result.book;
      playerView.renderPlayerAll();
    } else if (result.book) {
      await openBookInPlayer(result.book.id, false);
    }
  } catch (err) {
    notify(`Import failed: ${err?.message || 'Unknown error'}`, { isError: true });
  } finally {
    modals.closeImportModal();
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

  els.shortcutsBtn.addEventListener('click', () => modals.toggleShortcutsModal());

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
    runImport(normalizeInputFileList(e.target.files), null);
  });
  els.filesInput.addEventListener('change', (e) => {
    runImport(normalizeInputFileList(e.target.files), null);
  });
  els.appendFolderInput.addEventListener('change', (e) => {
    if (!player.book) return;
    runImport(normalizeInputFileList(e.target.files), player.book.id);
  });
  els.appendFilesInput.addEventListener('change', (e) => {
    if (!player.book) return;
    runImport(normalizeInputFileList(e.target.files), player.book.id);
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
    libraryView.renderBooksGrid();
  });

  // Transport & Mini-player navigation
  els.prevTrackBtn.addEventListener('click', () => player.prevTrack());
  els.skipBackBtn.addEventListener('click', () => player.seekBy(-15));
  els.playPauseBtn.addEventListener('click', () => player.togglePlay());
  els.skipFwdBtn.addEventListener('click', () => player.seekBy(30));
  els.nextTrackBtn.addEventListener('click', () => player.nextTrack());

  els.miniPlayerOpenBtn.addEventListener('click', () => switchView('player'));
  els.miniPlayPauseBtn.addEventListener('click', () => player.togglePlay());

  // Sleep & Volume
  els.sleepTimerSelect.addEventListener('change', (e) => {
    player.setSleepTimer(e.target.value);
  });
  els.sleepCountdownPill.addEventListener('click', () => {
    if (player.extendSleepTimer(5)) {
      notify('Sleep timer extended by 5 minutes');
    }
  });
  els.muteBtn.addEventListener('click', () => player.toggleMute());
  els.volumeRange.addEventListener('input', (e) => player.setVolume(Number(e.target.value)));

  // Granular Speed Console
  document.querySelectorAll('[data-speed-delta]').forEach((btn) => {
    btn.addEventListener('click', () => {
      player.nudgeSpeed(Number(btn.getAttribute('data-speed-delta')));
    });
  });

  els.resetSpeedBtn.addEventListener('click', () => player.setSpeed(1.0));

  els.speedToggleBtn.addEventListener('click', () => {
    const open = els.speedConsole.classList.contains('hidden');
    setSpeedConsoleOpen(open);
    setSetting('speedConsoleOpen', open).catch(() => {});
  });
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
      playerView.renderSpeedControls(cur);
      notify(`Pinned ${cur.toFixed(2)}×`);
    }
  });

  // Panel Tabs & Filters
  els.tabChaptersBtn.addEventListener('click', () => switchPanelTab('chapters'));
  els.tabBookmarksBtn.addEventListener('click', () => switchPanelTab('bookmarks'));
  // WAI-ARIA tabs pattern: arrow keys / Home / End move between tabs
  els.tabChaptersBtn.parentElement.addEventListener('keydown', (e) => {
    const tabs = ['chapters', 'bookmarks'];
    const idx = tabs.indexOf(state.activeTab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation(); // don't also seek via the global ArrowLeft/Right shortcuts
    switchPanelTab(next, { focus: true });
  });
  els.chapterSearchInput.addEventListener('input', (e) => {
    state.chapterQuery = e.target.value;
    playerView.renderChaptersList();
  });
  els.bookmarkSearchInput.addEventListener('input', (e) => {
    state.bookmarkQuery = e.target.value;
    playerView.renderBookmarksPanel();
  });
  els.bookmarkSortSelect.addEventListener('change', (e) => {
    state.bookmarkSort = e.target.value;
    playerView.renderBookmarksPanel();
  });

  // Bookmarks Actions & Export/Import
  els.quickBookmarkBtn.addEventListener('click', () => createQuickBookmark());
  els.noteBookmarkBtn.addEventListener('click', () => modals.openBookmarkModal(null));

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
      playerView.renderScrubMarkers();
      playerView.renderChaptersList();
      playerView.renderBookmarksPanel();
      refreshLibrary();
      notify(`Imported ${imported.length} bookmark${imported.length === 1 ? '' : 's'}`);
    } catch (err) {
      notify(`Bookmark import failed: ${err?.message || 'Invalid JSON'}`, { isError: true });
    }
  });

  // Targeted Player Event Updates
  player.addEventListener('statechange', ({ detail }) => {
    if (!player.book) {
      playerView.updateMiniPlayer();
      libraryView.updateActiveBookStatus();
      return;
    }

    const reason = detail?.reason;
    if (reason === 'metadata') {
      playerView.renderTimeAndProgress(detail);
      playerView.renderScrubMarkers();
      playerView.renderChaptersList();
      playerView.renderBookHeader();
      playerView.updateMiniPlayer();
    } else if (reason === 'playstate' || reason === 'volume' || reason === 'pitch' || reason === 'sleep') {
      playerView.renderTransportState();
      playerView.updateMiniPlayer();
      libraryView.updateActiveBookStatus();
    } else {
      playerView.renderPlayerAll();
      libraryView.updateActiveBookStatus();
    }
  });

  player.addEventListener('timeupdate', () => {
    if (!player.book) return;
    playerView.renderTimeAndProgress(player.getState());
    playerView.updateMiniPlayer();
  });

  player.addEventListener('chapterchange', () => {
    if (!player.book) return;
    playerView.syncActiveChapterHighlight();
    playerView.updateMiniPlayer();
  });

  player.addEventListener('speedchange', ({ detail }) => {
    playerView.renderSpeedControls(detail.playbackRate);
    playerView.renderTimeAndProgress(player.getState());
    playerView.updateMiniPlayer();
    libraryView.updateActiveBookStatus();
  });

  player.addEventListener('sleeptimer', ({ detail }) => {
    if (detail.triggered) {
      els.sleepTimerSelect.value = 'off';
      els.sleepCountdownPill.classList.add('hidden');
      notify('Sleep timer paused playback');
      return;
    }
    if (detail.mode === 'timer' && detail.remainingMs > 0) {
      els.sleepCountdownPill.disabled = false;
      els.sleepCountdownPill.textContent = `${formatTime(Math.ceil(detail.remainingMs / 1000))} +5`;
      els.sleepCountdownPill.classList.remove('hidden');
    } else if (detail.mode === 'end-of-chapter') {
      els.sleepCountdownPill.textContent = 'Ch End';
      els.sleepCountdownPill.classList.remove('hidden');
      els.sleepCountdownPill.disabled = true; // +5 min only applies to a running timer
    } else {
      els.sleepTimerSelect.value = 'off';
      els.sleepCountdownPill.classList.add('hidden');
    }
  });

  player.addEventListener('error', ({ detail }) => {
    notify(detail.message || 'Playback error', { isError: true });
  });

  // Database lifecycle notifications
  window.addEventListener('lectio:db-blocked', () => {
    notify('Database upgrade blocked by another open tab. Please close other tabs.', { isError: true });
  });
  window.addEventListener('lectio:db-versionchange', () => {
    notify('Database updated in another tab. Reload to sync.', {
      actionLabel: 'Reload',
      onAction: () => window.location.reload(),
    });
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
  modals = initModals({
    els,
    player,
    onSaveBookmark: async ({ editingBookmark, time, title, note, category }) => {
      const track = player.getCurrentTrack();
      if (!player.book || !track) return;

      if (editingBookmark) {
        const updated = {
          ...editingBookmark,
          time,
          title: title.trim() || `${editingBookmark.trackTitle} · ${formatTime(time)}`,
          note: note.trim(),
          category,
          updatedAt: Date.now(),
        };
        await putBookmark(updated);
        const idx = state.activeBookBookmarks.findIndex((b) => b.id === updated.id);
        if (idx >= 0) state.activeBookBookmarks[idx] = updated;
        notify('Bookmark updated');
      } else {
        const created = createBookmarkData({
          book: player.book,
          track,
          time,
          bookTime: player.getBookProgress().currentBookTime,
          speed: player.playbackRate,
          title,
          note,
          category,
        });
        await putBookmark(created);
        state.activeBookBookmarks.push(created);
        notify(`Saved bookmark at ${formatTime(created.time)}`);
      }

      playerView.renderScrubMarkers();
      playerView.renderChaptersList();
      playerView.renderBookmarksPanel();
      refreshLibrary();
    },
    onSaveBookEdit: async (bookId, { title, author }) => {
      const updated = await updateBook(bookId, { title, author });
      if (player.book?.id === bookId && updated) {
        player.book = updated;
        playerView.renderPlayerAll();
      }
      await refreshLibrary();
      notify('Textbook details updated');
    },
  });

  libraryView = createLibraryView({
    els,
    state,
    player,
    onOpenBook: openBookInPlayer,
    onEditBook: (book) => modals.openBookEditModal(book),
    onDeleteBook: handleDeleteBook,
  });

  playerView = createPlayerView({
    els,
    state,
    player,
    onEditBookmark: (bm) => modals.openBookmarkModal(bm),
    onDeleteBookmark: handleDeleteBookmark,
    onQuickBookmark: createQuickBookmark,
  });

  initShortcuts({
    player,
    onQuickBookmark: createQuickBookmark,
    onNoteBookmark: () => modals.openBookmarkModal(null),
    onToggleShortcuts: () => modals.toggleShortcutsModal(),
  });

  wireEvents();

  els.retryInitBtn.addEventListener('click', () => {
    window.location.reload();
  });

  try {
    const settings = await getAllSettings();
    applyTheme(settings.theme || 'dark');
    if (Array.isArray(settings.pinnedSpeeds) && settings.pinnedSpeeds.length > 0) {
      state.pinnedSpeeds = settings.pinnedSpeeds;
    }
    if (typeof settings.preservesPitch === 'boolean') {
      player.preservesPitch = settings.preservesPitch;
    }
    setSpeedConsoleOpen(settings.speedConsoleOpen === true);
    if (typeof settings.lastPlaybackRate === 'number') {
      player.playbackRate = clampSpeed(settings.lastPlaybackRate);
    }
    await refreshLibrary();
    els.fatalErrorBanner.classList.add('hidden');
  } catch (err) {
    els.fatalErrorText.textContent = `Offline library unavailable: ${err?.message || 'IndexedDB could not be opened.'}`;
    els.fatalErrorBanner.classList.remove('hidden');
  }
}

init();
