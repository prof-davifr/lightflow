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

/* The smallest R - D counted as light when the dark has no noise at all: a
   covered sensor often reads 0 on every frame, and 3 sigma is then 0. About
   sRGB code 8. */
export const PISO_RUIDO = 0.002;

/* True where the reference does not stand above the dark noise. A ratio there
   is noise divided by noise: it comes out as a number, often a large one, and
   it reads as absorbance at the ends of the lamp where nothing was measured. */
function fraca(R, D, escuro, canal, i) {
  const sd = escuro.sigma && escuro.sigma[canal];
  return R[i] - D[i] <= Math.max(sd ? 3 * sd[i] : 0, PISO_RUIDO);
}

/* A = -log10((S-D)/(R-D)).

   NaN, never Infinity, where the ratio is not positive, where any of the
   frames clipped, or where the reference is lost in the dark noise. The screen
   turns NaN into a gap (LF.serieY), a file into an empty field; an Infinity
   would be drawn as a full-height stroke that looks like a real, enormous
   peak. */
export function absorbance(amostra, escuro, referencia, canal) {
  checaCanal(canal);
  const S = puxa(amostra, canal, "sample");
  const D = puxa(escuro, canal, "dark");
  const R = puxa(referencia, canal, "reference");
  const n = S.length, y = new Float32Array(n);
  const q = [amostra, escuro, referencia];
  for (let i = 0; i < n; i++) {
    const num = S[i] - D[i], den = R[i] - D[i];
    y[i] = (num <= 0 || fraca(R, D, escuro, canal, i) || ruim(q, i))
      ? NaN : -Math.log10(num / den);
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
    y[i] = (fraca(R, D, escuro, canal, i) || ruim(q, i)) ? NaN : 100 * (S[i] - D[i]) / den;
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
    /* The same floor as the mask: a covered sensor that reads 0 on every frame
       has sigma 0, and the ceiling would come out infinite. */
    const den = Math.max(3 * sd[i], PISO_RUIDO), num = R[i] - D[i];
    /* Only the columns the mask keeps: a ceiling below zero, from the dark
       ends of a lamp, is a ceiling on nothing. */
    if (num > den && !ruim([referencia, escuro], i)) vals.push(Math.log10(num / den));
  }
  if (!vals.length) return NaN;
  vals.sort(function (a, b) { return a - b; });
  return vals[vals.length >> 1];
}

/* ------------------------------------------- captures that empty a mode

   A dark taken with the lamp on, or a reference taken on a line lamp, gives no
   error: the arithmetic is right and nearly every column comes out NaN, so the
   plot just goes blank. These two checks say why at the moment of capture. */

/* Linear intensity a covered slit never reaches. */
export const ESCURO_MAX = 0.05;

/* A warning for a dark that has light in it, or null. */
export function confereEscuro(escuro, canal) {
  checaCanal(canal);
  const D = puxa(escuro, canal, "dark");
  let clip = 0, mx = 0;
  for (let i = 0; i < D.length; i++) {
    if (escuro.clip && escuro.clip[i] > 0) clip++;
    if (D[i] > mx) mx = D[i];
  }
  if (clip > 0 || mx > ESCURO_MAX) {
    return "the dark is not dark: it reaches " + Math.round(100 * mx)
      + " % of full scale" + (clip ? " and clips in " + clip + " columns" : "")
      + ". Cover the slit or switch the lamp off, and capture the dark again.";
  }
  return null;
}

/* How many columns of the reference stand above the dark noise, and a warning
   when fewer than a third do. Absorbance and transmittance are NaN everywhere
   else. */
export function confereReferencia(referencia, escuro, canal) {
  checaCanal(canal);
  const R = puxa(referencia, canal, "reference");
  const D = puxa(escuro, canal, "dark");
  const q = [referencia, escuro];
  let uteis = 0;
  for (let i = 0; i < R.length; i++) {
    if (!fraca(R, D, escuro, canal, i) && !ruim(q, i)) uteis++;
  }
  const total = R.length;
  let aviso = null;
  if (3 * uteis < total) {
    aviso = "the reference stands above the dark in only " + uteis + " of "
      + total + " columns, and absorbance and transmittance exist only there. Take the dark "
      + "with the slit covered, and the reference on a continuous lamp: a "
      + "line lamp, such as a fluorescent tube, lights only its lines.";
  }
  return { uteis: uteis, total: total, aviso: aviso };
}
