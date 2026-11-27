import test from 'node:test';
import assert from 'node:assert/strict';

import { installBrowserMocks } from './mocks.mjs';

const mocks = installBrowserMocks();

const db = await import('../src/db.js');
const { importFiles, findDuplicateBook } = await import('../src/importer.js');
const { LectioPlayer } = await import('../src/player.js');
const { createBookmarkData } = await import('../src/bookmarks.js');

function tick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFakeAudioFile(name, relativePath, bytes = 128) {
  const data = new Uint8Array(bytes);
  const blob = new Blob([data], { type: '' });
  blob.name = name;
  blob.webkitRelativePath = relativePath;
  return { file: blob, relativePath };
}

test('db.js cascade deleteBook cleans books, tracks, audioBlobs, and bookmarks; handles versionchange', async () => {
  mocks.fakeIndexedDB._reset();
  db.closeDB();

  const book = { id: 'book-1', title: 'Calculus', createdAt: 100, lastPlayedAt: 100 };
  await db.putBook(book);
  await db.putTracksWithBlobs(
    [
      { id: 't1', bookId: 'book-1', order: 0, title: 'Ch 1', duration: 60 },
      { id: 't2', bookId: 'book-1', order: 1, title: 'Ch 2', duration: 90 },
    ],
    [
      { trackId: 't1', bookId: 'book-1', blob: new Blob(['a']) },
      { trackId: 't2', bookId: 'book-1', blob: new Blob(['b']) },
    ]
  );
  await db.putBookmark(
    createBookmarkData({
      book,
      track: { id: 't1', order: 0, title: 'Ch 1' },
      time: 12,
      category: 'important',
    })
  );

  assert.equal((await db.getAllBooks()).length, 1);
  assert.equal((await db.getTracksForBook('book-1')).length, 2);
  assert.ok(await db.getAudioBlob('t1'));
  assert.equal((await db.getBookmarksForBook('book-1')).length, 1);

  // Simulate another tab triggering a schema upgrade
  mocks.fakeIndexedDB._triggerVersionChange('lectio-audiobooks', 2);
  // Subsequent DB calls still succeed cleanly after reconnect
  await db.deleteBook('book-1');

  assert.equal((await db.getAllBooks()).length, 0);
  assert.equal((await db.getTracksForBook('book-1')).length, 0);
  assert.equal(await db.getAudioBlob('t1'), null);
  assert.equal((await db.getBookmarksForBook('book-1')).length, 0);
});

test('importer.js imports multi-file folder, detects duplicates, and merges missing files', async () => {
  mocks.fakeIndexedDB._reset();
  db.closeDB();

  const entries1 = [
    makeFakeAudioFile('02_Derivatives.m4a', 'Calc/02_Derivatives.m4a', 200),
    makeFakeAudioFile('01_Limits.mp3', 'Calc/01_Limits.mp3', 150),
    makeFakeAudioFile('.DS_Store', 'Calc/.DS_Store', 20),
  ];

  const res1 = await importFiles({ entries: entries1 });
  assert.equal(res1.importedCount, 2);
  assert.equal(res1.book.title, 'Calc');

  const tracks1 = await db.getTracksForBook(res1.book.id);
  assert.deepEqual(
    tracks1.map((t) => t.fileName),
    ['01_Limits.mp3', '02_Derivatives.m4a']
  );

  // Duplicate check on re-import
  const existingBooks = await db.getAllBooks();
  const dup = await findDuplicateBook(entries1, existingBooks, db.getTracksForBook);
  assert.ok(dup);
  assert.equal(dup.book.id, res1.book.id);

  // Merge with 1 existing file and 1 new file
  const entries2 = [
    makeFakeAudioFile('01_Limits.mp3', 'Calc/01_Limits.mp3', 150),
    makeFakeAudioFile('03_Integrals.m4b', 'Calc/03_Integrals.m4b', 300),
  ];
  const res2 = await importFiles({
    entries: entries2,
    targetBookId: res1.book.id,
    skipExistingSignatures: true,
  });
  assert.equal(res2.importedCount, 1);
  assert.equal(res2.duplicateSkippedCount, 1);

  const tracksAfter = await db.getTracksForBook(res1.book.id);
  assert.equal(tracksAfter.length, 3);
});

