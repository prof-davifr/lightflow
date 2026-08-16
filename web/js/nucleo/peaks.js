/* Finding a line and saying where its centre is, to better than one pixel.

   Sub-pixel refinement is not a luxury here. A homemade spectrometer spreads
   the visible range over roughly 1000 columns, so one column is around 0.4 nm.
   Clicking a peak by eye lands within a pixel or two, and that alone would set
   the floor of the wavelength calibration at about 1 nm. The parabola below
   pulls it down to a few hundredths. */

/* Local maxima, filtered by prominence and by a minimum separation.
   `y` may contain NaN, which is skipped rather than treated as low. */
export function acha(y, opc) {
  opc = opc || {};
  const n = y.length;
  const janela = opc.janela === undefined ? 15 : opc.janela;
  const distMin = opc.distMin === undefined ? 5 : opc.distMin;
  let promMin = opc.promMin;
  if (promMin === undefined) {
    /* Default: five percent of the full span of the data. */
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!isFinite(y[i])) continue;
      if (y[i] < lo) lo = y[i];
      if (y[i] > hi) hi = y[i];
    }
    promMin = isFinite(hi - lo) ? (hi - lo) * 0.05 : 0;
  }

  const cand = [];
  for (let i = 1; i < n - 1; i++) {
    if (!isFinite(y[i]) || !isFinite(y[i - 1]) || !isFinite(y[i + 1])) continue;
    if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
    /* Prominence against the lowest point within the window on each side. */
    let base = Infinity;
    for (let k = Math.max(0, i - janela); k <= Math.min(n - 1, i + janela); k++) {
      if (isFinite(y[k]) && y[k] < base) base = y[k];
    }
    const prom = y[i] - base;
    if (prom >= promMin) cand.push({ i: i, altura: y[i], prom: prom });
  }

  /* Tallest first, then drop anything too close to one already kept. */
  cand.sort(function (a, b) { return b.altura - a.altura; });
  const fica = [];
  for (let k = 0; k < cand.length; k++) {
    let perto = false;
    for (let j = 0; j < fica.length; j++) {
      if (Math.abs(cand[k].i - fica[j].i) < distMin) { perto = true; break; }
    }
    if (!perto) fica.push(cand[k]);
  }
  fica.sort(function (a, b) { return a.i - b.i; });
  return fica.map(function (p) {
    return { i: p.i, px: refina(y, p.i), altura: p.altura, prom: p.prom };
  });
}

/* Sub-pixel centre from the three samples around a maximum.

   A parabola through the LOGARITHM of the three values recovers the centre of a
   Gaussian exactly, and a spectral line through a slit is very close to a
   Gaussian. Where a value is not positive the plain parabola is used instead,
   which is the right fallback for a peak sitting on a subtracted baseline. */
export function refina(y, i) {
  if (i <= 0 || i >= y.length - 1) return i;
  const a = y[i - 1], b = y[i], c = y[i + 1];
  if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return i;
  let d;
  if (a > 0 && b > 0 && c > 0) {
    const la = Math.log(a), lb = Math.log(b), lc = Math.log(c);
    const den = la - 2 * lb + lc;
    d = den === 0 ? 0 : 0.5 * (la - lc) / den;
  } else {
    const den = a - 2 * b + c;
    d = den === 0 ? 0 : 0.5 * (a - c) / den;
  }
  /* A shift larger than half a column means the maximum is not where it was
     claimed to be; refusing it is safer than trusting a wild extrapolation. */
  if (!isFinite(d) || Math.abs(d) > 1) return i;
  return i + d;
}

/* Full width at half maximum, in the units of `xs`, measured above a baseline
   taken as the lowest point inside the search window on each side.
   Returns NaN when the half-maximum crossing is not reached before the window
   ends — a line running off the edge has no width worth quoting. */
export function fwhm(xs, y, i, janela) {
  janela = janela === undefined ? 60 : janela;
  const n = y.length;
  let base = Infinity;
  for (let k = Math.max(0, i - janela); k <= Math.min(n - 1, i + janela); k++) {
    if (isFinite(y[k]) && y[k] < base) base = y[k];
  }
  const meio = base + (y[i] - base) / 2;
  const e = cruza(xs, y, i, -1, meio);
  const d = cruza(xs, y, i, +1, meio);
  if (!isFinite(e) || !isFinite(d)) return NaN;
  return Math.abs(d - e);
}

/* Walks outward from `i` until y crosses `nivel`, and interpolates the crossing
   linearly between the two bracketing samples. */
function cruza(xs, y, i, passo, nivel) {
  const n = y.length;
  let k = i;
  while (k + passo >= 0 && k + passo < n) {
    const a = y[k], b = y[k + passo];
    if (isFinite(a) && isFinite(b) && (a - nivel) * (b - nivel) <= 0) {
      const t = (a - b) === 0 ? 0 : (a - nivel) / (a - b);
      return xs[k] + t * (xs[k + passo] - xs[k]);
    }
    k += passo;
  }
  return NaN;
}

/* Trapezoidal area under y between two x values, skipping NaN columns.
   Used for the integrated band that feeds the kinetics plot. */
export function area(xs, y, x0, x1) {
  if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
  let s = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i], xb = xs[i + 1];
    if (xb < x0 || xa > x1) continue;
    if (!isFinite(y[i]) || !isFinite(y[i + 1])) continue;
    const a = Math.max(xa, x0), b = Math.min(xb, x1);
    if (b <= a) continue;
    /* Linear interpolation of y at the clipped ends. */
    const t0 = (a - xa) / (xb - xa), t1 = (b - xa) / (xb - xa);
    const ya = y[i] + t0 * (y[i + 1] - y[i]);
    const yb = y[i] + t1 * (y[i + 1] - y[i]);
    s += (ya + yb) / 2 * (b - a);
  }
  return s;
}

/* Mean of y over a band, which is what a kinetics trace at "546 nm plus or
   minus 5 nm" actually is. NaN columns are left out of both sums, so a clipped
   column lowers the count instead of poisoning the value. */
export function media(xs, y, centro, largura) {
  const lo = centro - largura / 2, hi = centro + largura / 2;
  let s = 0, n = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < lo || xs[i] > hi) continue;
    if (!isFinite(y[i])) continue;
    s += y[i]; n++;
  }
  return n ? s / n : NaN;
}

/* Index of the column nearest a wavelength, for the cursor readout. */
export function indiceDe(xs, x) {
  let melhor = 0, dist = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - x);
    if (d < dist) { dist = d; melhor = i; }
  }
  return melhor;
}
