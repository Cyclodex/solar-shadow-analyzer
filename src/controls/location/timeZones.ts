import { isValidTimeZone } from '../../model/time';

// ─────────────────────────────────────────────
// TIME ZONE SUGGESTIONS (datalist of the time zone field)
// ─────────────────────────────────────────────

/** Frequently used IANA time zones, offered first (DACH region, then Europe, then the rest of the world). */
export const COMMON_TIME_ZONES: readonly string[] = [
  'Europe/Zurich',
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Vaduz',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Copenhagen',
  'Europe/Oslo',
  'Europe/Stockholm',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Athens',
  'Europe/Istanbul',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

let supported: readonly string[] | null = null;

/** All time zones the runtime knows (empty when Intl.supportedValuesOf is unavailable). Cached. */
export function supportedTimeZones(): readonly string[] {
  if (supported === null) {
    try {
      supported = Intl.supportedValuesOf('timeZone');
    } catch {
      supported = [];
    }
  }
  return supported;
}

/** Time zone of this device (null if unknown or rejected by Intl). */
export function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** Suggestions in display order without duplicates: current, device, common zones, then all others. */
export function timeZoneSuggestions(current: string, device: string | null): string[] {
  const out = new Set<string>();
  for (const tz of [current, device, ...COMMON_TIME_ZONES, ...supportedTimeZones()]) {
    if (tz) out.add(tz);
  }
  return [...out];
}
