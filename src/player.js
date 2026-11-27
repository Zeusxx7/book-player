import { clampSpeed, computeAutoRewindSeconds, DEFAULT_SPEED, normalizeAudioMime, stepSpeed } from './formats.js';
import { getAudioBlob, setSetting, updateBook, updateTrack } from './db.js';

// Volume fades to silence over this window before the sleep timer pauses playback
const SLEEP_FADE_MS = 15000;

export class LectioPlayer extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'metadata';

    this.book = null;
    this.tracks = [];
    this.currentTrackIndex = 0;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.playbackRate = DEFAULT_SPEED;
    this.preservesPitch = true;
    this.autoRewind = true;
    this.skipBackSeconds = 15;
    this.skipForwardSeconds = 30;
    this.loopA = null;
    this.loopB = null;
    this.voiceBoost = false;
    this.volume = 1;
    this.muted = false;

    this.sleepMode = 'off'; // 'off' | 'timer' | 'end-of-chapter'
    this.sleepEndTime = null;
    this._sleepInterval = null;
    this._sleepTargetChapterIndex = null;

    this._objectUrl = null;
    this._pendingSeekTime = null;
    this._pausedAt = null;
    this._lastPersistAt = 0;
    this._loadToken = 0;
    this._lastEmbeddedChapterIndex = -1;
    this._chapterCache = new WeakMap();
    this._audioCtx = null;
    this._audioSource = null;
    this._voiceNodes = null;

    this._bindAudioEvents();
    this._bindMediaSession();
    this._bindLifecycleEvents();
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _emitStateChange(reason = 'general') {
    this._emit('statechange', { ...this.getState(), reason });
  }

  _applyPlaybackRateToAudio() {
    const rate = clampSpeed(this.playbackRate);
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;

    if ('preservesPitch' in this.audio) {
      this.audio.preservesPitch = this.preservesPitch;
    }
    if ('mozPreservesPitch' in this.audio) {
      this.audio.mozPreservesPitch = this.preservesPitch;
    }
    if ('webkitPreservesPitch' in this.audio) {
      this.audio.webkitPreservesPitch = this.preservesPitch;
    }
  }

  getEmbeddedChapters(track = this.getCurrentTrack()) {
    const raw = track?.chapters;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const trackDur = track === this.getCurrentTrack()
      ? (this.duration || track.duration || 0)
      : (track.duration || 0);

    // Called several times per timeupdate; reuse the result while inputs are unchanged
    const cached = this._chapterCache.get(track);
    if (cached && cached.raw === raw && cached.trackDur === trackDur) {
      return cached.chapters;
    }

    const sorted = [...raw].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const chapters = sorted.map((ch, idx) => {
      const startTime = Math.max(0, Number(ch.startTime) || 0);
      const nextStart = idx + 1 < sorted.length ? Math.max(startTime, Number(sorted[idx + 1].startTime) || 0) : null;
      const endTime = nextStart !== null ? nextStart : (trackDur > startTime ? trackDur : null);
      return {
        index: idx,
        title: ch.title || `Chapter ${idx + 1}`,
        startTime,
        endTime,
      };
    });
    this._chapterCache.set(track, { raw, trackDur, chapters });
    return chapters;
  }

  getCurrentEmbeddedChapter(time = this.currentTime, track = this.getCurrentTrack()) {
    const chapters = this.getEmbeddedChapters(track);
    if (chapters.length === 0) return null;
    const t = Math.max(0, Number(time) || 0);
    let active = chapters[0];
    for (const ch of chapters) {
      if (t + 0.05 >= ch.startTime) {
        active = ch;
      } else {
        break;
      }
    }
    return active;
  }

  _syncEmbeddedChapterOnTime(time) {
    const ch = this.getCurrentEmbeddedChapter(time);
    const nextIdx = ch ? ch.index : -1;
    if (nextIdx !== this._lastEmbeddedChapterIndex) {
      this._lastEmbeddedChapterIndex = nextIdx;
      this._updateMediaMetadata();
      this._emit('chapterchange', { chapter: ch, state: this.getState() });
    }
    return ch;
  }

  _bindAudioEvents() {
    this.audio.addEventListener('loadedmetadata', () => {
      this._applyPlaybackRateToAudio();
      const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      this.duration = dur;

      // Update stored track duration if it was missing or inaccurate
      const track = this.getCurrentTrack();
      if (track && dur > 0 && Math.abs((track.duration || 0) - dur) > 1) {
        track.duration = dur;
        updateTrack(track.id, { duration: dur }).catch(() => {});
        if (this.book) {
          const totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          this.book.totalDuration = totalDuration;
          updateBook(this.book.id, { totalDuration }).catch(() => {});
        }
      }

      if (this._pendingSeekTime !== null) {
        const clamped = dur > 0
          ? Math.max(0, Math.min(this._pendingSeekTime, Math.max(0, dur - 0.25)))
          : Math.max(0, this._pendingSeekTime);
        this.audio.currentTime = clamped;
        this.currentTime = clamped;
        this._pendingSeekTime = null;
      }

      this._syncEmbeddedChapterOnTime(this.currentTime);
      this._updateMediaPositionState();
      this._emitStateChange('metadata');
    });

    this.audio.addEventListener('play', () => {
      this._applyPlaybackRateToAudio();
      this.isPlaying = true;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      this._updateMediaPositionState();
      this._emitStateChange('playstate');
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      if (!this.audio.ended && this._pausedAt === null) {
        this._pausedAt = Date.now();
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      this.persistProgress(true);
      this._updateMediaPositionState();
      this._emitStateChange('playstate');
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTime = this.audio.currentTime || 0;
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.duration = this.audio.duration;
      }

      // Check A-B loop boundary
      if (this.loopA !== null && this.loopB !== null && this.currentTime >= this.loopB) {
        this.audio.currentTime = this.loopA;
        this.currentTime = this.loopA;
        this._syncEmbeddedChapterOnTime(this.currentTime);
        this._updateMediaPositionState();
        this._emit('timeupdate', {
          currentTime: this.currentTime,
          duration: this.duration,
          bookPosition: this.getBookProgress(),
          currentEmbeddedChapter: this.getCurrentEmbeddedChapter(),
        });
        return;
      }

      // Check embedded .m4b chapter boundary for "End of Chapter" sleep timer
      if (this.sleepMode === 'end-of-chapter' && this._sleepTargetChapterIndex !== null) {
        const chapters = this.getEmbeddedChapters();
        const targetCh = chapters[this._sleepTargetChapterIndex];
        if (targetCh && targetCh.endTime !== null && this.currentTime >= targetCh.endTime - 0.15) {
          this.audio.currentTime = targetCh.endTime;
          this.currentTime = targetCh.endTime;
          this.pause();
          this.clearSleepTimer(false);
          this.persistProgress(true);
          this._emit('sleeptimer', { triggered: true, mode: 'end-of-chapter' });
          this._emitStateChange('sleep');
          return;
        }
      }

      this._syncEmbeddedChapterOnTime(this.currentTime);
      this._applySleepFade();

      const now = Date.now();
      if (now - this._lastPersistAt >= 3000) {
        this.persistProgress(false);
      }

      this._updateMediaPositionState();
      this._emit('timeupdate', {
        currentTime: this.currentTime,
        duration: this.duration,
        bookPosition: this.getBookProgress(),
        currentEmbeddedChapter: this.getCurrentEmbeddedChapter(),
      });
    });

    this.audio.addEventListener('ended', async () => {
      this.isPlaying = false;
      this._pausedAt = null;

      if (this.sleepMode === 'end-of-chapter') {
        this.clearSleepTimer(false);
        await this.persistProgress(true);
        this._emit('sleeptimer', { triggered: true, mode: 'end-of-chapter' });
        this._emitStateChange('sleep');
        return;
      }

      if (this.currentTrackIndex + 1 < this.tracks.length) {
        await this.loadTrack(this.currentTrackIndex + 1, 0, true);
      } else {
        this.currentTime = this.duration;
        if (this.book) {
          this.book.completed = true;
          updateBook(this.book.id, { completed: true }).catch(() => {});
        }
        await this.persistProgress(true);
        this._emitStateChange('playstate');
      }
    });

    this.audio.addEventListener('error', () => {
      this.isPlaying = false;
      const errCode = this.audio.error?.code;
      this._emit('error', {
        message: `Audio playback error${errCode ? ` (code ${errCode})` : ''}. Format may not be supported by this browser.`,
      });
      this._emitStateChange('error');
    });
  }

  _bindMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;

    const safeHandler = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Ignore unsupported actions
      }
    };

    safeHandler('play', () => this.play());
    safeHandler('pause', () => this.pause());
    safeHandler('seekbackward', (details) => this.seekBy(-(details?.seekOffset || this.skipBackSeconds)));
    safeHandler('seekforward', (details) => this.seekBy(details?.seekOffset || this.skipForwardSeconds));
    safeHandler('previoustrack', () => this.prevTrack());
    safeHandler('nexttrack', () => this.nextTrack());
    safeHandler('seekto', (details) => {
      if (typeof details?.seekTime === 'number') {
        this.seekTo(details.seekTime);
      }
    });
  }

  _bindLifecycleEvents() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.persistProgress(true);
      }
    });
    window.addEventListener('pagehide', () => {
      this.persistProgress(true);
    });
  }

  _updateMediaMetadata() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    const track = this.getCurrentTrack();
    if (!this.book || !track) return;

    const embeddedCh = this.getCurrentEmbeddedChapter();
    const title = embeddedCh ? `${track.title} — ${embeddedCh.title}` : track.title;

    let artwork = [];
    if (this.book.coverDataUrl) {
      const entry = {
        src: this.book.coverDataUrl,
        type: this.book.coverMime || 'image/jpeg',
      };
      if (this.book.coverWidth && this.book.coverHeight) {
        entry.sizes = `${this.book.coverWidth}x${this.book.coverHeight}`;
      }
      artwork = [entry];
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: this.book.author || 'Lectio Audiobook',
        album: this.book.title,
        artwork,
      });
    } catch {
      // Ignore metadata failures
    }
  }

  _updateMediaPositionState() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) {
      return;
    }
    if (!Number.isFinite(this.duration) || this.duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        playbackRate: clampSpeed(this.playbackRate),
        position: Math.max(0, Math.min(this.currentTime || 0, this.duration)),
      });
    } catch {
      // Ignore invalid position errors
    }
  }

  _revokeObjectUrl() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  getCurrentTrack() {
    return this.tracks[this.currentTrackIndex] || null;
  }

  getBookProgress() {
    let elapsedBefore = 0;
    let totalDuration = 0;

    for (let i = 0; i < this.tracks.length; i++) {
      const dur = this.tracks[i].duration || (i === this.currentTrackIndex ? this.duration : 0);
      if (i < this.currentTrackIndex) {
        elapsedBefore += dur;
      }
      totalDuration += dur;
    }

    const currentBookTime = elapsedBefore + (this.currentTime || 0);
    const remainingBookTime = Math.max(0, totalDuration - currentBookTime);
    const percent = totalDuration > 0 ? Math.min(100, (currentBookTime / totalDuration) * 100) : 0;

    return {
      currentBookTime,
      totalDuration,
      remainingBookTime,
      percent,
    };
  }

  getState() {
    return {
      book: this.book,
      tracks: this.tracks,
      currentTrack: this.getCurrentTrack(),
      currentTrackIndex: this.currentTrackIndex,
      currentEmbeddedChapter: this.getCurrentEmbeddedChapter(),
      currentTime: this.currentTime,
      duration: this.duration,
      isPlaying: this.isPlaying,
      playbackRate: this.playbackRate,
      preservesPitch: this.preservesPitch,
      autoRewind: this.autoRewind,
      skipBackSeconds: this.skipBackSeconds,
      skipForwardSeconds: this.skipForwardSeconds,
      loopA: this.loopA,
      loopB: this.loopB,
      voiceBoost: this.voiceBoost,
      volume: this.volume,
      muted: this.muted,
      sleepMode: this.sleepMode,
      sleepRemainingMs: this.sleepEndTime ? Math.max(0, this.sleepEndTime - Date.now()) : 0,
      bookProgress: this.getBookProgress(),
    };
  }

  async openBook(book, tracks, options = {}) {
    const {
      autoplay = false,
      trackIndex = book?.currentTrackIndex || 0,
      startTime = book?.currentTime || 0,
      preservesPitch,
      autoRewind,
    } = options;

    // Persist progress of the previously open book before switching
    if (this.book && this.book.id !== book?.id) {
      await this.persistProgress(true);
    }

    this.pause();
    this.clearSleepTimer(false);
    this._pausedAt = null;
    this.loopA = null;
    this.loopB = null;
    this.loopA = null;
    this.loopB = null;
    this.book = book;
    this.tracks = tracks || [];
    this._lastEmbeddedChapterIndex = -1;

    if (typeof preservesPitch === 'boolean') {
      this.preservesPitch = preservesPitch;
    }
    if (typeof autoRewind === 'boolean') {
      this.autoRewind = autoRewind;
    }
    this.playbackRate = clampSpeed(book?.playbackRate ?? this.playbackRate);

    if (this.tracks.length === 0) {
      this._revokeObjectUrl();
      this.audio.removeAttribute('src');
      this.currentTrackIndex = 0;
      this.currentTime = 0;
      this.duration = 0;
      this._emitStateChange('book');
      return;
    }

    const safeIdx = Math.max(0, Math.min(trackIndex, this.tracks.length - 1));
    await this.loadTrack(safeIdx, startTime, autoplay);
  }

  async loadTrack(index, startTime = 0, autoplay = false) {
    if (index < 0 || index >= this.tracks.length) return;

    const token = ++this._loadToken;
    const track = this.tracks[index];

    this.audio.pause();
    this.isPlaying = false;
    this._pausedAt = null;
    this.loopA = null;
    this.loopB = null;
    this.currentTrackIndex = index;
    this.currentTime = startTime || 0;
    this.duration = track.duration || 0;
    this._pendingSeekTime = startTime || 0;
    this._lastEmbeddedChapterIndex = -1;

    const rawBlob = await getAudioBlob(track.id);
    if (token !== this._loadToken) return;

    if (!rawBlob) {
      this._emit('error', { message: `Audio file for "${track.title}" could not be found in storage.` });
      return;
    }

    const mime = track.mimeType || normalizeAudioMime(track.fileName, rawBlob.type);
    const typedBlob = rawBlob.type === mime ? rawBlob : new Blob([rawBlob], { type: mime });

    this._revokeObjectUrl();
    this._objectUrl = URL.createObjectURL(typedBlob);
    this.audio.src = this._objectUrl;
    this._applyPlaybackRateToAudio();
    this.audio.load();

    const ch = this._syncEmbeddedChapterOnTime(this.currentTime);
    if (this.sleepMode === 'end-of-chapter') {
      this._sleepTargetChapterIndex = ch ? ch.index : null;
    }

    this._updateMediaMetadata();
    await this.persistProgress(true);
    this._emit('trackchange', this.getState());
    this._emitStateChange('track');

    if (autoplay) {
      await this.play();
    }
  }

  async play() {
    if (!this.audio.src) return;
    if (this.autoRewind && this._pausedAt !== null && this.currentTime > 0) {
      const rewindSec = computeAutoRewindSeconds(Date.now() - this._pausedAt);
      this._pausedAt = null;
      if (rewindSec > 0) {
        const floor = this.getCurrentEmbeddedChapter(this.currentTime)?.startTime ?? 0;
        const rewound = Math.max(floor, this.currentTime - rewindSec);
        this.audio.currentTime = rewound;
        this.currentTime = rewound;
      }
    } else {
      this._pausedAt = null;
    }
    this._applyPlaybackRateToAudio();
    if (this._audioCtx && this._audioCtx.state === 'suspended') {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      await this.audio.play();
    } catch (err) {
      if (err?.name !== 'AbortError') {
        this._emit('error', { message: 'Playback could not start. Click Play again to resume.' });
      }
    }
  }

  pause() {
    if (!this.audio.paused || this.isPlaying) {
      this._pausedAt = Date.now();
    }
    if (!this.audio.paused) {
      this.audio.pause();
    }
    // The 'pause' event fires asynchronously; reflect the new state right away so
    // anything emitted before it (e.g. the sleep-timer statechange) is accurate.
    this.isPlaying = false;
  }

  async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  seekTo(seconds, { persist = true } = {}) {
    if (!this.audio.src) return;
    this._pausedAt = null;
    const maxDur = Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : this.duration;
    const target = maxDur > 0 ? Math.max(0, Math.min(seconds, maxDur)) : Math.max(0, seconds);
    this.audio.currentTime = target;
    this.currentTime = target;

    if (this.book?.completed && maxDur > 0 && target < maxDur - 2) {
      this.book.completed = false;
    }

    const ch = this._syncEmbeddedChapterOnTime(target);
    if (this.sleepMode === 'end-of-chapter') {
      this._sleepTargetChapterIndex = ch ? ch.index : null;
    }

    if (persist) {
      this.persistProgress(true);
    }
    this._updateMediaPositionState();
    this._emit('timeupdate', {
      currentTime: this.currentTime,
      duration: this.duration,
      bookPosition: this.getBookProgress(),
      currentEmbeddedChapter: ch,
    });
  }

  async seekBy(deltaSeconds) {
    const delta = Number(deltaSeconds);
    if (!Number.isFinite(delta)) return;

    if (!this.book || this.tracks.length === 0) {
      this.seekTo((this.currentTime || 0) + delta, { persist: true });
      return;
    }

    const maxDur = Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : (this.duration || this.getCurrentTrack()?.duration || 0);
    const rawTarget = (this.currentTime || 0) + delta;

    // Cross backward into the previous track(s)
    if (rawTarget < 0 && this.currentTrackIndex > 0) {
      let remainingBack = -rawTarget;
      let idx = this.currentTrackIndex - 1;
      while (idx > 0) {
        const prevDur = this.tracks[idx]?.duration || 0;
        if (prevDur > 0 && remainingBack > prevDur) {
          remainingBack -= prevDur;
          idx--;
        } else {
          break;
        }
      }
      const targetDur = this.tracks[idx]?.duration || 0;
      const landTime = targetDur > 0 ? Math.max(0, targetDur - remainingBack) : 0;
      await this.loadTrack(idx, landTime, this.isPlaying);
      return;
    }

    // Cross forward into the next track(s)
    if (maxDur > 0 && rawTarget > maxDur && this.currentTrackIndex + 1 < this.tracks.length) {
      let overflow = rawTarget - maxDur;
      let idx = this.currentTrackIndex + 1;
      while (idx + 1 < this.tracks.length) {
        const nextDur = this.tracks[idx]?.duration || 0;
        if (nextDur > 0 && overflow >= nextDur) {
          overflow -= nextDur;
          idx++;
        } else {
          break;
        }
      }
      const targetDur = this.tracks[idx]?.duration || 0;
      const landTime = targetDur > 0 ? Math.min(overflow, Math.max(0, targetDur - 0.25)) : overflow;
      await this.loadTrack(idx, landTime, this.isPlaying);
      return;
    }

    this.seekTo(rawTarget, { persist: true });
  }

  async jumpToPosition(trackIndex, timeSeconds, autoplay = true) {
    if (trackIndex === this.currentTrackIndex && this.audio.src) {
      this.seekTo(timeSeconds, { persist: true });
      if (autoplay && !this.isPlaying) {
        await this.play();
      }
      return;
    }
    await this.loadTrack(trackIndex, timeSeconds, autoplay);
  }

  async prevTrack() {
    const chapters = this.getEmbeddedChapters();
    if (chapters.length > 0) {
      const currentCh = this.getCurrentEmbeddedChapter();
      if (currentCh) {
        if (this.currentTime - currentCh.startTime > 5) {
          this.seekTo(currentCh.startTime, { persist: true });
          return;
        }
        if (currentCh.index > 0) {
          this.seekTo(chapters[currentCh.index - 1].startTime, { persist: true });
          return;
        }
      }
    } else if (this.currentTime > 5) {
      this.seekTo(0, { persist: true });
      return;
    }

    if (this.currentTrackIndex > 0) {
      await this.loadTrack(this.currentTrackIndex - 1, 0, this.isPlaying);
    } else {
      this.seekTo(0, { persist: true });
    }
  }

  async nextTrack() {
    const chapters = this.getEmbeddedChapters();
    if (chapters.length > 0) {
      const currentCh = this.getCurrentEmbeddedChapter();
      if (currentCh && currentCh.index + 1 < chapters.length) {
        this.seekTo(chapters[currentCh.index + 1].startTime, { persist: true });
        return;
      }
    }

    if (this.currentTrackIndex + 1 < this.tracks.length) {
      await this.loadTrack(this.currentTrackIndex + 1, 0, this.isPlaying);
    }
  }

  setSpeed(rate, { persist = true } = {}) {
    const next = clampSpeed(rate);
    this.playbackRate = next;
    this._applyPlaybackRateToAudio();
    this._updateMediaPositionState();

    if (persist) {
      this.persistSpeed();
    }

    this._emit('speedchange', { playbackRate: next });
    return next;
  }

  persistSpeed() {
    const rate = clampSpeed(this.playbackRate);
    if (this.book) {
      this.book.playbackRate = rate;
      updateBook(this.book.id, { playbackRate: rate }).catch(() => {});
    }
    setSetting('lastPlaybackRate', rate).catch(() => {});
  }

  nudgeSpeed(delta) {
    return this.setSpeed(stepSpeed(this.playbackRate, delta), { persist: true });
  }

  setPreservesPitch(enabled) {
    this.preservesPitch = Boolean(enabled);
    this._applyPlaybackRateToAudio();
    setSetting('preservesPitch', this.preservesPitch).catch(() => {});
    this._emitStateChange('pitch');
  }

  setAutoRewind(enabled) {
    this.autoRewind = Boolean(enabled);
    setSetting('autoRewind', this.autoRewind).catch(() => {});
    this._emitStateChange('autorewind');
  }

  setSkipIntervals(backSeconds, forwardSeconds) {
    const clampInterval = (v, fallback) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(5, Math.min(120, n)) : fallback;
    };
    this.skipBackSeconds = clampInterval(backSeconds, this.skipBackSeconds);
    this.skipForwardSeconds = clampInterval(forwardSeconds, this.skipForwardSeconds);
    setSetting('skipBackSeconds', this.skipBackSeconds).catch(() => {});
    setSetting('skipForwardSeconds', this.skipForwardSeconds).catch(() => {});
    this._emitStateChange('settings');
  }

  setLoopA(time = this.currentTime) {
    const a = Math.max(0, Number(time) || 0);
    this.loopA = a;
    if (this.loopB !== null && this.loopB <= a + 0.5) {
      this.loopB = null;
    }
    this._emitStateChange('loop');
  }

  setLoopB(time = this.currentTime) {
    let b = Math.max(0, Number(time) || 0);
    if (this.loopA === null) {
      this.loopA = Math.max(0, b - 10);
      this.loopB = Math.max(this.loopA + 0.5, b);
    } else if (b < this.loopA) {
      const prevA = this.loopA;
      this.loopA = b;
      this.loopB = Math.max(b + 0.5, prevA);
    } else {
      this.loopB = Math.max(this.loopA + 0.5, b);
    }
    this._emitStateChange('loop');
  }

  clearLoop() {
    this.loopA = null;
    this.loopB = null;
    this._emitStateChange('loop');
  }

  cycleLoop() {
    if (this.loopA === null) {
      this.setLoopA();
      return 'set-a';
    }
    if (this.loopB === null) {
      this.setLoopB();
      return 'set-b';
    }
    this.clearLoop();
    return 'cleared';
  }

  _applyVoiceBoost() {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!this._audioCtx && !this.voiceBoost) return;

    try {
      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
        this._audioSource = this._audioCtx.createMediaElementSource(this.audio);

        const highpass = this._audioCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 85;

        const presence = this._audioCtx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 2800;
        presence.Q.value = 1;
        presence.gain.value = 4;

        const compressor = this._audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.15;

        highpass.connect(presence);
        presence.connect(compressor);
        compressor.connect(this._audioCtx.destination);
        this._voiceNodes = { highpass, presence, compressor };
      }

      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }

      this._audioSource.disconnect();
      if (this.voiceBoost && this._voiceNodes) {
        this._audioSource.connect(this._voiceNodes.highpass);
      } else {
        this._audioSource.connect(this._audioCtx.destination);
      }
    } catch {
      // Fall back silently if browser restricts Web Audio routing
    }
  }

  setVoiceBoost(enabled) {
    this.voiceBoost = Boolean(enabled);
    this._applyVoiceBoost();
    setSetting('voiceBoost', this.voiceBoost).catch(() => {});
    this._emitStateChange('voiceboost');
  }

  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol)));
    this.volume = Number.isFinite(clamped) ? clamped : 1;
    this._applySleepFade(); // sets audio.volume, honouring any in-progress fade
    if (this.volume > 0 && this.muted) {
      this.muted = false;
      this.audio.muted = false;
    }
    this._emitStateChange('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.muted = this.muted;
    this._emitStateChange('volume');
  }

  setSleepTimer(option) {
    this.clearSleepTimer(false);
    if (!option || option === 'off') {
      this._emit('sleeptimer', { mode: 'off', remainingMs: 0 });
      this._emitStateChange('sleep');
      return;
    }

    if (option === 'end-of-chapter') {
      this.sleepMode = 'end-of-chapter';
      this.sleepEndTime = null;
      const ch = this.getCurrentEmbeddedChapter();
      this._sleepTargetChapterIndex = ch ? ch.index : null;
      this._emit('sleeptimer', { mode: 'end-of-chapter', remainingMs: 0 });
      this._emitStateChange('sleep');
      return;
    }

    const minutes = Number(option);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    this.sleepMode = 'timer';
    this.sleepEndTime = Date.now() + minutes * 60 * 1000;
    this._sleepInterval = setInterval(() => {
      const remaining = this.sleepEndTime - Date.now();
      if (remaining <= 0) {
        this.pause();
        this.clearSleepTimer(false);
        this._emit('sleeptimer', { triggered: true, mode: 'timer', remainingMs: 0 });
        this._emitStateChange('sleep');
      } else {
        this._applySleepFade();
        this._emit('sleeptimer', { mode: 'timer', remainingMs: remaining });
      }
    }, 1000);

    this._emit('sleeptimer', { mode: 'timer', remainingMs: minutes * 60 * 1000 });
    this._emitStateChange('sleep');
  }

  /**
   * Add minutes to a running countdown timer. Returns false when no countdown is
   * active (e.g. "end of chapter" mode), so the caller can ignore the request.
   */
  extendSleepTimer(minutes = 5) {
    if (this.sleepMode !== 'timer' || !this.sleepEndTime) return false;
    this.sleepEndTime += minutes * 60 * 1000;
    this._applySleepFade();
    this._emit('sleeptimer', { mode: 'timer', remainingMs: this.sleepEndTime - Date.now() });
    return true;
  }

  /** Real (wall-clock) milliseconds until the sleep timer stops playback, or null. */
  _sleepRemainingMs() {
    if (this.sleepMode === 'timer' && this.sleepEndTime) {
      return Math.max(0, this.sleepEndTime - Date.now());
    }
    if (this.sleepMode === 'end-of-chapter') {
      const targetCh = this._sleepTargetChapterIndex !== null
        ? this.getEmbeddedChapters()[this._sleepTargetChapterIndex]
        : null;
      const end = targetCh?.endTime ?? this.duration;
      if (!Number.isFinite(end) || end <= 0) return null;
      const audioSecondsLeft = Math.max(0, end - (this.currentTime || 0));
      return (audioSecondsLeft / clampSpeed(this.playbackRate)) * 1000;
    }
    return null;
  }

  /** Fade volume out over the final seconds before the sleep timer pauses playback. */
  _applySleepFade() {
    const remaining = this._sleepRemainingMs();
    const factor = remaining !== null && remaining < SLEEP_FADE_MS
      ? Math.max(0, remaining / SLEEP_FADE_MS)
      : 1;
    const target = this.volume * factor;
    if (Math.abs(this.audio.volume - target) > 0.001) {
      this.audio.volume = target;
    }
  }

  clearSleepTimer(emit = true) {
    if (this._sleepInterval) {
      clearInterval(this._sleepInterval);
      this._sleepInterval = null;
    }
    this.sleepMode = 'off';
    this.sleepEndTime = null;
    this._sleepTargetChapterIndex = null;
    // Undo any fade so the next play starts at the user's volume
    this.audio.volume = this.volume;
    if (emit) {
      this._emit('sleeptimer', { mode: 'off', remainingMs: 0 });
      this._emitStateChange('sleep');
    }
  }

  async persistProgress(force = false) {
    if (!this.book) return;
    const now = Date.now();
    if (!force && now - this._lastPersistAt < 2500) return;

    this._lastPersistAt = now;
    const { currentBookTime } = this.getBookProgress();
    this.book.currentTrackIndex = this.currentTrackIndex;
    this.book.currentTime = this.currentTime;
    this.book.bookTime = currentBookTime;
    this.book.playbackRate = this.playbackRate;
    this.book.lastPlayedAt = now;

    try {
      await updateBook(this.book.id, {
        currentTrackIndex: this.currentTrackIndex,
        currentTime: this.currentTime,
        bookTime: currentBookTime,
        playbackRate: this.playbackRate,
        lastPlayedAt: now,
        completed: Boolean(this.book.completed),
      });
    } catch {
      // Ignore transient DB write failures
    }
  }

  async unloadBook({ persist = true } = {}) {
    if (persist && this.book) {
      await this.persistProgress(true);
    }
    this.pause();
    this.clearSleepTimer(false);
    this._pausedAt = null;
    this.loopA = null;
    this.loopB = null;
    this._revokeObjectUrl();
    this.audio.removeAttribute('src');
    this.book = null;
    this.tracks = [];
    this.currentTrackIndex = 0;
    this.currentTime = 0;
    this.duration = 0;
    this._lastEmbeddedChapterIndex = -1;
    this._emitStateChange('unload');
  }
}
