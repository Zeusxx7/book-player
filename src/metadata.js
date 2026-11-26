import { getExtension, normalizeAudioMime } from './formats.js';

const utf8Decoder = new TextDecoder('utf-8');
const latin1Decoder = new TextDecoder('iso-8859-1');

function decodeTextBytes(bytes, encodingByte) {
  if (!bytes || bytes.length === 0) return '';
  if (encodingByte === 0) {
    return latin1Decoder.decode(bytes).replace(/\0+$/g, '').trim();
  }
  if (encodingByte === 3) {
    return utf8Decoder.decode(bytes).replace(/\0+$/g, '').trim();
  }
  if (encodingByte === 1 || encodingByte === 2) {
    let isLittleEndian = false;
    let offset = 0;
    if (encodingByte === 1 && bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        isLittleEndian = true;
        offset = 2;
      } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        isLittleEndian = false;
        offset = 2;
      }
    }
    try {
      const decoder = new TextDecoder(isLittleEndian ? 'utf-16le' : 'utf-16be');
      return decoder.decode(bytes.subarray(offset)).replace(/\0+$/g, '').trim();
    } catch {
      return latin1Decoder.decode(bytes).replace(/\0+$/g, '').trim();
    }
  }
  return utf8Decoder.decode(bytes).replace(/\0+$/g, '').trim();
}

function readSyncsafe32(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readAscii(bytes, offset, len) {
  let out = '';
  const end = Math.min(bytes.length, offset + len);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function parseTrackNumber(raw) {
  if (!raw) return null;
  const match = String(raw).match(/^\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function parseID3v2(buffer) {
  const result = {};
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 10) return result;
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
      return result;
    }

    const majorVersion = bytes[3];
    const flags = bytes[5];
    const tagSize = readSyncsafe32(bytes, 6);
    const tagEnd = Math.min(bytes.length, 10 + tagSize);

    let offset = 10;
    // Skip extended header if present (bit 6)
    if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
      const extSize = majorVersion === 4 ? readSyncsafe32(bytes, offset) : readUint32BE(bytes, offset);
      offset += majorVersion === 4 ? extSize : extSize + 4;
    }

    if (majorVersion === 2) {
      while (offset + 6 <= tagEnd) {
        const frameId = readAscii(bytes, offset, 3);
        if (!/^[A-Z0-9]{3}$/.test(frameId)) break;
        const frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
        offset += 6;
        if (frameSize <= 0 || offset + frameSize > tagEnd) break;
        const frameData = bytes.subarray(offset, offset + frameSize);
        if (frameId === 'TT2') result.title = decodeTextBytes(frameData.subarray(1), frameData[0]);
        else if (frameId === 'TP1') result.artist = decodeTextBytes(frameData.subarray(1), frameData[0]);
        else if (frameId === 'TAL') result.album = decodeTextBytes(frameData.subarray(1), frameData[0]);
        else if (frameId === 'TRK') result.trackNumber = parseTrackNumber(decodeTextBytes(frameData.subarray(1), frameData[0]));
        offset += frameSize;
      }
      return result;
    }

    while (offset + 10 <= tagEnd) {
      const frameId = readAscii(bytes, offset, 4);
      if (frameId === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize = majorVersion === 4
        ? readSyncsafe32(bytes, offset + 4)
        : readUint32BE(bytes, offset + 4);
      offset += 10;

      if (frameSize <= 0 || offset + frameSize > tagEnd) break;
      const frameData = bytes.subarray(offset, offset + frameSize);

      if (frameId === 'TIT2') {
        result.title = decodeTextBytes(frameData.subarray(1), frameData[0]);
      } else if (frameId === 'TPE1') {
        result.artist = decodeTextBytes(frameData.subarray(1), frameData[0]);
      } else if (frameId === 'TALB') {
        result.album = decodeTextBytes(frameData.subarray(1), frameData[0]);
      } else if (frameId === 'TRCK') {
        result.trackNumber = parseTrackNumber(decodeTextBytes(frameData.subarray(1), frameData[0]));
      } else if (frameId === 'APIC' && !result.coverImage && frameData.length > 4) {
        const encoding = frameData[0];
        let pos = 1;
        while (pos < frameData.length && frameData[pos] !== 0) pos++;
        const mime = readAscii(frameData, 1, pos - 1) || 'image/jpeg';
        pos += 2; // skip null + picture type
        if (encoding === 1 || encoding === 2) {
          while (pos + 1 < frameData.length && !(frameData[pos] === 0 && frameData[pos + 1] === 0)) {
            pos += 2;
          }
          pos += 2;
        } else {
          while (pos < frameData.length && frameData[pos] !== 0) pos++;
          pos += 1;
        }
        if (pos < frameData.length) {
          result.coverImage = {
            mime,
            data: frameData.slice(pos),
          };
        }
      }

      offset += frameSize;
    }
  } catch {
    return result;
  }
  return result;
}

const CONTAINER_ATOMS = new Set(['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia', 'minf', 'stbl']);

function parseMP4Boxes(bytes, start, end, state) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = readUint32BE(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      const hi = readUint32BE(bytes, offset + 8);
      const lo = readUint32BE(bytes, offset + 12);
      size = hi * 4294967296 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;

    const payloadStart = offset + headerSize;
    const payloadEnd = offset + size;

    if (type === 'meta') {
      // 'meta' is a FullBox (4 bytes version+flags) before child boxes
      if (payloadStart + 4 <= payloadEnd) {
        parseMP4Boxes(bytes, payloadStart + 4, payloadEnd, state);
      }
    } else if (CONTAINER_ATOMS.has(type)) {
      parseMP4Boxes(bytes, payloadStart, payloadEnd, state);
    } else if (type === '\xa9nam' || type === '\xa9ART' || type === '\xa9alb' || type === 'trkn' || type === 'covr') {
      parseIlstItem(bytes, payloadStart, payloadEnd, type, state);
    } else if (type === 'chpl') {
      parseChplAtom(bytes, payloadStart, payloadEnd, state);
    }

    offset += size;
  }
}

