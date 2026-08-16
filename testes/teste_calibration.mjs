import test from "node:test";
import assert from "node:assert/strict";
import { ajusta, toNm, toPx, eixo, dispersao, confere, LINHAS, DUBLETO_HG }
  from "../web/js/nucleo/calibration.js";
import { acha } from "../web/js/nucleo/peaks.js";
import { polyval } from "../web/js/nucleo/num.js";

/* The instrument this test pretends to be: 1280 columns spanning 350 to 778 nm,
   with the curvature a small transmission grating really has. */
const VERDADE = [350, 0.35, -1.2e-5];
const NCOL = 1280;
const lambda = (p) => polyval(VERDADE, p);
const CAL_VERDADE = { coef: VERDADE };

/* The mercury lines of a ceiling fluorescent tube, which is the calibration
   source this bench actually has. */
const LINHAS_HG = [404.66, 435.83, 546.07, DUBLETO_HG, 611.60];

test("the synthetic instrument is monotone across its whole range", () => {
  for (let p = 1; p < NCOL; p++) {
    assert.ok(lambda(p) > lambda(p - 1), `not monotone at column ${p}`);
  }
});

test("toPx inverts toNm", () => {
  LINHAS_HG.forEach((nm) => {
    const p = toPx(CAL_VERDADE, nm, NCOL);
    assert.ok(Math.abs(lambda(p) - nm) < 1e-6, `${nm} nm came back as ${lambda(p)}`);
  });
  assert.ok(Number.isNaN(toPx(CAL_VERDADE, 300, NCOL)), "outside the range is NaN");
  assert.ok(Number.isNaN(toPx(CAL_VERDADE, 900, NCOL)), "outside the range is NaN");
});

test("an exact fit recovers the instrument to the last digit", () => {
  const pontos = LINHAS_HG.map((nm) => ({ px: toPx(CAL_VERDADE, nm, NCOL), nm: nm }));
  const cal = ajusta(pontos, 2);
  for (let k = 0; k < 3; k++) {
    const rel = Math.abs(cal.coef[k] - VERDADE[k]) / Math.abs(VERDADE[k]);
    assert.ok(rel < 1e-8, `coefficient ${k}: ${cal.coef[k]} against ${VERDADE[k]}`);
  }
  const ax = eixo(cal, NCOL);
  let pior = 0;
  for (let p = 0; p < NCOL; p++) pior = Math.max(pior, Math.abs(ax[p] - lambda(p)));
  assert.ok(pior < 1e-6, `worst error across the axis: ${pior} nm`);
  assert.ok(cal.rms < 1e-9, `rms ${cal.rms}`);
});

test("the polynomial order is doing real work", () => {
  /* Counter-check. If the order were ignored, these two would be equal and this
     whole test file would be measuring nothing. */
  const pontos = LINHAS_HG.map((nm) => ({ px: toPx(CAL_VERDADE, nm, NCOL), nm: nm }));
  const grau1 = ajusta(pontos, 1);
  const grau2 = ajusta(pontos, 2);
  assert.ok(grau1.rms > 0.05, `a straight line through a curved instrument should
    leave a visible residual, got ${grau1.rms} nm`);
  assert.ok(grau2.rms < grau1.rms / 20, `order 2 rms ${grau2.rms} against order 1 ${grau1.rms}`);
});

/* Builds the spectrum the camera would actually deliver: Gaussian lines on a
   smooth background, with reproducible noise. */
function espectroSintetico() {
  const y = new Float32Array(NCOL);
  const alturas = [1.0, 0.8, 0.9, 0.6, 0.5];
  const sigma = 3;
  for (let i = 0; i < NCOL; i++) y[i] = 0.05 + 0.03 * Math.sin(i / 400);
  LINHAS_HG.forEach((nm, k) => {
    const c = toPx(CAL_VERDADE, nm, NCOL);
    for (let i = 0; i < NCOL; i++) {
      y[i] += alturas[k] * Math.exp(-((i - c) ** 2) / (2 * sigma * sigma));
    }
  });
  let semente = 20260816;
  for (let i = 0; i < NCOL; i++) {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    y[i] += 0.005 * (semente / 0x7fffffff - 0.5);
  }
  return y;
}

