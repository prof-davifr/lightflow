/* From a camera frame to one spectral line.

   THE ORDER OF THE STAGES IS THE WHOLE POINT OF THIS FILE.

   1. Detect saturation on the RAW code value, first.
   2. Linearize every source pixel, through a 256-entry lookup table.
   3. Only then interpolate and average the rows.

   Stage 3 after stage 2, and not the other way round: the mean of the sRGB
   curve is not the curve of the mean. On a stripe with a bright core and dim
   edges, binning first and linearizing after costs several percent, which is
   the same size as the absorbance being measured.

   Stage 1 before stage 2, and not after: once the table has run, 250 and 255
   are both plausible numbers and the evidence of clipping is gone.

   WHICH CHANNEL TO MEASURE ON. `getUserMedia` gives no control over the pixel
   format, and the browser will negotiate MJPG or YUYV. Both subsample chroma
   HORIZONTALLY — 4:2:0 and 4:2:2 respectively — and horizontal is the spectral
   axis. Red and blue therefore arrive at half the resolution along the very
   axis being measured. Green is the only channel at full resolution, so green
   is the default for the measurement, and the luminance mix uses the Rec.709
   weights, which lean on green for the same reason. Red and blue are for
   cross-checking and for the ends where green runs out — never for fine work. */

const SRGB = "srgb";

/* Anything at or above this raw code counts as clipped. Not 255: a camera with
   any processing in front of the sensor flattens out before it reaches full
   scale, and a column already sitting at 251 has lost its top. */
export const LIMIAR_SATUR = 250;

/* Rec.709 luminance weights, applied to LINEAR values. Applying them to code
   values is the common mistake, and it is simply a different number. */
const KR = 0.2126, KG = 0.7152, KB = 0.0722;

/* Inverse sRGB transfer, or a plain power law when the operator measured one.
   `v` is 0..1. */
export function toLinear(v, gamma) {
  if (gamma === undefined || gamma === SRGB) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return Math.pow(v, gamma);
}

/* The forward transfer, used by the tests and by the preview. */
export function fromLinear(v, gamma) {
  if (gamma === undefined || gamma === SRGB) {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  return Math.pow(v, 1 / gamma);
}

/* 256 entries, built once per gamma change and reused for every frame. */
export function makeLut(gamma) {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = toLinear(i / 255, gamma);
  return t;
}

/* A region of interest over the spectral stripe.
   `x`,`y` is the top-left corner of the UNROTATED box, `w` its width in output
   columns, `h` the number of rows binned into each column, and `angle` the
   rotation of the box about its own centre, in degrees, positive clockwise on
   screen. The stripe is almost never exactly horizontal, and a one-degree tilt
   over 1000 columns smears every line across 17 rows. */
export function makeRoi(x, y, w, h, angle) {
  return { x: x, y: y, w: w | 0, h: h | 0, angle: angle || 0 };
}

/* A short string that says which setup a calibration belongs to. A calibration
   is only valid for the geometry that produced it, and comparing this string is
   the cheapest way to catch a mismatch before it becomes a wrong wavelength. */
export function assinatura(roi, larg, alt) {
  return [larg, alt, roi.x, roi.y, roi.w, roi.h,
    (roi.angle || 0).toFixed(3)].join("/");
}

/* Pulls one spectral line out of a frame.

   `img` is an ImageData, or anything with `{data, width, height}` — the tests
   build one by hand. `lut` comes from makeLut.

   Returns Float32Arrays of length roi.w holding LINEAR intensity in 0..1:
     r, g, b   the three camera channels, kept apart because a Bayer filter
               gives each one its own spectral response
     lum       the Rec.709 mix of the three, on linear values
   plus:
     clip      per column, how many raw samples reached LIMIAR_SATUR
     used      per column, how many rows actually fell inside the image
     clipTotal the sum of clip, for the header pill

   A column with no usable row comes back NaN, and uPlot draws a gap there. */
export function extract(img, roi, lut, limiar) {
  const W = img.width, H = img.height, D = img.data;
  const lim = limiar === undefined ? LIMIAR_SATUR : limiar;
  const w = roi.w | 0, h = roi.h | 0;
  const r = new Float32Array(w), g = new Float32Array(w), b = new Float32Array(w);
  const lum = new Float32Array(w);
  const clip = new Uint16Array(w), used = new Uint16Array(w);

  const rad = (roi.angle || 0) * Math.PI / 180;
  const co = Math.cos(rad), si = Math.sin(rad);
  /* (w-1)/2, not w/2. The ROI centre has to be the centre of the SET OF PIXEL
     CENTRES it covers, not the centre of the box drawn around them. With w/2
     the whole strip lands half a pixel off, which at angle zero means column i
     is read from image column x+i+0.5 — a permanent half-column shift in every
     wavelength the instrument reports. */
  const cx = roi.x + (roi.w - 1) / 2, cy = roi.y + (roi.h - 1) / 2;
  let clipTotal = 0;

  for (let i = 0; i < w; i++) {
    const u = i - (w - 1) / 2;
    let sr = 0, sg = 0, sb = 0, n = 0, nc = 0;
    for (let j = 0; j < h; j++) {
      const v = j - (h - 1) / 2;
      const px = cx + u * co - v * si;
      const py = cy + u * si + v * co;
      const x0 = Math.floor(px), y0 = Math.floor(py);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) continue;
      const fx = px - x0, fy = py - y0;
      const o00 = (y0 * W + x0) * 4, o10 = o00 + 4;
      const o01 = o00 + W * 4, o11 = o01 + 4;

      /* Saturation, on the raw codes, before the table. */
      if (D[o00] >= lim || D[o00 + 1] >= lim || D[o00 + 2] >= lim
        || D[o10] >= lim || D[o10 + 1] >= lim || D[o10 + 2] >= lim
        || D[o01] >= lim || D[o01 + 1] >= lim || D[o01 + 2] >= lim
        || D[o11] >= lim || D[o11 + 1] >= lim || D[o11 + 2] >= lim) nc++;

      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      sr += lut[D[o00]] * w00 + lut[D[o10]] * w10 + lut[D[o01]] * w01 + lut[D[o11]] * w11;
      sg += lut[D[o00 + 1]] * w00 + lut[D[o10 + 1]] * w10 + lut[D[o01 + 1]] * w01 + lut[D[o11 + 1]] * w11;
      sb += lut[D[o00 + 2]] * w00 + lut[D[o10 + 2]] * w10 + lut[D[o01 + 2]] * w01 + lut[D[o11 + 2]] * w11;
      n++;
    }
    if (n === 0) {
      r[i] = g[i] = b[i] = lum[i] = NaN;
    } else {
      r[i] = sr / n; g[i] = sg / n; b[i] = sb / n;
      lum[i] = KR * r[i] + KG * g[i] + KB * b[i];
    }
    clip[i] = nc; used[i] = n; clipTotal += nc;
  }
  return { r: r, g: g, b: b, lum: lum, clip: clip, used: used, clipTotal: clipTotal };
}

