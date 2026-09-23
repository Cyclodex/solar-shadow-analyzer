import { downloadBlob } from './download';

// ─────────────────────────────────────────────
// PNG EXPORT OF A VIEW
// Minimal version: exports the first <canvas> inside `element` if there is one (heatmap, 3D), else the
// largest <svg>. SVG colours come from CSS variables, which a standalone SVG image cannot resolve, so
// the computed presentation styles are inlined into a clone before rasterising.
// WebGL canvases must be created with preserveDrawingBuffer: true (or be exported right after a
// render), otherwise the exported image is blank.
// ─────────────────────────────────────────────

export interface PngOptions {
  /** Pixel ratio of the output (default: max(2, devicePixelRatio)). */
  scale?: number;
  /** Background colour; default: the theme's --surface. */
  background?: string;
}

/** Presentation properties copied from the computed style into the exported SVG clone. */
const SVG_STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'paint-order',
  'visibility',
  'display',
] as const;

function themeBackground(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  return v || '#ffffff';
}

function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  const decl = SVG_STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p)] as const)
    .filter(([, v]) => v !== '' && !v.includes('var('))
    .map(([p, v]) => `${p}:${v}`)
    .join(';');
  if (decl) dst.setAttribute('style', decl);
  const s = src.children;
  const d = dst.children;
  for (let i = 0; i < s.length && i < d.length; i++) inlineComputedStyles(s[i], d[i]);
}

function largestSvg(element: HTMLElement): SVGSVGElement | null {
  const all = Array.from(element.querySelectorAll('svg')).filter((s) => !s.parentElement?.closest('svg'));
  if (all.length === 0) return null;
  const area = (s: SVGSVGElement): number => {
    const r = s.getBoundingClientRect();
    return r.width * r.height;
  };
  return all.reduce((best, s) => (area(s) > area(best) ? s : best), all[0]);
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

function newCanvas(
  width: number,
  height: number,
  background: string,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return [canvas, ctx];
}

/** Renders the view inside `element` to a PNG blob (see module comment for what is exported). */
export async function renderViewPng(element: HTMLElement, opts: PngOptions = {}): Promise<Blob> {
  const scale = opts.scale ?? Math.max(2, globalThis.devicePixelRatio || 1);
  const background = opts.background ?? themeBackground();

  const source = element.querySelector('canvas');
  if (source) {
    const [canvas, ctx] = newCanvas(source.width, source.height, background);
    ctx.drawImage(source, 0, 0);
    return canvasToBlob(canvas);
  }

  const svg = largestSvg(element);
  if (!svg) throw new Error('Nothing to export: the view contains neither <canvas> nor <svg>');
  const rect = svg.getBoundingClientRect();
  const width = rect.width || svg.viewBox.baseVal?.width || 800;
  const height = rect.height || svg.viewBox.baseVal?.height || 600;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const [canvas, ctx] = newCanvas(width * scale, height * scale, background);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
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
