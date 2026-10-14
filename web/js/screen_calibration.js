"use strict";
/* Tab 3 — turning columns into nanometres.

   The screen is five numbered steps: mark the peaks, name them, fit, check,
   save. The step to do next is marked and holds the only primary button, so
   the order of the work is on the screen and not only in the manual. "Find
   peaks" does the first two in one press on an ordinary lamp. Naming works
   because a grating puts wavelength monotonically and almost linearly along
   the sensor, so the peaks keep the spacing pattern of the lines.

   The screen looks at R+G+B, not at the measurement channel: green alone does
   not show the red and blue lines of a lamp. `calibration.sinal` says why. */

LF.telas.calibracao = (function () {
  let plot = null, plotRes = null, pendente = false;
  let pontos = [], ultimoY = null, ultimoClip = null, ultimoAjuste = null;
  /* Whether the fit and the saved copy still describe the points on screen.
     Any edit to a point makes both false again. */
  let ajustado = false, salvo = false, avaliacao = null;

  /* Peaks "Find peaks" marks. Five names a lamp without ambiguity, and lets
     one stray peak be left out. */
  const ACHAR = 5;

  /* ------------------------------------------------------------ messages */

  /* The result of an action goes next to the steps, where the operator is
     looking, and to the footer as before. */
  function diz(texto, tipo) {
    const el = LF.q("#estado-cal");
    el.textContent = texto;
    el.className = "estado" + (tipo ? " " + tipo : "");
    LF.mensagem(texto, tipo === "erro");
  }

  /* ---------------------------------------------------------------- steps */

  function nomeados() {
    return pontos.length >= 2
      && pontos.some(function (p) { return isFinite(p.nm); })
      && pontos.every(function (p) { return isFinite(p.nm) || p.usar === false; });
  }

  function atualizaPassos() {
    const feito = {
      1: pontos.length >= 2,
      2: nomeados(),
      3: ajustado,
      4: ajustado && !!avaliacao && !avaliacao.suspeita,
      5: ajustado && salvo,
    };
    let atual = 0;
    for (let k = 1; k <= 5; k++) if (!feito[k]) { atual = k; break; }
    LF.qq("#passos-cal > li").forEach(function (li) {
      const k = parseInt(li.dataset.passo, 10);
      const mau = k === 4 && ajustado && avaliacao && avaliacao.suspeita;
      li.classList.toggle("feito", feito[k] && !mau);
      li.classList.toggle("atual", k === atual && !mau);
      li.classList.toggle("mau", !!mau);
      li.querySelector(".num").textContent = feito[k] && !mau ? "✓" : String(k);
      const bt = li.querySelector("[data-principal]");
      if (bt) bt.classList.toggle("primario", k === atual);
    });
    mostraCheck();
  }

  /* Step 4 is a reading, not a button: where the check lines landed. */
  function mostraCheck() {
    const res = LF.q("#res-cal"), dica = LF.q("#dica-check");
    if (!ajustado || !avaliacao) {
      res.textContent = "—";
      dica.textContent = "the unticked lines are the test";
      return;
    }
    const lim = LF.num(avaliacao.limite, 1);
    const pc = avaliacao.piorCheck;
    if (avaliacao.suspeita) {
      res.textContent = pc && Math.abs(pc.residuo) > avaliacao.limite
        ? pc.nm + " nm lands " + LF.num(Math.abs(pc.residuo), 1) + " nm off"
        : "residuals too wide";
      dica.textContent = "limit " + lim + " nm — a peak has the wrong name";
    } else if (pc) {
      res.textContent = "checks within " + LF.num(Math.abs(pc.residuo), 1) + " nm";
      dica.textContent = "limit " + lim + " nm (three columns)";
    } else {
      res.textContent = "no check line";
      dica.textContent = "untick a named line to make it a check";
    }
  }

  /* Any change to the points makes the fit stale. */
  function mudou() {
    ajustado = false; salvo = false;
    atualizaPassos();
  }

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
          const ctx = u.ctx;
          ctx.save();
          if (!ultimoY) {
            ctx.fillStyle = LF.cor.tinta2;
            ctx.font = "13px system-ui";
            ctx.textAlign = "center";
            ctx.fillText("No spectrum yet — open the camera on the Camera tab "
              + "and point the slit at the lamp", u.bbox.left + u.bbox.width / 2,
              u.bbox.top + u.bbox.height / 2);
            ctx.restore();
            return;
          }
          /* Every marked point gets a line, so it is obvious which peaks are
             already claimed. A label that would overlap the one before drops
             to the next row. */
          const fins = [];
          pontos.forEach(function (p) {
            const x = u.valToPos(p.px, "x", true);
            const usado = p.usar !== false && isFinite(p.nm);
            ctx.strokeStyle = usado ? LF.cor.cat[1] : LF.cor.tinta2;
            ctx.setLineDash(usado ? [] : [3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);
            const txt = isFinite(p.nm) ? LF.num(p.nm, 1)
              : (p.rotulo ? "not a line" : "?");
            ctx.font = "10px system-ui";
            let fila = 0;
            while (fila < fins.length && fins[fila] > x) fila++;
            fins[fila] = x + ctx.measureText(txt).width + 6;
            ctx.fillStyle = usado ? LF.cor.cat[1] : LF.cor.tinta2;
            ctx.fillText(txt, x + 3, u.bbox.top + 11 + 12 * fila);
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
        const lim = avaliacao ? avaliacao.limite : 0;
        return LF.faixa(Math.min(lo, -lim), Math.max(hi, lim),
          { inclui_zero: true, margem: 0.2 });
      } } },
      /* No legend and no x label: the box title says what the marks are,
         and the column axis is the one of the chart above. Both took most of
         a 140 px box, and the residuals were drawn in a strip 20 px high. */
      legend: { show: false },
      axes: [Object.assign(LF.eixo("", 0), { label: undefined, labelSize: 0 }),
        LF.eixo("nm", "auto")],
      series: [{},
        { label: "fitted", stroke: LF.cor.cat[1], width: 0,
          points: { show: true, size: 7, fill: LF.cor.cat[1] } },
        { label: "check", stroke: LF.cor.cat[0], width: 0,
          points: { show: true, size: 8, width: 1.5, fill: "#ffffff" } }],
      hooks: {
        draw: [function (u) {
          /* The limit a check line may miss by before the fit is suspect. */
          if (!avaliacao) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = LF.cor.alerta;
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          [avaliacao.limite, -avaliacao.limite].forEach(function (v) {
            const y = u.valToPos(v, "y", true);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
          });
          ctx.restore();
        }],
      },
    }, [LF.vazio(2), LF.vazio(2), LF.vazio(2)], elR);
    LF.ajusta(plotRes, elR);
  }

  function aoEspectro(m) {
    const primeiro = !ultimoY;
    ultimoY = LF.nucleo.calibration.sinal(m);
    ultimoClip = m.clip;
    if (LF.telaAtual !== "calibracao" || pendente) return;
    pendente = true;
    requestAnimationFrame(function () {
      pendente = false; pinta();
      if (primeiro) atualizaPassos();
    });
  }

  function pinta() {
    if (!plot || !ultimoY) return;
    const n = ultimoY.length;
    const xs = new Array(n);
    for (let i = 0; i < n; i++) xs[i] = i;
    plot.setData([xs, Array.from(ultimoY)]);
    LF.ajusta(plot, LF.q("#g-cal"));
  }

  function pintaResiduos() {
    if (!ultimoAjuste || !ajustado) {
      plotRes.setData([LF.vazio(2), LF.vazio(2), LF.vazio(2)]);
      return;
    }
    const cal = ultimoAjuste;
    const xs = [], fit = [], chk = [];
    cal.pontos.forEach(function (p, k) {
      const r = cal.residuos[k];
      if (!isFinite(r)) return;
      xs.push(p.px);
      fit.push(p.usar !== false ? r : null);
      chk.push(p.usar === false ? r : null);
    });
    plotRes.setData([xs, fit, chk]);
    LF.ajusta(plotRes, LF.q("#g-residuos"));
  }

  /* -------------------------------------------------------------- points */

  /* Marks the peak at column `i`. Quiet when "Find peaks" is the caller, which
     reports once for all of them. Returns whether a point was added. */
  function adiciona(i, quieto) {
    if (!ultimoY) return false;
    const px = LF.nucleo.peaks.refina(ultimoY, i);
    if (pontos.some(function (p) { return Math.abs(p.px - px) < 3; })) {
      if (!quieto) diz("there is already a point within three columns of that one", "aviso");
      return false;
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
    mudou();
    if (quieto) return true;
    if (satura) {
      diz("that peak is clipped, so its centre is not reliable — shorten the "
        + "exposure and mark it again", "aviso");
    } else {
      diz("marked a peak at column " + LF.num(px, 1) + " — " + pontos.length
        + " marked; press Name when they are all there");
    }
    return true;
  }

  function maisForte(quieto) {
    if (!ultimoY) { diz("no spectrum yet — open the camera first", "erro"); return false; }
    const picos = LF.nucleo.peaks.acha(ultimoY);
    const livre = picos.filter(function (p) {
      return !pontos.some(function (q) { return Math.abs(q.px - p.px) < 5; });
    });
    if (!livre.length) {
      if (!quieto) diz("every peak found is already marked; click a faint one on the chart", "aviso");
      return false;
    }
    livre.sort(function (a, b) { return b.prom - a.prom; });
    return adiciona(livre[0].i, quieto);
  }

  /* Steps 1 and 2 in one press: the strongest peaks, then their names. */
  function acha() {
    if (!ultimoY) { diz("no spectrum yet — open the camera first", "erro"); return; }
    let novos = 0;
    while (pontos.length < ACHAR && maisForte(true)) novos++;
    if (pontos.length < 2) {
      diz("found " + pontos.length + " peak — raise the exposure, or check that "
        + "the strip lies on the spectrum", "erro");
      return;
    }
    if (!novos) diz("no new peak found; naming the " + pontos.length + " marked");
    carregaLinhas();
  }

  function mostraTabela() {
    const corpo = LF.q("#tab-cal tbody");
    corpo.innerHTML = "";
    if (!pontos.length) {
      corpo.innerHTML = '<tr><td colspan="6" class="vazio">No points yet. Press '
        + "<b>Find peaks</b>, or click a peak on the chart.</td></tr>";
      return;
    }
    pontos.forEach(function (p, k) {
      const tr = document.createElement("tr");
      const res = ajustado && ultimoAjuste ? ultimoAjuste.residuos[k] : NaN;
      const papel = p.usar !== false ? "fit" : (isFinite(p.nm) ? "check" : "left out");
      const lim = avaliacao ? avaliacao.limite : Infinity;
      tr.innerHTML =
        '<td class="papel"><input type="checkbox" ' + (p.usar === false ? "" : "checked")
        + "> " + papel + "</td>"
        + '<td class="num">' + LF.num(p.px, 2)
        + (p.satura ? '<span class="etiqueta mau" title="clipped: shorten the '
          + 'exposure and mark it again">clipped</span>' : "") + "</td>"
        + '<td class="nm"><input type="number" step="0.01" list="linhas-preset" value="'
        + (isFinite(p.nm) ? p.nm : "") + '"></td>'
        + '<td><input type="text" value="' + (p.rotulo || "") + '" title="'
        + (p.rotulo || "") + '"></td>'
        + '<td class="num' + (isFinite(res) && Math.abs(res) > lim ? " ruim" : "") + '">'
        + (isFinite(res) ? LF.num(Math.abs(res) < 0.005 ? 0 : res, 2) : "—") + "</td>"
        + '<td><button title="remove">×</button></td>';
      const [cx, , inm, irot, , bt] = tr.children;
      cx.firstChild.addEventListener("change", function () {
        p.usar = this.checked; mostraTabela(); plot.redraw(); mudou();
      });
      inm.firstChild.addEventListener("change", function () {
        p.nm = parseFloat(this.value); plot.redraw(); mudou();
      });
      irot.firstChild.addEventListener("change", function () { p.rotulo = this.value; });
      bt.firstChild.addEventListener("click", function () {
        pontos.splice(k, 1); mostraTabela(); plot.redraw(); mudou();
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
    LF.q("#nota-preset").title = p ? p.nota : "";
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
      diz(e.message, "erro");
      return;
    }
    if (!r.confiavel) {
      diz("the spacing of these peaks fits no set of this source's lines: the "
        + "best straight line misses by " + LF.num(r.rmsCol, 1) + " columns. Some "
        + "of them are not lines of this lamp, or come from the second order — "
        + "remove them with × and press Name again", "erro");
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
    mudou();
    const lado = r.crescente ? "red end on the right" : "red end on the left";
    if (r.fora >= 0) {
      diz("named " + (pontos.length - 1) + " peaks by their spacing (" + lado
        + "); the peak at column " + LF.num(pontos[r.fora].px, 1) + " is no line "
        + "of this source and is left out. Next: Fit", "aviso");
    } else if (r.ambiguo) {
      diz("named " + pontos.length + " peaks, but the spacing fits more than one "
        + "set of lines — assumed " + lado + ". Mark another peak with + One more, "
        + "or check each name", "aviso");
    } else {
      diz("named " + pontos.length + " peaks by their spacing (" + lado
        + "). Next: Fit", "ok");
    }
  }

  /* ---------------------------------------------------------------- fit */

  function ajusta() {
    if (pontos.some(function (p) { return p.usar !== false && !isFinite(p.nm); })) {
      diz("every ticked peak needs a wavelength — press Name, or type it in", "erro");
      return;
    }
    const N = LF.nucleo.calibration;
    const escolha = LF.q("#ordem").value;
    const ordem = escolha === "auto" ? N.ordemAuto(pontos) : parseInt(escolha, 10);
    let cal;
    try {
      cal = N.ajusta(pontos, ordem, {
        n_col: LF.estado.nCol, assinatura: LF.estado.assinatura,
      });
    } catch (e) {
      diz(e.message, "erro");
      return;
    }
    ultimoAjuste = cal;
    ajustado = true; salvo = false;
    aplica(cal);
    if (avaliacao.suspeita) {
      diz("fitted order " + ordem + " on " + cal.n + " lines, but a check line "
        + "lands too far off: a peak has the wrong name. Check the names, or "
        + "remove the peak and fit again", "erro");
    } else {
      diz("fitted order " + ordem + (escolha === "auto" ? " (auto)" : "") + " on "
        + cal.n + " lines. Next: Save", "ok");
    }
  }

  function aplica(cal) {
    const N = LF.nucleo.calibration;
    LF.estado.cal = cal;
    LF.estado.eixo = N.eixo(cal, LF.estado.nCol);
    const problemas = N.confere(cal, LF.estado.assinatura, LF.estado.nCol);
    /* The axis is applied either way, so the operator can see what the fit
       does, but a fit with a wrong name in it does not get to call itself
       calibrated. `avalia` says what counts as one. */
    avaliacao = N.avalia(cal, LF.estado.nCol);
    if (problemas.length) LF.selo("#selo-cal", "calibration stale", "mau");
    else if (avaliacao.suspeita) LF.selo("#selo-cal", "calibration suspect", "mau");
    else LF.selo("#selo-cal", "calibrated", "ok");

    /* Why the fit is suspect is said in step 4 and in the status line; this
       line keeps what neither says. */
    const texto = problemas.slice();
    if ((cal.pontos || []).some(function (p) { return p.satura && p.usar !== false; })) {
      texto.push("a fitted peak is clipped; shorten the exposure and mark it again");
    }
    LF.q("#aviso-cal").textContent = texto.length
      ? texto.join("; ").replace(/^./, function (c) { return c.toUpperCase(); }) + "."
      : "";
    /* An exact fit is not an error, so it is said next to the order, quietly. */
    LF.q("#dica-ordem").textContent = avaliacao.avisos.length
      ? "exact through " + cal.n + " lines: rms says nothing"
      : "auto picks 1 or 2";

    const d = N.dispersao(cal, LF.estado.nCol);
    const pc = avaliacao.piorCheck;
    LF.q("#rot-rms").textContent = "order " + cal.ordem + " · fit rms " + LF.num(cal.rms, 3)
      + " nm" + (pc ? " · worst check " + LF.num(Math.abs(pc.residuo), 2) + " nm" : "")
      + " · " + LF.num(Math.abs(d), 3) + " nm per column";

    mostraTabela();
    pintaResiduos();
    atualizaPassos();
    LF.telas.espectro.redesenha();
    LF.telas.cinetica.recalibra();
  }

  function limpa() {
    pontos = []; ultimoAjuste = null; avaliacao = null;
    ajustado = false; salvo = false;
    mostraTabela(); plot.redraw(); pintaResiduos();
    LF.q("#rot-rms").textContent = "not fitted";
    LF.q("#aviso-cal").textContent = "";
    LF.q("#dica-ordem").textContent = "auto picks 1 or 2";
    atualizaPassos();
    diz("points cleared");
  }

  /* ------------------------------------------------------------- storage */

  async function salva() {
    if (!ultimoAjuste || !ajustado) { diz("fit first, then save", "erro"); return; }
    const nome = prompt("Name for this calibration",
      "cal " + new Date().toLocaleDateString());
    if (!nome) return;
    ultimoAjuste.nome = nome;
    await LF.nucleo.storage.salvaCal(ultimoAjuste);
    salvo = true;
    atualizaPassos();
    await listaSalvas();
    diz("calibration \"" + nome + "\" saved — the Spectrum and Kinetics tabs now "
      + "read in nanometres", "ok");
  }

  async function listaSalvas() {
    const corpo = LF.q("#tab-cal-salvas tbody");
    corpo.innerHTML = "";
    let cs = [];
    try { cs = await LF.nucleo.storage.listaCals(); } catch (e) { return; }
    if (!cs.length) {
      corpo.innerHTML = '<tr><td class="vazio">none saved yet</td></tr>';
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
        ajustado = true; salvo = true;
        LF.q("#ordem").value = String(c.ordem);
        aplica(c);
        diz("loaded \"" + c.nome + "\"", "ok");
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
    LF.q("#bt-cal-achar").addEventListener("click", acha);
    LF.q("#bt-cal-adicionar").addEventListener("click", function () { maisForte(false); });
    LF.q("#bt-preset").addEventListener("click", carregaLinhas);
    LF.q("#bt-ajustar").addEventListener("click", ajusta);
    LF.q("#bt-cal-salvar").addEventListener("click", salva);
    LF.q("#bt-cal-limpar").addEventListener("click", limpa);
    LF.q("#bt-cal-json").addEventListener("click", function () {
      if (!ultimoAjuste) { diz("fit first, then export", "erro"); return; }
      LF.baixa("lightflow-calibration.json",
        LF.nucleo.exportfile.jsonCalibracao(ultimoAjuste), "application/json");
    });
    mostraTabela();
    atualizaPassos();
    listaSalvas();
  }

  return {
    inicia: inicia,
    aoEntrar: function () {
      LF.ajusta(plot, LF.q("#g-cal"));
      LF.ajusta(plotRes, LF.q("#g-residuos"));
      pinta();
      plot.redraw();
    },
  };
})();
