export function formatScreenContextForPrompt(screenContext) {
  if (!screenContext?.ok) {
    return 'Screen facts: unavailable. Do not guess what is on screen.';
  }

  const lines = [];

  if (screenContext.activeWindow) {
    if (screenContext.activeWindowIsSelf) {
      lines.push('Active window: your own companion app (Live2D viewer).');
    } else {
      lines.push(`Active window: "${screenContext.activeWindow}"`);
    }
  }

  if (screenContext.otherWindows?.length) {
    lines.push(`Other open windows: ${screenContext.otherWindows.map((title) => `"${title}"`).join(', ')}`);
  }

  if (lines.length === 0) {
    return 'Screen facts: nothing useful detected right now. Do not guess what is on screen.';
  }

  return `Screen facts (this is all you know about their screen — do not invent anything else):\n${lines.join('\n')}`;
}
