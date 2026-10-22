export function hexToRgb(hex: string): [number, number, number] | null {
  let s = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null;
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = Number.parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Value accepted by `<input type="color">`. */
export function toColorInput(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : "#000000";
}
