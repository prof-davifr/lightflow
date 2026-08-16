import test from "node:test";
import assert from "node:assert/strict";
import { plano, confere, podeMedir, comandoV4l2 } from "../web/js/nucleo/locks.js";

/* What Chrome reports for this bench's Suyin HD Camera. */
const SUYIN = {
  exposureMode: ["continuous", "manual"],
  exposureTime: { min: 5, max: 1000, step: 1 },
  whiteBalanceMode: ["continuous", "manual"],
  colorTemperature: { min: 2800, max: 6500, step: 10 },
};

test("a capable camera gets both manual modes", () => {
  const p = plano(SUYIN, { exposureTime: 20, colorTemperature: 4600 });
  assert.equal(p.restricoes.exposureMode, "manual");
  assert.equal(p.restricoes.whiteBalanceMode, "manual");
  assert.equal(p.restricoes.exposureTime, 20);
  assert.equal(p.restricoes.colorTemperature, 4600);
  assert.deepEqual(p.faltando, []);
});

test("values are clamped into the declared range", () => {
  const alto = plano(SUYIN, { exposureTime: 99999, colorTemperature: 99999 });
  assert.equal(alto.restricoes.exposureTime, 1000);
  assert.equal(alto.restricoes.colorTemperature, 6500);
  const baixo = plano(SUYIN, { exposureTime: -5, colorTemperature: 0 });
  assert.equal(baixo.restricoes.exposureTime, 5);
  assert.equal(baixo.restricoes.colorTemperature, 2800);
});

test("values are snapped onto the declared step", () => {
  /* A value off the step makes some drivers reject the whole applyConstraints,
     taking the mode change down with it. */
  const p = plano(SUYIN, { exposureTime: 20, colorTemperature: 4603 });
  assert.equal(p.restricoes.colorTemperature, 4600);
});

test("a camera without manual exposure is reported, not silently accepted", () => {
  const cap = { whiteBalanceMode: ["manual"], colorTemperature: { min: 2800, max: 6500 } };
  const p = plano(cap, {});
  assert.ok(p.faltando.includes("exposureMode"));
  assert.equal(p.restricoes.exposureMode, undefined);
  assert.ok(p.avisos.some((a) => /may be the camera/.test(a)),
    "the operator has to be told that the kinetics may be the camera");
});

test("Firefox, which exposes nothing, comes back with everything missing", () => {
  const p = plano({}, {});
  assert.ok(p.faltando.includes("exposureMode"));
  assert.ok(p.faltando.includes("whiteBalanceMode"));
  assert.equal(Object.keys(p.restricoes).length, 0);
  assert.equal(p.avisos.length, 2);
});

test("focus is locked only when the camera has focus at all", () => {
  assert.equal(plano(SUYIN, {}).restricoes.focusMode, undefined);
  assert.equal(plano(Object.assign({ focusMode: ["manual"] }, SUYIN), {}).restricoes.focusMode, "manual");
});

test("confere catches a driver that resolved but did not obey", () => {
  /* applyConstraints resolving means the browser accepted the request, not that
     the camera honoured it. Several UVC cameras resolve happily and carry on. */
  const r = { exposureMode: "manual", exposureTime: 20 };
  const bom = confere(r, { exposureMode: "manual", exposureTime: 20 });
  assert.ok(bom.ok && bom.modosOk);

  const mentiu = confere(r, { exposureMode: "continuous", exposureTime: 20 });
  assert.ok(!mentiu.ok, "the mode did not take");
  assert.ok(!mentiu.modosOk);
  assert.equal(mentiu.divergente[0].campo, "exposureMode");
});

test("confere tolerates the rounding a driver does, and nothing more", () => {
  const r = { exposureTime: 200 };
  assert.ok(confere(r, { exposureTime: 201 }).ok, "half a percent is rounding");
  assert.ok(!confere(r, { exposureTime: 260 }).ok, "thirty percent is not");
});

test("confere flags a field the camera does not report back", () => {
  const d = confere({ exposureTime: 20 }, {});
  assert.ok(!d.ok);
  assert.equal(d.divergente[0].obtido, "not reported");
});

test("a kinetics run is blocked while the exposure is free", () => {
  assert.equal(podeMedir({ faltando: [], confere: { modosOk: true } }).pode, true);
  const bloqueado = podeMedir({ faltando: ["exposureMode"], confere: { modosOk: false } });
  assert.equal(bloqueado.pode, false);
  assert.match(bloqueado.motivo, /exposure/);
  assert.equal(podeMedir(null).pode, false);
});

test("the v4l2 fallback names the controls no browser can reach", () => {
  /* Sharpness is not cosmetic: it is a spatial filter whose overshoot on the
     edge of a narrow line changes the line's area, which is exactly what a band
     integration reports. */
  const c = comandoV4l2("/dev/video2");
  assert.match(c, /sharpness=0/);
  assert.match(c, /gamma=100/);
  assert.match(c, /\/dev\/video2/);
});
