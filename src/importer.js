import {
  cleanTrackTitle,
  DEFAULT_SPEED,
  extractFolderAndSection,
  getExtension,
  isCoverImageFile,
  isIgnoredSystemPath,
  isSupportedAudioFile,
  normalizeAudioMime,
  scoreCoverImage,
  sortTextbookTracks,
} from './formats.js';
import { createCoverDataUrl, extractAudioMetadata, probeAudioDuration } from './metadata.js';
import {
  getBook,
  getTracksForBook,
  putBook,
  putTracksWithBlobs,
  updateBook,
} from './db.js';

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function wrapFileWithPath(file, relativePath) {
  return {
    file,
    relativePath: relativePath || file.webkitRelativePath || file.name,
  };
}

export async function pickDirectoryWithNativeAPI() {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    return null;
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  const collected = [];

  async function walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (isIgnoredSystemPath(relPath)) continue;
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        collected.push(wrapFileWithPath(file, relPath));
      } else if (entry.kind === 'directory') {
        await walk(entry, relPath);
      }
    }
  }

  await walk(dirHandle, dirHandle.name);
  return {
    folderName: dirHandle.name,
    entries: collected,
  };
}

function readAllDirectoryEntries(dirReader) {
  return new Promise((resolve, reject) => {
    const allEntries = [];
    function readNext() {
      dirReader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0) {
            resolve(allEntries);
          } else {
            allEntries.push(...batch);
            readNext();
          }
        },
        (err) => reject(err)
      );
    }
    readNext();
  });
}

function getFileFromEntry(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

async function traverseEntry(entry, prefix, results) {
  if (!entry) return;
  const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (isIgnoredSystemPath(relPath)) return;

  if (entry.isFile) {
    const file = await getFileFromEntry(entry);
    results.push(wrapFileWithPath(file, relPath));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await readAllDirectoryEntries(reader);
    for (const child of children) {
      await traverseEntry(child, relPath, results);
    }
  }
}

export async function collectFilesFromDataTransfer(dataTransfer) {
  const results = [];
  if (!dataTransfer) return results;

  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    for (const entry of entries) {
      await traverseEntry(entry, '', results);
    }
    return results;
  }

  const files = Array.from(dataTransfer.files || []);
  for (const file of files) {
    if (!isIgnoredSystemPath(file.webkitRelativePath || file.name)) {
      results.push(wrapFileWithPath(file, file.webkitRelativePath || file.name));
    }
  }
  return results;
}

