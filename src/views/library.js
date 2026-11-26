import { formatDurationHuman, formatSpeed, formatTime } from '../formats.js';
import { getStorageEstimate, isStoragePersisted } from '../db.js';
import { bookCoverMarkup, escapeHtml, ICONS } from '../ui-utils.js';

export function computeBookProgressPct(book) {
  const total = book.totalDuration || 0;
  if (total <= 0) return 0;

  if (Number.isFinite(book.bookTime) && book.bookTime >= 0) {
    return Math.min(100, Math.round((book.bookTime / total) * 100));
  }

  const approxCurrent = book.currentTime || 0;
  const approxElapsed = approxCurrent + (book.currentTrackIndex || 0) * (total / Math.max(1, book.trackCount || 1));
  return Math.min(100, Math.round((approxElapsed / total) * 100));
}

export function createLibraryView({ els, state, player, onOpenBook, onEditBook, onDeleteBook }) {
  els.booksGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('article[data-book-id]');
    if (!card) return;
    const book = state.books.find((b) => b.id === card.dataset.bookId);
    if (!book) return;

    const action = btn.dataset.action;
    if (action === 'open') onOpenBook(book.id, true);
    else if (action === 'edit') onEditBook(book);
    else if (action === 'delete') onDeleteBook(book);
  });

  async function refreshStorageInfo() {
    const [est, persisted] = await Promise.all([getStorageEstimate(), isStoragePersisted()]);
    const persistLabel = persisted === true
      ? ' · Persistent'
      : persisted === false
        ? ' · Best-effort'
        : '';

    if (!est || !Number.isFinite(est.usage)) {
      els.storageInfo.textContent = `Offline IndexedDB Ready${persistLabel}`;
      return;
    }
    const mb = (est.usage / (1024 * 1024)).toFixed(1);
    if (est.quota) {
      const gb = (est.quota / (1024 * 1024 * 1024)).toFixed(1);
      els.storageInfo.textContent = `${mb} MB used · ${gb} GB available${persistLabel}`;
    } else {
      els.storageInfo.textContent = `${mb} MB stored offline${persistLabel}`;
    }
  }

  function bookPrimaryLabel(book, isActive) {
    if (isActive && player.isPlaying) return 'Playing…';
    if ((book.bookTime || 0) > 5 || (book.currentTrackIndex || 0) > 0 || (book.currentTime || 0) > 5) {
      return 'Continue Listening';
    }
    return 'Start Listening';
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

    els.dropZone.classList.toggle('compact', state.books.length > 0);
    els.libraryEmpty.classList.toggle('hidden', state.books.length > 0);
    els.booksGrid.innerHTML = '';

    if (state.books.length > 0 && filtered.length === 0) {
      const noMatch = document.createElement('div');
      noMatch.className = 'empty-state';
      noMatch.textContent = `No textbooks matching "${state.libraryQuery.trim()}".`;
      els.booksGrid.appendChild(noMatch);
      return;
    }

    for (const book of filtered) {
      const total = book.totalDuration || 0;
      const pct = computeBookProgressPct(book);
      const bmCount = state.bookmarkCountsByBook.get(book.id) || 0;
      const isActive = player.book?.id === book.id;

      const card = document.createElement('article');
      card.className = `book-card${isActive ? ' is-active' : ''}`;
      card.dataset.bookId = book.id;
      card.innerHTML = `
        <div class="book-card-top">
          <div class="book-cover">${bookCoverMarkup(book)}</div>
          <div class="book-card-info">
            <h3 class="book-card-title">${escapeHtml(book.title)}</h3>
            <p class="book-card-author">${escapeHtml(book.author || 'Unknown Author')}</p>
            <div class="book-badges">
              <span class="meta-badge">${book.trackCount || 0} chapters</span>
              <span class="meta-badge">${formatDurationHuman(total)}</span>
              <span class="meta-badge accent mono" data-role="speed">${formatSpeed(book.playbackRate || 1)}</span>
              ${bmCount > 0 ? `<span class="meta-badge">★ ${bmCount}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="book-progress-wrap">
          <div class="book-progress-bar">
            <div class="book-progress-fill" data-role="progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="book-progress-labels">
            <span data-role="chapter-pos">Ch ${(book.currentTrackIndex || 0) + 1} of ${book.trackCount || 1} · ${pct}%</span>
            <span data-role="time-pos" class="mono">${formatTime(book.currentTime || 0)}</span>
          </div>
        </div>
        <div class="book-card-actions">
          <button class="btn btn-primary btn-sm btn-resume" data-action="open" type="button">
            ${bookPrimaryLabel(book, isActive)}
          </button>
          <button class="icon-btn" data-action="edit" type="button" title="Edit Title/Author" aria-label="Edit Textbook Details">${ICONS.edit}</button>
          <button class="icon-btn icon-btn-danger" data-action="delete" type="button" title="Delete Textbook" aria-label="Delete Textbook">${ICONS.trash}</button>
        </div>
      `;
      els.booksGrid.appendChild(card);
    }
  }

  function updateActiveBookStatus() {
    const activeId = player.book?.id;
    for (const card of els.booksGrid.querySelectorAll('article[data-book-id]')) {
      const id = card.dataset.bookId;
      const book = state.books.find((b) => b.id === id);
      const openBtn = card.querySelector('[data-action="open"]');
      if (!openBtn) continue;

      if (id === activeId && player.book) {
        card.classList.add('is-active');
        openBtn.textContent = bookPrimaryLabel(player.book, true);
        const pct = computeBookProgressPct(player.book);
        const fill = card.querySelector('[data-role="progress-fill"]');
        const chPos = card.querySelector('[data-role="chapter-pos"]');
        const timePos = card.querySelector('[data-role="time-pos"]');
        const speedEl = card.querySelector('[data-role="speed"]');
        if (fill) fill.style.width = `${pct}%`;
        if (chPos) chPos.textContent = `Ch ${(player.currentTrackIndex || 0) + 1} of ${player.book.trackCount || 1} · ${pct}%`;
        if (timePos) timePos.textContent = formatTime(player.currentTime || 0);
        if (speedEl) speedEl.textContent = formatSpeed(player.playbackRate || 1);
      } else {
        card.classList.remove('is-active');
        openBtn.textContent = book ? bookPrimaryLabel(book, false) : 'Start Listening';
      }
    }
  }

  return {
    renderBooksGrid,
    updateActiveBookStatus,
    refreshStorageInfo,
  };
}
