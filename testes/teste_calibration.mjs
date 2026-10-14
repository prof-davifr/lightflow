import test from "node:test";
import assert from "node:assert/strict";
import { ajusta, toNm, toPx, eixo, dispersao, confere, nomeia, avalia, sinal, ordemAuto,
  LINHAS, DUBLETO_HG } from "../web/js/nucleo/calibration.js";
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

/* ------------------------------------------------ naming the marked peaks */

/* The columns where each preset line lands on the synthetic instrument, in the
   order of the preset. */
const PRESET_HG = LINHAS.fluorescent.pontos;
const colunaDe = (nm) => toPx(CAL_VERDADE, nm, NCOL);

test("the preset offers the unresolved yellow pair as one line at its midpoint", () => {
  /* As two lines the pair took two names: the hump got 576.96 and the europium
     band, one peak further, got 579.07. The fit still looked fine. */
  const nms = PRESET_HG.map((p) => p.nm);
  assert.ok(nms.includes(DUBLETO_HG));
  assert.ok(!nms.includes(576.96) && !nms.includes(579.07));
});

test("nomeia names every visible line of the lamp", () => {
  const pxs = PRESET_HG.map((p) => colunaDe(p.nm) + 0.1);
  const r = nomeia(pxs, PRESET_HG);
  assert.deepEqual(r.linhas.map((l) => l.nm), PRESET_HG.map((p) => p.nm));
  assert.equal(r.crescente, true);
  assert.equal(r.ambiguo, false);
});

test("nomeia is not shifted by a faint line that was never marked", () => {
  /* The violet line is weak on a webcam, so "strongest unused peak" marks the
     other four first. Naming in order called the blue line violet. */
  const vistas = PRESET_HG.filter((p) => p.nm > 420);
  const pxs = vistas.map((p) => colunaDe(p.nm));
  const r = nomeia(pxs.slice().reverse(), PRESET_HG);   // marking order is irrelevant
  assert.deepEqual(r.linhas.map((l) => l.nm), vistas.map((p) => p.nm).reverse());
  assert.equal(r.ambiguo, false);
});

test("nomeia finds the red end on the left of the sensor", () => {
  const pxs = PRESET_HG.map((p) => NCOL - 1 - colunaDe(p.nm));
  const r = nomeia(pxs, PRESET_HG);
  assert.deepEqual(r.linhas.map((l) => l.nm), PRESET_HG.map((p) => p.nm));
  assert.equal(r.crescente, false);
});

test("nomeia says so when the spacing cannot tell the direction", () => {
  /* Three lasers on evenly spaced columns: mirrored, the pattern is the same. */
  const lasers = LINHAS.laser.pontos;
  const r = nomeia([200, 550, 900], lasers);
  assert.equal(r.ambiguo, true);
  assert.equal(r.crescente, true, "red on the right is the assumption kept");
});

test("nomeia refuses more peaks than lines, and a single peak", () => {
  assert.throws(() => nomeia([1, 2, 3, 4, 5, 6, 7, 8], PRESET_HG), /more marked peaks/);
  assert.throws(() => nomeia([100], PRESET_HG), /at least two peaks/);
});

test("the lamp calibrates to a fraction of a nanometre through the whole path", () => {
  /* The test that the old preset failed: a spectrum where the yellow pair is
     one hump, four peaks marked without the violet line, and the preset doing
     the naming. Before, the axis was 11 nm out at the red end. */
  const y = new Float32Array(NCOL);
  const linhas = [[404.66, 0.35, 4], [435.83, 0.75, 4], [546.07, 1.0, 4],
    [576.96, 0.45, 4], [579.07, 0.45, 4], [611.60, 0.8, 7]];
  for (let i = 0; i < NCOL; i++) y[i] = 0.03;
  linhas.forEach(([nm, h, s]) => {
    const c = colunaDe(nm);
    for (let i = 0; i < NCOL; i++) y[i] += h * Math.exp(-((i - c) ** 2) / (2 * s * s));
  });
  const picos = acha(y).sort((a, b) => b.prom - a.prom).slice(0, 4);
  assert.ok(!picos.some((p) => Math.abs(p.px - colunaDe(404.66)) < 5),
    "the violet line should be the one left out, as on the bench");

  const r = nomeia(picos.map((p) => p.px), PRESET_HG);
  const pontos = picos.map((p, k) => ({
    px: p.px, nm: r.linhas[k].nm, usar: r.linhas[k].ajuste !== false,
  }));
  const cal = ajusta(pontos, 2);
  const ax = eixo(cal, NCOL);
  let pior = 0;
  for (let p = colunaDe(420); p < colunaDe(620); p++) {
    pior = Math.max(pior, Math.abs(ax[Math.round(p)] - lambda(Math.round(p))));
  }
  assert.ok(pior < 0.5, `worst error from 420 to 620 nm: ${pior} nm`);
});

