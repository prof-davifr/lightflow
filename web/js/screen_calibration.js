"use strict";
/* Tab 3 — turning columns into nanometres.

   The workflow this screen is built around: point the slit at a fluorescent
   tube, press "Add the strongest unused peak" a few times, press "Load its
   lines" to name them in order, fit, and read the residuals. Naming in order
   works because a grating puts wavelength monotonically along the sensor, so
   the k-th peak from the left is the k-th line. */

LF.telas.calibracao = (function () {
  let plot = null, plotRes = null, pendente = false;
  let pontos = [], ultimoY = null, ultimoAjuste = null;

  /* ------------------------------------------------------------ the plot */

  function cria() {
    const el = LF.q("#g-cal");
    plot = new uPlot({
      width: 600, height: 260,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [LF.eixo("Column (px)", 0), LF.eixo("Linear intensity", "auto")],
      series: [{}, LF.serie("signal", LF.cor.seq3)],
      hooks: {
        draw: [function (u) {
          /* Every marked point gets a line, so it is obvious which peaks are
             already claimed before another one is added. */
          const ctx = u.ctx;
          ctx.save();
          pontos.forEach(function (p, k) {
            const x = u.valToPos(p.px, "x", true);
            ctx.strokeStyle = p.usar === false ? LF.cor.tinta2 : LF.cor.cat2;
            ctx.setLineDash(p.usar === false ? [3, 3] : []);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = LF.cor.cat2;
            ctx.font = "10px system-ui";
            ctx.fillText(isFinite(p.nm) ? LF.num(p.nm, 1) : "?" + (k + 1),
              x + 3, u.bbox.top + 11);
          });
          ctx.restore();
        }],
      },
    }, [LF.vazio(2), LF.vazio(2)], el);
    LF.ajusta(plot, el);

    plot.over.addEventListener("click", function () {
      if (!ultimoY || plot.cursor.idx === null || plot.cursor.idx === undefined) return;
      adiciona(plot.cursor.idx);
    });

    const elR = LF.q("#g-residuos");
    plotRes = new uPlot({
      width: 600, height: 130,
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: function (u, lo, hi) {
        return LF.faixa(lo, hi, { inclui_zero: true, margem: 0.2 });
      } } },
      axes: [LF.eixo("Column (px)", 0), LF.eixo("Residual (nm)", "auto")],
      series: [{}, { label: "residual", stroke: LF.cor.cat2, width: 0,
        points: { show: true, size: 7, fill: LF.cor.cat2 } }],
    }, [LF.vazio(2), LF.vazio(2)], elR);
    LF.ajusta(plotRes, elR);
  }

  function aoEspectro(m) {
    ultimoY = m[LF.estado.canal];
    if (LF.telaAtual !== "calibracao" || pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; pinta(); });
  }

  function pinta() {
    if (!plot || !ultimoY) return;
    const n = ultimoY.length;
    const xs = new Array(n);
    for (let i = 0; i < n; i++) xs[i] = i;
    plot.setData([xs, Array.from(ultimoY)]);
    LF.ajusta(plot, LF.q("#g-cal"));
  }

  /* -------------------------------------------------------------- points */

  function adiciona(i) {
    if (!ultimoY) return;
    const px = LF.nucleo.peaks.refina(ultimoY, i);
    if (pontos.some(function (p) { return Math.abs(p.px - px) < 3; })) {
      LF.mensagem("there is already a point within three columns of that one");
      return;
    }
    pontos.push({ px: px, nm: NaN, rotulo: "", usar: true });
    pontos.sort(function (a, b) { return a.px - b.px; });
    mostraTabela();
    plot.redraw();
  }

  function maisForte() {
    if (!ultimoY) { LF.mensagem("no spectrum yet", true); return; }
    const picos = LF.nucleo.peaks.acha(ultimoY);
    const livre = picos.filter(function (p) {
      return !pontos.some(function (q) { return Math.abs(q.px - p.px) < 5; });
    });
    if (!livre.length) { LF.mensagem("every peak found is already marked"); return; }
    livre.sort(function (a, b) { return b.prom - a.prom; });
    adiciona(livre[0].i);
  }

  function mostraTabela() {
    const corpo = LF.q("#tab-cal tbody");
    corpo.innerHTML = "";
    pontos.forEach(function (p, k) {
      const tr = document.createElement("tr");
      const res = ultimoAjuste && ultimoAjuste.residuos[k];
      tr.innerHTML =
        '<td><input type="checkbox" ' + (p.usar === false ? "" : "checked") + "></td>"
        + '<td class="num">' + LF.num(p.px, 2) + "</td>"
        + '<td><input type="number" step="0.01" list="linhas-preset" value="'
        + (isFinite(p.nm) ? p.nm : "") + '"></td>'
        + '<td><input type="text" value="' + (p.rotulo || "") + '"></td>'
        + '<td class="num' + (isFinite(res) && Math.abs(res) > 1 ? " ruim" : "") + '">'
        + (isFinite(res) ? LF.num(res, 3) : "—") + "</td>"
        + '<td><button title="remove">×</button></td>';
      const [cx, , inm, irot, , bt] = tr.children;
      cx.firstChild.addEventListener("change", function () {
        p.usar = this.checked; plot.redraw();
      });
      inm.firstChild.addEventListener("change", function () {
        p.nm = parseFloat(this.value); plot.redraw();
      });
      irot.firstChild.addEventListener("change", function () { p.rotulo = this.value; });
      bt.firstChild.addEventListener("click", function () {
        pontos.splice(k, 1); mostraTabela(); plot.redraw();
      });
      corpo.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------- presets */

  function ligaPresets() {
    const sel = LF.q("#preset");
    const L = LF.nucleo.calibration.LINHAS;
    Object.keys(L).forEach(function (k) {
      const o = document.createElement("option");
      o.value = k; o.textContent = L[k].rotulo;
      sel.appendChild(o);
    });
    sel.addEventListener("change", mostraNota);
    mostraNota();
  }

  function presetAtual() {
    return LF.nucleo.calibration.LINHAS[LF.q("#preset").value];
  }

  function mostraNota() {
    const p = presetAtual();
    LF.q("#nota-preset").textContent = p ? p.nota : "";
    /* The datalist gives every nm box a dropdown of that source's lines. */
    let dl = LF.q("#linhas-preset");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "linhas-preset";
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    (p ? p.pontos : []).forEach(function (l) {
      const o = document.createElement("option");
      o.value = l.nm; o.label = l.rotulo;
      dl.appendChild(o);
    });
  }

  /* Names the marked peaks in order. A grating is monotonic, so the k-th peak
     from the left is the k-th line of the source; that is what makes this safe
     and it is also exactly why it breaks if a peak was marked twice or a faint
     line was missed. The residuals afterwards are what catch that. */
  function carregaLinhas() {
    const p = presetAtual();
    if (!p) return;
    const linhas = p.pontos.slice().sort(function (a, b) { return a.nm - b.nm; });
    if (pontos.length > linhas.length) {
      LF.mensagem("there are more marked peaks (" + pontos.length + ") than lines in "
        + "this source (" + linhas.length + ") — remove the extra ones first", true);
      return;
    }
    pontos.sort(function (a, b) { return a.px - b.px; });
    pontos.forEach(function (q, k) {
      q.nm = linhas[k].nm;
      q.rotulo = linhas[k].rotulo;
      q.usar = linhas[k].ajuste !== false;
    });
    mostraTabela();
    plot.redraw();
    LF.mensagem("named " + pontos.length + " peaks in order — check that each label "
      + "matches the line you meant before fitting");
  }

  /* ---------------------------------------------------------------- fit */

  function ajusta() {
    const bons = pontos.filter(function (p) { return isFinite(p.nm); });
    if (bons.length !== pontos.length) {
      LF.mensagem("every marked peak needs a wavelength", true);
      return;
    }
    const ordem = parseInt(LF.q("#ordem").value, 10);
    let cal;
    try {
      cal = LF.nucleo.calibration.ajusta(pontos, ordem, {
        n_col: LF.estado.nCol, assinatura: LF.estado.assinatura,
      });
    } catch (e) {
      LF.mensagem(e.message, true);
      return;
    }
    ultimoAjuste = cal;
    aplica(cal);
    mostraTabela();

    const d = LF.nucleo.calibration.dispersao(cal, LF.estado.nCol);
    LF.q("#rot-rms").textContent = "rms " + LF.num(cal.rms, 3) + " nm  ·  worst "
      + LF.num(cal.max, 3) + " nm  ·  " + LF.num(Math.abs(d), 3) + " nm per column";
    LF.q("#rot-rms").className = "marca";

    const xs = pontos.map(function (p) { return p.px; });
    plotRes.setData([xs, cal.residuos]);
    LF.ajusta(plotRes, LF.q("#g-residuos"));

    /* A residual much larger than a column's worth of wavelength means a peak
       was named as the wrong line; the fit itself cannot tell you that. */
    const av = LF.q("#aviso-cal");
    if (cal.rms > Math.abs(d) * 3) {
      av.textContent = "The residuals are several columns wide. That normally "
        + "means one peak was matched to the wrong line, not that the order is "
        + "too low. Check the labels before raising the order.";
    } else {
      av.textContent = "";
    }
    LF.mensagem("fitted order " + ordem + " on " + cal.n + " points, rms "
      + LF.num(cal.rms, 3) + " nm");
  }

  function aplica(cal) {
    LF.estado.cal = cal;
    LF.estado.eixo = LF.nucleo.calibration.eixo(cal, LF.estado.nCol);
    const problemas = LF.nucleo.calibration.confere(cal, LF.estado.assinatura, LF.estado.nCol);
    LF.selo("#selo-cal", problemas.length ? "calibration stale" : "calibrated",
      problemas.length ? "mau" : "ok");
    if (problemas.length) LF.q("#aviso-cal").textContent = problemas.join("; ");
    LF.telas.espectro.redesenha();
    LF.telas.cinetica.recalibra();
  }

  /* ------------------------------------------------------------- storage */

  async function salva() {
    if (!ultimoAjuste) { LF.mensagem("fit something first", true); return; }
    const nome = prompt("Name for this calibration",
      "cal " + new Date().toLocaleDateString());
    if (!nome) return;
    ultimoAjuste.nome = nome;
    await LF.nucleo.storage.salvaCal(ultimoAjuste);
    await listaSalvas();
    LF.mensagem("calibration \"" + nome + "\" saved");
  }

  async function listaSalvas() {
    const corpo = LF.q("#tab-cal-salvas tbody");
    corpo.innerHTML = "";
    let cs = [];
    try { cs = await LF.nucleo.storage.listaCals(); } catch (e) { return; }
    if (!cs.length) {
      corpo.innerHTML = '<tr><td>none saved yet</td></tr>';
      return;
    }
    cs.forEach(function (c) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + c.nome + "</td>"
        + '<td class="num">order ' + c.ordem + "</td>"
        + '<td class="num">' + LF.num(c.rms, 3) + " nm</td>"
        + "<td><button>load</button> <button>×</button></td>";
      const bts = tr.lastChild.children;
      bts[0].addEventListener("click", function () {
        pontos = c.pontos.map(function (p) { return Object.assign({}, p); });
        ultimoAjuste = c;
        aplica(c);
        mostraTabela();
        LF.q("#ordem").value = c.ordem;
        LF.q("#rot-rms").textContent = "rms " + LF.num(c.rms, 3) + " nm (loaded)";
        LF.mensagem("loaded \"" + c.nome + "\"");
      });
      bts[1].addEventListener("click", async function () {
        await LF.nucleo.storage.apagaCal(c.nome);
        listaSalvas();
      });
      corpo.appendChild(tr);
    });
  }

  function inicia() {
    cria();
    ligaPresets();
    LF.aoEspectro(aoEspectro);
    LF.q("#bt-preset").addEventListener("click", carregaLinhas);
    LF.q("#bt-cal-adicionar").addEventListener("click", maisForte);
    LF.q("#bt-ajustar").addEventListener("click", ajusta);
    LF.q("#bt-cal-salvar").addEventListener("click", salva);
    LF.q("#bt-cal-limpar").addEventListener("click", function () {
      pontos = []; ultimoAjuste = null;
      mostraTabela(); plot.redraw();
      LF.q("#rot-rms").textContent = "—";
      LF.q("#aviso-cal").textContent = "";
    });
    LF.q("#bt-cal-json").addEventListener("click", function () {
      if (!ultimoAjuste) { LF.mensagem("fit something first", true); return; }
      LF.baixa("lightflow-calibration.json",
        LF.nucleo.exportfile.jsonCalibracao(ultimoAjuste), "application/json");
    });
    mostraTabela();
    listaSalvas();
  }

  return {
    inicia: inicia,
    aoEntrar: function () {
      LF.ajusta(plot, LF.q("#g-cal"));
      LF.ajusta(plotRes, LF.q("#g-residuos"));
      pinta();
    },
  };
})();
