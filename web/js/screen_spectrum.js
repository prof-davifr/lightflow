"use strict";
/* Tab 2 — the spectrum itself.

   Until a dark and a reference exist there is no absorbance to show, so the
   screen falls back to raw linear intensity and says so in the status strip
   rather than drawing a flat line that looks like a finished measurement. */

LF.telas.espectro = (function () {
  let plot = null, ultimo = null, pendente = false;
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
    try {
      return LF.nucleo.photometry.calcula(LF.estado.modo, q, canal);
    } catch (e) {
      LF.mensagem(e.message, true);
      return q.amostra[canal];
    }
  }

  function unidade() {
    return faltando().length ? "Linear intensity (uncorrected)"
      : LF.nucleo.photometry.UNIDADE[LF.estado.modo];
  }

  /* ------------------------------------------------------------ the plot */

  function cria() {
    const el = LF.q("#g-espectro");
    plot = new uPlot({
      width: 600, height: 300,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false }, y: { range: escY.range } },
      axes: [LF.eixo(LF.unidadeX(), 0), LF.eixo(unidade(), "auto")],
      series: [{}].concat(CANAIS.map(function (c) { return LF.serie(c.rot, c.cor); })),
      hooks: {
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
            const a = u.valToPos(xs[i], "x", true);
            const b = u.valToPos(xs[Math.min(j, xs.length - 1)], "x", true);
            ctx.fillRect(a, u.bbox.top, Math.max(1, b - a), u.bbox.height);
            i = j;
          }
          ctx.restore();
        }],
      },
    }, [LF.vazio(2), LF.vazio(2), LF.vazio(2), LF.vazio(2), LF.vazio(2)], el);
    LF.ajusta(plot, el);
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
    const dados = [xs];
    const mostra = visiveis().map(function (c) { return c.k; });
    CANAIS.forEach(function (c) {
      if (mostra.indexOf(c.k) < 0) { dados.push(LF.vazio(n)); return; }
      const y = serieDe(c.k);
      dados.push(y ? Array.from(y) : LF.vazio(n));
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
    ["escuro", "referencia", "branco"].forEach(function (k) {
      const rot = { escuro: "dark", referencia: "reference", branco: "blank" }[k];
      if (q[k]) {
        partes.push("<b>" + rot + "</b> " + q[k].n_quadros + " frames");
      } else if (falta.indexOf(k) >= 0) {
        partes.push('<span class="falta">' + rot + " missing</span>");
      }
    });
    if (q.amostra) partes.push("<b>averaging</b> " + q.amostra.n_quadros + " frames");
    LF.q("#estado-quadros").innerHTML = partes.join("");
    LF.q("#rot-modo").textContent = falta.length
      ? "raw intensity — " + falta.join(" and ") + " missing"
      : LF.q("#modo").options[LF.q("#modo").selectedIndex].text;

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

  function captura(nome) {
    LF.captura(nome, LF.estado.mediaN, function () { pinta(); });
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
    });
    LF.baixa("lightflow-spectrum-" + carimbo() + ".csv", texto, "text/csv");
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
    serieDe: serieDe, unidade: unidade, faltando: faltando,
    get ultimo() { return ultimo; },
    aoEntrar: function () { LF.ajusta(plot, LF.q("#g-espectro")); pinta(); },
  };
})();
