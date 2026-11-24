import test from "node:test";
import assert from "node:assert/strict";
import {
  extract, makeLut, makeRoi, Acumulador, completaCanais, CANAIS, MEDIDAS,
} from "../web/js/nucleo/frame.js";
import { transmittance, absorbance } from "../web/js/nucleo/photometry.js";
import { leCoeficientes, escreveCoeficientes } from "../web/js/nucleo/resposta.js";

/* A one-row image, each column given as [r, g, b] code values. */
function imagem(colunas) {
  const W = colunas.length, H = 2, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    colunas.forEach(function (c, x) {
      const o = (y * W + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    });
  }
  return { width: W, height: H, data: d };
}

/* A stored row: r, g and b only, as gravaEspectro writes them. */
function linha(r, g, b, sigma) {
  const q = { r: Float32Array.from(r), g: Float32Array.from(g), b: Float32Array.from(b) };
  if (sigma) {
    q.sigma = { r: Float32Array.from(sigma[0]), g: Float32Array.from(sigma[1]),
      b: Float32Array.from(sigma[2]) };
  }
  return q;
}

test("R+G+B is a measurement channel and green is still the first", () => {
  assert.ok(CANAIS.indexOf("rgb") >= 0);
  assert.deepEqual(MEDIDAS, ["g", "rgb"]);
});

test("extract gives R+G+B as the plain sum of the linear channels", () => {
  const img = imagem([[200, 40, 10], [0, 128, 0], [30, 30, 250]]);
  const roi = makeRoi(0, 0, 3, 2, 0);
  const l = extract(img, roi, makeLut());
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(l.rgb[i] - (l.r[i] + l.g[i] + l.b[i])) < 1e-6, `column ${i}`);
  }
});

test("R+G+B measures where green has no light, and green leaves a gap", () => {
  /* Column 0 is lit in blue only, column 1 in green, column 2 in red: the ends
     of a white lamp seen through a Bayer filter. The sample halves all of it. */
  const D = linha([0, 0, 0], [0, 0, 0], [0, 0, 0], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  const R = linha([0, 0, 0.3], [0, 0.4, 0], [0.5, 0, 0]);
  const S = linha([0, 0, 0.15], [0, 0.2, 0], [0.25, 0, 0]);
  [D, R, S].forEach(completaCanais);
  const tg = transmittance(S, D, R, "g");
  const tw = transmittance(S, D, R, "rgb");
  assert.ok(isNaN(tg[0]) && isNaN(tg[2]), "green reports the blue and red ends");
  assert.ok(Math.abs(tg[1] - 50) < 1e-4);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(tw[i] - 50) < 1e-4, `column ${i}: ${tw[i]}`);
  const a = absorbance(S, D, R, "rgb");
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - Math.log10(2)) < 1e-5);
});

test("a stored row gets lum and R+G+B on read, and a bound on their spread", () => {
  const q = completaCanais(linha([0.1, 0.2], [0.3, 0.4], [0.5, 0.6],
    [[0.01, 0.02], [0.03, 0.04], [0.05, 0.06]]));
  assert.ok(Math.abs(q.rgb[0] - 0.9) < 1e-6 && Math.abs(q.rgb[1] - 1.2) < 1e-6);
  assert.ok(Math.abs(q.lum[0] - (0.2126 * 0.1 + 0.7152 * 0.3 + 0.0722 * 0.5)) < 1e-6);
  /* Full correlation: the sum of the spreads, never less than the truth. */
  assert.ok(Math.abs(q.sigma.rgb[0] - 0.09) < 1e-6);
});

test("a channel already present is not overwritten", () => {
  const q = linha([0.1], [0.2], [0.3]);
  q.rgb = Float32Array.from([7]);
  completaCanais(q);
  assert.equal(q.rgb[0], 7);
});

test("a capture measures the spread of R+G+B itself, within the bound", () => {
  /* Red and blue move against each other: the sum is steady although each
     channel is not. Summing the spreads would call it noisy. */
  const ac = new Acumulador(1);
  [[0.1, 0.3], [0.3, 0.1], [0.1, 0.3], [0.3, 0.1]].forEach(function (p) {
    ac.poe({ r: Float32Array.of(p[0]), g: Float32Array.of(0.2), b: Float32Array.of(p[1]),
      clip: Uint16Array.of(0), clipTotal: 0 });
  });
  const m = ac.media();
  assert.ok(Math.abs(m.rgb[0] - 0.6) < 1e-6);
  assert.ok(m.sigma.rgb[0] < 1e-6, `got ${m.sigma.rgb[0]}`);
  assert.ok(m.sigma.r[0] > 0.1);
});

test("a response file keeps the channel it was measured on", () => {
  const c = { nm: Float64Array.of(450, 650), k: Float64Array.of(1.5, 0.8) };
  assert.equal(leCoeficientes(escreveCoeficientes(c, { channel: "rgb" })).canal, "rgb");
  assert.equal(leCoeficientes(escreveCoeficientes(c, {})).canal, undefined);
});
