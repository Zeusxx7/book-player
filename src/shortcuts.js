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

    // Let Space activate focused buttons, links, and summaries normally
    if (e.code === 'Space' && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) {
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
