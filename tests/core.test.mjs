import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcSpeedAdjustedTime,
  clampSpeed,
  cleanTrackTitle,
  extractFolderAndSection,
  formatDurationHuman,
  formatSpeed,
  formatTime,
  isCoverImageFile,
  isSupportedAudioFile,
  normalizeAudioMime,
  scoreCoverImage,
  sortTextbookTracks,
  stepSpeed,
} from '../src/formats.js';

import { parseID3v2, parseMP4Metadata } from '../src/metadata.js';

import {
  BOOKMARK_CATEGORIES,
  createBookmarkData,
  exportBookmarksToJSON,
  exportBookmarksToMarkdown,
  filterBookmarks,
  parseImportedBookmarksJSON,
  sortBookmarks,
} from '../src/bookmarks.js';

// --- formats.js tests ---

test('isSupportedAudioFile accepts common audiobook formats and rejects macOS junk files', () => {
  const valid = [
    'Chapter_01.mp3',
    'Biology/Unit 1/01.m4a',
    'Physics/02_Optics.m4b',
    'Lecture.ogg',
    'Notes.opus',
    'Studio.flac',
    'Recording.wav',
    'Stream.aac',
    'Audio.webm',
    'Archive.aiff',
  ];
  for (const name of valid) {
    assert.equal(isSupportedAudioFile(name), true, `Expected ${name} to be supported`);
  }

  assert.equal(isSupportedAudioFile('unknown.bin', 'audio/ogg'), true);
  assert.equal(isSupportedAudioFile('.DS_Store'), false);
  assert.equal(isSupportedAudioFile('Folder/._01.mp3'), false);
  assert.equal(isSupportedAudioFile('__MACOSX/01.mp3'), false);
  assert.equal(isSupportedAudioFile('notes.pdf'), false);
});

test('normalizeAudioMime maps audiobook extensions accurately', () => {
  assert.equal(normalizeAudioMime('book.m4b', ''), 'audio/mp4');
  assert.equal(normalizeAudioMime('ch1.m4a', ''), 'audio/mp4');
  assert.equal(normalizeAudioMime('ch1.mp3', ''), 'audio/mpeg');
  assert.equal(normalizeAudioMime('ch1.opus', ''), 'audio/opus');
  assert.equal(normalizeAudioMime('ch1.ogg', ''), 'audio/ogg');
  assert.equal(normalizeAudioMime('ch1.flac', ''), 'audio/flac');
  assert.equal(normalizeAudioMime('ch1.wav', ''), 'audio/wav');
  assert.equal(normalizeAudioMime('ch1.aac', ''), 'audio/aac');
});

test('cover image detection and scoring prioritizes cover/folder/front', () => {
  assert.equal(isCoverImageFile('cover.jpg'), true);
  assert.equal(isCoverImageFile('._cover.jpg'), false);
  assert.equal(isCoverImageFile('readme.txt'), false);

  assert.ok(scoreCoverImage('Book/cover.jpg') > scoreCoverImage('Book/folder.png'));
  assert.ok(scoreCoverImage('Book/folder.png') > scoreCoverImage('Book/diagram.png'));
});

test('sortTextbookTracks orders nested textbook folders and chapters naturally', () => {
  const shuffled = [
    { relativePath: 'Organic Chem/Part 2/Ch 1.m4a' },
    { relativePath: 'Organic Chem/Part 1/Ch 10.m4a' },
    { relativePath: 'Organic Chem/Part 1/Ch 2.m4a' },
    { relativePath: 'Organic Chem/Part 1/Ch 1.m4a' },
    { relativePath: 'Organic Chem/Part 10/Ch 1.m4a' },
  ];

  const sorted = sortTextbookTracks(shuffled).map((t) => t.relativePath);
  assert.deepEqual(sorted, [
    'Organic Chem/Part 1/Ch 1.m4a',
    'Organic Chem/Part 1/Ch 2.m4a',
    'Organic Chem/Part 1/Ch 10.m4a',
    'Organic Chem/Part 2/Ch 1.m4a',
    'Organic Chem/Part 10/Ch 1.m4a',
  ]);
});

