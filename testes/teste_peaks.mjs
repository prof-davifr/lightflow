import test from "node:test";
import assert from "node:assert/strict";
import { acha, refina, fwhm, area, media, indiceDe, picoPerto } from "../web/js/nucleo/peaks.js";

function gaussiana(n, centro, sigma, altura, fundo) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = (fundo || 0) + altura * Math.exp(-((i - centro) ** 2) / (2 * sigma * sigma));
  }
  return y;
}

test("refina finds the centre of a Gaussian to a fraction of a pixel", () => {
  /* A whole column is about 0.4 nm on this instrument, so the sub-pixel step is
     what keeps the calibration below a nanometre. */
  const y = gaussiana(1024, 511.37, 3, 0.8, 0.02);
  let imax = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[imax]) imax = i;
  const px = refina(y, imax);
  assert.ok(Math.abs(px - 511.37) < 0.05, `got ${px}`);
});

test("refina beats plain integer picking", () => {
  const centro = 200.45;
  const y = gaussiana(512, centro, 3, 1, 0);
  let imax = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[imax]) imax = i;
  assert.ok(Math.abs(refina(y, imax) - centro) < Math.abs(imax - centro),
    "the refinement must be closer than the raw index");
});

test("refina refuses a shift larger than a column", () => {
  /* A monotone ramp has no maximum; the parabola would fly off. */
  const y = Float32Array.from([1, 2, 3]);
  assert.equal(refina(y, 1), 1);
});

test("acha finds several lines and rejects the noise floor", () => {
  const n = 1024;
  const y = new Float32Array(n);
  const verdade = [150.3, 400.7, 700.2];
  verdade.forEach((c, k) => {
    const g = gaussiana(n, c, 3, 0.8 - 0.2 * k, 0);
    for (let i = 0; i < n; i++) y[i] += g[i];
  });
  let semente = 7;
  for (let i = 0; i < n; i++) {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    y[i] += 0.004 * (semente / 0x7fffffff - 0.5);
  }
  const picos = acha(y);
  assert.equal(picos.length, verdade.length, `found ${picos.length} peaks`);
  picos.forEach((p, k) => {
    assert.ok(Math.abs(p.px - verdade[k]) < 0.2, `peak ${k} at ${p.px}`);
  });
});

test("acha separates well-parted lines and merges lines it cannot resolve", () => {
  const n = 512, sigma = 3;
  const bem = new Float32Array(n), junto = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    bem[i] = Math.exp(-((i - 240) ** 2) / (2 * 9)) + Math.exp(-((i - 264) ** 2) / (2 * 9));
    junto[i] = Math.exp(-((i - 250) ** 2) / (2 * 9)) + Math.exp(-((i - 253) ** 2) / (2 * 9));
  }
  assert.equal(acha(bem).length, 2, "8 sigma apart must resolve");
  assert.equal(acha(junto).length, 1,
    "1 sigma apart cannot resolve, and the instrument should not pretend it does");
});

test("fwhm matches the analytic width of a Gaussian", () => {
  const sigma = 4;
  const n = 512;
  const y = gaussiana(n, 256, sigma, 1, 0);
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  const w = fwhm(xs, y, 256, 120);
  const esperado = 2 * Math.sqrt(2 * Math.log(2)) * sigma;   // 2.3548 sigma
  assert.ok(Math.abs(w - esperado) / esperado < 0.02, `got ${w}, expected ${esperado}`);
});

test("fwhm reports NaN for a line running off the edge", () => {
  const n = 64;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = i / n;      // monotone, never comes back down
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  assert.ok(Number.isNaN(fwhm(xs, y, n - 1, 30)));
});

test("area matches the analytic integral of a Gaussian", () => {
  const n = 1024, sigma = 6, altura = 0.9;
  const y = gaussiana(n, 512, sigma, altura, 0);
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  const a = area(xs, y, 512 - 5 * sigma, 512 + 5 * sigma);
  const esperado = altura * sigma * Math.sqrt(2 * Math.PI);
  assert.ok(Math.abs(a - esperado) / esperado < 0.005, `got ${a}, expected ${esperado}`);
});

test("media over a band skips NaN instead of poisoning the value", () => {
  const xs = [500, 501, 502, 503, 504];
  const y = [1, 2, NaN, 4, 5];
  assert.equal(media(xs, y, 502, 4), 3);          // (1+2+4+5)/4
  assert.ok(Number.isNaN(media(xs, [NaN, NaN, NaN, NaN, NaN], 502, 4)));
});

test("indiceDe finds the nearest column", () => {
  const xs = [400, 410, 420, 430];
  assert.equal(indiceDe(xs, 419), 2);
  assert.equal(indiceDe(xs, 404), 0);
  assert.equal(indiceDe(xs, 1000), 3);
});

test("picoPerto moves a click that landed beside a line onto its maximum", () => {
  /* One screen pixel is two or three columns, and refina alone refuses to move
     more than one: the point used to stay where the click landed. */
  const y = gaussiana(1024, 511.37, 4, 0.8, 0.02);
  for (const clique of [505, 508, 514, 518]) {
    const i = picoPerto(y, clique);
    assert.equal(i, 511, `click at ${clique} went to ${i}`);
    assert.ok(Math.abs(refina(y, i) - 511.37) < 0.05);
  }
});

test("picoPerto skips NaN and stays inside the array", () => {
  const y = new Float32Array([NaN, 0.2, 0.9, 0.1, NaN]);
  assert.equal(picoPerto(y, 0), 2);
  assert.equal(picoPerto(y, 4, 1), 3);
});
