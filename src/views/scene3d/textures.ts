import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { CELLS_ACROSS_SHORT_SIDE } from '../../model/geometry';
import type { ScenePalette } from './palette';

// ─────────────────────────────────────────────
// PROCEDURAL TEXTURES (2D canvas → CanvasTexture)
// Panel cells, text labels and the sun glow. Browser only (never called in jsdom: the scene is not
// mounted without WebGL). The caller owns the returned textures and disposes them.
// ─────────────────────────────────────────────

/** Width of the aluminium module frame, m. */
export const FRAME_WIDTH = 0.03;
/** Gap between neighbouring cells, m. */
const CELL_GAP = 0.0025;
/** Pixels along the longer module side. */
const PANEL_TEXTURE_PX = 1024;

function context2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, mipmaps = true): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Front face of one module (width × length in m): aluminium frame, dark backsheet, monocrystalline cells
 * with cut corners and busbars. Cell grid as in the model's substring loss: CELLS_ACROSS_SHORT_SIDE
 * cells across the short side, round(long / cell) along the long side.
 */
export function createPanelTexture(width: number, length: number, palette: ScenePalette): CanvasTexture {
  const long = Math.max(width, length);
  const ppm = PANEL_TEXTURE_PX / long;
  const [canvas, ctx] = context2d(width * ppm, length * ppm);
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = palette.css('panel-edge');
  ctx.fillRect(0, 0, W, H);
  const f = FRAME_WIDTH * ppm;
  ctx.fillStyle = palette.css('panel');
  ctx.fillRect(f, f, W - 2 * f, H - 2 * f);

  const landscape = width >= length;
  const innerW = W - 2 * f;
  const innerH = H - 2 * f;
  const shortPx = landscape ? innerH : innerW;
  const longPx = landscape ? innerW : innerH;
  // Same grid as substringBeamLoss: 6 cells across the short side, round(long / cell) along the long side.
  const across = CELLS_ACROSS_SHORT_SIDE;
  const cs = shortPx / across;
  const along = Math.max(1, Math.round(longPx / cs));
  const cols = landscape ? along : across;
  const rows = landscape ? across : along;
  const cw = innerW / cols;
  const ch = innerH / rows;
  const gap = Math.max(1, CELL_GAP * ppm);
  const cut = Math.min(cw, ch) * 0.13;

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x0 = f + i * cw + gap / 2;
      const y0 = f + j * ch + gap / 2;
      const x1 = x0 + cw - gap;
      const y1 = y0 + ch - gap;
      ctx.beginPath();
      ctx.moveTo(x0 + cut, y0);
      ctx.lineTo(x1 - cut, y0);
      ctx.lineTo(x1, y0 + cut);
      ctx.lineTo(x1, y1 - cut);
      ctx.lineTo(x1 - cut, y1);
      ctx.lineTo(x0 + cut, y1);
      ctx.lineTo(x0, y1 - cut);
      ctx.lineTo(x0, y0 + cut);
      ctx.closePath();
      ctx.fillStyle = palette.css('panel-cell');
      ctx.fill();
    }
  }
  // Busbars parallel to the long module side (4 per cell).
  ctx.strokeStyle = palette.css('panel-edge', 0.28);
  ctx.lineWidth = Math.max(1, 0.0012 * ppm);
  ctx.beginPath();
  const bars = 4;
  if (landscape) {
    for (let j = 0; j < rows; j++) {
      for (let b = 1; b <= bars; b++) {
        const y = f + j * ch + (b * ch) / (bars + 1);
        ctx.moveTo(f, y);
        ctx.lineTo(W - f, y);
      }
    }
  } else {
    for (let i = 0; i < cols; i++) {
      for (let b = 1; b <= bars; b++) {
        const x = f + i * cw + (b * cw) / (bars + 1);
        ctx.moveTo(x, f);
        ctx.lineTo(x, H - f);
      }
    }
  }
  ctx.stroke();
  // Faint glass sheen.
  const sheen = ctx.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0, palette.css('sky-bottom', 0.1));
  sheen.addColorStop(0.5, palette.css('sky-bottom', 0));
  sheen.addColorStop(1, palette.css('sky-bottom', 0.05));
  ctx.fillStyle = sheen;
  ctx.fillRect(f, f, innerW, innerH);
  return finish(canvas);
}

export interface LabelOptions {
  palette: ScenePalette;
  /** Colour dot before the text (e.g. the floor colour token). */
  dot?: Parameters<ScenePalette['css']>[0];
  /** Emphasised (accent) label. */
  strong?: boolean;
}

export interface LabelTexture {
  texture: CanvasTexture;
  /** Width / height of the label. */
  aspect: number;
}

const LABEL_PX = 96;

/** Pill-shaped text label (surface background, text colour), crisp at 96 px height. */
export function createLabelTexture(text: string, { palette, dot, strong }: LabelOptions): LabelTexture {
  const h = LABEL_PX;
  const fontPx = Math.round(h * 0.5);
  const font = `${strong ? 700 : 600} ${fontPx}px ${palette.font}`;
  const [, mctx] = context2d(1, 1);
  mctx.font = font;
  const textW = Math.ceil(mctx.measureText(text).width);
  const pad = Math.round(h * 0.36);
  const dotD = dot ? Math.round(h * 0.28) : 0;
  const dotGap = dot ? Math.round(h * 0.16) : 0;
  const w = pad * 2 + dotD + dotGap + textW;
  const [canvas, ctx] = context2d(w, h);
  const r = h / 2 - 2;
  ctx.beginPath();
  ctx.roundRect(1.5, 1.5, w - 3, h - 3, r);
  ctx.fillStyle = palette.css('surface', 0.88);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.css(strong ? 'sun' : 'axis', 0.9);
  ctx.stroke();
  let x = pad;
  if (dot) {
    ctx.beginPath();
    ctx.arc(x + dotD / 2, h / 2, dotD / 2, 0, Math.PI * 2);
    ctx.fillStyle = palette.css(dot);
    ctx.fill();
    x += dotD + dotGap;
  }
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.css('text');
  ctx.fillText(text, x, h / 2 + fontPx * 0.04);
  return { texture: finish(canvas), aspect: w / h };
}

/** Soft radial glow around the sun marker. */
export function createGlowTexture(palette: ScenePalette): CanvasTexture {
  const size = 128;
  const [canvas, ctx] = context2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, palette.css('sun', 0.95));
  g.addColorStop(0.18, palette.css('sun', 0.55));
  g.addColorStop(0.45, palette.css('sun-glow'));
  g.addColorStop(1, palette.css('sun', 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas, false);
}
