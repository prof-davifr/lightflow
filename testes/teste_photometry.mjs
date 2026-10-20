import test from "node:test";
import assert from "node:assert/strict";
import {
  absorbance, transmittance, emission, fluorescence, calcula, aMax,
  confereEscuro, confereReferencia,
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
  /* NaN becomes a gap on the screen and an empty field in a file. Infinity
     would be drawn as a full-height vertical stroke that reads as an enormous
     real peak. */
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

/* What the bench did: dark and reference both taken on the calibration lamp. */
test("a dark taken with the lamp on is reported", () => {
  const D = quadro("g", [0.002, 0.40, 0.003]);
  assert.match(confereEscuro(D, "g"), /not dark: it reaches 40 %/);
});

test("a dark that clips is reported even when its mean is low", () => {
  const D = quadro("g", [0.001, 0.002, 0.001], { clip: Uint16Array.from([0, 3, 0]) });
  assert.match(confereEscuro(D, "g"), /clips in 1 columns/);
});

test("a covered slit passes the dark check", () => {
  assert.equal(confereEscuro(quadro("g", [0, 0.001, 0.004]), "g"), null);
});

test("a reference on a line lamp is reported with its count of usable columns", () => {
  /* Two lit columns out of eight, like the lines of a fluorescent tube. */
  const D = quadro("g", new Array(8).fill(0.001), { sigma: new Array(8).fill(0.0005) });
  const R = quadro("g", [0.001, 0.6, 0.001, 0.001, 0.001, 0.3, 0.001, 0.001]);
  const r = confereReferencia(R, D, "g");
  assert.equal(r.uteis, 2);
  assert.match(r.aviso, /only 2 of 8 columns/);
});

test("a dark equal to the reference leaves no usable column", () => {
  const v = [0.2, 0.6, 0.4, 0.3];
  const r = confereReferencia(quadro("g", v), quadro("g", v, { sigma: [0, 0, 0, 0] }), "g");
  assert.equal(r.uteis, 0);
  assert.ok(r.aviso);
});

test("a continuous reference over a covered dark passes", () => {
  const D = quadro("g", [0, 0, 0, 0], { sigma: [0, 0, 0, 0] });
  const R = quadro("g", [0.1, 0.5, 0.7, 0.2]);
  const r = confereReferencia(R, D, "g");
  assert.equal(r.uteis, 4);
  assert.equal(r.aviso, null);
});

test("a noiseless dark still needs the reference above the noise floor", () => {
  /* A covered sensor often reads 0 on every frame, so 3 sigma is 0 and any
     stray code value would count as light without the floor. */
  const D = quadro("g", [0, 0, 0], { sigma: [0, 0, 0] });
  const r = confereReferencia(quadro("g", [0.0005, 0.0005, 0.5]), D, "g");
  assert.equal(r.uteis, 1);
});

test("absorbance is empty where the reference is lost in the dark noise", () => {
  /* Column 1: R - D = 0.004, under 3 sigma = 0.006. The ratio would be a number,
     and a large one, but it is noise divided by noise. */
  const D = quadro("g", [0.01, 0.01], { sigma: [0.002, 0.002] });
  const R = quadro("g", [0.51, 0.014]);
  const S = quadro("g", [0.26, 0.011]);
  const A = absorbance(S, D, R, "g");
  assert.ok(Math.abs(A[0] - Math.log10(2)) < 1e-6, `got ${A[0]}`);
  assert.ok(Number.isNaN(A[1]));
  assert.ok(Number.isNaN(transmittance(S, D, R, "g")[1]));
});

test("a noiseless dark still masks a reference under the noise floor", () => {
  const D = quadro("g", [0, 0], { sigma: [0, 0] });
  const R = quadro("g", [0.5, 0.001]);
  const A = absorbance(quadro("g", [0.5, 0.001]), D, R, "g");
  assert.ok(Math.abs(A[0]) < 1e-6);
  assert.ok(Number.isNaN(A[1]));
});

test("aMax of a noiseless dark uses the noise floor, not an infinite ceiling", () => {
  /* A covered sensor reading 0 on every frame: sigma 0. log10(0.5 / 0.002). */
  const D = quadro("g", [0, 0], { sigma: [0, 0] });
  const a = aMax(D, quadro("g", [0.5, 0.5]), "g");
  assert.ok(Math.abs(a - Math.log10(250)) < 1e-6, `got ${a}`);
});
