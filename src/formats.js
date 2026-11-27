export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.flac',
  '.webm',
  '.weba',
  '.aiff',
  '.aif',
  '.mp4',
];

export const AUDIO_ACCEPT_STRING = [
  ...SUPPORTED_AUDIO_EXTENSIONS,
  'audio/*',
].join(',');

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
];

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4.0;
export const DEFAULT_SPEED = 1.0;

const EXTENSION_MIME_MAP = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
};

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function getExtension(fileName = '') {
  const base = String(fileName).split(/[/\\]/).pop() || '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return base.slice(dotIdx).toLowerCase();
}

export function isIgnoredSystemPath(fileOrPath) {
  const pathStr = typeof fileOrPath === 'string'
    ? fileOrPath
    : (fileOrPath?.webkitRelativePath || fileOrPath?.relativePath || fileOrPath?.name || '');
  if (!pathStr) return true;
  const segments = pathStr.split(/[/\\]+/).filter(Boolean);
  for (const seg of segments) {
    if (seg === '__MACOSX' || seg === '.DS_Store' || seg.startsWith('._') || seg.startsWith('.')) {
      return true;
    }
  }
  return false;
}

export function isSupportedAudioFile(fileOrName, mimeType = '') {
  const name = typeof fileOrName === 'string'
    ? fileOrName
    : (fileOrName?.webkitRelativePath || fileOrName?.relativePath || fileOrName?.name || '');

  if (isIgnoredSystemPath(name)) return false;

  const ext = getExtension(name);
  if (SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
    return true;
  }

  const mime = (typeof fileOrName === 'object' && fileOrName?.type ? fileOrName.type : mimeType) || '';
  return mime.toLowerCase().startsWith('audio/');
}

export function isCoverImageFile(fileName) {
  if (isIgnoredSystemPath(fileName)) return false;
  const ext = getExtension(fileName);
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

export function scoreCoverImage(fileName = '') {
  if (!isCoverImageFile(fileName)) return -1;
  const base = String(fileName).split(/[/\\]/).pop().toLowerCase();
  const stem = base.replace(/\.[^.]+$/, '');
  if (stem === 'cover') return 100;
  if (stem === 'folder') return 90;
  if (stem === 'front') return 80;
  if (stem === 'album') return 70;
  if (stem === 'artwork') return 60;
  if (stem.includes('cover')) return 50;
  if (stem.includes('front')) return 40;
  return 10;
}

export function normalizeAudioMime(fileName, originalMime = '') {
  const ext = getExtension(fileName);
  if (EXTENSION_MIME_MAP[ext]) {
    return EXTENSION_MIME_MAP[ext];
  }
  if (originalMime && originalMime.startsWith('audio/')) {
    return originalMime;
  }
  return 'audio/mpeg';
}

export function naturalCompare(a, b) {
  return NATURAL_COLLATOR.compare(String(a ?? ''), String(b ?? ''));
}

export function sortTextbookTracks(tracks) {
  return [...tracks].sort((a, b) => {
    const pathA = String(a.relativePath || a.fileName || a.title || '');
    const pathB = String(b.relativePath || b.fileName || b.title || '');
    const segsA = pathA.split(/[/\\]+/).filter(Boolean);
    const segsB = pathB.split(/[/\\]+/).filter(Boolean);

    const dirA = segsA.slice(0, -1);
    const dirB = segsB.slice(0, -1);
    const minDirLen = Math.min(dirA.length, dirB.length);

    for (let i = 0; i < minDirLen; i++) {
      const cmp = naturalCompare(dirA[i], dirB[i]);
      if (cmp !== 0) return cmp;
    }

    if (dirA.length !== dirB.length) {
      return dirA.length - dirB.length;
    }

    const fileA = segsA[segsA.length - 1] || pathA;
    const fileB = segsB[segsB.length - 1] || pathB;
    return naturalCompare(fileA, fileB);
  });
}

export function cleanTrackTitle(fileName = '') {
  const base = String(fileName).split(/[/\\]/).pop() || '';
  const withoutExt = base.replace(/\.[^.]+$/, '');
  return withoutExt
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || base;
}

export function extractFolderAndSection(relativePath = '', fallbackBookTitle = 'Untitled Textbook') {
  const segments = String(relativePath).split(/[/\\]+/).filter(Boolean);
  if (segments.length <= 1) {
    return {
      bookTitle: fallbackBookTitle,
      section: '',
    };
  }
  if (segments.length === 2) {
    return {
      bookTitle: segments[0].replace(/_/g, ' ').trim() || fallbackBookTitle,
      section: '',
    };
  }
  return {
    bookTitle: segments[0].replace(/_/g, ' ').trim() || fallbackBookTitle,
    section: segments.slice(1, -1).map((s) => s.replace(/_/g, ' ').trim()).join(' / '),
  };
}

export function clampSpeed(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/×|x/gi, '').trim());
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SPEED;
  }
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, parsed));
  return Math.round(clamped * 1000) / 1000;
}

export function stepSpeed(current, delta) {
  const curThousandths = Math.round(clampSpeed(current) * 1000);
  const deltaThousandths = Math.round(Number(delta) * 1000);
  if (!Number.isFinite(deltaThousandths)) {
    return clampSpeed(current);
  }
  return clampSpeed((curThousandths + deltaThousandths) / 1000);
}

export function formatSpeed(rate) {
  const safe = clampSpeed(rate);
  const thousandths = Math.round(safe * 1000);
  if (thousandths % 10 === 0) {
    return `${safe.toFixed(2)}×`;
  }
  return `${safe.toFixed(3)}×`;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const paddedSecs = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}

export function formatDurationHuman(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0m';
  }
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${secs}s`;
}

export function calcSpeedAdjustedTime(seconds, speed) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return seconds / clampSpeed(speed);
}

/**
 * Compute gentle auto-rewind seconds based on how long playback was paused.
 */
export function computeAutoRewindSeconds(pauseElapsedMs) {
  if (!Number.isFinite(pauseElapsedMs) || pauseElapsedMs < 10_000) {
    return 0;
  }
  if (pauseElapsedMs >= 600_000) {
    return 5;
  }
  if (pauseElapsedMs >= 60_000) {
    return 2;
  }
  return 1;
}
