// Shared by the globe's texture builds: unwrapping, scanline rasterising, and a minimal PNG writer.
import { zlibSync } from "fflate";

export type Position = number[];
export type Ring = [number, number][]; // [lon, lat], lon unwrapped so a ring never jumps across ±180

/** Unwraps a ring's longitudes; a ring that goes once round the globe (Antarctica) is closed through the pole. */
export function unwrap(r: Position[]): Ring {
  const out: Ring = [];
  let off = 0;
  for (let i = 0; i < r.length; i++) {
    if (i > 0) {
      const d = r[i][0] + off - out[i - 1][0];
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
    }
    out.push([r[i][0] + off, r[i][1]]);
  }
  const drift = out[out.length - 1][0] - out[0][0];
  if (Math.abs(drift) > 180) {
    const pole = out.reduce((s, p) => s + p[1], 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole], out[0]);
  }
  return out;
}

/** Even-odd spans of a country's rings along latitude `lat`, as sorted pairs of unwrapped longitudes. */
export function spans(rings: Ring[], lat: number): number[] {
  const xs: number[] = [];
  for (const r of rings)
    for (let i = 1; i < r.length; i++) {
      const [x0, y0] = r[i - 1];
      const [x1, y1] = r[i];
      if (y0 <= lat !== y1 <= lat) xs.push(x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0));
    }
  return xs.sort((a, b) => a - b);
}

/** Calls fill(column) for each column whose centre is inside a span, at `cols` columns round the globe. */
export function eachInside(xs: number[], cols: number, fill: (col: number) => void) {
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const a = Math.ceil(((xs[k] + 180) / 360) * cols - 0.5);
    const b = Math.ceil(((xs[k + 1] + 180) / 360) * cols - 0.5);
    for (let j = a; j < b; j++) fill(((j % cols) + cols) % cols);
  }
}

export function png(rgba: Uint8Array, w: number, h: number): Buffer {
  // filter 1 (Sub) per row: flat fills become runs of zeros
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    raw[o] = 1;
    for (let i = 0; i < w * 4; i++) raw[o + 1 + i] = (rgba[y * w * 4 + i] - (i >= 4 ? rgba[y * w * 4 + i - 4] : 0)) & 255;
  }
  const chunk = (type: string, data: Uint8Array) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    Buffer.from(data).copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function crc(b: Uint8Array) {
  let c = ~0;
  for (const v of b) {
    c ^= v;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
