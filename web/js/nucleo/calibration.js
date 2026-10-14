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

   The fluorescent lamp is the standard of the field for a reason: the mercury
   lines are narrow, they are bright, and every ceiling in the building has one.
   The rest of what a lamp shows comes from the phosphor. The 611.6 nm band is
   europium; it is wider than the mercury lines, so it is offered as a CHECK
   rather than a fit point — leaving it out of the fit and then seeing where it
   lands is an independent test that costs nothing.

   A compact or tri-phosphor lamp adds terbium, and on this bench two terbium
   bands outshine mercury lines: 487.7 nm, between the blue and the green, and
   587.6 nm, nine columns from the yellow mercury pair and stronger than it.
   Left out of the preset they still get marked, and then they take a mercury
   name: the 587.6 band was named 578.01, the fit through three points was
   exact, and the axis was 18 nm out at the red end. Listed, they are named for
   what they are, and as wide phosphor bands they are checks too.

   The 546.07 green line has terbium at 543.4 nm under it, unresolved at this
   slit width. The second order splits the two at about equal height, so the
   green point probably sits about a nanometre low. It stays a fit point: it is
   the brightest line there is, and the checks will show it. */
export const LINHAS = {
  fluorescent: {
    rotulo: "Fluorescent lamp (mercury + phosphor)",
    nota: "Point the slit at a ceiling tube or a compact lamp. Mercury lines "
      + "fit; the phosphor bands at 487.7, 587.6 and 611.6 nm are checks.",
    pontos: [
      { nm: 404.66, rotulo: "Hg violet", ajuste: true },
      { nm: 435.83, rotulo: "Hg blue", ajuste: true },
      { nm: 487.70, rotulo: "Tb blue-green (phosphor, wide)", ajuste: false },
      { nm: 546.07, rotulo: "Hg green", ajuste: true },
      /* Listed as two lines, the pair used to take two names: the hump got
         576.96 and the europium band, one peak further, got 579.07. The fit
         still looked good and the red end of the axis was 11 nm out. */
      { nm: DUBLETO_HG, rotulo: "Hg yellow pair (unresolved)", ajuste: true },
      { nm: 587.60, rotulo: "Tb orange (phosphor, wide)", ajuste: false },
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

/* The signal the calibration screen looks at: R+G+B, linear.

   Not the measurement channel. Green is right for measuring, because it is the
   only channel at full resolution along the spectrum, but on this bench the
   green channel does not see the red europium line or the blue mercury line
   above the noise, and the peak finder found one line in it. A calibration
   needs lines across the whole range, and every channel together has them. */
export function sinal(m) {
  const n = m.g.length, y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = m.r[i] + m.g[i] + m.b[i];
  return y;
}

/* How far, in columns, a straight line through the named peaks may miss before
   the names are wrong. The curvature of a real grating costs about half a
   column and a phosphor band about one; a wrong name costs tens. */
export const LIMITE_COL = 3;

/* Two namings whose straight lines both miss by less than this many columns
   are equally good as far as the spacing can say. */
const MESMA_COL = 1;

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

   The best choice is not always a good one. A peak from the second order, or a
   phosphor band the preset does not list, has no right name, and the best
   straight line then misses by many columns. With five peaks or more, each one
   is tried left out; if that brings the miss under LIMITE_COL, the peak stays
   unnamed. Four is not enough: three peaks out of seven lines fit some
   straight line by chance.

   `pxs` is the column of each marked peak, in any order. `opc.crescente` is
   the direction to keep when the data cannot tell, normally the direction of
   the calibration already in use; without it, red on the right. Returns
   {linhas, crescente, rms, rmsCol, ambiguo, confiavel, fora}: `linhas[k]` is
   the line for `pxs[k]`, or null for the peak left out, whose index is `fora`
   (-1 when none). `confiavel` is false when even the best names miss by more
   than LIMITE_COL columns; then none of them should be used. */
export function nomeia(pxs, linhas, opc) {
  opc = opc || {};
  const n = pxs.length, L = linhas.length;
  if (n < 2) throw new Error("mark at least two peaks before naming them");
  if (n > L) {
    throw new Error("there are more marked peaks (" + n + ") than lines in this "
      + "source (" + L + ") — remove the extra ones first");
  }
  const prefere = opc.crescente === undefined ? true : !!opc.crescente;
  const ref = linhas.slice().sort(function (a, b) { return a.nm - b.nm; });
  const ordemPx = pxs.map(function (p, k) { return k; })
    .sort(function (a, b) { return pxs[a] - pxs[b]; });

  let r = escolhe(ordemPx, pxs, ref, prefere);
  let fora = -1;
  if (r.rmsCol > LIMITE_COL && n >= 5) {
    for (let d = 0; d < n; d++) {
      const s = escolhe(ordemPx.filter(function (k, pos) { return pos !== d; }),
        pxs, ref, prefere);
      if (s.rmsCol < r.rmsCol && s.rmsCol <= LIMITE_COL) { r = s; fora = ordemPx[d]; }
    }
  }

  const out = new Array(n).fill(null);
  r.ordem.forEach(function (k, pos) { out[k] = r.sel[pos]; });
  return {
    linhas: out, crescente: r.crescente, rms: r.rms, rmsCol: r.rmsCol,
    ambiguo: r.ambiguo, confiavel: r.rmsCol <= LIMITE_COL, fora: fora,
  };
}

/* The best naming of the peaks `ordem` (indices into pxs, left to right). */
function escolhe(ordem, pxs, ref, prefere) {
  const n = ordem.length, L = ref.length;
  const xs = ordem.map(function (k) { return pxs[k]; });
  const cand = [];
  const escolha = [];
  (function combina(inicio) {
    if (escolha.length === n) {
      [true, false].forEach(function (crescente) {
        const sel = escolha.map(function (j) { return ref[j]; });
        if (!crescente) sel.reverse();
        const ys = sel.map(function (l) { return l.nm; });
        let r = 0, rc = 0;
        if (n >= 3) {
          const c = polyfit(xs, ys, 1);
          r = rms(ys.map(function (y, k) { return y - polyval(c, xs[k]); }));
          rc = Math.abs(c[1]) > 0 ? r / Math.abs(c[1]) : Infinity;
        }
        cand.push({ sel: sel, crescente: crescente, rms: r, rmsCol: rc });
      });
      return;
    }
    for (let j = inicio; j <= L - (n - escolha.length); j++) {
      escolha.push(j);
      combina(j + 1);
      escolha.pop();
    }
  })(0);

  /* Plausible is within a column of a straight line, or twice the best miss.
     Measured in columns and not in nanometres: with three peaks and seven
     lines, 404.66, 435.83 and 487.7 nm fall on this bench's three brightest
     peaks within a tenth of a column, as straight as the right names, at half
     the dispersion. Nothing in the spacing can tell those two apart. */
  cand.sort(function (a, b) { return a.rmsCol - b.rmsCol; });
  const tol = Math.max(2 * cand[0].rmsCol, MESMA_COL);
  const perto = cand.filter(function (c) { return c.rmsCol <= tol; });
  const fica = perto.filter(function (c) { return c.crescente === prefere; })[0] || cand[0];
  return Object.assign({ ordem: ordem, ambiguo: perto.length > 1 }, fica);
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

/* Whether a fit can call itself calibrated.

   The rms of the fitted points is not enough. Order N through exactly N+1
   points passes through every one of them, so its rms is zero whatever names
   they carry. On this bench three points named with one wrong name fitted
   exactly, the screen said calibrated, and the europium check line landed
   18 nm from where it belongs. The checks are the test the rms cannot be: a
   check line more than LIMITE_COL columns off makes the fit suspect too.

   Returns {suspeita, motivos, avisos}: `motivos` say why it is suspect,
   `avisos` are things the operator should know that do not make it so. */
export function avalia(cal, nCol) {
  const d = Math.abs(dispersao(cal, nCol));
  const lim = LIMITE_COL * d;
  const motivos = [], avisos = [];
  if (cal.rms > lim) {
    motivos.push("the residuals are several columns wide, which normally means "
      + "one peak was matched to the wrong line, not that the order is too low");
  }
  let checks = 0;
  (cal.pontos || []).forEach(function (p, k) {
    if (p.usar !== false || !isFinite(p.nm)) return;
    checks++;
    const r = cal.residuos[k];
    if (isFinite(r) && Math.abs(r) > lim) {
      motivos.push("the check line at " + p.nm + " nm lands " + Math.abs(r).toFixed(1)
        + " nm away from it");
    }
  });
  if (cal.n === cal.ordem + 1) {
    avisos.push("order " + cal.ordem + " on " + cal.n + " points passes through "
      + "every one of them, so its rms says nothing"
      + (checks ? "; the check lines are the test" : "; mark another line"));
  }
  return { suspeita: motivos.length > 0, motivos: motivos, avisos: avisos };
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
