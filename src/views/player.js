import {
  calcSpeedAdjustedTime,
  clampSpeed,
  formatDurationHuman,
  formatSpeed,
  formatTime,
  MAX_SPEED,
  MIN_SPEED,
} from '../formats.js';
import {
  BOOKMARK_CATEGORIES,
  filterBookmarks,
  sortBookmarks,
} from '../bookmarks.js';
import { bookCoverMarkup, EQ_BARS_MARKUP, escapeHtml, ICONS } from '../ui-utils.js';

const PRESET_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

function setRangeProgress(inputEl, value, min, max) {
  if (!inputEl) return;
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  inputEl.style.setProperty('--range-progress', `${pct}%`);
}

export function createPlayerView({
  els,
  state,
  player,
  onEditBookmark,
  onDeleteBookmark,
  onQuickBookmark,
}) {
  let lastPlayerCoverKey = '';
  let lastMiniCoverKey = '';
  let isScrubbing = false;

  // Render static preset speed buttons once
  els.speedPresetsRow.innerHTML = '';
  for (const preset of PRESET_SPEEDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-pill';
    btn.dataset.speedPreset = String(preset);
    btn.textContent = formatSpeed(preset);
    els.speedPresetsRow.appendChild(btn);
  }

  // Delegated handlers
  els.speedPresetsRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speed-preset]');
    if (!btn) return;
    player.setSpeed(Number(btn.dataset.speedPreset));
  });

  els.pinnedSpeedsList.addEventListener('click', (e) => {
    const applyBtn = e.target.closest('[data-apply-pin]');
    if (applyBtn) {
      player.setSpeed(Number(applyBtn.dataset.applyPin));
      return;
    }
    const delBtn = e.target.closest('[data-del-pin]');
    if (delBtn) {
      const target = Number(delBtn.dataset.delPin);
      state.pinnedSpeeds = state.pinnedSpeeds.filter((v) => Math.abs(v - target) >= 0.001);
      if (typeof state.onPinnedSpeedsChange === 'function') {
        state.onPinnedSpeedsChange(state.pinnedSpeeds);
      }
      renderSpeedControls(player.playbackRate);
    }
  });

  els.scrubMarkers.addEventListener('click', (e) => {
    const marker = e.target.closest('[data-seek-time]');
    if (!marker) return;
    e.stopPropagation();
    player.seekTo(Number(marker.dataset.seekTime), { persist: true });
  });

  // Scrubber hover preview tooltip
  els.scrubRange.addEventListener('pointermove', (e) => {
    const dur = player.duration || 0;
    if (dur <= 0 || !els.scrubHoverTip) return;
    const rect = els.scrubRange.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const hoverSec = ratio * dur;
    const ch = player.getCurrentEmbeddedChapter(hoverSec);
    els.scrubHoverTip.textContent = ch ? `${formatTime(hoverSec)} · ${ch.title}` : formatTime(hoverSec);
    els.scrubHoverTip.style.left = `${Math.max(8, Math.min(92, ratio * 100))}%`;
    els.scrubHoverTip.classList.remove('hidden');
  });

  els.scrubRange.addEventListener('pointerleave', () => {
    els.scrubHoverTip?.classList.add('hidden');
  });

  els.chaptersList.addEventListener('click', (e) => {
    const subBtn = e.target.closest('[data-subchapter-time]');
    if (subBtn) {
      const trackIdx = Number(subBtn.dataset.trackIdx);
      const startTime = Number(subBtn.dataset.subchapterTime);
      player.jumpToPosition(trackIdx, startTime, true);
      return;
    }

    const row = e.target.closest('[data-track-idx]');
    if (!row) return;
    const trackIdx = Number(row.dataset.trackIdx);
    player.loadTrack(trackIdx, 0, true);
  });

  els.bookmarkFilterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter-category]');
    if (!chip) return;
    state.bookmarkCategory = chip.dataset.filterCategory;
    renderBookmarksPanel();
  });

  els.bookmarksList.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-jump-bm]');
    if (jumpBtn) {
      const bm = state.activeBookBookmarks.find((b) => b.id === jumpBtn.dataset.jumpBm);
      if (!bm) return;
      const idx = player.tracks.findIndex((t) => t.id === bm.trackId);
      const safeIdx = idx >= 0 ? idx : Math.max(0, Math.min(bm.trackOrder || 0, player.tracks.length - 1));
      player.jumpToPosition(safeIdx, bm.time, true);
      return;
    }

    const actionBtn = e.target.closest('[data-bm-action]');
    if (!actionBtn) return;
    const card = actionBtn.closest('[data-bm-id]');
    const bm = state.activeBookBookmarks.find((b) => b.id === card?.dataset.bmId);
    if (!bm) return;

    if (actionBtn.dataset.bmAction === 'edit') onEditBookmark(bm);
    else if (actionBtn.dataset.bmAction === 'delete') onDeleteBookmark(bm);
  });

  // Scrubber & Speed slider: update smoothly on input, persist to DB on change
  els.scrubRange.addEventListener('pointerdown', () => {
    isScrubbing = true;
  });
  els.scrubRange.addEventListener('input', (e) => {
    isScrubbing = true;
    const val = Number(e.target.value);
    setRangeProgress(els.scrubRange, val, 0, Number(els.scrubRange.max) || 100);
    player.seekTo(val, { persist: false });
  });
  els.scrubRange.addEventListener('change', () => {
    isScrubbing = false;
    player.persistProgress(true);
  });
  window.addEventListener('pointerup', () => {
    isScrubbing = false;
  });

  els.speedSlider.addEventListener('input', (e) => {
    player.setSpeed(Number(e.target.value), { persist: false });
  });
  els.speedSlider.addEventListener('change', () => {
    player.persistSpeed();
  });

  function renderBookHeader() {
    const s = player.getState();
    if (!s.book) return;

    const coverKey = `${s.book.id}:${s.book.coverDataUrl || ''}`;
    if (coverKey !== lastPlayerCoverKey) {
      lastPlayerCoverKey = coverKey;
      els.playerCoverWrap.innerHTML = bookCoverMarkup(s.book);
    }

    els.playerBookTitle.textContent = s.book.title;
    const embeddedCh = s.currentEmbeddedChapter;
    els.playerTrackTitle.textContent = embeddedCh
      ? `${s.currentTrack?.title || ''} — ${embeddedCh.title}`
      : (s.currentTrack?.title || 'No chapter loaded');

    const chapters = player.getEmbeddedChapters();
    if (chapters.length > 0 && embeddedCh) {
      els.playerChapterBadge.textContent = `File ${s.currentTrackIndex + 1}/${s.tracks.length} · Ch ${embeddedCh.index + 1}/${chapters.length}`;
    } else {
      els.playerChapterBadge.textContent = `Chapter ${s.currentTrackIndex + 1} / ${s.tracks.length}`;
    }

    if (s.currentTrack?.section) {
      els.playerSectionName.textContent = s.currentTrack.section;
      els.playerSectionName.classList.remove('hidden');
    } else {
      els.playerSectionName.classList.add('hidden');
    }
  }

  function renderTransportState() {
    const s = player.getState();
    els.playPauseBtn.innerHTML = s.isPlaying ? ICONS.pause : ICONS.play;
    els.playPauseBtn.classList.toggle('is-playing', s.isPlaying);
    els.muteBtn.innerHTML = s.muted || s.volume === 0 ? ICONS.volumeMute : ICONS.volume;
    els.volumeRange.value = String(s.volume);
    setRangeProgress(els.volumeRange, s.muted ? 0 : s.volume, 0, 1);
    els.pitchToggleInput.checked = s.preservesPitch;

    for (const row of els.chaptersList.querySelectorAll('.chapter-row')) {
      const idx = Number(row.dataset.trackIdx);
      const isActive = idx === s.currentTrackIndex;
      row.classList.toggle('active', isActive);
      const numEl = row.querySelector('.chapter-num');
      if (numEl) {
        numEl.innerHTML = isActive && s.isPlaying ? EQ_BARS_MARKUP : String(idx + 1);
      }
    }
  }

  function syncActiveChapterHighlight() {
    const s = player.getState();
    if (!s.book) return;
    renderBookHeader();

    const activeChIdx = s.currentEmbeddedChapter ? s.currentEmbeddedChapter.index : -1;
    for (const sub of els.chaptersList.querySelectorAll('.subchapter-row')) {
      const tIdx = Number(sub.dataset.trackIdx);
      const cIdx = Number(sub.dataset.subchapterIdx);
      sub.classList.toggle('active', tIdx === s.currentTrackIndex && cIdx === activeChIdx);
    }
  }

  function renderTimeAndProgress(s) {
    const dur = s.duration || 0;
    const cur = s.currentTime || 0;
    const rate = clampSpeed(s.playbackRate);

    if (!isScrubbing) {
      const maxVal = dur > 0 ? dur : 100;
      const curVal = dur > 0 ? Math.min(cur, dur) : 0;
      els.scrubRange.max = String(maxVal);
      els.scrubRange.value = String(curVal);
      setRangeProgress(els.scrubRange, curVal, 0, maxVal);
    }

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
    setRangeProgress(els.speedSlider, rate, MIN_SPEED, MAX_SPEED);
    els.pinSpeedBtn.textContent = `+ Pin ${formatted}`;
    els.miniSpeedBadge.textContent = formatted;

    for (const btn of els.speedPresetsRow.querySelectorAll('[data-speed-preset]')) {
      const preset = Number(btn.dataset.speedPreset);
      btn.classList.toggle('active', Math.abs(rate - preset) < 0.001);
    }

    els.pinnedSpeedsList.innerHTML = '';
    for (const pinned of state.pinnedSpeeds) {
      const chip = document.createElement('span');
      chip.className = 'pinned-chip';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'pinned-chip-btn';
      applyBtn.dataset.applyPin = String(pinned);
      applyBtn.textContent = formatSpeed(pinned);
      if (Math.abs(rate - pinned) < 0.001) {
        applyBtn.style.color = 'var(--accent)';
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'pinned-chip-del';
      delBtn.dataset.delPin = String(pinned);
      delBtn.title = 'Remove pinned speed';
      delBtn.textContent = '×';

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

    const chapters = player.getEmbeddedChapters(track);
    for (const ch of chapters) {
      if (ch.startTime <= 0) continue;
      const pct = Math.max(0, Math.min(100, (ch.startTime / dur) * 100));
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'scrub-chapter-tick';
      tick.style.left = `${pct}%`;
      tick.dataset.seekTime = String(ch.startTime);
      tick.title = `${ch.title} (${formatTime(ch.startTime)})`;
      els.scrubMarkers.appendChild(tick);
    }

    const trackBookmarks = state.activeBookBookmarks.filter((bm) => bm.trackId === track.id);
    for (const bm of trackBookmarks) {
      const pct = Math.max(0, Math.min(100, (bm.time / dur) * 100));
      const cat = BOOKMARK_CATEGORIES[bm.category] || BOOKMARK_CATEGORIES.important;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'scrub-marker';
      dot.style.left = `${pct}%`;
      dot.style.background = cat.color;
      dot.dataset.seekTime = String(bm.time);
      dot.title = `${bm.title} (${formatTime(bm.time)})`;
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

    const activeEmbedded = player.getCurrentEmbeddedChapter();
    let lastSection = null;

    tracks.forEach((track, idx) => {
      const chapters = player.getEmbeddedChapters(track);
      const trackMatches = !query || `${track.title} ${track.section || ''} ${track.fileName}`.toLowerCase().includes(query);
      const matchingChapters = query
        ? chapters.filter((ch) => ch.title.toLowerCase().includes(query))
        : chapters;

      if (query && !trackMatches && matchingChapters.length === 0) return;

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
      row.dataset.trackIdx = String(idx);
      row.innerHTML = `
        <span class="chapter-num">${isActive && player.isPlaying ? EQ_BARS_MARKUP : idx + 1}</span>
        <div class="chapter-info">
          <div class="chapter-title">${escapeHtml(track.title)}</div>
          <div class="chapter-sub">
            <span class="format-tag">${escapeHtml(track.format || 'AUDIO')}</span>
            ${chapters.length > 0 ? `<span>${chapters.length} chapters</span>` : ''}
            ${bmCount > 0 ? `<span>★ ${bmCount}</span>` : ''}
          </div>
        </div>
        <span class="chapter-duration">${track.duration ? formatTime(track.duration) : '--:--'}</span>
      `;
      els.chaptersList.appendChild(row);

      const subChaptersToShow = trackMatches ? chapters : matchingChapters;
      if (subChaptersToShow.length > 0) {
        const subList = document.createElement('div');
        subList.className = 'subchapter-list';
        for (const ch of subChaptersToShow) {
          const isSubActive = isActive && activeEmbedded && activeEmbedded.index === ch.index;
          const subRow = document.createElement('button');
          subRow.type = 'button';
          subRow.className = `subchapter-row ${isSubActive ? 'active' : ''}`;
          subRow.dataset.trackIdx = String(idx);
          subRow.dataset.subchapterIdx = String(ch.index);
          subRow.dataset.subchapterTime = String(ch.startTime);
          subRow.innerHTML = `
            <span class="subchapter-title">${escapeHtml(ch.title)}</span>
            <span class="subchapter-time">${formatTime(ch.startTime)}</span>
          `;
          subList.appendChild(subRow);
        }
        els.chaptersList.appendChild(subList);
      }
    });
  }

  function renderBookmarksPanel() {
    els.bookmarksCountBadge.textContent = String(state.activeBookBookmarks.length);

    els.bookmarkFilterChips.innerHTML = '';
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = `filter-chip ${state.bookmarkCategory === 'all' ? 'active' : ''}`;
    allChip.dataset.filterCategory = 'all';
    allChip.textContent = 'All';
    els.bookmarkFilterChips.appendChild(allChip);

    for (const cat of Object.values(BOOKMARK_CATEGORIES)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `filter-chip ${state.bookmarkCategory === cat.id ? 'active' : ''}`;
      chip.dataset.filterCategory = cat.id;
      chip.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}`;
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
      card.dataset.bmId = bm.id;
      card.innerHTML = `
        <div class="bookmark-card-top">
          <span class="bookmark-cat-label">
            <span class="cat-dot" style="background:${cat.color}"></span>
            ${escapeHtml(cat.label)} · ${formatSpeed(bm.speed || 1)}
          </span>
          <button class="bookmark-jump-btn" type="button" data-jump-bm="${escapeHtml(bm.id)}" title="Jump to timestamp">${formatTime(bm.time)}</button>
        </div>
        <div class="bookmark-title">${escapeHtml(bm.title)}</div>
        <div class="bookmark-chapter-sub">${escapeHtml(bm.trackTitle)}</div>
        ${bm.note ? `<p class="bookmark-note">${escapeHtml(bm.note)}</p>` : ''}
        <div class="bookmark-actions">
          <button class="btn btn-secondary btn-xs" data-bm-action="edit" type="button">Edit</button>
          <button class="btn btn-danger btn-xs" data-bm-action="delete" type="button">Delete</button>
        </div>
      `;
      els.bookmarksList.appendChild(card);
    }
  }

  function updateMiniPlayer() {
    const show = state.view === 'library' && Boolean(player.book);
    els.miniPlayer.classList.toggle('hidden', !show);
    if (!show) return;

    const coverKey = `${player.book.id}:${player.book.coverDataUrl || ''}`;
    if (coverKey !== lastMiniCoverKey) {
      lastMiniCoverKey = coverKey;
      els.miniCover.innerHTML = bookCoverMarkup(player.book);
    }

    els.miniBookTitle.textContent = player.book.title;
    const ch = player.getCurrentEmbeddedChapter();
    const trackLabel = ch ? `${player.getCurrentTrack()?.title || ''} — ${ch.title}` : (player.getCurrentTrack()?.title || '');
    els.miniTrackTitle.textContent = `${trackLabel} · ${formatTime(player.currentTime)}`;
    els.miniSpeedBadge.textContent = formatSpeed(player.playbackRate);
    els.miniPlayPauseBtn.innerHTML = player.isPlaying ? ICONS.pause : ICONS.play;
  }

  function renderPlayerAll() {
    if (!player.book) return;
    renderBookHeader();
    renderTransportState();
    renderTimeAndProgress(player.getState());
    renderSpeedControls(player.playbackRate);
    renderScrubMarkers();
    renderChaptersList();
    renderBookmarksPanel();
    updateMiniPlayer();
  }

  els.miniBookmarkBtn.addEventListener('click', () => onQuickBookmark());

  return {
    renderPlayerAll,
    renderBookHeader,
    renderTransportState,
    syncActiveChapterHighlight,
    renderTimeAndProgress,
    renderSpeedControls,
    renderScrubMarkers,
    renderChaptersList,
    renderBookmarksPanel,
    updateMiniPlayer,
  };
}
