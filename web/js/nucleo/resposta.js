/* The instrument response, and how to take it out of an emission spectrum.

   The camera, the grating and the lenses do not pass every wavelength equally:
   the sensor's green filter falls off on both sides, the grating has a blaze,
   and the glass absorbs at the blue end. An emission or a fluorescence spectrum
   comes out multiplied by that curve, so the RATIO of two bands, and the shape
   of a broad one, are wrong by however much the response changes between them.

   Absorbance does not need this: the response multiplies the sample and the
   reference alike and cancels in S/R. Only emission and fluorescence use it.

   The correction is one coefficient per wavelength, multiplied in on READ, like
   every other correction here: what goes to disk stays raw, and a better curve
   can be applied to an old run later. The result is relative irradiance — the
   right shape, in arbitrary units. An absolute scale would need a lamp of known
   power, which is not something a teaching lab has. */

/* Coefficients outside this range are refused: a response curve that varies by
   more than four orders of magnitude means the file is wrong, or the lamp gave
   nothing at that end. */
const K_MIN = 1e-3, K_MAX = 1e3;

/* Reads a coefficient file: one wavelength in nm and one coefficient per line.

   Two layouts, both common:
     546.1,1.32          the CSV this program writes (point decimal, comma
                         separator), with a header line or none
     546,1 1,32          whitespace, tab or semicolon between the two values;
                         here a comma is a decimal separator, as in a file
                         saved by a spreadsheet in a comma locale
   Lines that are not exactly two numbers (headers, comments starting with #)
   are skipped. The wavelengths must rise and there must be at least two.

   Returns {nm: Float64Array, k: Float64Array}. Throws on a file that cannot be
   a response curve, rather than returning one that silently is not. */
export function leCoeficientes(texto) {
  const nm = [], k = [];
  String(texto).split(/\r?\n/).forEach(function (bruta) {
    const l = bruta.trim();
    if (!l || l[0] === "#") return;
    let campos;
    if (/[\s;]/.test(l)) {
      campos = l.split(/[\s;]+/).map(function (c) { return c.replace(",", "."); });
    } else {
      campos = l.split(",");
    }
    if (campos.length !== 2) return;
    const a = Number(campos[0]), b = Number(campos[1]);
    if (campos[0] === "" || campos[1] === "" || !isFinite(a) || !isFinite(b)) return;
    nm.push(a); k.push(b);
  });
  if (nm.length < 2) throw new Error("a response file needs at least two lines of \"nm, coefficient\"");
  for (let i = 0; i < nm.length; i++) {
    if (nm[i] < 200 || nm[i] > 1200) throw new Error(nm[i] + " nm is outside what a webcam sees");
    if (i > 0 && !(nm[i] > nm[i - 1])) throw new Error("the wavelengths must rise: " + nm[i - 1] + " then " + nm[i]);
    if (!(k[i] >= K_MIN && k[i] <= K_MAX)) throw new Error("coefficient " + k[i] + " at " + nm[i] + " nm is not between " + K_MIN + " and " + K_MAX);
  }
  return { nm: Float64Array.from(nm), k: Float64Array.from(k) };
}

/* The curve as CSV, in the same layout leCoeficientes reads first. */
export function escreveCoeficientes(curva, meta) {
  const linhas = ["# LightFlow — instrument response coefficients"];
  Object.keys(meta || {}).forEach(function (c) {
    if (meta[c] !== undefined && meta[c] !== null && meta[c] !== "") linhas.push("# " + c + ": " + meta[c]);
  });
  linhas.push("wavelength_nm,coefficient");
  for (let i = 0; i < curva.nm.length; i++) {
    linhas.push(curva.nm[i].toFixed(2) + "," + curva.k[i].toPrecision(6));
  }
  return linhas.join("\n") + "\n";
}

