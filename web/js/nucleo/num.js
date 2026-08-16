/* Numerics. No DOM here, so Node runs this file directly in the tests.
   Everything is small and dense: the largest system ever solved here is the
   4x4 of a cubic wavelength fit. */

/* Gaussian elimination with partial pivoting. `A` is an array of rows, `b` is
   the right-hand side. Both are consumed, so callers pass copies.
   Throws on a singular matrix instead of returning silent NaNs — a singular
   normal-equations matrix means duplicate calibration points, and the operator
   has to be told, not handed a fit made of infinities. */
export function solve(A, b) {
  const n = b.length;
  for (let k = 0; k < n; k++) {
    let p = k, melhor = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i][k]);
      if (v > melhor) { melhor = v; p = i; }
    }
    if (melhor < 1e-300) throw new Error("singular system");
    if (p !== k) {
      const t = A[p]; A[p] = A[k]; A[k] = t;
      const s = b[p]; b[p] = b[k]; b[k] = s;
    }
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/* Least-squares polynomial of the given order, by the normal equations.
   Returns the coefficients low order first: c[0] + c[1]*x + c[2]*x^2 + …

   The x values are CENTRED AND SCALED before the fit and the shift is undone
   after. Pixel indices run to about 1280, so a cubic in raw pixels puts 1280^6
   — around 4e18 — in the normal-equations matrix, and double precision loses
   the small coefficients in the rounding. Centring keeps every entry near 1. */
export function polyfit(xs, ys, ordem) {
  const n = xs.length;
  if (n < ordem + 1) {
    throw new Error("a polynomial of order " + ordem + " needs at least "
      + (ordem + 1) + " points, got " + n);
  }
  let x0 = 0;
  for (let i = 0; i < n; i++) x0 += xs[i];
  x0 /= n;
  let esc = 0;
  for (let i = 0; i < n; i++) esc = Math.max(esc, Math.abs(xs[i] - x0));
  if (!(esc > 0)) throw new Error("every x is the same value");

  const m = ordem + 1;
  /* Powers of the reduced x, up to 2*ordem, summed once and reused. */
  const soma = new Float64Array(2 * ordem + 1);
  const rhs = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const u = (xs[i] - x0) / esc;
    let p = 1;
    for (let k = 0; k <= 2 * ordem; k++) { soma[k] += p; p *= u; }
    p = 1;
    for (let k = 0; k < m; k++) { rhs[k] += ys[i] * p; p *= u; }
  }
  const A = [];
  for (let i = 0; i < m; i++) {
    const linha = new Float64Array(m);
    for (let j = 0; j < m; j++) linha[j] = soma[i + j];
    A.push(linha);
  }
  const cu = solve(A, rhs);

  /* Undo u = (x - x0)/esc: expand sum_k cu[k] * ((x-x0)/esc)^k back into x. */
  const c = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const ck = cu[k] / Math.pow(esc, k);
    /* (x - x0)^k expanded by the binomial theorem. */
    for (let j = 0; j <= k; j++) {
      c[j] += ck * binom(k, j) * Math.pow(-x0, k - j);
    }
  }
  return c;
}

function binom(n, k) {
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}

/* Horner. */
export function polyval(c, x) {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i];
  return v;
}

export function mean(v) {
  let s = 0, n = 0;
  for (let i = 0; i < v.length; i++) if (isFinite(v[i])) { s += v[i]; n++; }
  return n ? s / n : NaN;
}

export function std(v) {
  const m = mean(v);
  let s = 0, n = 0;
  for (let i = 0; i < v.length; i++) {
    if (isFinite(v[i])) { const d = v[i] - m; s += d * d; n++; }
  }
  return n > 1 ? Math.sqrt(s / (n - 1)) : NaN;
}

/* Root mean square of the residuals. */
export function rms(v) {
  let s = 0, n = 0;
  for (let i = 0; i < v.length; i++) if (isFinite(v[i])) { s += v[i] * v[i]; n++; }
  return n ? Math.sqrt(s / n) : NaN;
}

/* Linear interpolation of y(x) on a strictly increasing xs.
   Outside the range it returns NaN rather than extrapolating: a wavelength
   outside the calibrated span is not a measurement. */
export function interp(xs, ys, x) {
  const n = xs.length;
  if (n === 0 || x < xs[0] || x > xs[n - 1]) return NaN;
  let a = 0, b = n - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (xs[m] <= x) a = m; else b = m;
  }
  const dx = xs[b] - xs[a];
  if (dx === 0) return ys[a];
  const t = (x - xs[a]) / dx;
  return ys[a] + t * (ys[b] - ys[a]);
}
