import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { faixaVertical, faixaHorizontal } from "../web/js/nucleo/frame.js";
import { acha } from "../web/js/nucleo/peaks.js";
import { LINHAS, DUBLETO_HG, sinal, nomeia, ajusta, avalia, toNm } from "../web/js/nucleo/calibration.js";

/* The calibration path against a real compact fluorescent lamp on this bench,
   not a synthetic one. The synthetic tube of the other tests has mercury and
   europium only; the real one also has terbium, a second order beside the
   first, and curved lines, and every one of those broke the calibration while
   the synthetic tests passed. testes/dados/LEIAME.md says where the data comes
   from.

   Where the lines are, in image columns at the middle of the slit, from the
   europium band and the two mercury lines either side of it, and checked
   against two lines left out: violet 404.66 at column 830.7 lands 1.0 nm low
   and terbium 487.7 lands 1.1 nm low, which is the green point sitting about a
   nanometre low under its terbium neighbour. */
const COLUNA = { 611.6: 610.4, 587.6: 636.3, 546.07: 680.4, 487.7: 743.5, 435.83: 797, 404.66: 830.7 };
const SEGUNDA_ORDEM = [0, 330];

const dados = JSON.parse(fs.readFileSync(new URL("dados/cfl_2026-10-13.json", import.meta.url)));
const N = dados.largura;

function exposicao(ms) {
  const x = Object.values(dados.exposicoes).find((e) => e.ms === ms);
  const m = { r: Float32Array.from(x.r), g: Float32Array.from(x.g), b: Float32Array.from(x.b) };
  return Object.assign({}, x, { m: m, s: sinal(m), faixa: faixaHorizontal(Float64Array.from(x.perfilColunas)) });
}

/* "Add the strongest unused peak", pressed `n` times inside the strip. */
function marca(e, n) {
  const { x, w } = e.faixa;
  return acha(e.s.slice(x, x + w)).sort((a, b) => b.prom - a.prom).slice(0, n).map((p) => p.px + x);
}

function perto(px, nm) { return Math.abs(px - COLUNA[nm]) < 3; }

test("the strip goes to the middle of the slit image, not to its brightest band", () => {
  /* The brightest 61 rows were a dusty band at the bottom edge, rows 565 to
     625, where the curved lines lean the most. The green line sits 4 columns
     further left there than in the middle. */
  for (const ms of [160, 640]) {
    const y = exposicao(ms).y;
    assert.ok(y > 400 && y < 470, `rows ${y} to ${y + 60}`);
    assert.equal(faixaVertical(Float64Array.from(exposicao(ms).perfilLinhas), dados.h), y);
  }
});

test("the strip keeps the first order and leaves the second out", () => {
  for (const ms of [160, 640]) {
    const { x, w } = exposicao(ms).faixa;
    assert.ok(x > SEGUNDA_ORDEM[1], `starts at column ${x}, inside the second order`);
    assert.ok(x < COLUNA[611.6] - 30 && x + w > COLUNA[404.66] + 10,
      `columns ${x} to ${x + w - 1} must hold 611.6 nm and the violet line`);
  }
});

test("green alone shows one line of the lamp; R+G+B shows four", () => {
  /* Why the calibration screen does not use the measurement channel. */
  const e = exposicao(160);
  const { x, w } = e.faixa;
  assert.equal(acha(e.m.g.slice(x, x + w)).length, 1);
  const todas = marca(e, 9);
  [611.6, 546.07, 487.7, 435.83].forEach((nm) => {
    assert.ok(todas.some((px) => perto(px, nm)), nm + " nm not found");
  });
});

test("five peaks of the real lamp get their real names", () => {
  const pxs = marca(exposicao(640), 5);
  const r = nomeia(pxs, LINHAS.fluorescent.pontos);
  assert.ok(r.confiavel && !r.ambiguo);
  assert.equal(r.crescente, false, "red is on the left on this bench");
  pxs.forEach((px, k) => {
    assert.ok(perto(px, r.linhas[k].nm), `column ${px.toFixed(1)} named ${r.linhas[k].nm}`);
  });
  assert.ok(r.linhas.some((l) => l.nm === 587.6),
    "the terbium band beside the mercury pair is named as terbium");
});

test("the fit through the named lamp passes its own checks", () => {
  const pxs = marca(exposicao(640), 5);
  const r = nomeia(pxs, LINHAS.fluorescent.pontos);
  const pontos = pxs.map((px, k) => ({ px: px, nm: r.linhas[k].nm, usar: r.linhas[k].ajuste !== false }));
  const cal = ajusta(pontos, 1);
  const av = avalia(cal, N);
  assert.equal(av.suspeita, false, av.motivos.join("; "));
  cal.pontos.forEach((p, k) => {
    if (p.usar === false) assert.ok(Math.abs(cal.residuos[k]) < 2, `${p.nm} nm off by ${cal.residuos[k]}`);
  });
});

test("the old naming of the terbium band as the mercury pair is caught", () => {
  /* What the screen used to do: 587.6 named 578.01, three fitted points, order
     2, rms 0, "calibrated" — and the europium check 18 nm out. */
  const nomes = { 611.6: 611.6, 587.6: DUBLETO_HG, 546.07: 546.07, 435.83: 435.83 };
  const pontos = Object.keys(nomes).map((k) => ({ px: COLUNA[k], nm: nomes[k], usar: nomes[k] !== 611.6 }));
  const cal = ajusta(pontos, 2);
  assert.ok(cal.rms < 1e-6, "an exact fit, whose rms proves nothing");
  assert.ok(Math.abs(toNm(cal, COLUNA[611.6]) - 611.6) > 10);
  const av = avalia(cal, N);
  assert.equal(av.suspeita, true);
  assert.match(av.motivos.join(" "), /611\.6/);
  assert.match(av.avisos.join(" "), /says nothing/);
});

test("three peaks are ambiguous, and the bench's direction picks the right names", () => {
  /* 404.66, 435.83 and 487.7 nm fit these three columns as straight as the
     right names, at half the dispersion. */
  const pxs = marca(exposicao(640), 3);
  const r = nomeia(pxs, LINHAS.fluorescent.pontos, { crescente: false });
  assert.equal(r.ambiguo, true);
  pxs.forEach((px, k) => assert.ok(perto(px, r.linhas[k].nm)));
});

test("a second-order peak among five is left unnamed", () => {
  const e = exposicao(640);
  const pxs = acha(e.s).sort((a, b) => b.prom - a.prom).slice(0, 5).map((p) => p.px);
  const fora = pxs.findIndex((px) => px < SEGUNDA_ORDEM[1]);
  assert.ok(fora >= 0, "the full width does carry a second-order peak");
  const r = nomeia(pxs, LINHAS.fluorescent.pontos);
  assert.ok(r.confiavel);
  assert.equal(r.fora, fora);
  assert.equal(r.linhas[fora], null);
});

test("peaks that no subset can name are refused, not named", () => {
  /* Seven peaks with two europium bands the preset does not list. */
  const pxs = marca(exposicao(640), 7);
  const r = nomeia(pxs, LINHAS.fluorescent.pontos);
  assert.equal(r.confiavel, false);
});