test('cleanTrackTitle and extractFolderAndSection format textbook metadata cleanly', () => {
  assert.equal(cleanTrackTitle('01_Introduction_to_Cells.m4b'), '01 Introduction to Cells');
  assert.deepEqual(
    extractFolderAndSection('Organic Chem/Part 1/01_Intro.m4a'),
    { bookTitle: 'Organic Chem', section: 'Part 1' }
  );
  assert.deepEqual(
    extractFolderAndSection('Bio 101/01.mp3'),
    { bookTitle: 'Bio 101', section: '' }
  );
});

test('granular fractional speed helpers clamp, step without float drift, and format', () => {
  assert.equal(clampSpeed(1.375), 1.375);
  assert.equal(clampSpeed(0.1), 0.25);
  assert.equal(clampSpeed(5.5), 4.0);
  assert.equal(clampSpeed('1.375×'), 1.375);
  assert.equal(clampSpeed('bad'), 1.0);

  // Zero floating-point drift on 0.01 steps
  assert.equal(stepSpeed(1.0, 0.01), 1.01);
  assert.equal(stepSpeed(1.1, 0.01), 1.11);
  assert.equal(stepSpeed(1.14, 0.01), 1.15);
  assert.equal(stepSpeed(0.25, -0.01), 0.25);
  assert.equal(stepSpeed(4.0, 0.01), 4.0);
  assert.equal(stepSpeed(1.375, 0.005), 1.38);

  assert.equal(formatSpeed(1.0), '1.00×');
  assert.equal(formatSpeed(1.37), '1.37×');
  assert.equal(formatSpeed(1.375), '1.375×');
});

test('time formatting and speed-adjusted duration calculation', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(Number.NaN), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3661), '1:01:01');

  assert.equal(formatDurationHuman(45), '45s');
  assert.equal(formatDurationHuman(2280), '38m');
  assert.equal(formatDurationHuman(15120), '4h 12m');

  assert.equal(calcSpeedAdjustedTime(150, 1.5), 100);
});

// --- metadata.js tests ---

function makeSyncsafe(val) {
  return [
    (val >> 21) & 0x7f,
    (val >> 14) & 0x7f,
    (val >> 7) & 0x7f,
    val & 0x7f,
  ];
}

function makeID3v23TextFrame(id, text) {
  const enc = new TextEncoder();
  const textBytes = enc.encode(text);
  const payload = new Uint8Array(1 + textBytes.length);
  payload[0] = 3; // UTF-8
  payload.set(textBytes, 1);

  const frame = new Uint8Array(10 + payload.length);
  frame.set(enc.encode(id), 0);
  const size = payload.length;
  frame[4] = (size >>> 24) & 0xff;
  frame[5] = (size >>> 16) & 0xff;
  frame[6] = (size >>> 8) & 0xff;
  frame[7] = size & 0xff;
  frame.set(payload, 10);
  return frame;
}

test('parseID3v2 extracts title, artist, album, and track number from synthetic ID3v2.3 buffer', () => {
  const frames = [
    makeID3v23TextFrame('TIT2', 'Cell Biology Ch 1'),
    makeID3v23TextFrame('TPE1', 'Dr. Ada Lovelace'),
    makeID3v23TextFrame('TALB', 'Molecular Biology'),
    makeID3v23TextFrame('TRCK', '3/12'),
  ];
  const bodySize = frames.reduce((s, f) => s + f.length, 0);
  const buf = new Uint8Array(10 + bodySize);
  buf.set([0x49, 0x44, 0x33, 3, 0, 0, ...makeSyncsafe(bodySize)], 0);

  let pos = 10;
  for (const f of frames) {
    buf.set(f, pos);
    pos += f.length;
  }

  const parsed = parseID3v2(buf);
  assert.equal(parsed.title, 'Cell Biology Ch 1');
  assert.equal(parsed.artist, 'Dr. Ada Lovelace');
  assert.equal(parsed.album, 'Molecular Biology');
  assert.equal(parsed.trackNumber, 3);
});

