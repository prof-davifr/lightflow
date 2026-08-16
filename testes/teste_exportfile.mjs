import test from "node:test";
import assert from "node:assert/strict";
import { csvEspectro, csvCorrida, csvCinetica, json, jsonCalibracao }
  from "../web/js/nucleo/exportfile.js";

function linhas(txt) {
  return txt.split("\n").filter(function (l) { return l !== ""; });
}
function dados(txt) {
  return linhas(txt).filter(function (l) { return l[0] !== "#"; });
}

test("a spectrum CSV has a header, a column row and one row per column", () => {
  const xs = [400, 401, 402], ys = [0.1, 0.2, 0.3];
  const t = csvEspectro(xs, ys, { x: "wavelength_nm", y: "absorbance", canal: "g" });
  const d = dados(t);
  assert.equal(d[0], "wavelength_nm,absorbance_g");
  assert.equal(d.length, 4);
  assert.equal(d[1], "400.0000,0.100000");
  assert.equal(d[3], "402.0000,0.300000");
});

test("the numbers use a decimal POINT", () => {
  /* Deliberately different from the screen, which formats for a reader. These
     files go to pandas, numpy and Origin, and all three take a point. */
  const t = csvEspectro([546.07], [0.30103], {});
  assert.match(dados(t)[1], /^546\.0700,0\.301030$/);
  assert.ok(!/;/.test(t), "the separator is a comma, so no semicolons");
});

test("a missing value is an EMPTY field, not NaN and not zero", () => {
  /* Empty is what pandas and numpy read back as missing. "NaN" is read as a
     string by half the tools that will open this, and zero is read as a
     measurement that was never made. */
  const t = csvEspectro([400, 401, 402], [0.1, NaN, Infinity], {});
  const d = dados(t);
  assert.equal(d[2], "401.0000,");
  assert.equal(d[3], "402.0000,");
  assert.ok(!/NaN/.test(t));
  assert.ok(!/Infinity/.test(t));
});

test("the metadata header is commented so a reader can skip it", () => {
  const t = csvEspectro([400], [1], { y: "absorbance", canal: "g", unidade: "AU" });
  const cab = linhas(t).filter(function (l) { return l[0] === "#"; });
  assert.ok(cab.length >= 3);
  assert.ok(cab.every(function (l) { return l.startsWith("# "); }));
  assert.ok(cab.some(function (l) { return /channel: g/.test(l); }));
  assert.ok(cab.some(function (l) { return /unit: AU/.test(l); }));
});

test("a run CSV is wide: wavelengths across, one row per spectrum", () => {
  /* One row is one spectrum and one column is one wavelength through time,
     which slices with a single index in numpy. */
  const xs = [400, 500, 600];
  const linhasY = [
    Float32Array.from([0.1, 0.2, 0.3]),
    Float32Array.from([0.4, 0.5, 0.6]),
  ];
  const t = csvCorrida([0, 2.5], xs, linhasY, { modo: "absorbance", canal: "g" });
  const d = dados(t);
  assert.equal(d[0], "time_s,400.0000,500.0000,600.0000");
  assert.equal(d.length, 3);
  assert.match(d[1], /^0\.000,0\.100000,0\.200000,0\.300000$/);
  assert.match(d[2], /^2\.500,0\.400000,0\.500000,0\.600000$/);
});

test("a kinetics CSV names each band by its centre and half width", () => {
  const bandas = [
    { centro: 546.07, largura: 10, y: [1, 0.5] },
    { centro: 664, largura: 4, y: [0.2, NaN] },
  ];
  const t = csvCinetica([0, 10], bandas, { modo: "absorbance" });
  const d = dados(t);
  assert.equal(d[0], "time_s,546.07nm_pm5.00,664.00nm_pm2.00");
  assert.equal(d[2], "10.000,0.500000,");
});

test("JSON turns typed arrays into plain arrays and NaN into null", () => {
  /* JSON.stringify makes NaN into null on its own, and JSON.parse would refuse
     a bare NaN, so the round trip is only safe while nothing writes one. */
  const t = json({ v: Float32Array.from([1, NaN, 3]), n: NaN });
  const back = JSON.parse(t);
  assert.deepEqual(back.v, [1, null, 3]);
  assert.equal(back.n, null);
  assert.ok(!/NaN/.test(t));
});

test("a calibration exports everything needed to reproduce the axis", () => {
  const cal = {
    nome: "bench", criada: 0, ordem: 2, coef: [350, 0.35, -1.2e-5],
    rms: 0.03, max: 0.05, n_col: 1280, assinatura: "1280/720/0/330/1280/61/0.000",
    pontos: [{ px: 100, nm: 404.66, usar: true }],
    residuos: [0.01],
  };
  const o = JSON.parse(jsonCalibracao(cal));
  assert.equal(o.format, "lightflow-calibration");
  assert.deepEqual(o.coefficients, [350, 0.35, -1.2e-5]);
  assert.equal(o.columns, 1280);
  assert.equal(o.signature, "1280/720/0/330/1280/61/0.000");
  assert.equal(o.points.length, 1);
});
