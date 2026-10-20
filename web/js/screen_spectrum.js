"use strict";
/* Tab 3 — the spectrum itself.

   Until a dark and a reference exist there is no absorbance to show, so the
   screen falls back to raw linear intensity and says so in the status strip
   rather than drawing a flat line that looks like a finished measurement. */

LF.telas.espectro = (function () {
  let plot = null, ultimo = null, pendente = false;
  let rotulos = [];          // [{x, y, txt}] for the peak labels, in plot units
  /* A log axis that also takes zero and negative values: asinh is linear
     within this distance of zero and logarithmic beyond it. A plain log axis
     cannot draw an absorbance baseline at all, since half of it is below 0. */
  const ASINH = 1e-3;
  /* A dark or a reference older than this gets a warning in the strip. A lamp
     drifts as it warms, and the absorbance drifts with it. */
  const IDADE_AVISO = 15 * 60 * 1000;
  /* Absorbance sits on a baseline, so the auto range keeps zero in view. */
  const escY = LF.escalaY({ faixa: { inclui_zero: true } });
  const CANAIS = [
    { k: "r", rot: "R", cor: LF.cor.canal.r },
    { k: "g", rot: "G", cor: LF.cor.canal.g },
    { k: "b", rot: "B", cor: LF.cor.canal.b },
    { k: "lum", rot: "lum", cor: LF.cor.canal.lum },
  ];

  function visiveis() {
    return CANAIS.filter(function (c) { return LF.q("#ver-" + c.k).checked; });
  }

  /* What can actually be computed with the frames in hand. */
  function faltando() {
    const exige = LF.nucleo.photometry.EXIGE[LF.estado.modo] || [];
    return exige.filter(function (k) { return !LF.estado.quadros[k]; });
  }

  /* The y values for one channel, in whichever mode is selected, or the raw
     linear intensity when the mode cannot be computed yet. */
  function serieDe(canal) {
    const q = LF.estado.quadros;
    if (!q.amostra) return null;
    if (faltando().length) return q.amostra[canal];
    let y;
    try {
      y = LF.nucleo.photometry.calcula(LF.estado.modo, q, canal);
    } catch (e) {
      LF.mensagem(e.message, true);
      return q.amostra[canal];
    }
    /* The response curve was measured on the measurement channel, so it
       corrects that channel and no other. */
    if (canal === LF.estado.canal) y = LF.resposta.corrige(y, LF.estado.modo, eixoNm()).y;
    return y;
  }

  /* True when the mode can be computed and every column of it is NaN: the
     plot is blank, and the strip has to say so instead of looking finished. */
  function semValor() {
    const y = serieDe(LF.estado.canal);
    if (!y) return false;
    for (let i = 0; i < y.length; i++) if (!isNaN(y[i])) return false;
    return true;
  }

  /* The wavelength axis, or null while the columns have none. */
  function eixoNm() { return LF.calibrado() ? LF.estado.eixo : null; }

  function unidade() {
    if (faltando().length) return "Linear intensity (uncorrected)";
    if (LF.resposta.ativa(LF.estado.modo, eixoNm())) return "Relative irradiance (response corrected)";
    return LF.nucleo.photometry.UNIDADE[LF.estado.modo];
  }

  /* ------------------------------------------------------------ the plot */

  /* Colour under the measurement channel, by wavelength. Drawn after the grid
     and before the lines, so both stay on top of it. Only on a calibrated axis:
     a column number has no colour. */
  function pintaCores(u) {
    if (!LF.q("#ver-cores").checked || !LF.calibrado()) return;
    const k = 1 + CANAIS.findIndex(function (c) { return c.k === LF.estado.canal; });
    if (!u.series[k] || !u.series[k].show) return;
    const xs = u.data[0], ys = u.data[k];
    if (!xs || !ys) return;
    const b = u.bbox, ctx = u.ctx;
    const mn = u.scales.y.min, mx = u.scales.y.max;
    const base = u.valToPos(Math.min(mx, Math.max(mn, 0)), "y", true);
    ctx.save();
    ctx.beginPath(); ctx.rect(b.left, b.top, b.width, b.height); ctx.clip();
    for (let i = 0; i < xs.length; i++) {
      const v = ys[i];
      if (v === null || !isFinite(v)) continue;
      const x = u.valToPos(xs[i], "x", true);
      const xa = i > 0 ? (x + u.valToPos(xs[i - 1], "x", true)) / 2 : x;
      const xb = i < xs.length - 1 ? (x + u.valToPos(xs[i + 1], "x", true)) / 2 : x;
      const y = u.valToPos(v, "y", true);
      ctx.fillStyle = LF.nucleo.cor.cssDe(xs[i], 0.6);
      ctx.fillRect(Math.min(xa, xb), Math.min(y, base), Math.abs(xb - xa) + 0.5, Math.abs(base - y));
    }
    ctx.restore();
  }

  /* The wavelength above each peak in the table, in a small box. */
  function pintaRotulos(u) {
    if (!LF.q("#ver-rotulos").checked || !rotulos.length) return;
    const ctx = u.ctx, pr = uPlot.pxRatio || 1, b = u.bbox;
    ctx.save();
    ctx.font = Math.round(11 * pr) + "px system-ui";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    rotulos.forEach(function (r) {
      if (!isFinite(r.y)) return;
      const x = u.valToPos(r.x, "x", true);
      const y = Math.max(b.top + 16 * pr, u.valToPos(r.y, "y", true) - 4 * pr);
      if (x < b.left || x > b.left + b.width) return;
      const w = ctx.measureText(r.txt).width + 6 * pr, h = 14 * pr;
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.strokeStyle = LF.cor.tinta2; ctx.lineWidth = pr;
      ctx.strokeRect(x - w / 2, y - h, w, h);
      ctx.fillStyle = LF.cor.tinta;
      ctx.fillText(r.txt, x, y - 1.5 * pr);
    });
    ctx.restore();
  }

  /* Ticks for the log axis: zero and the powers of ten inside the range. The
     splits uPlot gives an asinh axis by itself crowd the labels on top of each
     other once the range crosses zero. */
  function marcasLog(u, idx, mn, mx) {
    const out = [];
    if (mn <= 0 && mx >= 0) out.push(0);
    for (let k = -6; k <= 6; k++) {
      const v = Math.pow(10, k);
      if (v < ASINH) continue;
      if (v >= mn && v <= mx) out.push(v);
      if (-v >= mn && -v <= mx) out.push(-v);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function rotulosLog(u, vs) {
    return vs.map(function (v) {
      return v === 0 ? "0" : LF.num(v, Math.max(0, -Math.floor(Math.log10(Math.abs(v)))));
    });
  }

  function cria() {
    const el = LF.q("#g-espectro");
    const log = LF.q("#esc-log").value === "log";
    const eixoY = LF.eixo(unidade(), "auto");
    if (log) { eixoY.splits = marcasLog; eixoY.values = rotulosLog; }
    plot = new uPlot({
      width: 600, height: 300,
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: false },
        y: log ? { distr: 4, asinh: ASINH, range: escY.range } : { range: escY.range },
      },
      axes: [LF.eixo(LF.unidadeX(), 0), eixoY],
      series: [{}].concat(CANAIS.map(function (c) { return LF.serie(c.rot, c.cor); })),
      hooks: {
        drawAxes: [pintaCores],
        /* Clipped columns are shaded in the alert colour straight onto the
           canvas. A gap in the line already says "no data"; this says why. */
        draw: [function (u) {
          if (!ultimo || !ultimo.clip) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.fillStyle = "rgba(165,60,116,.20)";
          const xs = LF.eixoAtual(ultimo.clip.length);
          let i = 0;
          while (i < ultimo.clip.length) {
            if (!ultimo.clip[i]) { i++; continue; }
            let j = i;
            while (j < ultimo.clip.length && ultimo.clip[j]) j++;
            /* Both edges by value, either way round: on a falling axis the
               last column is the left edge. */
            const a = u.valToPos(xs[i], "x", true);
            const b = u.valToPos(xs[Math.min(j, xs.length - 1)], "x", true);
            ctx.fillRect(Math.min(a, b), u.bbox.top, Math.max(1, Math.abs(b - a)), u.bbox.height);
            i = j;
          }
          ctx.restore();
        }, pintaRotulos],
      },
    }, [LF.vazio(2), LF.vazio(2), LF.vazio(2), LF.vazio(2), LF.vazio(2)], el);
    LF.ajusta(plot, el);
  }

  /* uPlot fixes a scale's distribution when the chart is built, so a change
     between linear and log builds the chart again. */
  function refaz() {
    if (plot) plot.destroy();
    cria();
    pinta();
  }

  function aoEspectro(m) {
    ultimo = m;
    if (LF.telaAtual !== "espectro" || pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; pinta(); });
  }

  function pinta() {
    if (!plot || !ultimo) return;
    const n = ultimo.r.length;
    const xs = Array.from(LF.eixoAtual(n));
    /* A calibration can make the wavelength fall with the column, and does on
       this bench. uPlot looks the cursor up by bisection, which assumes x
       rises, so the chart gets every series reversed; nothing else does. */
    const vira = n > 1 && xs[n - 1] < xs[0];
    const ordem = function (a) { return vira ? a.slice().reverse() : a; };
    const dados = [ordem(xs)];
    const mostra = visiveis().map(function (c) { return c.k; });
    CANAIS.forEach(function (c) {
      if (mostra.indexOf(c.k) < 0) { dados.push(LF.vazio(n)); return; }
      const y = serieDe(c.k);
      dados.push(y ? ordem(LF.serieY(y)) : LF.vazio(n));
    });
    plot.setData(dados);
    CANAIS.forEach(function (c, k) {
      plot.setSeries(k + 1, { show: mostra.indexOf(c.k) >= 0 }, false);
    });
    plot.axes[0].label = LF.unidadeX();
    plot.axes[1].label = unidade();
    LF.ajusta(plot, LF.q("#g-espectro"));
    mostraTira();
    mostraPicos(xs);
  }

  function mostraTira() {
    const q = LF.estado.quadros;
    const falta = faltando();
    const partes = [];
    const agora = LF.configAtual();
    ["escuro", "referencia", "branco"].forEach(function (k) {
      const rot = LF.ROT_QUADRO[k];
      if (q[k]) {
        partes.push("<b>" + rot + "</b> " + q[k].n_quadros + " frames · " + idade(q[k].t));
        const outra = divergencia(q[k].config, agora);
        if (outra) {
          partes.push('<span class="falta" title="A ' + rot + " is only valid for the "
            + "settings it was taken with. Capture it again.\">" + rot + " taken at another "
            + outra + "</span>");
        } else if (k !== "escuro" && Date.now() - q[k].t > IDADE_AVISO) {
          partes.push('<span class="falta" title="A lamp drifts as it warms and the '
            + "bench moves. Take the sample out and check that the absorbance of the "
            + "blank still reads zero; if not, capture the " + rot + ' again.">'
            + rot + " is " + idade(q[k].t) + " old — check it with the blank</span>");
        }
      } else if (falta.indexOf(k) >= 0) {
        partes.push('<span class="falta">' + rot + " missing</span>");
      }
    });
    if (q.amostra) {
      const f = { exp: "running mean", pico: "peak hold" }[q.amostra.filtro];
      partes.push(f ? "<b>" + f + "</b> " + q.amostra.n_quadros + " frames"
        : "<b>averaging</b> " + q.amostra.n_quadros + " frames");
    }
    LF.q("#estado-quadros").innerHTML = partes.join("");
    const rotModo = LF.q("#modo").options[LF.q("#modo").selectedIndex].text;
    LF.q("#rot-modo").textContent = falta.length
      ? "raw intensity — " + falta.map(function (k) { return LF.ROT_QUADRO[k]; })
        .join(" and ") + " missing"
      : (semValor() ? rotModo + " — no column has a value" : rotModo);

    /* The honest ceiling on absorbance, from the measured dark noise. */
    const el = LF.q("#rot-amax");
    if (q.escuro && q.referencia && LF.estado.modo === "absorbance") {
      const a = LF.nucleo.photometry.aMax(q.escuro, q.referencia, LF.estado.canal);
      el.textContent = isFinite(a) ? "A max ≈ " + LF.num(a, 2) : "A max —";
      el.title = "Above this, the signal is smaller than three times the dark "
        + "noise, and any number printed there is noise wearing a value.";
    } else {
      el.textContent = "—";
    }
  }

  function idade(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return Math.round(s) + " s";
    if (s < 5400) return Math.round(s / 60) + " min";
    return LF.num(s / 3600, 1) + " h";
  }

  /* Which setting differs between a captured frame and now, or "". The
     exposure is compared with a tolerance, because a camera may round the
     value it was given. */
  function divergencia(c, agora) {
    if (!c) return "";
    if (isFinite(c.exposicao) && isFinite(agora.exposicao)
      && Math.abs(c.exposicao - agora.exposicao) > 0.01 * Math.max(c.exposicao, agora.exposicao)) return "exposure";
    if (c.temp !== agora.temp) return "white balance";
    if (c.gama !== agora.gama) return "linearization";
    if (c.assinatura && agora.assinatura && c.assinatura !== agora.assinatura) return "region of interest";
    return "";
  }

  /* The table always holds this many rows, blank ones included. The plot box
     above it is flex: 1, so a table that grew and shrank with the peak count
     resized the plot on every frame: the y range stayed pinned, but its pixels
     moved, and a frozen axis still bounced. */
  const LINHAS_PICOS = 8;

  function completaPicos(corpo) {
    while (corpo.rows.length < LINHAS_PICOS) {
      corpo.insertRow().innerHTML = "<td>&nbsp;</td><td></td><td></td><td></td>";
    }
  }

  function mostraPicos(xs) {
    const corpo = LF.q("#tab-picos tbody");
    const y = serieDe(LF.estado.canal);
    corpo.innerHTML = "";
    rotulos = [];
    if (!y) { completaPicos(corpo); return; }
    /* In absorbance and transmittance the interesting feature is a band, and in
       transmittance it points down, so the search runs on the negated curve. */
    const procura = LF.estado.modo === "transmittance"
      ? Float32Array.from(y, function (v) { return -v; }) : y;
    const picos = LF.nucleo.peaks.acha(procura).slice(0, LINHAS_PICOS);
    picos.forEach(function (p) {
      const nm = LF.calibrado()
        ? LF.nucleo.calibration.toNm(LF.estado.cal, p.px) : p.px;
      const l = LF.nucleo.peaks.fwhm(xs, procura, p.i);
      rotulos.push({ x: nm, y: y[p.i],
        txt: LF.calibrado() ? LF.num(nm, 1) : LF.num(nm, 0) + " px" });
      const tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"num\">" + (LF.calibrado() ? LF.nm(nm) : LF.num(nm, 1) + " px")
        + "</td><td class=\"num\">" + LF.num(y[p.i], 4)
        + "</td><td class=\"num\">" + (isFinite(l) ? LF.num(l, 2) : "—")
        + "</td><td class=\"num\">" + LF.num(p.prom, 4) + "</td>";
      corpo.appendChild(tr);
    });
    completaPicos(corpo);
  }

  /* --------------------------------------------------------------- actions */

  /* A dark with light in it, or a reference on a line lamp, empties the plot
     without any error. Both are checked as soon as the frames are in. */
  function captura(nome) {
    LF.captura(nome, LF.estado.mediaN, function () {
      const q = LF.estado.quadros, fot = LF.nucleo.photometry, c = LF.estado.canal;
      let aviso = null;
      if (nome === "escuro") aviso = fot.confereEscuro(q.escuro, c);
      if (!aviso && q.escuro && q.referencia && (nome === "escuro" || nome === "referencia")) {
        aviso = fot.confereReferencia(q.referencia, q.escuro, c).aviso;
      }
      if (aviso) LF.mensagem(aviso, true);
      pinta();
    });
  }

  function csv() {
    const y = serieDe(LF.estado.canal);
    if (!y) { LF.mensagem("nothing to export yet", true); return; }
    const xs = LF.eixoAtual(y.length);
    const texto = LF.nucleo.exportfile.csvEspectro(xs, y, {
      x: LF.calibrado() ? "wavelength_nm" : "column_px",
      y: LF.estado.modo,
      canal: LF.estado.canal,
      unidade: unidade(),
      calibrado: LF.calibrado(),
      resposta: LF.resposta.ativa(LF.estado.modo, eixoNm()) ? LF.estado.resposta.nome : undefined,
    });
    LF.baixa("lightflow-spectrum-" + carimbo() + ".csv", texto, "text/csv");
  }

  /* The chart as a PNG, with what it is written above it. The legend is HTML
     and does not come along, so the series and the settings go in the title. */
  function png() {
    if (!plot || !ultimo) { LF.mensagem("nothing to save yet", true); return; }
    const fonte = plot.ctx.canvas, pr = uPlot.pxRatio || 1;
    const topo = Math.round(44 * pr);
    const c = document.createElement("canvas");
    c.width = fonte.width; c.height = fonte.height + topo;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    const modo = LF.q("#modo").options[LF.q("#modo").selectedIndex].text;
    const series = visiveis().map(function (s) { return s.rot; }).join(", ");
    const cal = LF.calibrado() ? "calibrated" + (LF.estado.cal && LF.estado.cal.nome ? " (" + LF.estado.cal.nome + ")" : "") : "uncalibrated";
    const linha2 = [new Date().toLocaleString(), "series " + series, cal,
      ultimo.n_quadros + " frames" + (ultimo.filtro === "exp" ? " running mean" : ultimo.filtro === "pico" ? " peak hold" : ""),
      LF.resposta.ativa(LF.estado.modo, eixoNm()) ? "response corrected" : ""]
      .filter(Boolean).join(" · ");
    ctx.fillStyle = LF.cor.tinta; ctx.font = "600 " + Math.round(13 * pr) + "px system-ui";
    ctx.fillText("LightFlow — " + modo + " — " + unidade(), 10 * pr, 18 * pr);
    ctx.fillStyle = LF.cor.tinta2; ctx.font = Math.round(11 * pr) + "px system-ui";
    ctx.fillText(linha2, 10 * pr, 35 * pr);
    ctx.drawImage(fonte, 0, topo);
    c.toBlob(function (b) {
      LF.baixa("lightflow-spectrum-" + carimbo() + ".png", b, "image/png");
    }, "image/png");
  }

  function carimbo() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function inicia() {
    completaPicos(LF.q("#tab-picos tbody"));
    cria();
    LF.aoEspectro(aoEspectro);
    LF.ligaEscalaY(escY, { modo: "#esc-y", min: "#esc-y-min",
      max: "#esc-y-max", bt: "#bt-esc-y" }, pinta);
    LF.q("#bt-escuro").addEventListener("click", function () { captura("escuro"); });
    LF.q("#bt-referencia").addEventListener("click", function () { captura("referencia"); });
    LF.q("#bt-branco").addEventListener("click", function () { captura("branco"); });
    LF.q("#bt-csv-espectro").addEventListener("click", csv);
    LF.q("#bt-png-espectro").addEventListener("click", png);
    LF.q("#ver-cores").addEventListener("change", function () {
      if (this.checked && !LF.calibrado()) {
        LF.mensagem("the colours need a calibration: a column number has no colour", true);
      }
      pinta();
    });
    LF.q("#ver-rotulos").addEventListener("change", pinta);
    LF.q("#esc-log").addEventListener("change", refaz);
    LF.q("#bt-salvar-espectro").addEventListener("click", function () {
      LF.telas.dados.salvaEspectro(ultimo);
    });
    CANAIS.forEach(function (c) {
      LF.q("#ver-" + c.k).addEventListener("change", pinta);
    });
    trocaModo();
  }

  function trocaModo() {
    /* A range fixed for absorbance, say 0 to 1, hides transmittance — which
       runs to 100 — completely, and the screen would just look broken. The
       axis therefore goes back to auto whenever the quantity changes. */
    if (escY.modo === "manual" && escY.solta) {
      escY.solta();
      LF.mensagem("the y axis went back to auto because the mode changed");
    }
    const falta = faltando();
    if (falta.length) {
      const rot = { escuro: "a dark frame", referencia: "a reference",
        branco: "a blank" };
      LF.mensagem("this mode needs " + falta.map(function (k) { return rot[k]; })
        .join(" and ") + " — capture it before reading any number off the curve",
        true);
    } else {
      LF.mensagem("mode: " + LF.q("#modo").options[LF.q("#modo").selectedIndex].text);
    }
    pinta();
  }

  return {
    inicia: inicia, redesenha: pinta, trocaModo: trocaModo,
    solta: function () { if (escY.solta) escY.solta(); },
    serieDe: serieDe, unidade: unidade, faltando: faltando, refaz: refaz,
    get ultimo() { return ultimo; },
    aoEntrar: function () { LF.ajusta(plot, LF.q("#g-espectro")); pinta(); },
  };
})();