function parseIlstItem(bytes, start, end, parentType, state) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = readUint32BE(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    if (size < 8 || offset + size > end) break;

    if (type === 'data' && size > 16) {
      const dataType = readUint32BE(bytes, offset + 8) & 0x00ffffff;
      const valueBytes = bytes.subarray(offset + 16, offset + size);

      if (parentType === '\xa9nam' && dataType === 1) {
        state.title = utf8Decoder.decode(valueBytes).trim();
      } else if (parentType === '\xa9ART' && dataType === 1) {
        state.artist = utf8Decoder.decode(valueBytes).trim();
      } else if (parentType === '\xa9alb' && dataType === 1) {
        state.album = utf8Decoder.decode(valueBytes).trim();
      } else if (parentType === 'trkn' && valueBytes.length >= 4) {
        state.trackNumber = (valueBytes[2] << 8) | valueBytes[3];
      } else if (parentType === 'covr' && !state.coverImage) {
        const mime = dataType === 14 ? 'image/png' : 'image/jpeg';
        state.coverImage = {
          mime,
          data: valueBytes.slice(),
        };
      }
    }

    offset += size;
  }
}

function parseChplAtom(bytes, start, end, state) {
  // FullBox (4 bytes) + reserved (1 byte) + count (4 bytes in v1 or 1 byte in v0)
  if (start + 9 > end) return;
  const version = bytes[start];
  let pos = start + 5;
  let count = 0;
  if (version === 1 && pos + 4 <= end) {
    count = readUint32BE(bytes, pos);
    pos += 4;
  } else if (pos < end) {
    count = bytes[pos];
    pos += 1;
  }

  const chapters = [];
  for (let i = 0; i < count && pos + 9 <= end; i++) {
    const hi = readUint32BE(bytes, pos);
    const lo = readUint32BE(bytes, pos + 4);
    const start100ns = hi * 4294967296 + lo;
    const titleLen = bytes[pos + 8];
    pos += 9;
    if (pos + titleLen > end) break;
    const title = utf8Decoder.decode(bytes.subarray(pos, pos + titleLen)).trim();
    pos += titleLen;
    chapters.push({
      startTime: start100ns / 10_000_000,
      title: title || `Chapter ${i + 1}`,
    });
  }
  if (chapters.length > 0) {
    state.chapters = chapters;
  }
}

