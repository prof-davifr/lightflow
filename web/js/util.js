"use strict";
/* Shared helpers: number formatting, the house palette, and uPlot axes.
   Ported from the sibling project MWFlow, whose axis and sizing fixes were
   paid for in bugs. */

const LF = {
  cor: {
    seq: ["#7ec8d8", "#3ba3bd", "#0f7d99", "#08536b"],
    cat: ["#0089a8", "#a53c74"],
    /* One colour per camera channel, so R/G/B always read the same way. */
    canal: { r: "#c0392b", g: "#1e8449", b: "#2471a3", lum: "#22262b" },
    tinta: "#22262b", tinta2: "#6b7280", grade: "#e4e6ea",
    alerta: "#a53c74", bom: "#0f7d99",
  },
};

/* A `const` at the top of a classic script does NOT become a property of
   `window`. The ES modules under js/nucleo/ need to reach LF, so the bridge is
   explicit. */
window.LF = LF;

/* Each screen file hangs itself here as it loads, and app.js walks the object
   to start them. Declared once, in the first script, so the order of the rest
   does not matter. */
LF.telas = {};

LF.num = function (v, casas) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: casas === undefined ? 3 : casas,
    maximumFractionDigits: casas === undefined ? 3 : casas,
  });
};

/* Wavelengths are always nanometres here, and two decimals is already finer
   than any homemade spectrometer resolves. */
LF.nm = function (v) {
  if (!isFinite(v)) return "—";
  return LF.num(v, 2) + " nm";
};

LF.q = function (sel) { return document.querySelector(sel); };
LF.qq = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

/* Saves a payload as a file. This is the copy the operator walks away with. */
LF.baixa = function (nome, conteudo, tipo) {
  const b = conteudo instanceof Blob
    ? conteudo : new Blob([conteudo], { type: tipo || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
};

/* uPlot breaks if a WHOLE series is null: it reads `.length` off it. A null
   inside the array is fine; the null array is not. */
LF.vazio = function (n) { return new Array(n).fill(null); };

/* Decimal places taken from the spacing between the axis ticks. A fixed count
   is wrong in both directions: on a 545.0 to 547.0 nm axis three places make
   every label read the same, and on a 380 to 780 nm axis they only add zeros. */
function casasDe(vs) {
  let passo = Infinity;
  for (let i = 1; i < vs.length; i++) {
    const d = Math.abs(vs[i] - vs[i - 1]);
    if (d > 0 && d < passo) passo = d;
  }
  if (!isFinite(passo)) return 3;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(passo))));
}

/* Width of the vertical axis, from the widest label it will actually write.
   uPlot does not measure this itself: the default is 50 px, and "0.30103" gets
   clipped there. The horizontal axis keeps the default height. */
function tamanhoEixo(u, vs, idx) {
  const lado = u.axes[idx].side;
  if (lado === 0 || lado === 2) return 30;
  let n = 0;
  (vs || []).forEach(function (s) { n = Math.max(n, String(s).length); });
  return Math.min(120, Math.max(38, n * 6.6 + 16));
}

/* House-style uPlot axis: no frame on the top or the right, a discreet grid,
   and labels sized to fit. `casas` takes a decimal count or "auto". */
LF.eixo = function (rotulo, casas) {
  return {
    label: rotulo,
    labelSize: 44,
    labelFont: "12px system-ui",
    font: "11px system-ui",
    stroke: LF.cor.tinta2,
    grid: { stroke: LF.cor.grade, width: 1 },
    ticks: { stroke: LF.cor.grade, width: 1, size: 4 },
    size: tamanhoEixo,
    values: function (u, vs) {
      const c = casas === "auto" ? casasDe(vs)
        : (casas === undefined ? 1 : casas);
      return vs.map(function (v) { return LF.num(v, c); });
    },
  };
};

/* Range for an axis that has to show more than its points: the zero of a
   baseline, or room above a peak. Without this uPlot fits the scale to the
   values alone and clips whatever is drawn outside. */
LF.faixa = function (lo, hi, extra) {
  extra = extra || {};
  if (lo === null || hi === null || !isFinite(lo) || !isFinite(hi)) {
    return [0, 1];
  }
  if (extra.inclui_zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi <= lo) {                       // every value identical
    const d = Math.abs(hi) * 1e-6 || 1;
    lo -= d; hi += d;
  }
  const folga = (hi - lo) * (extra.margem === undefined ? 0.06 : extra.margem);
  return [lo - folga, hi + folga];
};

LF.serie = function (rotulo, cor, largura) {
  return {
    label: rotulo, stroke: cor, width: largura || 1.5,
    points: { show: false },
    value: function (u, v) { return v === null ? "—" : LF.num(v, 4); },
  };
};

/* Resizes a uPlot chart to the element that holds it.
   THE LEGEND IS NOT INSIDE THE HEIGHT `setSize` ASKS FOR: it is a table below
   the drawing area. Without subtracting it the chart overflows its box by the
   legend height and lands on top of whatever comes next. */
LF.ajusta = function (plot, el) {
  if (!plot || !el) return;
  const r = el.getBoundingClientRect();
  const leg = plot.root ? plot.root.querySelector(".u-legend") : null;
  const alturaLegenda = leg ? leg.getBoundingClientRect().height : 0;
  const altura = Math.floor(r.height - 16 - alturaLegenda);
  if (r.width > 20 && altura > 20) {
    plot.setSize({ width: Math.floor(r.width - 16), height: altura });
  }
};

/* Status pill in the header. `estado` is "", "ok" or "mau". */
LF.selo = function (sel, texto, estado) {
  const el = LF.q(sel);
  if (!el) return;
  el.textContent = texto;
  el.className = "selo" + (estado ? " " + estado : "");
};

/* One-line message in the footer. Errors stay until the next message. */
LF.mensagem = function (texto, erro) {
  const el = LF.q("#mensagem");
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle("erro", !!erro);
};

/* Min/max decimation, two points per pixel column. A plain stride would hide
   narrow lines — exactly what a spectrum is made of. */
LF.decima = function (xs, ys, largura) {
  const n = xs.length;
  if (n <= largura * 2 || largura < 2) return [xs, ys];
  const passo = n / largura;
  const X = [], Y = [];
  for (let c = 0; c < largura; c++) {
    const a = Math.floor(c * passo), b = Math.min(n, Math.floor((c + 1) * passo));
    if (b <= a) continue;
    let lo = Infinity, hi = -Infinity, ilo = a, ihi = a;
    for (let k = a; k < b; k++) {
      const v = ys[k];
      if (v < lo) { lo = v; ilo = k; }
      if (v > hi) { hi = v; ihi = k; }
    }
    if (ilo <= ihi) { X.push(xs[ilo], xs[ihi]); Y.push(lo, hi); }
    else { X.push(xs[ihi], xs[ilo]); Y.push(hi, lo); }
  }
  return [X, Y];
};
