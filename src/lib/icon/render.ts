import { hexToRgb, rgbToHex } from "@/lib/icon/color";

export type Framing = "cover" | "contain";
export type RemoveMode = "off" | "chroma" | "edges";

export type EditState = {
  framing: Framing;
  zoom: number;
  panX: number;
  panY: number;
  removeMode: RemoveMode;
  keyColor: string;
  tolerance: number;
  feather: number;
  padding: number;
  fill: boolean;
  fillColor: string;
};

export const DEFAULT_EDIT: EditState = {
  framing: "cover",
  zoom: 1,
  panX: 0,
  panY: 0,
  removeMode: "off",
  keyColor: "#00ff00",
  tolerance: 0.12,
  feather: 0.06,
  padding: 0,
  fill: false,
  fillColor: "#000000",
};

export type SampleKind = "orbit" | "bars" | "studio";

function canvas2d(size: number, read = false): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", read ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function drawFramed(
  image: CanvasImageSource,
  sw: number,
  sh: number,
  edit: EditState,
  size: number,
): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(size, true);
  const zoom = clamp(edit.zoom, 1, 3);
  const panX = clamp(edit.panX, -1, 1);
  const panY = clamp(edit.panY, -1, 1);

  if (edit.framing === "cover") {
    const side = Math.min(sw, sh) / zoom;
    const maxX = Math.max(0, sw - side);
    const maxY = Math.max(0, sh - side);
    const sx = maxX * (panX + 1) * 0.5;
    const sy = maxY * (panY + 1) * 0.5;
    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
    return canvas;
  }

  const fit = Math.min(size / sw, size / sh);
  const drawW = sw * fit * zoom;
  const drawH = sh * fit * zoom;
  const spareX = Math.max(0, drawW - size);
  const spareY = Math.max(0, drawH - size);
  const dx = (size - drawW) / 2 + panX * (spareX / 2);
  const dy = (size - drawH) / 2 + panY * (spareY / 2);
  ctx.drawImage(image, 0, 0, sw, sh, dx, dy, drawW, drawH);
  return canvas;
}

function colorDist(data: Uint8ClampedArray, index: number, rgb: [number, number, number]): number {
  return Math.max(
    Math.abs(data[index] - rgb[0]),
    Math.abs(data[index + 1] - rgb[1]),
    Math.abs(data[index + 2] - rgb[2]),
  );
}

function despill(data: Uint8ClampedArray, index: number, rgb: [number, number, number]) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  if (rgb[1] >= rgb[0] && rgb[1] >= rgb[2]) data[index + 1] = Math.min(g, Math.max(r, b));
  else if (rgb[0] >= rgb[1] && rgb[0] >= rgb[2]) data[index] = Math.min(r, Math.max(g, b));
  else data[index + 2] = Math.min(b, Math.max(r, g));
}

function knockOut(canvas: HTMLCanvasElement, edit: EditState) {
  if (edit.removeMode === "off") return;
  const rgb = hexToRgb(edit.keyColor);
  if (!rgb) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const tol = clamp(edit.tolerance, 0, 1) * 255;
  const feather = clamp(edit.feather, 0, 1) * 255;
  const limit = tol + feather;

  const clearAt = (index: number, dist: number) => {
    if (dist <= tol) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      return;
    }
    if (feather > 0 && dist <= limit) {
      const keep = (dist - tol) / feather;
      data[index + 3] = Math.round(data[index + 3] * keep);
      despill(data, index, rgb);
      if (data[index + 3] === 0) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
      }
    }
  };

  if (edit.removeMode === "chroma") {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      clearAt(i, colorDist(data, i, rgb));
    }
    ctx.putImageData(image, 0, 0);
    return;
  }

  const seen = new Uint8Array(width * height);
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);
  let qe = 0;
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    seen[p] = 1;
    const index = p * 4;
    if (data[index + 3] === 0) return;
    if (colorDist(data, index, rgb) <= limit) {
      qx[qe] = x;
      qy[qe] = y;
      qe += 1;
    }
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  for (let qs = 0; qs < qe; qs += 1) {
    const x = qx[qs];
    const y = qy[qs];
    const index = (y * width + x) * 4;
    clearAt(index, colorDist(data, index, rgb));
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  ctx.putImageData(image, 0, 0);
}