export function parseMP4Metadata(buffer) {
  const result = {};
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 12) return result;
    parseMP4Boxes(bytes, 0, bytes.length, result);
  } catch {
    return result;
  }
  return result;
}

async function readMP4MoovSlice(file) {
  const fileSize = file.size;
  if (fileSize <= 8 * 1024 * 1024) {
    return new Uint8Array(await file.arrayBuffer());
  }

  // Walk top-level MP4 boxes by reading just 16-byte headers via file.slice()
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const headerBuf = await file.slice(offset, offset + 16).arrayBuffer();
    const hBytes = new Uint8Array(headerBuf);
    let size = readUint32BE(hBytes, 0);
    const type = readAscii(hBytes, 4, 4);
    if (size === 1 && hBytes.length >= 16) {
      const hi = readUint32BE(hBytes, 8);
      const lo = readUint32BE(hBytes, 12);
      size = hi * 4294967296 + lo;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < 8) break;

    if (type === 'moov') {
      const boundedEnd = Math.min(fileSize, offset + Math.min(size, 12 * 1024 * 1024));
      return new Uint8Array(await file.slice(offset, boundedEnd).arrayBuffer());
    }
    offset += size;
  }

  // Fallback: inspect last 512 KB in case moov sits at tail
  const tailStart = Math.max(0, fileSize - 512 * 1024);
  return new Uint8Array(await file.slice(tailStart, fileSize).arrayBuffer());
}

export async function extractAudioMetadata(file) {
  const result = {};
  try {
    if (!file || typeof file.slice !== 'function') return result;

    const headBuf = await file.slice(0, 64).arrayBuffer();
    const headBytes = new Uint8Array(headBuf);
    const ext = getExtension(file.name);

    const isID3 = headBytes.length >= 3 && headBytes[0] === 0x49 && headBytes[1] === 0x44 && headBytes[2] === 0x33;
    const isFtyp = headBytes.length >= 8 && readAscii(headBytes, 4, 4) === 'ftyp';

    let parsed = {};
    if (isID3 || ext === '.mp3') {
      // Read up to 2 MB from start for ID3v2 header + APIC cover art
      const sliceLen = Math.min(file.size, 2 * 1024 * 1024);
      const id3Buf = await file.slice(0, sliceLen).arrayBuffer();
      parsed = parseID3v2(id3Buf);
    } else if (isFtyp || ext === '.m4a' || ext === '.m4b' || ext === '.mp4' || ext === '.aac') {
      const mp4Bytes = await readMP4MoovSlice(file);
      parsed = parseMP4Metadata(mp4Bytes);
    }

    if (parsed.title) result.title = parsed.title;
    if (parsed.artist) result.artist = parsed.artist;
    if (parsed.album) result.album = parsed.album;
    if (parsed.trackNumber != null) result.trackNumber = parsed.trackNumber;
    if (parsed.chapters) result.chapters = parsed.chapters;
    if (parsed.coverImage && typeof Blob !== 'undefined') {
      result.coverBlob = new Blob([parsed.coverImage.data], { type: parsed.coverImage.mime });
    }
  } catch {
    return result;
  }
  return result;
}

export function probeAudioDuration(blob, mimeType = '', timeoutMs = 5000) {
  if (typeof Audio === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(0);
  }

  return new Promise((resolve) => {
    const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType || normalizeAudioMime('') });
    const objectUrl = URL.createObjectURL(typedBlob);
    const audio = new Audio();
    audio.preload = 'metadata';

    let settled = false;
    const cleanup = (duration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };

    const onLoaded = () => cleanup(audio.duration);
    const onError = () => cleanup(0);

    const timer = setTimeout(() => cleanup(0), timeoutMs);
    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.src = objectUrl;
  });
}

export async function createCoverAsset(imageBlob, maxSize = 480) {
  if (!imageBlob || typeof document === 'undefined') return null;
  const objectUrl = URL.createObjectURL(imageBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });

    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || maxSize) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || maxSize) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const mime = 'image/jpeg';
    return {
      dataUrl: canvas.toDataURL(mime, 0.84),
      width,
      height,
      mime,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createCoverDataUrl(imageBlob, maxSize = 480) {
  const asset = await createCoverAsset(imageBlob, maxSize);
  return asset?.dataUrl || '';
}