function makeMp4Atom(type, payloadBytes) {
  const size = 8 + payloadBytes.length;
  const out = new Uint8Array(size);
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(payloadBytes, 8);
  return out;
}

function concatBytes(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function makeIlstTextAtom(type, text) {
  const textBytes = new TextEncoder().encode(text);
  const dataPayload = new Uint8Array(8 + textBytes.length);
  dataPayload[3] = 1; // UTF-8 dataType
  dataPayload.set(textBytes, 8);
  return makeMp4Atom(type, makeMp4Atom('data', dataPayload));
}

test('parseMP4Metadata extracts title, artist, and album from synthetic M4A/M4B moov/udta/meta/ilst tree', () => {
  const ilst = makeMp4Atom(
    'ilst',
    concatBytes([
      makeIlstTextAtom('\xa9nam', 'Thermodynamics Intro'),
      makeIlstTextAtom('\xa9ART', 'Prof. Maxwell'),
      makeIlstTextAtom('\xa9alb', 'Physics Vol 2'),
    ])
  );
  // meta FullBox has 4 bytes version/flags before children
  const meta = makeMp4Atom('meta', concatBytes([new Uint8Array(4), ilst]));
  const udta = makeMp4Atom('udta', meta);
  const moov = makeMp4Atom('moov', udta);

  const parsed = parseMP4Metadata(moov);
  assert.equal(parsed.title, 'Thermodynamics Intro');
  assert.equal(parsed.artist, 'Prof. Maxwell');
  assert.equal(parsed.album, 'Physics Vol 2');
});

// --- bookmarks.js tests ---

test('bookmarks creation, sorting, filtering, Markdown export, and JSON round-trip', () => {
  const book = { id: 'b1', title: 'Linear Algebra', author: 'Prof. Strang' };
  const tracks = [
    { id: 't1', order: 0, title: 'Ch 1 Vectors' },
    { id: 't2', order: 1, title: 'Ch 2 Matrices' },
  ];

  const bm1 = createBookmarkData({
    book,
    track: tracks[1],
    time: 42,
    bookTime: 642,
    speed: 1.37,
    title: '',
    note: 'Orthogonal basis definition',
    category: 'definition',
  });
  bm1.createdAt = 1000;

  const bm2 = createBookmarkData({
    book,
    track: tracks[0],
    time: 125,
    bookTime: 125,
    speed: 1.25,
    title: 'Dot product identity',
    note: 'Important for midterm',
    category: 'exam',
  });
  bm2.createdAt = 2000;

  assert.equal(bm1.title, 'Ch 2 Matrices · 0:42');
  assert.ok(BOOKMARK_CATEGORIES[bm1.category]);

  const byPos = sortBookmarks([bm1, bm2], 'position');
  assert.equal(byPos[0].id, bm2.id);
  assert.equal(byPos[1].id, bm1.id);

  const byNewest = sortBookmarks([bm1, bm2], 'newest');
  assert.equal(byNewest[0].id, bm2.id);

  assert.equal(filterBookmarks([bm1, bm2], { category: 'exam' }).length, 1);
  assert.equal(filterBookmarks([bm1, bm2], { query: 'orthogonal' }).length, 1);

  const md = exportBookmarksToMarkdown(book, [bm1, bm2]);
  assert.match(md, /# Linear Algebra — Study Bookmarks/);
  assert.match(md, /## Ch 1 Vectors/);
  assert.match(md, /\[2:05\]/);
  assert.match(md, /1\.37×/);

  const json = exportBookmarksToJSON(book, [bm1, bm2]);
  const reimported = parseImportedBookmarksJSON(json, 'b1', tracks);
  assert.equal(reimported.length, 2);
  assert.equal(reimported[0].trackId, 't1');
  assert.equal(reimported[1].trackId, 't2');
  assert.equal(reimported[1].note, 'Orthogonal basis definition');
});
