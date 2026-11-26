# Lectio — Textbook & Audiobook Player

**Lectio** is a zero-dependency, offline-first Progressive Web App (PWA) designed for listening to multi-file textbooks and audiobooks directly in the browser.

**Live App (GitHub Pages):** https://zeusxx7.github.io/book-player/

---

## Features

- **Multi-File Textbook Folder Upload**
  - Upload an entire textbook folder via directory picker, file picker, or drag-and-drop (including nested unit/part subfolders).
  - Automatically filters system metadata (`.DS_Store`, `._*`, `__MACOSX`), sorts folders and chapters in natural numeric order (`Ch 2` before `Ch 10`), and extracts folder/embedded cover artwork.
  - Append additional chapters or folders to an existing textbook, with duplicate detection (`Skip`, `Add Missing Files`, or `Import as New Copy`).
- **Broad Audio Format Support**
  - Supports `.mp3`, `.m4a`, `.m4b`, `.aac`, `.ogg`, `.oga`, `.opus`, `.wav`, `.flac`, `.webm`, `.weba`, `.aif`, and `.aiff`.
  - Parses ID3v2 (`TIT2`, `TPE1`, `TALB`, `TRCK`, `APIC`) and MP4/M4A/M4B (`©nam`, `©ART`, `©alb`, `trkn`, `covr`, and `chpl` embedded chapters) directly in JavaScript.
  - Embedded `.m4b` chapter navigation, scrub-bar chapter ticks, and `"End of Chapter"` sleep timer support.
- **Ultra-Granular Fractional Playback Speed**
  - Adjust playback speed from `0.25×` to `4.00×` in `0.01×` steps (`±0.01`, `±0.05`, `±0.10`), via smooth slider, or by typing any exact decimal up to `0.001×` precision (e.g., `1.375×`).
  - Optional pitch preservation (`Keep Natural Pitch`), custom pinned speeds, speed-adjusted remaining time estimates, and per-book speed memory.
- **Study Bookmarks & Notes**
  - 1-click quick bookmarks (`B`) or detailed bookmarks with study notes (`Shift+B`) and timestamp nudging (`−5s` / `+5s`).
  - Five color-coded categories (`Important`, `Definition`, `Review`, `Quote`, `Exam`), scrub-bar markers, search/category filtering, and `.md` / `.json` export & import.
- **Offline-First PWA**
  - Stores textbooks, audio blobs, bookmarks, and preferences locally in IndexedDB with persistent storage support (`navigator.storage.persist()`).
  - Installable as a standalone desktop or mobile app with Media Session lock-screen/hardware controls, sleep timer, dark/light themes, and keyboard shortcuts.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / Pause |
| `←` / `→` | Skip `−15s` / `+30s` |
| `Shift + ←` / `Shift + →` | Previous / Next Chapter |
| `[` / `]` | Speed `−0.01×` / `+0.01×` |
| `Shift + [` / `Shift + ]` | Speed `−0.10×` / `+0.10×` |
| `0` | Reset Speed to `1.00×` |
| `B` | Quick Bookmark |
| `Shift + B` | Bookmark with Note |
| `M` | Mute / Unmute |
| `?` | Toggle Shortcuts Help |

---

## Running Locally

Requires Node.js (v20+ recommended; zero npm dependencies required).

```bash
# Start the local static server
npm start
# Opens at http://127.0.0.1:8080

# Run unit & integration tests
npm test
```

---

## Project Structure

- `index.html` & `styles/app.css` — App shell, native `<dialog>` modals, and dark/light editorial themes
- `manifest.webmanifest` & `sw.js` — PWA manifest and network-first app-shell service worker
- `src/app.js` — App initialization and orchestration
- `src/views/library.js` & `src/views/player.js` — Library shelf, player controls, speed console, and chapter/bookmark panels
- `src/player.js` — `HTMLAudioElement` engine, fractional speed, embedded chapters, sleep timer, and Media Session API
- `src/importer.js` & `src/metadata.js` — Recursive folder import, duplicate detection, and ID3v2/MP4 parsers
- `src/db.js` — IndexedDB persistence layer
- `src/bookmarks.js` & `src/formats.js` — Bookmark sorting/filtering/export and audio/speed/time helpers
- `tests/core.test.mjs` & `tests/integration.test.mjs` — Automated test suite
