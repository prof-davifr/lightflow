import test from "node:test";
import assert from "node:assert/strict";
import {
  absorbance, transmittance, emission, fluorescence, calcula, aMax,
} from "../web/js/nucleo/photometry.js";

/* A minimal frame in the shape that frame.js Acumulador.media() produces. */
function quadro(canal, valores, opc) {
  opc = opc || {};
  const n = valores.length;
  const q = { clip: opc.clip || new Uint16Array(n), n_quadros: 1, sigma: {} };
  q[canal] = Float32Array.from(valores);
  if (opc.sigma) q.sigma[canal] = Float32Array.from(opc.sigma);
  return q;
}

test("absorbance of a half-transmitting sample is log10(2)", () => {
  /* D = 0.10, R = 1.10, S = 0.60  →  (S-D)/(R-D) = 0.5  →  A = 0.30103 */
  const A = absorbance(quadro("g", [0.60]), quadro("g", [0.10]), quadro("g", [1.10]), "g");
  /* The frames are Float32Array, so about seven decimal digits survive. Asking
     for more than that tests the storage format, not the arithmetic. */
  assert.ok(Math.abs(A[0] - Math.log10(2)) < 1e-6, `got ${A[0]}`);
});

test("absorbance of exactly one is recovered exactly", () => {
  const R = 0.8, D = 0.05;
  const S = D + (R - D) * Math.pow(10, -1);
  const A = absorbance(quadro("g", [S]), quadro("g", [D]), quadro("g", [R]), "g");
  assert.ok(Math.abs(A[0] - 1) < 1e-6, `got ${A[0]}`);
});

test("absorbance is zero when the sample equals the reference", () => {
  const A = absorbance(quadro("g", [0.7]), quadro("g", [0.1]), quadro("g", [0.7]), "g");
  assert.ok(Math.abs(A[0]) < 1e-6, `got ${A[0]}`);
});

test("absorbance gives NaN, never Infinity, on a dead sample", () => {
  /* uPlot draws NaN as a gap and Infinity as a full-height vertical stroke that
     reads as an enormous real peak. */
  const A = absorbance(quadro("g", [0.05]), quadro("g", [0.05]), quadro("g", [0.9]), "g");
  assert.ok(Number.isNaN(A[0]), `got ${A[0]}`);
  assert.ok(!Number.isFinite(A[0]) && !(A[0] === Infinity));
});

test("absorbance gives NaN when the reference is not above the dark", () => {
  const A = absorbance(quadro("g", [0.5]), quadro("g", [0.6]), quadro("g", [0.6]), "g");
  assert.ok(Number.isNaN(A[0]));
});

test("a clipped column is NaN in every mode", () => {
  const clip = Uint16Array.from([3]);
  const S = quadro("g", [0.6], { clip: clip });
  const D = quadro("g", [0.1]);
  const R = quadro("g", [1.1]);
  assert.ok(Number.isNaN(absorbance(S, D, R, "g")[0]));
  assert.ok(Number.isNaN(transmittance(S, D, R, "g")[0]));
  assert.ok(Number.isNaN(emission(S, D, "g")[0]));
  assert.ok(Number.isNaN(fluorescence(S, D, R, "g")[0]));
});

test("clipping anywhere in the chain poisons the column, not just the sample", () => {
  const R = quadro("g", [1.1], { clip: Uint16Array.from([1]) });
  const A = absorbance(quadro("g", [0.6]), quadro("g", [0.1]), R, "g");
  assert.ok(Number.isNaN(A[0]), "a saturated reference is still a saturated measurement");
});

test("transmittance is the same ratio in percent", () => {
  const T = transmittance(quadro("g", [0.60]), quadro("g", [0.10]), quadro("g", [1.10]), "g");
  assert.ok(Math.abs(T[0] - 50) < 1e-5, `got ${T[0]}`);
});

test("emission removes the dark and nothing else", () => {
  const E = emission(quadro("b", [0.42]), quadro("b", [0.02]), "b");
  assert.ok(Math.abs(E[0] - 0.40) < 1e-7);
});

test("fluorescence subtracts the blank rather than dividing by it", () => {
  /* The classic error is reaching for the absorbance formula. The blank carries
     solvent emission and scattered excitation, and both are additive. */
  const S = quadro("g", [0.50]), D = quadro("g", [0.02]), B = quadro("g", [0.12]);
  const F = fluorescence(S, D, B, "g");
  assert.ok(Math.abs(F[0] - 0.38) < 1e-7, `got ${F[0]}`);
  assert.ok(Math.abs(F[0] - (0.50 - 0.02) / (0.12 - 0.02)) > 1, "must not be a ratio");
});

test("mixing channels throws instead of returning a plausible number", () => {
  /* Sample in green, reference in luminance. The arithmetic would succeed and
     the curve would look completely normal. */
  const S = quadro("g", [0.6]);
  const D = quadro("g", [0.1]);
  const R = quadro("lum", [1.1]);
  assert.throws(() => absorbance(S, D, R, "g"), /reference has no channel/);
});

test("an unknown channel throws", () => {
  assert.throws(() => absorbance(quadro("g", [1]), quadro("g", [0]), quadro("g", [1]), "x"),
    /unknown channel/);
});

test("calcula routes every mode to the same answer as the direct call", () => {
  const q = {
    amostra: quadro("g", [0.60]), escuro: quadro("g", [0.10]),
    referencia: quadro("g", [1.10]), branco: quadro("g", [0.20]),
  };
  assert.equal(calcula("absorbance", q, "g")[0], absorbance(q.amostra, q.escuro, q.referencia, "g")[0]);
  assert.equal(calcula("transmittance", q, "g")[0], transmittance(q.amostra, q.escuro, q.referencia, "g")[0]);
  assert.equal(calcula("emission", q, "g")[0], emission(q.amostra, q.escuro, "g")[0]);
  assert.equal(calcula("fluorescence", q, "g")[0], fluorescence(q.amostra, q.escuro, q.branco, "g")[0]);
  assert.throws(() => calcula("nonsense", q, "g"), /unknown mode/);
});

test("aMax reports the honest ceiling from the dark noise", () => {
  /* R-D = 1.0 and sigma = 0.001 give A_max = log10(1/0.003) = 2.52 */
  const D = quadro("g", [0.0, 0.0, 0.0], { sigma: [0.001, 0.001, 0.001] });
  const R = quadro("g", [1.0, 1.0, 1.0]);
  const a = aMax(D, R, "g");
  assert.ok(Math.abs(a - Math.log10(1 / 0.003)) < 1e-5, `got ${a}`);
  assert.ok(a < 3, "an 8-bit camera cannot honestly reach A = 3");
});

test("aMax is NaN without a measured dark spread", () => {
  assert.ok(Number.isNaN(aMax(quadro("g", [0]), quadro("g", [1]), "g")));
});
