"use strict";
/* Tab 3 — turning columns into nanometres.

   The workflow this screen is built around: point the slit at a fluorescent
   tube, press "Add the strongest unused peak" a few times, press "Load its
   lines" to name them, fit, and read the residuals. Naming works because a
   grating puts wavelength monotonically and almost linearly along the sensor,
   so the peaks keep the spacing pattern of the lines.

   The screen looks at R+G+B, not at the measurement channel: green alone does
   not show the red and blue lines of a lamp. `calibration.sinal` says why. */

LF.telas.calibracao = (function () {
  let plot = null, plotRes = null, pendente = false;
  let pontos = [], ultimoY = null, ultimoClip = null, ultimoAjuste = null;

  /* ------------------------------------------------------------ the plot */

  function cria() {
    const el = LF.q("#g-cal");
    plot = new uPlot({
      width: 600, height: 260,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [LF.eixo("Column (px)", 0), LF.eixo("Linear intensity", "auto")],
      series: [{}, LF.serie("R+G+B", LF.cor.seq[2])],
      hooks: {
        draw: [function (u) {
          /* Every marked point gets a line, so it is obvious which peaks are
             already claimed before another one is added. */
          const ctx = u.ctx;
          ctx.save();
          pontos.forEach(function (p, k) {
            const x = u.valToPos(p.px, "x", true);
            ctx.strokeStyle = p.usar === false ? LF.cor.tinta2 : LF.cor.cat[1];
            ctx.setLineDash(p.usar === false ? [3, 3] : []);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = LF.cor.cat[1];
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
      adiciona(LF.nucleo.peaks.picoPerto(ultimoY, plot.cursor.idx));
    });

    const elR = LF.q("#g-residuos");
    plotRes = new uPlot({
      width: 600, height: 130,
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: function (u, lo, hi) {
        return LF.faixa(lo, hi, { inclui_zero: true, margem: 0.2 });
      } } },
      axes: [LF.eixo("Column (px)", 0), LF.eixo("Residual (nm)", "auto")],
      series: [{}, { label: "residual", stroke: LF.cor.cat[1], width: 0,
        points: { show: true, size: 7, fill: LF.cor.cat[1] } }],
    }, [LF.vazio(2), LF.vazio(2)], elR);
    LF.ajusta(plotRes, elR);
  }

  function aoEspectro(m) {
    ultimoY = LF.nucleo.calibration.sinal(m);
    ultimoClip = m.clip;
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
    /* A clipped line has a flat top, and its centre moves with the exposure:
       0.7 columns on this bench between 80 ms and 1 s. */
    let satura = false;
    if (ultimoClip) {
      for (let k = Math.max(0, i - 4); k <= Math.min(ultimoClip.length - 1, i + 4); k++) {
        if (ultimoClip[k]) satura = true;
      }
    }
    pontos.push({ px: px, nm: NaN, rotulo: "", usar: true, satura: satura });
    pontos.sort(function (a, b) { return a.px - b.px; });
    mostraTabela();
    plot.redraw();
    if (satura) {
      LF.mensagem("that peak is clipped, so its centre is not reliable — shorten "
        + "the exposure and mark it again", true);
    }
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
        + '<td class="num' + (p.satura ? ' ruim" title="clipped' : "") + '">'
        + LF.num(p.px, 2) + "</td>"
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

  /* Names the marked peaks by matching their spacing to the source's lines, in
     either direction along the sensor, so a faint line left unmarked or a red
     end on the left does not shift every name. `nomeia` explains the rule.
     When the spacing cannot tell the direction, the calibration in use can. */
  function carregaLinhas() {
    const p = presetAtual();
    if (!p) return;
    const N = LF.nucleo.calibration;
    const opc = {};
    if (LF.estado.cal && LF.estado.nCol) {
      opc.crescente = N.dispersao(LF.estado.cal, LF.estado.nCol) > 0;
    }
    let r;
    try {
      r = N.nomeia(pontos.map(function (q) { return q.px; }), p.pontos, opc);
    } catch (e) {
      LF.mensagem(e.message, true);
      return;
    }
    if (!r.confiavel) {
      LF.mensagem("the spacing of these peaks fits no set of this source's lines: "
        + "the best straight line misses by " + LF.num(r.rmsCol, 1) + " columns. "
        + "Some of them are not lines of this lamp, or come from the second "
        + "order — remove them and name again", true);
      return;
    }
    pontos.forEach(function (q, k) {
      const l = r.linhas[k];
      q.nm = l ? l.nm : NaN;
      q.rotulo = l ? l.rotulo : "not a line of this source";
      q.usar = !!l && l.ajuste !== false;
    });
    mostraTabela();
    plot.redraw();
    const lado = r.crescente ? "red end on the right" : "red end on the left";
    if (r.fora >= 0) {
      LF.mensagem("named " + (pontos.length - 1) + " peaks by their spacing (" + lado
        + "); the peak at column " + LF.num(pontos[r.fora].px, 1) + " is no line "
        + "of this source and is left out — check the labels before fitting", true);
    } else if (r.ambiguo) {
      LF.mensagem("named " + pontos.length + " peaks, but the spacing fits more than "
        + "one set of lines — assumed " + lado + ". Check each label, or mark "
        + "another peak", true);
    } else {
      LF.mensagem("named " + pontos.length + " peaks by their spacing (" + lado
        + ") — check that each label matches the line you meant before fitting");
    }
  }

  /* ---------------------------------------------------------------- fit */

  function ajusta() {
    if (pontos.some(function (p) { return p.usar !== false && !isFinite(p.nm); })) {
      LF.mensagem("every peak used in the fit needs a wavelength", true);
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

    LF.mensagem("fitted order " + ordem + " on " + cal.n + " points, rms "
      + LF.num(cal.rms, 3) + " nm");
  }

  function aplica(cal) {
    LF.estado.cal = cal;
    LF.estado.eixo = LF.nucleo.calibration.eixo(cal, LF.estado.nCol);
    const problemas = LF.nucleo.calibration.confere(cal, LF.estado.assinatura, LF.estado.nCol);
    /* The axis is applied either way, so the operator can see what the fit
       does, but a fit with a wrong name in it does not get to call itself
       calibrated. `avalia` says what counts as one. */
    const av = LF.nucleo.calibration.avalia(cal, LF.estado.nCol);
    if (problemas.length) LF.selo("#selo-cal", "calibration stale", "mau");
    else if (av.suspeita) LF.selo("#selo-cal", "calibration suspect", "mau");
    else LF.selo("#selo-cal", "calibrated", "ok");
    const texto = problemas.concat(av.motivos, av.avisos);
    if ((cal.pontos || []).some(function (p) { return p.satura && p.usar !== false; })) {
      texto.push("a fitted peak is clipped; shorten the exposure and mark it again");
    }
    LF.q("#aviso-cal").textContent = texto.length
      ? texto.join("; ").replace(/^./, function (c) { return c.toUpperCase(); }) + "."
      : "";
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
