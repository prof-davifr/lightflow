import test from "node:test";
import assert from "node:assert/strict";
import { proximo, ALVO, JANELA } from "../web/js/nucleo/exposicao.js";
import { toLinear, fromLinear } from "../web/js/nucleo/frame.js";

const faixa = { min: 1, max: 10000, step: 1 };

/* A camera whose brightest pixel is proportional to the exposure, in linear
   light, through the sRGB curve — the model the search assumes. */
function camera(brilho) {
  return function (e) {
    const lin = Math.min(1, brilho * e);
    return Math.round(255 * fromLinear(lin));
  };
}

test("a peak inside the window is accepted as it is", () => {
  const r = proximo(300, 200, faixa);
  assert.equal(r.pronto, true);
  assert.equal(r.exposicao, 300);
});

test("a dim strip asks for a longer exposure, in proportion to linear light", () => {
  const r = proximo(100, 100, faixa);
  const esperado = 100 * toLinear(ALVO / 255) / toLinear(100 / 255);
  assert.equal(r.pronto, false);
  assert.ok(Math.abs(r.exposicao - esperado) <= 1, `got ${r.exposicao}, want ${esperado}`);
});

test("a clipped strip cuts the exposure by four", () => {
  const r = proximo(800, 255, faixa);
  assert.equal(r.exposicao, 200);
});

test("one step never jumps more than sixteen times", () => {
  assert.equal(proximo(10, 2, faixa).exposicao, 160);
});

test("the search converges on a model camera from either side", () => {
  for (const [brilho, inicio] of [[1e-4, 10], [5e-3, 5000], [2e-4, 300]]) {
    const cam = camera(brilho);
    let e = inicio, r, passos = 0;
    do { r = proximo(e, cam(e), faixa); e = r.exposicao; passos++; } while (!r.pronto && passos < 12);
    const p = cam(e);
    assert.ok(r.pronto, `did not settle from ${inicio}`);
    assert.ok(p >= JANELA[0] && p <= JANELA[1], `peak ${p} at exposure ${e}`);
    assert.ok(passos <= 6, `${passos} steps`);
  }
});

test("at the longest exposure a dim lamp stops with a reason", () => {
  const r = proximo(10000, 40, faixa);
  assert.equal(r.pronto, true);
  assert.equal(r.limite, true);
  assert.match(r.motivo, /longest exposure is still dim/);
});

test("at the shortest exposure a clipped lamp stops with a reason", () => {
  const r = proximo(1, 255, faixa);
  assert.equal(r.limite, true);
  assert.match(r.motivo, /shortest exposure still clips/);
});

test("the result lands on the camera's step", () => {
  const r = proximo(100, 100, { min: 3, max: 2047, step: 4 });
  assert.equal((r.exposicao - 3) % 4, 0);
});
