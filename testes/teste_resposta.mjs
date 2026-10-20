import test from "node:test";
import assert from "node:assert/strict";
import {
  leCoeficientes, escreveCoeficientes, coeficientesEm, aplica, planck, deLampada,
} from "../web/js/nucleo/resposta.js";
import { rgbDe } from "../web/js/nucleo/cor.js";

test("reads the CSV this program writes", () => {
  const c = leCoeficientes("# comment\nwavelength_nm,coefficient\n450,2.5\n550,1\n650,1.75\n");
  assert.deepEqual(Array.from(c.nm), [450, 550, 650]);
  assert.deepEqual(Array.from(c.k), [2.5, 1, 1.75]);
});

test("reads whitespace pairs with a decimal comma", () => {
  const c = leCoeficientes("450 2,5\n550\t1\n650;1,75\n");
  assert.deepEqual(Array.from(c.k), [2.5, 1, 1.75]);
});

test("writing and reading gives the same curve back", () => {
  const c = { nm: Float64Array.from([400.5, 500, 700]), k: Float64Array.from([3.25, 1, 0.5]) };
  const d = leCoeficientes(escreveCoeficientes(c, { lamp: "halogen 3000 K" }));
  assert.deepEqual(Array.from(d.nm), Array.from(c.nm));
  assert.deepEqual(Array.from(d.k), Array.from(c.k));
});

test("a file that cannot be a response curve is refused", () => {
  assert.throws(() => leCoeficientes("550,1\n"), /at least two/);
  assert.throws(() => leCoeficientes("550,1\n500,1\n"), /must rise/);
  assert.throws(() => leCoeficientes("500,1\n550,0\n"), /not between/);
  assert.throws(() => leCoeficientes("50,1\n550,1\n"), /outside what a webcam sees/);
});

test("interpolates inside the curve and leaves a gap outside it", () => {
  const c = { nm: Float64Array.from([500, 600]), k: Float64Array.from([2, 4]) };
  const k = coeficientesEm(c, [450, 500, 525, 600, 650]);
  assert.ok(Number.isNaN(k[0]));
  assert.equal(k[1], 2); assert.equal(k[2], 2.5); assert.equal(k[3], 4);
  assert.ok(Number.isNaN(k[4]));
});

test("interpolates on a falling axis too", () => {
  const c = { nm: Float64Array.from([500, 550, 600]), k: Float64Array.from([1, 2, 3]) };
  assert.deepEqual(Array.from(coeficientesEm(c, [590, 560, 510])).map(function (v) { return +v.toFixed(4); }), [2.8, 2.2, 1.2]);
});

test("aplica multiplies column by column", () => {
  assert.deepEqual(Array.from(aplica([1, 2, 3], [2, 0.5, NaN])).slice(0, 2), [2, 1]);
});

test("Planck peaks where Wien's law says", () => {
  /* Wien: lambda_max = 2.898e6 nm K / T. At 3000 K that is 966 nm. */
  let best = 0, nmBest = 0;
  for (let nm = 300; nm < 2000; nm++) { const v = planck(nm, 3000); if (v > best) { best = v; nmBest = nm; } }
  assert.ok(Math.abs(nmBest - 966) <= 1, `got ${nmBest}`);
});

test("a lamp seen through a known response gives that response back", () => {
  /* The bench passes 2x more at 500 nm than at 600 nm. The coefficient must
     be the inverse: half as large at 500. */
  const nms = [], S = [], D = [];
  for (let i = 0; i < 201; i++) {
    const nm = 450 + i;
    const resp = 1 + (600 - nm) / 100;                // 2 at 500, 1 at 600
    nms.push(nm); D.push(0.01);
    S.push(0.01 + 1e-15 * resp * planck(nm, 3000));
  }
  const c = deLampada(S, D, nms, 3000, { piso: 0 });
  const k = coeficientesEm(c, [500, 600]);
  assert.ok(Math.abs(k[1] / k[0] - 2) < 0.02, `ratio ${k[1] / k[0]}`);
});

test("columns where the lamp is lost in the dark are left out", () => {
  const nms = [500, 510, 520, 530], D = [0, 0, 0, 0];
  const c = deLampada([0.5, 0.001, 0.5, 0.5], D, nms, 3000, { piso: 0.02 });
  assert.ok(Array.from(c.nm).indexOf(510) < 0);
  assert.throws(() => deLampada([0, 0], [0, 0], [500, 600], 3000), /not above the dark/);
});

test("the colour ramp is red at 650, green at 530, blue at 450, black outside", () => {
  const [r1, g1, b1] = rgbDe(650); assert.ok(r1 > 200 && g1 === 0 && b1 === 0);
  const [r2, g2, b2] = rgbDe(530); assert.ok(g2 > 200 && b2 === 0 && r2 < 150);
  const [r3, g3, b3] = rgbDe(450); assert.ok(b3 > 200 && r3 === 0 && g3 < 100);
  assert.deepEqual(rgbDe(300), [0, 0, 0]);
  assert.deepEqual(rgbDe(900), [0, 0, 0]);
});

test("a line lamp is refused as a response source", () => {
  /* Two lit columns of ten, like the lines of a fluorescent tube. */
  const nms = [], S = [], D = [];
  for (let i = 0; i < 10; i++) { nms.push(500 + 10 * i); D.push(0); S.push(i === 3 || i === 7 ? 0.5 : 0); }
  assert.throws(() => deLampada(S, D, nms, 3000), /only 2 of 10 columns/);
});
