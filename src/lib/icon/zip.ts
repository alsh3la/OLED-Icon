const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

class Bin {
  private parts: Uint8Array[] = [];
  length = 0;

  u16(n: number) {
    this.raw(Uint8Array.of(n & 255, (n >> 8) & 255));
  }

  u32(n: number) {
    this.raw(Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255));
  }

  raw(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

export type ZipFile = { name: string; data: Uint8Array };

/** Store-only ZIP (no compression), same idea as the on-device builder. */
export function buildZip(files: ZipFile[]): Uint8Array {
  const out = new Bin();
  const entries: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  // 2026-10-22 12:00:00 as a DOS stamp so archives don't show 1980.
  const time = 12 << 11;
  const date = (2026 - 1980) << 9 | 10 << 5 | 22;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const offset = out.length;
    const size = file.data.length;
    out.u32(0x04034b50);
    out.u16(20);
    out.u16(0);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(size);
    out.u32(size);
    out.u16(name.length);
    out.u16(0);
    out.raw(name);
    out.raw(file.data);
    entries.push({ name, crc, size, offset });
  }

  const cdStart = out.length;
  for (const entry of entries) {
    out.u32(0x02014b50);
    out.u16(20);
    out.u16(20);
    out.u16(0);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u32(0);
    out.u32(entry.offset);
    out.raw(entry.name);
  }

  const cdSize = out.length - cdStart;
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(cdSize);
  out.u32(cdStart);
  out.u16(0);
  return out.finish();
}

/** Vista-style ICO that embeds PNG frames. Sizes of 256 are stored as 0. */
export function buildIco(images: { px: number; png: Uint8Array }[]): Uint8Array {
  const count = images.length;
  const headerSize = 6 + 16 * count;
  const dir = new Uint8Array(headerSize);
  const view = new DataView(dir.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  let cursor = headerSize;
  images.forEach((img, index) => {
    const o = 6 + index * 16;
    const dim = img.px >= 256 ? 0 : img.px;
    dir[o] = dim;
    dir[o + 1] = dim;
    view.setUint16(o + 4, 1, true);
    view.setUint16(o + 6, 32, true);
    view.setUint32(o + 8, img.png.length, true);
    view.setUint32(o + 12, cursor, true);
    cursor += img.png.length;
  });
  const out = new Uint8Array(cursor);
  out.set(dir, 0);
  let offset = headerSize;
  for (const img of images) {
    out.set(img.png, offset);
    offset += img.png.length;
  }
  return out;
}
