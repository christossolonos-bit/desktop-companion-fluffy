export function formatMediaContextForPrompt(mediaContext) {
  if (!mediaContext?.ok) {
    return 'Media facts: unavailable. Do not guess what they are listening to or watching.';
  }

  const title = mediaContext.title?.trim();
  if (!title) {
    return 'Media facts: nothing playing detected. Do not guess what they are listening to or watching.';
  }

  const artist = mediaContext.artist?.trim();
  const album = mediaContext.album?.trim();
  const app = mediaContext.app?.trim();
  const status = mediaContext.playing ? 'Playing' : (mediaContext.status || 'Paused');

  const parts = [`${status}: "${title}"`];
  if (artist) parts.push(`by ${artist}`);
  if (album && album !== title) parts.push(`from ${album}`);
  if (app) parts.push(`(${app})`);

  return `Media facts (this is all you know about what they hear — do not invent songs or videos):\n${parts.join(' ')}`;
}