/* The coefficient at each wavelength of an axis, by linear interpolation.

   NaN outside the range of the curve, not an extrapolation: a straight line
   continued past the last point of a falling response goes to zero or below,
   and multiplying by that invents a spectrum. A gap says what is true — the
   correction is not known there. */
export function coeficientesEm(curva, nms) {
  const n = nms.length, out = new Float32Array(n);
  const X = curva.nm, K = curva.k, m = X.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = nms[i];
    if (!(x >= X[0] && x <= X[m - 1])) { out[i] = NaN; continue; }
    while (j > 0 && X[j] > x) j--;
    while (j < m - 2 && X[j + 1] < x) j++;
    const t = (x - X[j]) / (X[j + 1] - X[j]);
    out[i] = K[j] + t * (K[j + 1] - K[j]);
  }
  return out;
}

/* y times the coefficient, column by column. */
export function aplica(y, coef) {
  const n = y.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i] * coef[i];
  return out;
}

/* Planck's law, relative: the shape of a black body at T kelvin, at nm. The
   constant in front does not matter, because the curve is normalized. */
export function planck(nm, T) {
  const l = nm * 1e-9;
  const c2 = 1.438776877e-2;            // h c / k, in m K
  return Math.pow(l, -5) / Math.expm1(c2 / (l * T));
}

/* The response curve from a lamp of known colour temperature.

   A halogen bulb is close enough to a black body at its filament temperature,
   2800 to 3200 K, for this: k = Planck(T) / (S - D), normalized so the median
   coefficient is 1. Where the lamp gives less than `piso` above the dark, the
   column is dropped, not divided by noise: those are the ends where the
   correction would be the largest and the least known at once. At most `n`
   points are kept, evenly spaced, which is plenty for a curve this smooth and
   keeps the file short enough to read.

   `S` and `D` are the lamp and the dark on the measurement channel; `nms` the
   calibrated axis. */
export function deLampada(S, D, nms, T, opc) {
  opc = opc || {};
  const piso = opc.piso === undefined ? 0.02 : opc.piso;
  const nMax = opc.n || 64;
  const x = [], k = [];
  for (let i = 0; i < S.length; i++) {
    const sinal = S[i] - D[i];
    if (!(sinal > piso) || !isFinite(nms[i])) continue;
    x.push(nms[i]); k.push(planck(nms[i], T) / sinal);
  }
  if (x.length < 2) {
    throw new Error("the lamp is not above the dark anywhere: open the slit or raise the exposure");
  }
  /* A halogen bulb lights every column. One that lights a third or less is a
     line lamp, an LED with gaps, or a dark that was not dark, and the curve
     from it would be the lamp's own spectrum, inverted. */
  const minimo = opc.minFracao === undefined ? 1 / 3 : opc.minFracao;
  if (x.length <= minimo * S.length) {
    throw new Error("the lamp is above the dark in only " + x.length + " of " + S.length
      + " columns. A halogen bulb is continuous; a fluorescent lamp or an LED is "
      + "not, and the curve from it would be wrong.");
  }
  const ordenado = k.slice().sort(function (a, b) { return a - b; });
  const mediana = ordenado[ordenado.length >> 1];
  const passo = Math.max(1, Math.ceil(x.length / nMax));
  const nm = [], kk = [];
  for (let i = 0; i < x.length; i += passo) {
    /* Each kept point is the mean of its run, so the noise of one column does
       not become the curve. */
    let sx = 0, sk = 0, c = 0;
    for (let j = i; j < Math.min(x.length, i + passo); j++) { sx += x[j]; sk += k[j]; c++; }
    const kn = (sk / c) / mediana;
    nm.push(sx / c); kk.push(Math.min(K_MAX, Math.max(K_MIN, kn)));
  }
  /* The calibrated axis can run either way; the file always rises. */
  if (nm.length > 1 && nm[1] < nm[0]) { nm.reverse(); kk.reverse(); }
  return { nm: Float64Array.from(nm), k: Float64Array.from(kk) };
}
