import test from "node:test";
import assert from "node:assert/strict";
import { Filtro, extract, makeLut, makeRoi } from "../web/js/nucleo/frame.js";

/* A line in the shape extract() returns, every channel at the same values. */
function linha(valores, clip) {
  const v = Float32Array.from(valores);
  return {
    r: v, g: v, b: v, lum: v,
    clip: Uint16Array.from(clip || valores.map(function () { return 0; })),
    clipTotal: (clip || []).reduce(function (a, b) { return a + b; }, 0),
  };
}

test("the block filter gives one mean every N frames", () => {
  const f = new Filtro(2, "bloco", 3);
  assert.equal(f.poe(linha([1, 2])), null);
  assert.equal(f.poe(linha([2, 4])), null);
  const m = f.poe(linha([3, 6]));
  assert.deepEqual(Array.from(m.g), [2, 4]);
  assert.equal(m.n_quadros, 3);
  assert.equal(f.poe(linha([9, 9])), null, "a new block starts empty");
});

test("the exponential filter gives a spectrum on every frame and settles", () => {
  const f = new Filtro(1, "exp", 4);
  let m = f.poe(linha([0]));
  assert.equal(m.g[0], 0);
  /* A step from 0 to 1. The first frames are a plain mean, so the start is not
     dragged towards an initial value that was never measured. */
  for (let k = 0; k < 40; k++) m = f.poe(linha([1]));
  assert.ok(Math.abs(m.g[0] - 1) < 1e-3, `got ${m.g[0]}`);
  assert.equal(m.n_quadros, 4);
});

test("the exponential filter reaches 1 - 1/e of a step in about N frames", () => {
  const N = 10, f = new Filtro(1, "exp", N);
  for (let k = 0; k < 200; k++) f.poe(linha([0]));
  let m;
  for (let k = 0; k < N; k++) m = f.poe(linha([1]));
  const esperado = 1 - Math.pow(1 - 1 / N, N);      // 0.651 for N = 10
  assert.ok(Math.abs(m.g[0] - esperado) < 1e-6, `got ${m.g[0]}`);
});

test("peak hold keeps a one-frame flash", () => {
  const f = new Filtro(3, "pico", 16);
  f.poe(linha([0.1, 0.1, 0.1]));
  f.poe(linha([0.1, 0.9, 0.1]));                    // the flash
  const m = f.poe(linha([0.1, 0.1, 0.2]));
  assert.deepEqual(Array.from(m.g, function (v) { return +v.toFixed(3); }), [0.1, 0.9, 0.2]);
  f.limpa();
  assert.equal(f.poe(linha([0.1, 0.1, 0.1])).g[1].toFixed(3), "0.100", "reset forgets the flash");
});

test("a clip stays flagged while it still weighs on the running mean", () => {
  const f = new Filtro(1, "exp", 2);
  assert.equal(f.poe(linha([1], [5])).clip[0], 1);
  for (let k = 0; k < 5; k++) assert.equal(f.poe(linha([0.5])).clip[0], 1, `frame ${k}`);
  assert.equal(f.poe(linha([0.5])).clip[0], 0, "gone after 3N frames");
});

test("peak hold never forgets a clip until reset", () => {
  const f = new Filtro(1, "pico", 2);
  f.poe(linha([1], [5]));
  for (let k = 0; k < 20; k++) f.poe(linha([0.5]));
  assert.equal(f.poe(linha([0.5])).clipTotal, 1);
});

test("an unknown filter is refused", () => {
  assert.throws(() => new Filtro(1, "mediana", 3), /unknown filter/);
});

test("extract reports the highest raw code value it read", () => {
  const W = 8, H = 4, d = new Uint8ClampedArray(W * H * 4).fill(10);
  d[(2 * W + 3) * 4 + 1] = 211;                     // one green pixel
  const s = extract({ data: d, width: W, height: H }, makeRoi(0, 0, W, H, 0), makeLut());
  assert.equal(s.pico, 211);
});