test("the whole calibration path survives a synthetic spectrum", () => {
  /* Peak finding, sub-pixel refinement and the fit, end to end, exactly as the
     operator drives it: see five lines, name them, press fit. */
  const y = espectroSintetico();
  const picos = acha(y);
  assert.equal(picos.length, LINHAS_HG.length, `found ${picos.length} lines`);

  picos.forEach((p, k) => {
    const esperado = toPx(CAL_VERDADE, LINHAS_HG[k], NCOL);
    assert.ok(Math.abs(p.px - esperado) < 0.2,
      `line ${k}: found at column ${p.px}, truth ${esperado}`);
  });

  const pontos = picos.map((p, k) => ({ px: p.px, nm: LINHAS_HG[k] }));
  const cal = ajusta(pontos, 2, { n_col: NCOL });

  assert.ok(cal.rms < 0.1, `fit rms ${cal.rms} nm`);
  const ax = eixo(cal, NCOL);
  let pior = 0;
  for (let p = 0; p < NCOL; p++) pior = Math.max(pior, Math.abs(ax[p] - lambda(p)));
  assert.ok(pior < 0.5, `worst wavelength error across the axis: ${pior} nm`);
});

test("a line held out of the fit lands where it should", () => {
  /* This is the acceptance test the manual asks the operator to run: fit on the
     mercury lines, leave the wide europium band out, and see where it falls.
     A point not in the fit cannot be flattered by it. */
  const y = espectroSintetico();
  const picos = acha(y);
  const pontos = picos.map((p, k) => ({
    px: p.px, nm: LINHAS_HG[k], usar: LINHAS_HG[k] !== 611.60,
  }));
  const cal = ajusta(pontos, 2);
  assert.equal(cal.n, 4, "only the four mercury lines were fitted");
  assert.equal(cal.residuos.length, 5, "every point gets a residual, fitted or not");
  const guardado = cal.residuos[4];
  assert.ok(Math.abs(guardado) < 1.0,
    `the held-out line missed by ${guardado} nm`);
});

test("the fit refuses too few points instead of returning a singular answer", () => {
  const pontos = [{ px: 100, nm: 420 }, { px: 500, nm: 530 }];
  assert.throws(() => ajusta(pontos, 2), /needs at least 3 points/);
  assert.throws(() => ajusta(pontos, 3), /needs at least 4 points/);
  ajusta(pontos, 1);                       // two points do make a line
});

test("points switched off do not count towards the minimum", () => {
  const pontos = [
    { px: 100, nm: 420 }, { px: 500, nm: 530 }, { px: 900, nm: 640, usar: false },
  ];
  assert.throws(() => ajusta(pontos, 2), /needs at least 3 points/);
});

test("dispersion reports the nanometres a single column is worth", () => {
  const cal = { coef: VERDADE };
  const d = dispersao(cal, NCOL);
  const analitico = VERDADE[1] + 2 * VERDADE[2] * (NCOL >> 1);
  assert.ok(Math.abs(d - analitico) < 1e-9, `got ${d}`);
  assert.ok(d > 0.2 && d < 0.5, `about a third of a nanometre per column, got ${d}`);
});

test("a calibration knows it does not belong to a changed setup", () => {
  const cal = { coef: VERDADE, n_col: 1280, assinatura: "1280/720/0/300/1280/40/0.000" };
  assert.equal(confere(cal, "1280/720/0/300/1280/40/0.000", 1280).length, 0);
  assert.equal(confere(cal, "1280/720/0/300/1280/40/0.000", 640).length, 1);
  assert.equal(confere(cal, "640/480/0/300/640/40/0.000", 1280).length, 1);
});

test("the mercury preset carries a line that is deliberately not fitted", () => {
  const f = LINHAS.fluorescent.pontos;
  assert.ok(f.some((p) => p.nm === 611.60 && p.ajuste === false),
    "the wide europium band must be offered as a check, not as a fit point");
  assert.ok(f.some((p) => p.nm === 546.07 && p.ajuste === true));
});

test("the yellow mercury doublet has a documented single-peak value", () => {
  /* 576.96 and 579.07 nm are 2.1 nm apart and almost nothing homemade resolves
     them. Marking the blurred hump as either line writes a 1 nm error into the
     fit before it starts. */
  assert.ok(DUBLETO_HG > 576.96 && DUBLETO_HG < 579.07);
});
