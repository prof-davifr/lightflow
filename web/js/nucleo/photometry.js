/* The four measurements, and the guards that make them mean something.

   Every mode takes averaged frames as produced by frame.js Acumulador.media().
   Sample, dark, reference and blank must all come from the SAME channel, and
   this file enforces that rather than trusting the caller: absorbance computed
   with the sample in green and the reference in luminance is not a small error,
   it is a different quantity, and it looks perfectly reasonable on screen. */

import { CANAIS } from "./frame.js";

export const MODOS = ["absorbance", "transmittance", "emission", "fluorescence"];

function puxa(quadro, canal, nome) {
  if (!quadro) throw new Error("missing frame: " + nome);
  const v = quadro[canal];
  if (!v) throw new Error(nome + " has no channel \"" + canal + "\"");
  return v;
}

function checaCanal(canal) {
  if (CANAIS.indexOf(canal) < 0) throw new Error("unknown channel: " + canal);
}

/* True where the column must not be reported at all. */
function ruim(quadros, i) {
  for (let k = 0; k < quadros.length; k++) {
    const q = quadros[k];
    if (q && q.clip && q.clip[i] > 0) return true;
  }
  return false;
}

/* A = -log10((S-D)/(R-D)).

   NaN, never Infinity, where the ratio is not positive or where any of the
   frames clipped. uPlot draws NaN as a gap and Infinity as a full-height
   vertical stroke that looks like a real, enormous peak. */
export function absorbance(amostra, escuro, referencia, canal) {
  checaCanal(canal);
  const S = puxa(amostra, canal, "sample");
  const D = puxa(escuro, canal, "dark");
  const R = puxa(referencia, canal, "reference");
  const n = S.length, y = new Float32Array(n);
  const q = [amostra, escuro, referencia];
  for (let i = 0; i < n; i++) {
    const num = S[i] - D[i], den = R[i] - D[i];
    y[i] = (den <= 0 || num <= 0 || ruim(q, i)) ? NaN : -Math.log10(num / den);
  }
  return y;
}

/* Transmittance in percent. Reflectance is the same arithmetic with a white
   standard in the reference position, which is why there is one function. */
export function transmittance(amostra, escuro, referencia, canal) {
  checaCanal(canal);
  const S = puxa(amostra, canal, "sample");
  const D = puxa(escuro, canal, "dark");
  const R = puxa(referencia, canal, "reference");
  const n = S.length, y = new Float32Array(n);
  const q = [amostra, escuro, referencia];
  for (let i = 0; i < n; i++) {
    const den = R[i] - D[i];
    y[i] = (den <= 0 || ruim(q, i)) ? NaN : 100 * (S[i] - D[i]) / den;
  }
  return y;
}

/* Raw emission, dark removed. Linear intensity, arbitrary units. */
export function emission(amostra, escuro, canal) {
  checaCanal(canal);
  const S = puxa(amostra, canal, "sample");
  const D = puxa(escuro, canal, "dark");
  const n = S.length, y = new Float32Array(n);
  const q = [amostra, escuro];
  for (let i = 0; i < n; i++) y[i] = ruim(q, i) ? NaN : S[i] - D[i];
  return y;
}

/* Fluorescence SUBTRACTS the blank; it does not divide by it.
   (S - D) - (B - D) = S - B. The blank carries the solvent emission and the
   scattered excitation, and both are additive. Dividing here — the reflex
   carried over from absorbance — turns an additive background into a
   multiplicative one and gives a spectrum that is wrong everywhere the
   background is not flat. */
export function fluorescence(amostra, escuro, branco, canal) {
  checaCanal(canal);
  const S = puxa(amostra, canal, "sample");
  const B = puxa(branco, canal, "blank");
  puxa(escuro, canal, "dark");            // required, and it cancels
  const n = S.length, y = new Float32Array(n);
  const q = [amostra, escuro, branco];
  for (let i = 0; i < n; i++) y[i] = ruim(q, i) ? NaN : S[i] - B[i];
  return y;
}

/* One entry point, so the screens never branch on the mode themselves. */
export function calcula(modo, quadros, canal) {
  switch (modo) {
    case "absorbance":
      return absorbance(quadros.amostra, quadros.escuro, quadros.referencia, canal);
    case "transmittance":
      return transmittance(quadros.amostra, quadros.escuro, quadros.referencia, canal);
    case "emission":
      return emission(quadros.amostra, quadros.escuro, canal);
    case "fluorescence":
      return fluorescence(quadros.amostra, quadros.escuro, quadros.branco, canal);
    default:
      throw new Error("unknown mode: " + modo);
  }
}

export const UNIDADE = {
  absorbance: "AU",
  transmittance: "%T",
  emission: "linear, a.u.",
  fluorescence: "linear, a.u.",
};

/* Which frames a mode cannot work without. */
export const EXIGE = {
  absorbance: ["escuro", "referencia"],
  transmittance: ["escuro", "referencia"],
  emission: ["escuro"],
  fluorescence: ["escuro", "branco"],
};

/* The largest absorbance this bench can honestly report.

   The smallest signal distinguishable from the dark is about three times the
   dark's own standard deviation, so A_max = log10((R-D)/(3 sigma)). Anything
   printed above this line is noise wearing a number, and the spectrum screen
   shows the figure precisely so that nobody quotes an A of 3 from an 8-bit
   camera. Returns the median across the columns, which is more robust than the
   mean when a few columns sit in the dark ends of the spectrum. */
export function aMax(escuro, referencia, canal) {
  checaCanal(canal);
  const D = puxa(escuro, canal, "dark");
  const R = puxa(referencia, canal, "reference");
  const sd = escuro.sigma && escuro.sigma[canal];
  if (!sd) return NaN;
  const vals = [];
  for (let i = 0; i < D.length; i++) {
    const den = 3 * sd[i], num = R[i] - D[i];
    if (den > 0 && num > 0) vals.push(Math.log10(num / den));
  }
  if (!vals.length) return NaN;
  vals.sort(function (a, b) { return a - b; });
  return vals[vals.length >> 1];
}
