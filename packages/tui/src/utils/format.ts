import chalk from 'chalk';

/**
 * Format a timestamp into HH:MM display.
 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Format a duration in ms to human-readable.
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  if (hours < 24) return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Apply basic inline formatting to message text.
 * Supports **bold**, *italic*, `code`, URLs, and @mentions.
 */
export function formatMessageText(text: string): string {
  let result = text;

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, (_, p1: string) => chalk.bold(p1));

  // Italic: *text* (but not inside bold)
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, (_, p1: string) => chalk.italic(p1));

  // Inline code: `text`
  result = result.replace(/`([^`]+?)`/g, (_, p1: string) => chalk.bgGray.white(` ${p1} `));

  // URLs
  result = result.replace(
    /(https?:\/\/[^\s)]+)/g,
    (url: string) => chalk.underline.blue(url),
  );

  // @mentions
  result = result.replace(
    /@(\w+)/g,
    (mention: string) => chalk.yellow.bold(mention),
  );

  return result;
}

/**
 * Truncate text to fit within a given width.
 */
export function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}
