import test from "node:test";
import assert from "node:assert/strict";
import { solve, polyfit, polyval, mean, std, rms, interp } from "../web/js/nucleo/num.js";

test("solve handles a hand-computed 3x3 system", () => {
  /*  2x +  y -  z =  8
     -3x -  y + 2z = -11
     -2x +  y + 2z = -3      →  x = 2, y = 3, z = -1  */
  const x = solve([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  assert.ok(Math.abs(x[0] - 2) < 1e-12, "x");
  assert.ok(Math.abs(x[1] - 3) < 1e-12, "y");
  assert.ok(Math.abs(x[2] + 1) < 1e-12, "z");
});

test("solve needs pivoting and does it", () => {
  /* A zero in the first pivot position: without partial pivoting this divides
     by zero and returns NaN. */
  const x = solve([[0, 1], [1, 0]], [3, 5]);
  assert.ok(Math.abs(x[0] - 5) < 1e-12);
  assert.ok(Math.abs(x[1] - 3) < 1e-12);
});

test("solve refuses a singular system instead of returning NaN", () => {
  assert.throws(() => solve([[1, 2], [2, 4]], [3, 6]), /singular/);
});

test("polyfit recovers an exact polynomial", () => {
  const verdade = [350, 0.35, -1.2e-5];
  const xs = [0, 200, 400, 700, 1000, 1279];
  const ys = xs.map((p) => verdade[0] + verdade[1] * p + verdade[2] * p * p);
  const c = polyfit(xs, ys, 2);
  for (let k = 0; k < 3; k++) {
    const rel = Math.abs(c[k] - verdade[k]) / Math.abs(verdade[k]);
    assert.ok(rel < 1e-9, `coefficient ${k}: ${c[k]} vs ${verdade[k]}`);
  }
});

test("polyfit stays accurate on raw pixel indices", () => {
  /* This is the reason polyfit centres and scales x internally. A cubic in raw
     indices up to 1280 puts about 4e18 into the normal-equations matrix, and a
     naive fit loses the small coefficients entirely. */
  const verdade = [380, 0.31, -8e-6, 2.5e-9];
  const xs = [];
  for (let p = 0; p < 1280; p += 97) xs.push(p);
  const ys = xs.map((p) => polyval(verdade, p));
  const c = polyfit(xs, ys, 3);
  let pior = 0;
  for (let p = 0; p < 1280; p++) {
    pior = Math.max(pior, Math.abs(polyval(c, p) - polyval(verdade, p)));
  }
  assert.ok(pior < 1e-7, `worst wavelength error ${pior} nm`);
});

test("polyfit refuses fewer points than the order needs", () => {
  assert.throws(() => polyfit([1, 2], [3, 4], 2), /at least 3 points/);
});

test("polyfit refuses a degenerate x", () => {
  assert.throws(() => polyfit([5, 5, 5], [1, 2, 3], 1), /same value/);
});

test("polyval is Horner and agrees with the direct sum", () => {
  const c = [1, -2, 3, -4];
  const x = 1.7;
  const direto = c[0] + c[1] * x + c[2] * x * x + c[3] * x * x * x;
  assert.ok(Math.abs(polyval(c, x) - direto) < 1e-12);
});

test("mean, std and rms skip NaN", () => {
  const v = [1, 2, NaN, 3, 4];
  assert.equal(mean(v), 2.5);
  assert.ok(Math.abs(std(v) - Math.sqrt(5 / 3)) < 1e-12);
  assert.ok(Math.abs(rms([3, 4]) - Math.sqrt(12.5)) < 1e-12);
});

test("interp is linear inside and NaN outside", () => {
  const xs = [0, 1, 2], ys = [10, 20, 40];
  assert.equal(interp(xs, ys, 0.5), 15);
  assert.equal(interp(xs, ys, 1.25), 25);
  assert.ok(Number.isNaN(interp(xs, ys, -0.1)), "below the range");
  assert.ok(Number.isNaN(interp(xs, ys, 2.1)), "above the range");
});