test("nomeia keeps the direction it is given when the spacing cannot tell", () => {
  const lasers = LINHAS.laser.pontos;
  const r = nomeia([200, 550, 900], lasers, { crescente: false });
  assert.equal(r.ambiguo, true);
  assert.equal(r.crescente, false);
  assert.deepEqual(r.linhas.map((l) => l.nm), [650, 532, 405]);
});

test("nomeia leaves out a peak that is no line of the source", () => {
  const vistas = PRESET_HG.filter((p) => p.nm > 420);
  const pxs = vistas.map((p) => colunaDe(p.nm));
  pxs.push(colunaDe(660));                     // a line the lamp does not have
  const r = nomeia(pxs, PRESET_HG);
  assert.ok(r.confiavel);
  assert.equal(r.fora, pxs.length - 1);
  assert.equal(r.linhas[r.fora], null);
  assert.deepEqual(r.linhas.slice(0, -1).map((l) => l.nm), vistas.map((p) => p.nm));
});

test("nomeia says when no naming fits", () => {
  const r = nomeia([100, 130, 400, 410, 1000], PRESET_HG);
  assert.equal(r.confiavel, false);
  assert.ok(r.rmsCol > 3);
});

test("avalia trusts a fit whose checks land where they belong", () => {
  const pontos = [404.66, 435.83, 546.07, DUBLETO_HG, 611.60].map((nm) => ({
    px: colunaDe(nm), nm: nm, usar: nm !== 611.60,
  }));
  const av = avalia(ajusta(pontos, 2), NCOL);
  assert.equal(av.suspeita, false);
  assert.deepEqual(av.avisos, []);
});

test("avalia catches a wrong name the rms cannot see", () => {
  /* Three fitted points and order 2: the fit is exact whatever the names. */
  const pontos = [
    { px: colunaDe(435.83), nm: 435.83 },
    { px: colunaDe(546.07), nm: 546.07 },
    { px: colunaDe(587.60), nm: DUBLETO_HG },   // the terbium band, misnamed
    { px: colunaDe(611.60), nm: 611.60, usar: false },
  ];
  const cal = ajusta(pontos, 2);
  assert.ok(cal.rms < 1e-6);
  const av = avalia(cal, NCOL);
  assert.equal(av.suspeita, true);
  assert.match(av.motivos[0], /611\.6 nm/);
  assert.match(av.avisos[0], /says nothing/);
  assert.equal(av.piorCheck.nm, 611.60);
  assert.ok(Math.abs(av.piorCheck.residuo) > av.limite);
  assert.ok(Math.abs(av.limite - 3 * Math.abs(dispersao(cal, NCOL))) < 1e-9);
});

test("avalia reports no worst check when there is no check line", () => {
  const pontos = [435.83, 546.07, DUBLETO_HG].map((nm) => ({ px: colunaDe(nm), nm: nm }));
  assert.equal(avalia(ajusta(pontos, 1), NCOL).piorCheck, null);
});

test("the automatic order follows the ticked, named lines", () => {
  const p = (nm, usar) => ({ px: 0, nm: nm, usar: usar });
  assert.equal(ordemAuto([p(435.83), p(546.07)]), 1);
  assert.equal(ordemAuto([p(435.83), p(546.07), p(611.6, false)]), 1, "a check does not count");
  assert.equal(ordemAuto([p(404.66), p(435.83), p(546.07)]), 2);
  assert.equal(ordemAuto([p(404.66), p(435.83), p(546.07), p(DUBLETO_HG)]), 2, "never 3 by itself");
  assert.equal(ordemAuto([p(NaN), p(546.07)]), 1);
});

test("the calibration signal is R+G+B, whatever the measurement channel", () => {
  const m = { r: Float32Array.of(0.1, 0.5), g: Float32Array.of(0.2, 0.1), b: Float32Array.of(0.3, NaN) };
  const y = sinal(m);
  assert.ok(Math.abs(y[0] - 0.6) < 1e-6);
  assert.ok(Number.isNaN(y[1]), "a missing column stays missing");
});
