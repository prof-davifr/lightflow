/* CSV and JSON output. Pure text building, so the tests can compare bytes.

   THE NUMBERS HERE USE A DECIMAL POINT, and the screen uses whatever the
   locale formatter gives. That is deliberate and it is not an inconsistency to
   tidy up later: these files are read by pandas, numpy and Origin, all of which
   take a point, while the screen is read by a person. Changing this to match
   the screen would silently break every downstream script. */

const NL = "\n";

/* A NaN is written as an EMPTY FIELD, not as the text "NaN" and not as a zero.
   Empty is what pandas and numpy both read back as a missing value; "NaN" is
   read as a string by half the tools that will open this, and zero is read as a
   measurement that was never made. */
function n(v, casas) {
  if (v === null || v === undefined || !isFinite(v)) return "";
  return casas === undefined ? String(v) : v.toFixed(casas);
}

function cabecalho(meta) {
  const linhas = [
    "# LightFlow — webcam spectrometer",
    "# generated: " + new Date().toISOString(),
  ];
  Object.keys(meta || {}).forEach(function (k) {
    const v = meta[k];
    if (v === undefined || v === null || v === "") return;
    linhas.push("# " + k + ": " + (typeof v === "object" ? JSON.stringify(v) : v));
  });
  return linhas.join(NL) + NL;
}

/* One spectrum: two columns. */
export function csvEspectro(xs, ys, meta) {
  meta = meta || {};
  const colX = meta.x || "column_px";
  const colY = (meta.y || "value") + (meta.canal ? "_" + meta.canal : "");
  const partes = [cabecalho({
    mode: meta.y, channel: meta.canal, unit: meta.unidade,
    calibrated: meta.calibrado === undefined ? undefined : !!meta.calibrado,
    columns: xs.length,
  })];
  partes.push(colX + "," + colY + NL);
  for (let i = 0; i < xs.length; i++) {
    partes.push(n(xs[i], 4) + "," + n(ys[i], 6) + NL);
  }
  return partes.join("");
}

/* A whole run: the wavelength axis across the top, one row per time.

   Wide rather than long, because that is the shape a kinetics run is actually
   used in — one row is one spectrum, and a column is one wavelength through
   time, which slices directly in a spreadsheet or with a single numpy index. */
export function csvCorrida(tempos, xs, linhas, meta) {
  meta = meta || {};
  const partes = [cabecalho({
    mode: meta.modo, channel: meta.canal, unit: meta.unidade,
    calibrated: meta.calibrado === undefined ? undefined : !!meta.calibrado,
    spectra: linhas.length, columns: xs.length,
    started: meta.inicio ? new Date(meta.inicio).toISOString() : undefined,
  })];
  const cab = ["time_s"];
  for (let i = 0; i < xs.length; i++) cab.push(n(xs[i], 4));
  partes.push(cab.join(",") + NL);
  for (let k = 0; k < linhas.length; k++) {
    const linha = [n(tempos[k], 3)];
    const y = linhas[k];
    for (let i = 0; i < xs.length; i++) linha.push(n(y[i], 6));
    partes.push(linha.join(",") + NL);
  }
  return partes.join("");
}

/* Kinetics traces: time down the side, one column per band. */
export function csvCinetica(tempos, bandas, meta) {
  const partes = [cabecalho({
    mode: meta && meta.modo, channel: meta && meta.canal,
    unit: meta && meta.unidade, bands: bandas.length,
  })];
  const cab = ["time_s"];
  bandas.forEach(function (b) {
    cab.push(n(b.centro, 2) + "nm_pm" + n(b.largura / 2, 2));
  });
  partes.push(cab.join(",") + NL);
  for (let k = 0; k < tempos.length; k++) {
    const linha = [n(tempos[k], 3)];
    bandas.forEach(function (b) { linha.push(n(b.y[k], 6)); });
    partes.push(linha.join(",") + NL);
  }
  return partes.join("");
}

/* JSON.stringify turns NaN into null on its own, and JSON.parse would refuse a
   bare NaN, so the round trip is safe as long as nothing here writes one by
   hand. Typed arrays become plain arrays, which is what a reader expects. */
export function json(obj) {
  return JSON.stringify(obj, function (k, v) {
    if (ArrayBuffer.isView(v)) return Array.from(v, function (x) {
      return isFinite(x) ? x : null;
    });
    return v;
  }, 2);
}

export function jsonCalibracao(cal) {
  return json({
    format: "lightflow-calibration",
    version: 1,
    name: cal.nome,
    created: cal.criada ? new Date(cal.criada).toISOString() : undefined,
    order: cal.ordem,
    coefficients: cal.coef,
    rms_nm: cal.rms,
    max_nm: cal.max,
    columns: cal.n_col,
    signature: cal.assinatura,
    points: cal.pontos,
    residuals_nm: cal.residuos,
  });
}