function applyPadding(source: HTMLCanvasElement, padding: number): HTMLCanvasElement {
  const amount = clamp(padding, 0, 0.45);
  if (amount <= 0) return source;
  const size = source.width;
  const { canvas, ctx } = canvas2d(size, true);
  const inset = Math.round(size * amount);
  const inner = Math.max(1, size - inset * 2);
  ctx.drawImage(source, inset, inset, inner, inner);
  return canvas;
}

function applyFill(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(source.width, true);
  ctx.fillStyle = hexToRgb(color) ? color : "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

export function renderMaster(
  image: CanvasImageSource,
  width: number,
  height: number,
  edit: EditState,
  output = 1024,
): { final: HTMLCanvasElement; framed: HTMLCanvasElement } {
  const framed = drawFramed(image, width, height, edit, output);
  const copy = document.createElement("canvas");
  copy.width = framed.width;
  copy.height = framed.height;
  const ctx = copy.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(framed, 0, 0);
  knockOut(copy, edit);
  let final = applyPadding(copy, edit.padding);
  if (edit.fill) final = applyFill(final, edit.fillColor);
  return { final, framed };
}

export function renderPlain(
  image: CanvasImageSource,
  width: number,
  height: number,
  output = 1024,
): HTMLCanvasElement {
  return drawFramed(image, width, height, { ...DEFAULT_EDIT, framing: "cover" }, output);
}

export function downscale(master: HTMLCanvasElement, px: number): HTMLCanvasElement {
  if (master.width === px && master.height === px) return master;
  const { canvas, ctx } = canvas2d(px);
  ctx.drawImage(master, 0, 0, px, px);
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("PNG export failed."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

export function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 64) {
    if (data[i] < 250) return true;
  }
  return false;
}

/** Map a click on the padded final image back to the framed plate. */
export function clickToFramedPixel(
  canvas: HTMLCanvasElement,
  u: number,
  v: number,
  padding: number,
): { x: number; y: number } | null {
  const amount = clamp(padding, 0, 0.45);
  let x = u;
  let y = v;
  if (amount > 0) {
    if (u < amount || u > 1 - amount || v < amount || v > 1 - amount) return null;
    x = (u - amount) / (1 - amount * 2);
    y = (v - amount) / (1 - amount * 2);
  }
  return {
    x: clamp(Math.floor(x * canvas.width), 0, canvas.width - 1),
    y: clamp(Math.floor(y * canvas.height), 0, canvas.height - 1),
  };
}

export function readPixel(canvas: HTMLCanvasElement, x: number, y: number): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  if (pixel[3] < 16) return null;
  return rgbToHex(pixel[0], pixel[1], pixel[2]);
}

export function sampleCorners(
  image: CanvasImageSource,
  width: number,
  height: number,
): string | null {
  if (width < 2 || height < 2) return null;
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const points: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const colors: [number, number, number][] = [];
  for (const [x, y] of points) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    if (pixel[3] < 250) return null;
    colors.push([pixel[0], pixel[1], pixel[2]]);
  }
  for (let i = 1; i < colors.length; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs(colors[0][c] - colors[i][c]) > 28) return null;
    }
  }
  const avg = colors.reduce(
    (acc, color) => [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2]] as [number, number, number],
    [0, 0, 0],
  );
  return rgbToHex(
    Math.round(avg[0] / colors.length),
    Math.round(avg[1] / colors.length),
    Math.round(avg[2] / colors.length),
  );
}

export function paintSample(kind: SampleKind): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(1024);
  if (kind === "studio") {
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = "#141418";
    roundRect(ctx, 232, 232, 560, 560, 140);
    ctx.fill();
    ctx.strokeStyle = "#2ee6ff";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.arc(512, 512, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#2ee6ff";
    ctx.beginPath();
    ctx.arc(512, 512, 36, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
  }

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = "#2ee6ff";
  ctx.fillStyle = "#2ee6ff";

  if (kind === "orbit") {
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.arc(512, 512, 300, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(512, 512, 190, Math.PI * 0.85, Math.PI * 1.72);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(512 + Math.cos(Math.PI * 0.85) * 190, 512 + Math.sin(Math.PI * 0.85) * 190, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(512, 512, 46, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
  }

  const heights = [180, 320, 470, 620];
  heights.forEach((h, i) => {
    const x = 196 + i * 168;
    ctx.fillRect(x, 760 - h, 112, h);
  });
  ctx.fillRect(196, 800, 112 * 4 + 168 * 3 - 112, 18);
  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