export const CANAIS = ["r", "g", "b", "lum"];

/* Running mean of N extracted lines. The camera is noisy and a line is cheap to
   repeat, so this is the operator's main noise knob.
   Accumulates in Float64 and only narrows to Float32 on read: summing 64 frames
   in Float32 loses exactly the low bits that averaging is meant to recover.
   Also carries the per-column spread, which is what sets the noise floor and
   therefore the largest absorbance this bench can honestly report. */
export class Acumulador {
  constructor(w) {
    this.w = w;
    this.soma = { r: new Float64Array(w), g: new Float64Array(w), b: new Float64Array(w), lum: new Float64Array(w) };
    this.soma2 = { r: new Float64Array(w), g: new Float64Array(w), b: new Float64Array(w), lum: new Float64Array(w) };
    this.clip = new Uint32Array(w);
    this.n = 0; this.clipTotal = 0;
  }
  poe(linha) {
    for (let c = 0; c < CANAIS.length; c++) {
      const k = CANAIS[c], v = linha[k], s = this.soma[k], s2 = this.soma2[k];
      for (let i = 0; i < this.w; i++) { s[i] += v[i]; s2[i] += v[i] * v[i]; }
    }
    for (let i = 0; i < this.w; i++) this.clip[i] += linha.clip[i];
    this.clipTotal += linha.clipTotal;
    this.n++;
  }
  pronto(alvo) { return this.n >= alvo; }
  /* Mean and per-column standard deviation. Does not reset — call limpa(). */
  media() {
    const n = this.n || 1;
    const saida = { n_quadros: this.n, clip: this.clip.slice(), clipTotal: this.clipTotal, sigma: {} };
    for (let c = 0; c < CANAIS.length; c++) {
      const k = CANAIS[c];
      const m = new Float32Array(this.w), sd = new Float32Array(this.w);
      for (let i = 0; i < this.w; i++) {
        m[i] = this.soma[k][i] / n;
        const varr = n > 1 ? (this.soma2[k][i] - n * m[i] * m[i]) / (n - 1) : 0;
        sd[i] = Math.sqrt(Math.max(0, varr));
      }
      saida[k] = m; saida.sigma[k] = sd;
    }
    return saida;
  }
  limpa() {
    for (let c = 0; c < CANAIS.length; c++) {
      this.soma[CANAIS[c]].fill(0); this.soma2[CANAIS[c]].fill(0);
    }
    this.clip.fill(0);
    this.n = 0; this.clipTotal = 0;
  }
}