test('LectioPlayer handles auto-advance, book-switch persistence, slider non-persist, and embedded .m4b chapters', async () => {
  mocks.fakeIndexedDB._reset();
  db.closeDB();

  const bookA = {
    id: 'book-a',
    title: 'Single-File M4B Textbook',
    author: 'Prof. Author',
    coverDataUrl: 'data:image/jpeg;base64,abc',
    coverWidth: 320,
    coverHeight: 480,
    coverMime: 'image/jpeg',
    trackCount: 2,
    totalDuration: 300,
    currentTrackIndex: 0,
    currentTime: 0,
    bookTime: 0,
    playbackRate: 1.0,
    createdAt: 1,
    lastPlayedAt: 1,
  };
  const tracksA = [
    {
      id: 'ta-1',
      bookId: 'book-a',
      order: 0,
      title: 'Part 1',
      fileName: 'Part1.m4b',
      mimeType: 'audio/mp4',
      duration: 180,
      chapters: [
        { title: '1.1 Intro', startTime: 0 },
        { title: '1.2 Core Theory', startTime: 60 },
        { title: '1.3 Summary', startTime: 120 },
      ],
    },
    {
      id: 'ta-2',
      bookId: 'book-a',
      order: 1,
      title: 'Part 2',
      fileName: 'Part2.mp3',
      mimeType: 'audio/mpeg',
      duration: 120,
      chapters: null,
    },
  ];
  await db.putBook(bookA);
  await db.putTracksWithBlobs(tracksA, [
    { trackId: 'ta-1', bookId: 'book-a', blob: new Blob(['1']) },
    { trackId: 'ta-2', bookId: 'book-a', blob: new Blob(['2']) },
  ]);

  const bookB = {
    id: 'book-b',
    title: 'Second Book',
    trackCount: 1,
    totalDuration: 100,
    currentTrackIndex: 0,
    currentTime: 0,
    bookTime: 0,
    playbackRate: 1.25,
    createdAt: 2,
    lastPlayedAt: 2,
  };
  await db.putBook(bookB);
  await db.putTracksWithBlobs(
    [{ id: 'tb-1', bookId: 'book-b', order: 0, title: 'Only Track', fileName: 'only.mp3', duration: 100 }],
    [{ trackId: 'tb-1', bookId: 'book-b', blob: new Blob(['3']) }]
  );

  const player = new LectioPlayer();
  player.audio.duration = 180;
  await player.openBook(bookA, tracksA, { autoplay: false });
  await tick(15);

  // Media Session artwork uses exact stored dimensions
  assert.deepEqual(navigator.mediaSession.metadata.artwork, [
    { src: 'data:image/jpeg;base64,abc', type: 'image/jpeg', sizes: '320x480' },
  ]);

  // Embedded chapter navigation
  assert.equal(player.getCurrentEmbeddedChapter()?.title, '1.1 Intro');
  await player.nextTrack();
  assert.equal(player.currentTime, 60);
  assert.equal(player.getCurrentEmbeddedChapter()?.title, '1.2 Core Theory');

  // End-of-chapter sleep timer pauses at embedded chapter boundary (120s)
  player.setSleepTimer('end-of-chapter');
  await player.play();
  let sleepTriggered = false;
  player.addEventListener('sleeptimer', ({ detail }) => {
    if (detail.triggered) sleepTriggered = true;
  });
  player.audio._emitTimeUpdate(120);
  assert.equal(sleepTriggered, true);
  assert.equal(player.isPlaying, false);

  // Slider drag with persist: false does not overwrite DB until explicit persist
  player.seekTo(95, { persist: false });
  const beforeSwitchSaved = await db.getBook('book-a');
  assert.notEqual(beforeSwitchSaved.currentTime, 95);

  // Speed slider with persist: false updates live audio without DB write until persistSpeed()
  player.setSpeed(1.42, { persist: false });
  assert.equal(player.audio.playbackRate, 1.42);
  assert.equal((await db.getBook('book-a')).playbackRate, 1.0);
  player.persistSpeed();
  await tick(10);
  assert.equal((await db.getBook('book-a')).playbackRate, 1.42);

  // Switching to Book B persists Book A's currentTime & bookTime first
  await player.openBook(bookB, await db.getTracksForBook('book-b'), { autoplay: false });
  await tick(15);
  const savedA = await db.getBook('book-a');
  assert.equal(savedA.currentTime, 95);
  assert.equal(savedA.bookTime, 95);

  // Auto-advance on track ended (Book A Part 1 -> Part 2)
  await player.openBook(savedA, tracksA, { autoplay: false, trackIndex: 0, startTime: 0 });
  await tick(15);
  player.audio._emitEnded();
  await tick(20);
  assert.equal(player.currentTrackIndex, 1);

  await player.unloadBook({ persist: false });
});

