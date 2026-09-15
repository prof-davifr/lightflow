/* Turning a column index into a wavelength.

   The fit is a polynomial of order 1 to 3 in the column index. Order 2 is
   almost always right for a small transmission grating: the grating equation is
   a sine, and over a 30-degree fan its departure from a straight line is a
   quadratic to well under a tenth of a nanometre. Order 3 is there for a badly
   tilted camera; order 1 is there so a two-laser calibration is possible at
   all, and it is honest about being coarse. */

import { polyfit, polyval, rms } from "./num.js";

/* The yellow mercury doublet at 576.96 and 579.07 nm is 2.1 nm apart. Almost no
   homemade instrument resolves it, and marking one blurred hump as either line
   puts a 1 nm error straight into the fit. The preset therefore offers the pair
   as ONE line at its midpoint. Declared before LINHAS, which uses it. */
export const DUBLETO_HG = 578.01;

/* Reference lines, with the source that makes each set worth trusting.

   The fluorescent lamp is the standard of the field for a reason: the four
   mercury lines are narrow, they are bright, and every ceiling in the building
   has one. The 611.6 nm band is europium in the phosphor coating; it is wider
   than the mercury lines, so it is offered as a CHECK rather than a fit point —
   leaving it out of the fit and then seeing where it lands is an independent
   test that costs nothing. */
export const LINHAS = {
  fluorescent: {
    rotulo: "Fluorescent lamp (mercury)",
    nota: "Point the slit at any ceiling tube. Use the four mercury lines to "
      + "fit, then check where 611.6 nm lands.",
    pontos: [
      { nm: 404.66, rotulo: "Hg violet", ajuste: true },
      { nm: 435.83, rotulo: "Hg blue", ajuste: true },
      { nm: 546.07, rotulo: "Hg green", ajuste: true },
      /* Listed as two lines, the pair used to take two names: the hump got
         576.96 and the europium band, one peak further, got 579.07. The fit
         still looked good and the red end of the axis was 11 nm out. */
      { nm: DUBLETO_HG, rotulo: "Hg yellow pair (unresolved)", ajuste: true },
      { nm: 611.60, rotulo: "Eu red (phosphor, wide)", ajuste: false },
    ],
  },
  laser: {
    rotulo: "Laser pointers",
    nota: "Aim at a diffuser, never into the slit directly. Nominal wavelengths "
      + "drift by a few nanometres between units.",
    pontos: [
      { nm: 405, rotulo: "violet diode", ajuste: true },
      { nm: 532, rotulo: "green DPSS", ajuste: true },
      { nm: 650, rotulo: "red diode", ajuste: true },
    ],
  },
  led: {
    rotulo: "LEDs and filters",
    nota: "Broad peaks. Good enough for a first straight line, not for a final "
      + "calibration.",
    pontos: [
      { nm: 455, rotulo: "royal blue LED", ajuste: true },
      { nm: 525, rotulo: "green LED", ajuste: true },
      { nm: 590, rotulo: "amber LED", ajuste: true },
      { nm: 660, rotulo: "deep red LED", ajuste: true },
    ],
  },
};

/* Which reference line each marked peak is.

   Naming the k-th peak from the left as the k-th line breaks in the two ways a
   real bench produces: a weak line is not marked (the violet mercury line is
   faint on a webcam, and "strongest unused peak" picks the europium band before
   it), and the red end sits on the LEFT of the sensor. Either way every name
   shifts, and the fit is fitted to the wrong lines.

   A grating is monotonic and close to linear, so the peaks keep the SPACING
   pattern of the lines. Every ordered choice of lines, in both directions, is
   scored by the rms of a straight line through it, and the best one wins. A
   straight line and not the order-2 fit: with four points order 2 has one
   degree of freedom left, which lets a wrong choice fit almost as well as the
   right one. The curvature of a real grating costs the right choice about half
   a nanometre; a wrong one costs tens.

   `pxs` is the column of each marked peak, in any order. Returns
   {linhas, crescente, rms, ambiguo}: `linhas[k]` is the line for `pxs[k]`,
   `crescente` says wavelength grows with the column, and `ambiguo` says another
   choice scored nearly as well — the case with three peaks and three evenly
   spaced lines, where the data cannot tell the direction. Then the choice with
   red on the right is kept. */
