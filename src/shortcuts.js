// Buttons that seek the audio (chapter rows, sub-chapters, bookmark jumps, scrub
// markers). Pressing Space on one should pause rather than jump back again.
const SPACE_TOGGLES_PLAYBACK_WITHIN = '[data-track-idx], [data-subchapter-time], [data-jump-bm], [data-seek-time]';

export function initShortcuts({ player, onQuickBookmark, onNoteBookmark, onToggleShortcuts }) {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    // Never fire global shortcuts while any native <dialog> modal is open
    if (document.querySelector('dialog[open]')) {
      return;
    }

    const target = e.target;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
      return;
    }

    // Let Space activate focused buttons, links, and summaries normally — except
    // seek/jump buttons in lists, where Space should still play/pause (Enter jumps).
    if (
      e.code === 'Space' &&
      (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') &&
      !target.closest(SPACE_TOGGLES_PLAYBACK_WITHIN)
    ) {
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      onToggleShortcuts();
      return;
    }

    if (!player.book) return;

    if (e.code === 'Space') {
      e.preventDefault();
      player.togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) player.prevTrack();
      else player.seekBy(-15);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) player.nextTrack();
      else player.seekBy(30);
    } else if (e.key === '[' || e.key === '{') {
      e.preventDefault();
      player.nudgeSpeed(e.shiftKey ? -0.1 : -0.01);
    } else if (e.key === ']' || e.key === '}') {
      e.preventDefault();
      player.nudgeSpeed(e.shiftKey ? 0.1 : 0.01);
    } else if (e.key === '0') {
      e.preventDefault();
      player.setSpeed(1.0);
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      if (e.shiftKey) onNoteBookmark();
      else onQuickBookmark();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      player.toggleMute();
    }
  });
}