test('sleep timer fades volume before stopping, can be extended, and restores volume', async () => {
  const player = new LectioPlayer();
  player.setVolume(0.8);

  // Countdown timer: +5 min extends the end time; extension is refused when no timer runs
  assert.equal(player.extendSleepTimer(5), false);
  player.setSleepTimer('10');
  const originalEnd = player.sleepEndTime;
  assert.equal(player.extendSleepTimer(5), true);
  assert.equal(player.sleepEndTime - originalEnd, 5 * 60 * 1000);

  // Far from the end: full volume
  player._applySleepFade();
  assert.equal(player.audio.volume, 0.8);

  // 7.5s left of the 15s fade window: half volume
  player.sleepEndTime = Date.now() + 7500;
  player._applySleepFade();
  assert.ok(Math.abs(player.audio.volume - 0.4) < 0.02, `volume was ${player.audio.volume}`);

  // Changing volume mid-fade keeps the fade applied
  player.setVolume(0.6);
  assert.ok(player.audio.volume < 0.6);

  // Clearing the timer restores the user's volume
  player.clearSleepTimer(false);
  assert.equal(player.audio.volume, 0.6);

  // End-of-chapter mode fades by real time left, accounting for playback speed
  player.sleepMode = 'end-of-chapter';
  player._sleepTargetChapterIndex = null;
  player.duration = 100;
  player.currentTime = 85; // 15s of audio left
  player.playbackRate = 2; // = 7.5s of real time
  player._applySleepFade();
  assert.ok(Math.abs(player.audio.volume - 0.3) < 0.02, `volume was ${player.audio.volume}`);
  player.clearSleepTimer(false);
});

test('LectioPlayer supports cross-track seekBy and smart autoRewind on resume', async () => {
  mocks.fakeIndexedDB._reset();
  db.closeDB();

  const book = {
    id: 'book-nav',
    title: 'Multi-Chapter Textbook',
    trackCount: 2,
    totalDuration: 300,
    currentTrackIndex: 0,
    currentTime: 0,
    bookTime: 0,
    playbackRate: 1.0,
    createdAt: 1,
    lastPlayedAt: 1,
  };
  const tracks = [
    {
      id: 'tn-1',
      bookId: 'book-nav',
      order: 0,
      title: 'Part 1',
      fileName: 'Part1.m4b',
      mimeType: 'audio/mp4',
      duration: 180,
      chapters: [
        { title: 'Sec 1', startTime: 0 },
        { title: 'Sec 2', startTime: 50 },
      ],
    },
    {
      id: 'tn-2',
      bookId: 'book-nav',
      order: 1,
      title: 'Part 2',
      fileName: 'Part2.mp3',
      mimeType: 'audio/mpeg',
      duration: 120,
    },
  ];
  await db.putBook(book);
  await db.putTracksWithBlobs(tracks, [
    { trackId: 'tn-1', bookId: 'book-nav', blob: new Blob(['1']) },
    { trackId: 'tn-2', bookId: 'book-nav', blob: new Blob(['2']) },
  ]);

  const player = new LectioPlayer();
  player.audio.duration = 180;
  await player.openBook(book, tracks, { autoplay: false, autoRewind: true });
  await tick(15);

  // Seek forward past Track 1 end (175 + 30 = 205 -> 25s into Track 2)
  player.seekTo(175, { persist: false });
  await player.play();
  await player.seekBy(30);
  await tick(15);
  assert.equal(player.currentTrackIndex, 1);
  assert.equal(player.currentTime, 25);
  assert.equal(player.isPlaying, true);

  // Seek backward past Track 2 start (5 - 15 = -10 -> 170s in Track 1)
  player.seekTo(5, { persist: false });
  await player.seekBy(-15);
  await tick(15);
  assert.equal(player.currentTrackIndex, 0);
  assert.equal(player.currentTime, 170);

  // Smart auto-rewind after a simulated 2-minute pause rewinds 2s
  player.pause();
  await tick(10);
  player._pausedAt = Date.now() - 120_000;
  await player.play();
  assert.equal(player.currentTime, 168);

  // Respects embedded chapter start floor (50.5s - 2s -> clamped to 50s)
  player.seekTo(50.5, { persist: false });
  player.pause();
  await tick(10);
  player._pausedAt = Date.now() - 120_000;
  await player.play();
  assert.equal(player.currentTime, 50);

  // Explicit seek while paused clears _pausedAt and does not rewind on play
  player.pause();
  await tick(10);
  player._pausedAt = Date.now() - 120_000;
  player.seekTo(80, { persist: false });
  await player.play();
  assert.equal(player.currentTime, 80);

  // Disabling autoRewind skips rewind completely
  player.setAutoRewind(false);
  player.pause();
  await tick(10);
  player._pausedAt = Date.now() - 600_000;
  await player.play();
  assert.equal(player.currentTime, 80);

  await player.unloadBook({ persist: false });
});

