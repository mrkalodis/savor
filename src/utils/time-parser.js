/**
 * Parse ISO 8601 duration strings (e.g., PT1H30M) into minutes.
 * Also handles plain minute numbers and common text formats.
 */
function parseDuration(input) {
  if (!input) return null;

  // Already a number (minutes)
  if (typeof input === 'number') return input;

  const str = String(input).trim();

  // Plain number
  if (/^\d+$/.test(str)) return parseInt(str, 10);

  // ISO 8601: PT1H30M, PT45M, PT2H, etc.
  const isoMatch = str.match(/^PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (isoMatch) {
    const hours = parseInt(isoMatch[1] || '0', 10);
    const minutes = parseInt(isoMatch[2] || '0', 10);
    const seconds = parseInt(isoMatch[3] || '0', 10);
    return hours * 60 + minutes + (seconds > 0 ? 1 : 0);
  }

  // Text formats: "1 hour 30 minutes", "45 mins", "2 hrs", etc.
  let total = 0;
  const hourMatch = str.match(/(\d+)\s*(?:hours?|hrs?|h)/i);
  const minMatch = str.match(/(\d+)\s*(?:minutes?|mins?|m(?!o))/i);

  if (hourMatch) total += parseInt(hourMatch[1], 10) * 60;
  if (minMatch) total += parseInt(minMatch[1], 10);

  return total > 0 ? total : null;
}

/**
 * Format minutes into a human-readable string.
 * Examples: 90 → "1 hr 30 min", 45 → "45 min", 120 → "2 hrs"
 */
function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '';

  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return hrs === 1 ? '1 hr' : `${hrs} hrs`;
  return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ${mins} min`;
}

/**
 * Format minutes into ISO 8601 duration for export.
 */
function toIsoDuration(minutes) {
  if (!minutes || minutes <= 0) return '';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  let iso = 'PT';
  if (hrs > 0) iso += `${hrs}H`;
  if (mins > 0) iso += `${mins}M`;
  return iso;
}

module.exports = { parseDuration, formatDuration, toIsoDuration };