export function normalizeInputFileList(fileList) {
  const results = [];
  for (const file of Array.from(fileList || [])) {
    const relPath = file.webkitRelativePath || file.name;
    if (!isIgnoredSystemPath(relPath)) {
      results.push(wrapFileWithPath(file, relPath));
    }
  }
  return results;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

export async function importFiles({
  entries,
  targetBookId = null,
  bookTitleOverride = '',
  defaultSpeed = DEFAULT_SPEED,
  onProgress = () => {},
}) {
  const rawEntries = (entries || []).map((item) =>
    item && item.file ? item : wrapFileWithPath(item, item?.webkitRelativePath || item?.name)
  );

  const audioItems = [];
  const imageItems = [];
  const skippedFiles = [];

  for (const item of rawEntries) {
    const { file, relativePath } = item;
    if (!file || isIgnoredSystemPath(relativePath)) continue;

    if (isSupportedAudioFile(relativePath, file.type)) {
      audioItems.push(item);
    } else if (isCoverImageFile(relativePath)) {
      imageItems.push(item);
    } else {
      skippedFiles.push(file.name);
    }
  }

  if (audioItems.length === 0) {
    return {
      book: null,
      importedCount: 0,
      skippedFiles,
    };
  }

  const sortedAudio = sortTextbookTracks(
    audioItems.map((item) => ({
      ...item,
      fileName: item.file.name,
    }))
  );

  // Pick best folder cover image if available
  let folderCoverBlob = null;
  if (imageItems.length > 0) {
    imageItems.sort((a, b) => scoreCoverImage(b.relativePath) - scoreCoverImage(a.relativePath));
    folderCoverBlob = imageItems[0].file;
  }

  const existingBook = targetBookId ? await getBook(targetBookId) : null;
  const existingTracks = existingBook ? await getTracksForBook(existingBook.id) : [];
  const bookId = existingBook ? existingBook.id : createId();
  const baseOrder = existingTracks.length;

  let detectedBookTitle = '';
  let detectedAuthor = '';
  let embeddedCoverBlob = null;

  onProgress({
    stage: 'reading',
    current: 0,
    total: sortedAudio.length,
    fileName: sortedAudio[0].file.name,
  });

  let completedCount = 0;
  const processed = await runWithConcurrency(sortedAudio, 4, async (item, index) => {
    const { file, relativePath } = item;
    const mimeType = normalizeAudioMime(file.name, file.type);

    const [meta, duration] = await Promise.all([
      extractAudioMetadata(file),
      probeAudioDuration(file, mimeType),
    ]);

    completedCount++;
    onProgress({
      stage: 'analyzing',
      current: completedCount,
      total: sortedAudio.length,
      fileName: file.name,
    });

    if (index === 0) {
      if (meta.album) detectedBookTitle = meta.album;
      if (meta.artist) detectedAuthor = meta.artist;
    } else if (!detectedAuthor && meta.artist) {
      detectedAuthor = meta.artist;
    }
    if (!embeddedCoverBlob && meta.coverBlob) {
      embeddedCoverBlob = meta.coverBlob;
    }

    const { bookTitle, section } = extractFolderAndSection(relativePath, 'Textbook Audiobook');
    if (index === 0 && !detectedBookTitle) {
      detectedBookTitle = bookTitle;
    }

    const trackId = createId();
    const ext = getExtension(file.name).replace('.', '').toUpperCase() || 'AUDIO';
    const cleanName = cleanTrackTitle(file.name);

    return {
      track: {
        id: trackId,
        bookId,
        order: baseOrder + index,
        title: meta.title || cleanName,
        fileName: file.name,
        relativePath,
        section,
        format: ext,
        mimeType,
        size: file.size,
        duration,
        chapters: meta.chapters || null,
      },
      blobEntry: {
        trackId,
        bookId,
        blob: file.type === mimeType ? file : new Blob([file], { type: mimeType }),
      },
      folderBookTitle: bookTitle,
    };
  });

  onProgress({
    stage: 'saving',
    current: sortedAudio.length,
    total: sortedAudio.length,
    fileName: 'Saving offline library…',
  });

  const newTracks = processed.map((p) => p.track);
  const newBlobs = processed.map((p) => p.blobEntry);
  await putTracksWithBlobs(newTracks, newBlobs);

  let coverDataUrl = existingBook?.coverDataUrl || '';
  if (!coverDataUrl) {
    const chosenCover = folderCoverBlob || embeddedCoverBlob;
    if (chosenCover) {
      coverDataUrl = await createCoverDataUrl(chosenCover);
    }
  }

  const addedDuration = newTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  let savedBook;
  if (existingBook) {
    const allTracks = [...existingTracks, ...newTracks];
    const totalDuration = allTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    savedBook = await updateBook(existingBook.id, {
      trackCount: allTracks.length,
      totalDuration,
      coverDataUrl: coverDataUrl || existingBook.coverDataUrl,
    });
  } else {
    const firstFolderTitle = processed[0]?.folderBookTitle;
    const finalTitle =
      bookTitleOverride.trim() ||
      (firstFolderTitle && firstFolderTitle !== 'Textbook Audiobook' ? firstFolderTitle : '') ||
      detectedBookTitle ||
      cleanTrackTitle(sortedAudio[0].file.name);

    const now = Date.now();
    savedBook = {
      id: bookId,
      title: finalTitle,
      author: detectedAuthor || 'Unknown Author',
      coverDataUrl,
      trackCount: newTracks.length,
      totalDuration: addedDuration,
      currentTrackIndex: 0,
      currentTime: 0,
      playbackRate: defaultSpeed,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: now,
    };
    await putBook(savedBook);
  }

  return {
    book: savedBook,
    importedCount: newTracks.length,
    skippedFiles,
  };
}
