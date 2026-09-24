import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_RENDER_EVENT, type CanvasRenderDetail } from './canvasRender';
import { EXPORT_IGNORE, exportViewPng, renderViewPng, serializeSvg } from './png';

// jsdom has no canvas implementation and never loads images: both are mocked here.

interface FakeContext {
  fillStyle: string;
  font: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() {
    queueMicrotask(() => this.onload?.());
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(parent: HTMLElement, viewBox = '0 0 200 100'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', 'chart');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', 'bar');
  rect.setAttribute('width', '50');
  rect.setAttribute('height', '20');
  svg.append(rect);
  parent.append(svg);
  return svg;
}

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe('PNG export', () => {
  const originalToBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob');
  let ctx: FakeContext;
  let canvases: HTMLCanvasElement[];
  let urlBlobs: Blob[];
  let style: HTMLStyleElement;

  beforeEach(() => {
    ctx = {
      fillStyle: '',
      font: '',
      textBaseline: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
    };
    canvases = [];
    urlBlobs = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const el = realCreate(tag, options);
      if (tag === 'canvas') canvases.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ctx) as unknown as HTMLCanvasElement['getContext'],
    );
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['png-bytes'], { type: 'image/png' }));
    };
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      urlBlobs.push(b as Blob);
      return `blob:test-${urlBlobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', FakeImage);
    style = document.createElement('style');
    style.textContent = `
      :root { --surface: rgb(19, 27, 46); }
      .bar { fill: rgb(1, 2, 3); stroke: var(--floor-0); }
    `;
    document.head.append(style);
  });

  afterEach(() => {
    style.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    if (originalToBlob) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', originalToBlob);
  });

  it('inlines computed styles into a standalone SVG and drops ignored elements', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const svg = makeSvg(host);
    const hover = document.createElementNS(SVG_NS, 'g');
    for (const [k, v] of Object.entries(EXPORT_IGNORE)) hover.setAttribute(k, v);
    svg.append(hover);

    const { xml, width, height } = serializeSvg(svg, 2);
    expect(width).toBe(200);
    expect(height).toBe(100);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('width="400"');
    expect(xml).toContain('height="200"');
    expect(xml).toMatch(/<rect[^>]*style="[^"]*fill:\s?rgb\(1, 2, 3\)/);
    // Unresolved custom properties are never written into the image.
    expect(xml).not.toContain('var(');
    expect(xml).not.toContain('data-export');
    // The live SVG is untouched.
    expect(svg.querySelector('[data-export]')).not.toBeNull();
  });

  it('rasterises the largest SVG at 2× on the theme background with the card title', async () => {
    const section = document.createElement('section');
    section.setAttribute('aria-labelledby', 'card-title');
    section.innerHTML = '<h3 id="card-title">Wirtschaftlichkeit</h3>';
    const body = document.createElement('div');
    section.append(body);
    document.body.append(section);
    makeSvg(body);
    // An icon inside a button is not exported.
    const button = document.createElement('button');
    makeSvg(button, '0 0 24 24');
    body.append(button);

    const blob = await renderViewPng(body, { scale: 2 });
    expect(blob.type).toBe('image/png');

    const out = canvases[0];
    // (200 + 2·12 padding) × (100 + 2·12 + 26 title) CSS px at scale 2
    expect(out.width).toBe(448);
    expect(out.height).toBe(300);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 448, 300);
    expect(ctx.fillStyle).not.toBe('');
    expect(ctx.fillText).toHaveBeenCalledWith('Wirtschaftlichkeit', 24, 54);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage.mock.calls[0].slice(1)).toEqual([24, 76, 400, 200]);

    // Exactly one SVG document was rasterised: the chart, not the icon.
    const svgBlobs = urlBlobs.filter((b) => b.type.startsWith('image/svg+xml'));
    expect(svgBlobs).toHaveLength(1);
    expect(await blobText(svgBlobs[0])).toContain('viewBox="0 0 200 100"');
  });

  it('draws canvases (heatmap, WebGL) and supports a transparent background without title', async () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    host.append(canvas);
    document.body.append(host);

    await renderViewPng(host, { scale: 1, background: null, padding: 0, title: null });
    const out = canvases[canvases.length - 1];
    expect(out.width).toBe(300);
    expect(out.height).toBe(150);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 300, 150);
  });

  it('lets a canvas owner re-render at the export scale right before the copy, then restore', async () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    host.append(canvas);
    document.body.append(host);
    const calls: string[] = [];
    const details: CanvasRenderDetail[] = [];
    canvas.addEventListener(CANVAS_RENDER_EVENT, (e) => {
      const detail = (e as CustomEvent<CanvasRenderDetail>).detail;
      details.push(detail);
      calls.push(`render ${detail.scale}`);
      canvas.width = 600; // hi-res frame for the capture
      canvas.height = 300;
      detail.rendered = true;
      detail.restore = () => {
        calls.push('restore');
        canvas.width = 300;
        canvas.height = 150;
      };
    });
    ctx.drawImage.mockImplementation((src: HTMLCanvasElement) => calls.push(`draw ${src.width}`));

    // Default scale: max(2, devicePixelRatio) → 2 in jsdom.
    await renderViewPng(host, { background: null, padding: 0, title: null });
    expect(details.map((d) => d.reason)).toEqual(['export']);
    expect(calls).toEqual(['render 2', 'draw 600', 'restore']);
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 600, 300);
    expect(canvas.width).toBe(300);
  });

  it('rejects views without graphics and encoding failures', async () => {
    const host = document.createElement('div');
    host.textContent = 'text only';
    document.body.append(host);
    await expect(renderViewPng(host)).rejects.toThrow(/Nothing to export/);

    makeSvg(host);
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
    await expect(renderViewPng(host)).rejects.toThrow(/PNG encoding failed/);
  });

  it('exportViewPng downloads the image with a .png name', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    makeSvg(host);
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    await exportViewPng(host, 'monatsertrag');
    expect(clicks).toEqual(['monatsertrag.png']);
    expect(urlBlobs[urlBlobs.length - 1].type).toBe('image/png');
  });
});