test('LectioPlayer supports A-B looping, configurable skip intervals, voice boost state, and db.updateTracksOrder', async () => {
  mocks.fakeIndexedDB._reset();
  db.closeDB();

  const book = {
    id: 'book-loop',
    title: 'Loop & Order Book',
    trackCount: 2,
    totalDuration: 200,
    currentTrackIndex: 0,
    currentTime: 0,
    bookTime: 0,
    playbackRate: 1.0,
    createdAt: 1,
    lastPlayedAt: 1,
  };
  const tracks = [
    { id: 'tl-1', bookId: 'book-loop', order: 0, title: 'Ch 1', fileName: '01.mp3', duration: 100 },
    { id: 'tl-2', bookId: 'book-loop', order: 1, title: 'Ch 2', fileName: '02.mp3', duration: 100 },
  ];
  await db.putBook(book);
  await db.putTracksWithBlobs(tracks, [
    { trackId: 'tl-1', bookId: 'book-loop', blob: new Blob(['1']) },
    { trackId: 'tl-2', bookId: 'book-loop', blob: new Blob(['2']) },
  ]);

  const player = new LectioPlayer();
  player.audio.duration = 100;
  await player.openBook(book, tracks, { autoplay: false });
  await tick(15);

  // Skip intervals clamp and persist
  player.setSkipIntervals(10, 45);
  assert.equal(player.skipBackSeconds, 10);
  assert.equal(player.skipForwardSeconds, 45);
  assert.equal(await db.getSetting('skipBackSeconds'), 10);

  // Voice boost safely sets state even without AudioContext in Node
  player.setVoiceBoost(true);
  assert.equal(player.voiceBoost, true);
  assert.equal(await db.getSetting('voiceBoost'), true);

  // A-B loop cycles and wraps playback at boundary B -> A
  player.seekTo(20, { persist: false });
  assert.equal(player.cycleLoop(), 'set-a');
  assert.equal(player.loopA, 20);
  player.seekTo(35, { persist: false });
  assert.equal(player.cycleLoop(), 'set-b');
  assert.equal(player.loopB, 35);

  player.audio._emitTimeUpdate(35.2);
  assert.equal(player.currentTime, 20);
  assert.equal(player.audio.currentTime, 20);

  assert.equal(player.cycleLoop(), 'cleared');
  assert.equal(player.loopA, null);
  assert.equal(player.loopB, null);

  // Switching track clears any active loop
  player.setLoopA(10);
  player.setLoopB(25);
  await player.loadTrack(1, 0, false);
  assert.equal(player.loopA, null);
  assert.equal(player.loopB, null);

  // db.updateTracksOrder persists swapped track ordering
  const reordered = [tracks[1], tracks[0]];
  await db.updateTracksOrder(reordered);
  const fetched = await db.getTracksForBook('book-loop');
  assert.deepEqual(
    fetched.map((t) => t.id),
    ['tl-2', 'tl-1']
  );

  await player.unloadBook({ persist: false });
});
