import { downloadBlob } from './download';

// ─────────────────────────────────────────────
// PNG EXPORT OF A VIEW
// The view inside `element` is composed from its graphic layers: every <canvas> (2D heatmap, WebGL
// scene) and every top-level <svg>, drawn in document order at their on-screen positions, on the
// theme background. Icons inside buttons/links and anything under [data-export="ignore"] (hover
// crosshairs, tooltips) are skipped. HTML text around the graphics is not part of the image, except
// the title: by default the heading that labels the enclosing <section aria-labelledby> (ViewCard)
// is drawn above the graphics, in the heading's own font and colour.
//
// SVG colours come from CSS variables and stylesheets, which a standalone SVG image cannot resolve,
// so the computed presentation styles are inlined into a clone before rasterising — the PNG matches
// the current theme. SVGs are rasterised at `scale` × their CSS size (default 2×).
// WebGL canvases must be created with preserveDrawingBuffer: true (or be exported right after a
// render), otherwise the exported image is blank.
// ─────────────────────────────────────────────

export interface PngOptions {
  /** Output pixels per CSS pixel (default: max(2, devicePixelRatio)). */
  scale?: number;
  /** Background colour; default the theme's --surface; null = transparent. */
  background?: string | null;
  /** Margin around the graphics in CSS px (default 12). */
  padding?: number;
  /** Title above the graphics; default: the label of the enclosing section (see above); null = none. */
  title?: string | null;
}

/** Title line height in CSS px. */
const TITLE_HEIGHT = 26;
/** Title font size in CSS px. */
const TITLE_SIZE = 15;

/** Spread onto an element to leave it (and its subtree) out of PNG exports: <g {...EXPORT_IGNORE}>. */
export const EXPORT_IGNORE = { 'data-export': 'ignore' } as const;
const IGNORE_SELECTOR = '[data-export="ignore"]';

/** Graphics inside these controls are icons, not content. */
const CONTROL_SELECTOR =
  'button, a, label, select, [role="button"], [role="menuitem"], [role="radio"], [role="switch"]';

/** SVGs smaller than this (CSS px, either side) are treated as icons and skipped. */
const MIN_LAYER_PX = 32;

/** Presentation properties copied from the computed style into the exported SVG clone. */
const SVG_STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant-numeric',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'letter-spacing',
  'text-decoration',
  'paint-order',
  'shape-rendering',
  'vector-effect',
  'visibility',
  'display',
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Layer =
  { kind: 'canvas'; el: HTMLCanvasElement; box: Box } | { kind: 'svg'; el: SVGSVGElement; box: Box };

/** The theme's --surface colour (white if unset). */
export function themeBackground(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  return v || '#ffffff';
}

function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  const decl = SVG_STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p).trim()] as const)
    .filter(([, v]) => v !== '' && !v.includes('var('))
    .map(([p, v]) => `${p}:${v}`)
    .join(';');
  if (decl) dst.setAttribute('style', decl);
  else dst.removeAttribute('style');
  const s = src.children;
  const d = dst.children;
  for (let i = 0; i < s.length && i < d.length; i++) inlineComputedStyles(s[i], d[i]);
}

/** Intrinsic size of an SVG when it is not laid out: viewBox, else width/height attributes. */
function intrinsicSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const w = Number.parseFloat(svg.getAttribute('width') ?? '');
  const h = Number.parseFloat(svg.getAttribute('height') ?? '');
  return { width: w > 0 ? w : 0, height: h > 0 ? h : 0 };
}

/**
 * Standalone SVG document of `svg` with the computed styles inlined (theme colours resolved) and
 * [data-export="ignore"] elements removed. `width`/`height` are the CSS size (or the intrinsic size
 * when the element is not laid out); the document's width/height attributes are multiplied by `scale`.
 */
export function serializeSvg(svg: SVGSVGElement, scale = 1): { xml: string; width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  const intrinsic = intrinsicSvgSize(svg);
  const width = rect.width || intrinsic.width || 800;
  const height = rect.height || intrinsic.height || 600;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.querySelectorAll(IGNORE_SELECTOR).forEach((n) => n.remove());
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('width', String(Math.round(width * scale)));
  clone.setAttribute('height', String(Math.round(height * scale)));
  // A standalone image has no stylesheet: the clone's own inline style now carries everything.
  clone.removeAttribute('class');
  return { xml: new XMLSerializer().serializeToString(clone), width, height };
}

