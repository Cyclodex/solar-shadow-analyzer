import type { HorizonPoint } from './types';
import { normalizeDeg } from './units';

// ─────────────────────────────────────────────
// PVGIS HORIZON IMPORT
// PVGIS `printhorizon` (JSON, CSV, basic) lists the horizon every 7.5° with azimuth A in the PVGIS
// convention 0 = south, 90 = west, −90 = east. North-based azimuth = A + 180 (a rotation, not a mirror).
// Verified empirically against the DEM horizon of terrain.ts (scripts/validate-terrain.ts): with this
// rotation r = 0.986 / 0.993 / 0.984 (Plateau 47.1/7.45, Grindelwald 46.62/8.04, Zermatt 46.02/7.75);
// the alternatives 180 − A, A, −A reach at most r = 0.81 there (RMS ≥ 2.5° instead of 0.3–1.2°).
// The API sends no CORS headers, so browsers can only import a downloaded file.
// ─────────────────────────────────────────────

/** PVGIS 5.3 printhorizon endpoint (no CORS — for scripts / manual download). */
export const PVGIS_PRINTHORIZON_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/printhorizon';

/** PVGIS azimuth (0 = S, 90 = W, −90 = E) → azimuth from north, clockwise, in [0, 360). */
export const pvgisToNorthAzimuth = (a: number): number => normalizeDeg(a + 180);

/** printhorizon URL for a site (outputformat json). */
export function pvgisHorizonUrl(latitude: number, longitude: number): string {
  return `${PVGIS_PRINTHORIZON_URL}?lat=${latitude}&lon=${longitude}&outputformat=json`;
}

/** Sorted by azimuth; duplicates (−180° and 180° both map to north) keep the higher elevation. */
function finish(raw: { a: number; h: number }[]): HorizonPoint[] {
  const byAz = new Map<number, number>();
  for (const { a, h } of raw) {
    if (!Number.isFinite(a) || !Number.isFinite(h)) continue;
    // Round away float noise so 180 and −180 collapse onto the same key.
    const az = Math.round(pvgisToNorthAzimuth(a) * 1e6) / 1e6;
    const key = az === 360 ? 0 : az;
    byAz.set(key, Math.max(byAz.get(key) ?? -Infinity, h));
  }
  return [...byAz.entries()].sort((x, y) => x[0] - y[0]).map(([azimuth, elevation]) => ({ azimuth, elevation }));
}

function parseJson(text: string): HorizonPoint[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const outputs = (data as { outputs?: { horizon_profile?: unknown } } | null)?.outputs;
  const list = Array.isArray(data) ? data : outputs?.horizon_profile;
  if (!Array.isArray(list)) return [];
  return finish(
    list.map((row: unknown) => {
      const r = row as { A?: unknown; H_hor?: unknown } | null;
      return { a: Number(r?.A), h: Number(r?.H_hor) };
    }),
  );
}

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/** Table fields. With `;`/tab separators a `,` is a decimal comma (spreadsheet re-save, as parseHorizonCsv). */
function splitFields(line: string): string[] {
  const t = line.trim();
  const parts = /[;\t]/.test(t) ? t.split(/[;\t]+/).map((f) => f.trim().replace(',', '.')) : t.split(/[\s,]+/);
  return parts.filter(Boolean);
}

function parseTable(text: string): HorizonPoint[] {
  const rows: { a: number; h: number }[] = [];
  let colA = 0;
  let colH = 1;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const fields = splitFields(raw);
    if (fields.length < 2) continue;
    // Header "A  H_hor  A_sun(w) …" fixes the columns; legend lines ("A: Azimuth (0 = S …") are skipped below.
    const iA = fields.indexOf('A');
    const iH = fields.indexOf('H_hor');
    if (iA >= 0 && iH >= 0) {
      colA = iA;
      colH = iH;
      continue;
    }
    const a = fields[colA];
    const h = fields[colH];
    if (a === undefined || h === undefined || !NUMBER.test(a) || !NUMBER.test(h)) continue;
    rows.push({ a: Number(a), h: Number(h) });
  }
  return finish(rows);
}

/** PVGIS `basic` output: no header, every line "A H_hor A_sun(w) H_sun(w) A_sun(s) H_sun(s)", A in −180…180. */
function isBasicTable(text: string): boolean {
  let rows = 0;
  let negative = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const f = splitFields(line);
    if (f.length === 0) continue;
    if (f.length !== 6 || !f.every((x) => NUMBER.test(x))) return false;
    const a = Number(f[0]);
    if (a < -180 || a > 180) return false;
    if (a < 0) negative = true; // north-based files have no negative azimuths
    rows++;
  }
  return rows >= 2 && negative;
}

/**
 * True if the text looks like PVGIS printhorizon output: JSON with horizon_profile, a table with H_hor, or the
 * headerless `basic` table (6 numeric columns, azimuths −180…180).
 */
export function isPvgisHorizon(text: string): boolean {
  return /"horizon_profile"|\bH_hor\b/.test(text) || isBasicTable(text.replace(/^\uFEFF/, ''));
}

/**
 * Horizon points (north-based azimuth, sorted, 0°…352.5°) from PVGIS printhorizon output: JSON
 * (outputs.horizon_profile[{A, H_hor}]), CSV (header "A H_hor …", tab separated) or `basic` (no header:
 * first column A, second H_hor). Rows that are not numeric are ignored; unrecognized input → [].
 */
export function parsePvgisHorizon(text: string): HorizonPoint[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const fromJson = parseJson(trimmed);
    if (fromJson) return fromJson;
  }
  return parseTable(trimmed);
}
