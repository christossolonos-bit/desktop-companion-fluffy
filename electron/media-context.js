const { getScreenContext } = require('./screen-context');

function normalizeText(value) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function emptyMedia(overrides = {}) {
  return {
    ok: true,
    playing: false,
    status: 'Stopped',
    title: '',
    artist: '',
    album: '',
    app: '',
    source: 'none',
    ...overrides,
  };
}

function parseMediaFromWindowTitle(title) {
  const normalized = normalizeText(title);
  if (!normalized) return null;

  if (/spotify/i.test(normalized)) {
    const body = normalized.replace(/\s*-\s*Spotify.*$/i, '').trim();
    const parts = body.split(/\s+-\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        ...emptyMedia(),
        playing: true,
        status: 'Playing',
        title: parts[0],
        artist: parts.slice(1).join(' - '),
        app: 'Spotify',
        source: 'window-title',
      };
    }
  }

  const youtubeWithTitle = normalized.match(/(?:^\(\d+\)\s*)?(.+?)\s+-\s+YouTube\b/i);
  if (youtubeWithTitle && !/^youtube$/i.test(youtubeWithTitle[1])) {
    return {
      ...emptyMedia(),
      playing: true,
      status: 'Playing',
      title: youtubeWithTitle[1].trim(),
      app: 'YouTube',
      source: 'window-title',
    };
  }

  if (/(?:^\(\d+\)\s*)?YouTube\s*-\s*/i.test(normalized)) {
    return {
      ...emptyMedia(),
      playing: true,
      status: 'Playing',
      title: 'a YouTube video',
      app: 'YouTube',
      source: 'window-title',
    };
  }

  const vlcMatch = normalized.match(/^(.+?)\s+-\s+VLC media player/i);
  if (vlcMatch) {
    return {
      ...emptyMedia(),
      playing: true,
      status: 'Playing',
      title: vlcMatch[1].trim(),
      app: 'VLC',
      source: 'window-title',
    };
  }

  const soundcloudMatch = normalized.match(/^(.+?)\s+-\s+SoundCloud/i);
  if (soundcloudMatch) {
    return {
      ...emptyMedia(),
      playing: true,
      status: 'Playing',
      title: soundcloudMatch[1].trim(),
      app: 'SoundCloud',
      source: 'window-title',
    };
  }

  return null;
}

function parseMediaFromWindowTitles(activeWindow, otherWindows) {
  const titles = [activeWindow, ...(otherWindows || [])].filter(Boolean);

  for (const title of titles) {
    const parsed = parseMediaFromWindowTitle(title);
    if (parsed) return parsed;
  }

  return emptyMedia();
}

async function getMediaContext() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      playing: false,
      status: 'Stopped',
      title: '',
      artist: '',
      album: '',
      app: '',
      unsupported: true,
    };
  }

  const screen = await getScreenContext();
  if (!screen.ok) {
    return emptyMedia({ ok: false, error: screen.error });
  }

  const activeWindow = screen.activeWindowIsSelf ? '' : screen.activeWindow;
  return parseMediaFromWindowTitles(activeWindow, screen.otherWindows);
}

module.exports = {
  getMediaContext,
};
