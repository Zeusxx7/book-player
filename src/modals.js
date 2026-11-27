import { formatDurationHuman, formatTime } from './formats.js';
import { BOOKMARK_CATEGORIES } from './bookmarks.js';
import { createCoverAsset } from './metadata.js';
import { bookCoverMarkup, escapeHtml } from './ui-utils.js';

export function initModals({
  els,
  player,
  onSaveBookmark,
  onSaveBookEdit,
  onResetBookProgress,
  onRenameTrack,
}) {
  let editingBookmark = null;
  let modalBookmarkTime = 0;
  let modalBookmarkCategory = 'important';
  let editingBook = null;
  let pendingCoverPatch = null;
  let renamingTrack = null;

  function openDialog(dialog) {
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function closeDialog(dialog) {
    if (dialog.open) {
      dialog.close();
    }
  }

  function wireDismissibleDialog(dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog(dialog);
      }
    });
  }

  wireDismissibleDialog(els.bookmarkModal);
  wireDismissibleDialog(els.bookEditModal);
  wireDismissibleDialog(els.shortcutsModal);
  wireDismissibleDialog(els.duplicateModal);
  wireDismissibleDialog(els.confirmModal);
  wireDismissibleDialog(els.settingsModal);
  wireDismissibleDialog(els.renameTrackModal);

  // Import modal should not be cancelled mid-import via Escape
  els.importModal.addEventListener('cancel', (e) => {
    e.preventDefault();
  });

  function openImportModal() {
    els.importProgressBar.style.width = '0%';
    els.importStatusText.textContent = 'Scanning audio files…';
    els.importFileText.textContent = '';
    openDialog(els.importModal);
  }

  function updateImportModal({ stage, current, total, fileName }) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    els.importProgressBar.style.width = `${pct}%`;
    els.importStatusText.textContent = stage === 'saving'
      ? 'Saving textbook to offline storage…'
      : `Processing chapter ${current} of ${total}…`;
    els.importFileText.textContent = fileName || '';
  }

  function closeImportModal() {
    closeDialog(els.importModal);
  }

  function renderBookmarkModalMeta() {
    els.bmTimeReadout.textContent = formatTime(modalBookmarkTime);
    els.bmCategoryPills.innerHTML = '';
    for (const cat of Object.values(BOOKMARK_CATEGORIES)) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `category-pill ${modalBookmarkCategory === cat.id ? 'active' : ''}`;
      pill.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}`;
      pill.dataset.category = cat.id;
      els.bmCategoryPills.appendChild(pill);
    }
  }

  els.bmCategoryPills.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    modalBookmarkCategory = btn.dataset.category;
    renderBookmarkModalMeta();
  });

  function openBookmarkModal(existingBookmark = null) {
    const track = player.getCurrentTrack();
    if (!player.book || !track) return;

    editingBookmark = existingBookmark;
    if (existingBookmark) {
      els.bookmarkModalTitle.textContent = 'Edit Study Bookmark';
      modalBookmarkTime = existingBookmark.time;
      modalBookmarkCategory = existingBookmark.category || 'important';
      els.bmTrackLabel.textContent = existingBookmark.trackTitle;
      els.bmTitleInput.value = existingBookmark.title || '';
      els.bmNoteInput.value = existingBookmark.note || '';
    } else {
      els.bookmarkModalTitle.textContent = 'Add Study Bookmark';
      modalBookmarkTime = player.currentTime;
      modalBookmarkCategory = 'important';
      const embeddedCh = player.getCurrentEmbeddedChapter();
      els.bmTrackLabel.textContent = embeddedCh ? `${track.title} — ${embeddedCh.title}` : track.title;
      els.bmTitleInput.value = '';
      els.bmNoteInput.value = '';
    }

    renderBookmarkModalMeta();
    openDialog(els.bookmarkModal);
    els.bmTitleInput.focus();
  }

  function closeBookmarkModal() {
    closeDialog(els.bookmarkModal);
  }

  els.closeBookmarkModalBtn.addEventListener('click', closeBookmarkModal);
  els.cancelBookmarkBtn.addEventListener('click', closeBookmarkModal);
  els.bmNudgeBackBtn.addEventListener('click', () => {
    modalBookmarkTime = Math.max(0, modalBookmarkTime - 5);
    renderBookmarkModalMeta();
  });
  els.bmNudgeFwdBtn.addEventListener('click', () => {
    // Clamp to the bookmark's own track, which may not be the one playing
    const bmTrack = editingBookmark
      ? player.tracks.find((t) => t.id === editingBookmark.trackId)
      : player.getCurrentTrack();
    const isCurrent = bmTrack && bmTrack === player.getCurrentTrack();
    const max = (isCurrent ? player.duration : 0) || bmTrack?.duration || Infinity;
    modalBookmarkTime = Math.min(max, modalBookmarkTime + 5);
    renderBookmarkModalMeta();
  });
  els.bmUseCurrentBtn.addEventListener('click', () => {
    modalBookmarkTime = player.currentTime || 0;
    renderBookmarkModalMeta();
  });

  els.bookmarkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await onSaveBookmark({
      editingBookmark,
      time: Math.max(0, modalBookmarkTime),
      title: els.bmTitleInput.value,
      note: els.bmNoteInput.value,
      category: modalBookmarkCategory,
    });
    closeBookmarkModal();
  });

  function renderBookEditCoverPreview() {
    if (!editingBook) return;
    const previewBook = pendingCoverPatch
      ? { ...editingBook, ...pendingCoverPatch }
      : editingBook;
    els.editBookCoverPreview.innerHTML = bookCoverMarkup(previewBook);
    els.clearBookCoverBtn.classList.toggle('hidden', !previewBook.coverDataUrl);
  }

  function openBookEditModal(book) {
    editingBook = book;
    pendingCoverPatch = null;
    els.editBookTitleInput.value = book.title || '';
    els.editBookAuthorInput.value = book.author || '';
    const hasProgress = Boolean(book.completed) || (book.bookTime || 0) > 5 || (book.currentTrackIndex || 0) > 0 || (book.currentTime || 0) > 5;
    els.resetBookProgressBtn.classList.toggle('hidden', !hasProgress);
    renderBookEditCoverPreview();
    openDialog(els.bookEditModal);
    els.editBookTitleInput.focus();
  }

  function closeBookEditModal() {
    closeDialog(els.bookEditModal);
  }

  els.closeBookEditModalBtn.addEventListener('click', closeBookEditModal);
  els.cancelBookEditBtn.addEventListener('click', closeBookEditModal);
  els.editBookCoverBtn.addEventListener('click', () => {
    els.editBookCoverInput.value = '';
    els.editBookCoverInput.click();
  });
  els.editBookCoverInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !editingBook) return;
    const asset = await createCoverAsset(file);
    if (asset) {
      pendingCoverPatch = {
        coverDataUrl: asset.dataUrl,
        coverWidth: asset.width,
        coverHeight: asset.height,
        coverMime: asset.mime,
      };
      renderBookEditCoverPreview();
    }
  });
  els.clearBookCoverBtn.addEventListener('click', () => {
    pendingCoverPatch = {
      coverDataUrl: '',
      coverWidth: 0,
      coverHeight: 0,
      coverMime: '',
    };
    renderBookEditCoverPreview();
  });
  els.resetBookProgressBtn.addEventListener('click', async () => {
    if (!editingBook || typeof onResetBookProgress !== 'function') return;
    const targetBook = editingBook;
    closeBookEditModal();
    await onResetBookProgress(targetBook);
  });

  els.bookEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingBook) return;
    const title = els.editBookTitleInput.value.trim();
    const author = els.editBookAuthorInput.value.trim() || 'Unknown Author';
    if (!title) return;
    await onSaveBookEdit(editingBook.id, {
      title,
      author,
      ...(pendingCoverPatch || {}),
    });
    closeBookEditModal();
  });

  function confirmAction({ title = 'Confirm Action', message = '', confirmLabel = 'Confirm', isDanger = false } = {}) {
    els.confirmModalTitle.textContent = title;
    els.confirmModalMessage.textContent = message;
    els.confirmOkBtn.textContent = confirmLabel;
    els.confirmOkBtn.className = `btn ${isDanger ? 'btn-danger' : 'btn-primary'}`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (accepted) => {
        if (settled) return;
        settled = true;
        cleanup();
        closeDialog(els.confirmModal);
        resolve(accepted);
      };

      const onConfirm = () => finish(true);
      const onCancel = () => finish(false);

      function cleanup() {
        els.confirmOkBtn.removeEventListener('click', onConfirm);
        els.confirmCancelBtn.removeEventListener('click', onCancel);
        els.closeConfirmModalBtn.removeEventListener('click', onCancel);
        els.confirmModal.removeEventListener('cancel', onCancel);
        els.confirmModal.removeEventListener('close', onCancel);
      }

      els.confirmOkBtn.addEventListener('click', onConfirm);
      els.confirmCancelBtn.addEventListener('click', onCancel);
      els.closeConfirmModalBtn.addEventListener('click', onCancel);
      els.confirmModal.addEventListener('cancel', onCancel);
      els.confirmModal.addEventListener('close', onCancel);

      openDialog(els.confirmModal);
      els.confirmCancelBtn.focus();
    });
  }

  function toggleShortcutsModal() {
    if (els.shortcutsModal.open) {
      closeDialog(els.shortcutsModal);
    } else {
      openDialog(els.shortcutsModal);
    }
  }

  els.closeShortcutsBtn.addEventListener('click', () => closeDialog(els.shortcutsModal));

  function updateSettingsStatsView(stats) {
    if (!els.statTodayVal) return;
    els.statTodayVal.textContent = formatDurationHuman(stats?.todaySeconds || 0);
    const streak = stats?.streakDays || 0;
    els.statStreakVal.textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
    els.statTotalVal.textContent = formatDurationHuman(stats?.totalSeconds || 0);
  }

  function openSettingsModal({ stats, skipBackSeconds, skipForwardSeconds }) {
    els.skipBackSelect.value = String(skipBackSeconds || 15);
    els.skipForwardSelect.value = String(skipForwardSeconds || 30);
    updateSettingsStatsView(stats);
    openDialog(els.settingsModal);
  }

  function closeSettingsModal() {
    closeDialog(els.settingsModal);
  }

  els.closeSettingsModalBtn.addEventListener('click', closeSettingsModal);

  function openRenameTrackModal(track) {
    renamingTrack = track;
    els.renameTrackInput.value = track?.title || '';
    openDialog(els.renameTrackModal);
    els.renameTrackInput.focus();
    els.renameTrackInput.select();
  }

  function closeRenameTrackModal() {
    closeDialog(els.renameTrackModal);
  }

  els.closeRenameTrackModalBtn.addEventListener('click', closeRenameTrackModal);
  els.cancelRenameTrackBtn.addEventListener('click', closeRenameTrackModal);
  els.renameTrackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!renamingTrack) return;
    const title = els.renameTrackInput.value.trim();
    if (!title) return;
    const target = renamingTrack;
    closeRenameTrackModal();
    await onRenameTrack?.(target, title);
  });

  function promptDuplicateBook(matchInfo) {
    const { book, matchedCount, incomingCount } = matchInfo;
    els.duplicateSummaryText.textContent =
      `"${book.title}" already exists in your library (${matchedCount} of ${incomingCount} files match). How would you like to proceed?`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice) => {
        if (settled) return;
        settled = true;
        cleanup();
        closeDialog(els.duplicateModal);
        resolve(choice);
      };

      const onSkip = () => finish('skip');
      const onMerge = () => finish('merge');
      const onCopy = () => finish('copy');
      const onCancel = () => finish('skip');

      function cleanup() {
        els.dupSkipBtn.removeEventListener('click', onSkip);
        els.dupMergeBtn.removeEventListener('click', onMerge);
        els.dupCopyBtn.removeEventListener('click', onCopy);
        els.closeDuplicateModalBtn.removeEventListener('click', onSkip);
        els.duplicateModal.removeEventListener('cancel', onCancel);
        els.duplicateModal.removeEventListener('close', onCancel);
      }

      els.dupSkipBtn.addEventListener('click', onSkip);
      els.dupMergeBtn.addEventListener('click', onMerge);
      els.dupCopyBtn.addEventListener('click', onCopy);
      els.closeDuplicateModalBtn.addEventListener('click', onSkip);
      els.duplicateModal.addEventListener('cancel', onCancel);
      els.duplicateModal.addEventListener('close', onCancel);

      openDialog(els.duplicateModal);
      els.dupSkipBtn.focus();
    });
  }

  return {
    openImportModal,
    updateImportModal,
    closeImportModal,
    openBookmarkModal,
    closeBookmarkModal,
    openBookEditModal,
    closeBookEditModal,
    confirmAction,
    openSettingsModal,
    updateSettingsStatsView,
    closeSettingsModal,
    openRenameTrackModal,
    toggleShortcutsModal,
    promptDuplicateBook,
  };
}