export function nomeia(pxs, linhas) {
  const n = pxs.length, L = linhas.length;
  if (n < 2) throw new Error("mark at least two peaks before naming them");
  if (n > L) {
    throw new Error("there are more marked peaks (" + n + ") than lines in this "
      + "source (" + L + ") — remove the extra ones first");
  }
  const ordemPx = pxs.map(function (p, k) { return k; })
    .sort(function (a, b) { return pxs[a] - pxs[b]; });
  const xs = ordemPx.map(function (k) { return pxs[k]; });
  const ref = linhas.slice().sort(function (a, b) { return a.nm - b.nm; });

  const cand = [];
  const escolha = [];
  (function combina(inicio) {
    if (escolha.length === n) {
      [true, false].forEach(function (crescente) {
        const sel = escolha.map(function (j) { return ref[j]; });
        if (!crescente) sel.reverse();
        const ys = sel.map(function (l) { return l.nm; });
        let r = 0;
        if (n >= 3) {
          const c = polyfit(xs, ys, 1);
          r = rms(ys.map(function (y, k) { return y - polyval(c, xs[k]); }));
        }
        cand.push({ sel: sel, crescente: crescente, rms: r });
      });
      return;
    }
    for (let j = inicio; j <= L - (n - escolha.length); j++) {
      escolha.push(j);
      combina(j + 1);
      escolha.pop();
    }
  })(0);

  cand.sort(function (a, b) { return a.rms - b.rms; });
  const tol = Math.max(2 * cand[0].rms, 0.05);
  const perto = cand.filter(function (c) { return c.rms <= tol; });
  const ambiguo = perto.length > 1;
  const fica = perto.filter(function (c) { return c.crescente; })[0] || cand[0];

  const out = new Array(n);
  ordemPx.forEach(function (k, pos) { out[k] = fica.sel[pos]; });
  return { linhas: out, crescente: fica.crescente, rms: fica.rms, ambiguo: ambiguo };
}

/* Least-squares fit of wavelength against column index.

   `pontos` is [{px, nm, rotulo, usar}]. Points with `usar === false` are kept
   in the list and shown, but left out of the fit — that is how the independent
   check works.

   Returns {ordem, coef, residuos, rms, max, n, pontos} with every residual in
   nanometres. */
export function ajusta(pontos, ordem, extra) {
  const usados = pontos.filter(function (p) { return p.usar !== false; });
  if (usados.length < ordem + 1) {
    throw new Error("order " + ordem + " needs at least " + (ordem + 1)
      + " points; " + usados.length + " are selected");
  }
  const xs = usados.map(function (p) { return p.px; });
  const ys = usados.map(function (p) { return p.nm; });
  const coef = polyfit(xs, ys, ordem);

  /* Residuals are reported for EVERY point, including the ones left out, so the
     check line shows its error next to the fitted ones. */
  const residuos = pontos.map(function (p) { return p.nm - polyval(coef, p.px); });
  const usadosRes = pontos
    .filter(function (p) { return p.usar !== false; })
    .map(function (p) { return p.nm - polyval(coef, p.px); });

  let max = 0;
  for (let i = 0; i < usadosRes.length; i++) max = Math.max(max, Math.abs(usadosRes[i]));

  return Object.assign({
    ordem: ordem,
    coef: Array.from(coef),
    residuos: residuos,
    rms: rms(usadosRes),
    max: max,
    n: usados.length,
    pontos: pontos.map(function (p) { return Object.assign({}, p); }),
    criada: Date.now(),
  }, extra || {});
}

/* Wavelength of one column. */
export function toNm(cal, i) { return polyval(cal.coef, i); }

/* The whole wavelength axis, ready for uPlot.
   Float64 because uPlot wants a plain array of numbers and because the
   differences between neighbouring columns are small next to the values. */
export function eixo(cal, n) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = polyval(cal.coef, i);
  return v;
}

/* Column index for a wavelength, by inverting the polynomial numerically.
   Newton from a bisection start; the map is monotonic over any sane grating
   geometry, and this refuses to answer when it is not. */
export function toPx(cal, nm, n) {
  let lo = 0, hi = n - 1;
  const a = polyval(cal.coef, lo), b = polyval(cal.coef, hi);
  if (a === b) return NaN;
  const cresce = b > a;
  if (cresce ? (nm < a || nm > b) : (nm > a || nm < b)) return NaN;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2, v = polyval(cal.coef, m);
    if ((v < nm) === cresce) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/* Nanometres per column at the middle of the range, which is the number that
   tells the operator what resolution the fit even allows. */
export function dispersao(cal, n) {
  const m = n >> 1;
  return polyval(cal.coef, m + 0.5) - polyval(cal.coef, m - 0.5);
}

/* A calibration belongs to one mechanical setup and one ROI. Comparing the
   signature catches a changed resolution or a moved ROI. It cannot catch
   somebody bumping the grating, and the manual says so. */
export function confere(cal, assinaturaAtual, nColAtual) {
  const problemas = [];
  if (cal.n_col !== undefined && cal.n_col !== nColAtual) {
    problemas.push("the calibration was made with " + cal.n_col
      + " columns and the ROI now has " + nColAtual);
  }
  if (cal.assinatura !== undefined && cal.assinatura !== assinaturaAtual) {
    problemas.push("the ROI or the camera resolution changed since the fit");
  }
  return problemas;
}