function collectLayers(element: HTMLElement): Layer[] {
  const origin = element.getBoundingClientRect();
  const layers: Layer[] = [];
  for (const el of element.querySelectorAll<HTMLCanvasElement | SVGSVGElement>('canvas, svg')) {
    if (el.closest(IGNORE_SELECTOR)) continue;
    const control = el.closest(CONTROL_SELECTOR);
    if (control && element.contains(control)) continue;
    const r = el.getBoundingClientRect();
    const laidOut = r.width > 0 && r.height > 0;
    if (el instanceof HTMLCanvasElement) {
      const box = laidOut
        ? { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height }
        : { x: 0, y: 0, width: el.width, height: el.height };
      if (box.width > 0 && box.height > 0) layers.push({ kind: 'canvas', el, box });
    } else {
      if (el.parentElement?.closest('svg')) continue; // nested <svg> is drawn with its parent
      const size = laidOut ? { width: r.width, height: r.height } : intrinsicSvgSize(el);
      if (size.width < MIN_LAYER_PX || size.height < MIN_LAYER_PX) continue;
      const box = laidOut
        ? { x: r.left - origin.left, y: r.top - origin.top, ...size }
        : { x: 0, y: 0, ...size };
      layers.push({ kind: 'svg', el, box });
    }
  }
  return layers;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG could not be rasterised'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    } catch (e) {
      // e.g. SecurityError for a tainted canvas
      reject(e instanceof Error ? e : new Error('PNG encoding failed'));
    }
  });
}

async function drawSvg(
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  box: Box,
  scale: number,
): Promise<void> {
  const { xml } = serializeSvg(svg, scale);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, box.x * scale, box.y * scale, box.width * scale, box.height * scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Heading that labels the section around `element` (ViewCard title), if any. */
function sectionHeading(element: HTMLElement): HTMLElement | null {
  const ids = element.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby')?.split(/\s+/);
  return ids?.[0] ? document.getElementById(ids[0]) : null;
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: Element | null,
  x: number,
  y: number,
  scale: number,
): void {
  const cs = font ? getComputedStyle(font) : null;
  const family = cs?.fontFamily || 'system-ui, sans-serif';
  const weight = cs?.fontWeight || '600';
  ctx.font = `${weight} ${TITLE_SIZE * scale}px ${family}`;
  ctx.fillStyle =
    cs?.color || getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x * scale, y * scale);
}

/** Renders the view inside `element` to a PNG blob (see module comment for what is exported). */
export async function renderViewPng(element: HTMLElement, opts: PngOptions = {}): Promise<Blob> {
  const scale = opts.scale ?? Math.max(2, globalThis.devicePixelRatio || 1);
  const background = opts.background === undefined ? themeBackground() : opts.background;
  const padding = opts.padding ?? 12;
  const heading = opts.title === undefined ? sectionHeading(element) : null;
  const title = (opts.title === undefined ? heading?.textContent : opts.title)?.trim() || null;
  const titleSpace = title ? TITLE_HEIGHT : 0;

  const layers = collectLayers(element);
  if (layers.length === 0) throw new Error('Nothing to export: the view contains neither <canvas> nor <svg>');

  // Bounding box of all layers (relative to `element`) plus padding.
  const x0 = Math.min(...layers.map((l) => l.box.x)) - padding;
  const y0 = Math.min(...layers.map((l) => l.box.y)) - padding;
  const x1 = Math.max(...layers.map((l) => l.box.x + l.box.width)) + padding;
  const y1 = Math.max(...layers.map((l) => l.box.y + l.box.height)) + padding + titleSpace;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((x1 - x0) * scale));
  canvas.height = Math.max(1, Math.round((y1 - y0) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (title) drawTitle(ctx, title, heading, padding, padding + TITLE_SIZE, scale);

  for (const layer of layers) {
    const box = { ...layer.box, x: layer.box.x - x0, y: layer.box.y - y0 + titleSpace };
    if (layer.kind === 'canvas') {
      ctx.drawImage(layer.el, box.x * scale, box.y * scale, box.width * scale, box.height * scale);
    } else {
      await drawSvg(ctx, layer.el, box, scale);
    }
  }
  return canvasToBlob(canvas);
}

/** Exports the view inside `element` as a PNG download named `filename` (".png" appended if missing). */
export async function exportViewPng(
  element: HTMLElement,
  filename: string,
  opts: PngOptions = {},
): Promise<void> {
  const blob = await renderViewPng(element, opts);
  downloadBlob(blob, filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`);
}
