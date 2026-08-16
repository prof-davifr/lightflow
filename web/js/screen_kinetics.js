"use strict";
/* Tab 4 — watch the reaction, then choose what to keep.

   Two things happen to every spectrum during a run. The value in the selected
   mode goes onto the map and into the band traces, because that is what the
   operator is watching. The RAW linearized frame goes to IndexedDB, because
   that is what survives a change of mind about the reference, the channel or
   the calibration. */

LF.telas.cinetica = (function () {
  let plot = null, pendente = false;
  let corrida = null, selecao = null;
  let bandas = [];
  let proximo = 0, t0Ocioso = 0;

  function rodando() { return !!corrida; }

  /* ---------------------------------------------------------------- run */

  async function comeca() {
    const falta = LF.telas.espectro.faltando();
    if (falta.length) {
      LF.mensagem("capture the " + falta.join(" and ") + " before starting a run", true);
      return;
    }
    const pode = LF.nucleo.locks.podeMedir(LF.camera.estado());
    if (!pode.pode) {
      const segue = confirm(
        "The camera is not locked: " + pode.motivo + ".\n\n"
        + "Automatic exposure and automatic white balance move on the same "
        + "timescale as a slow reaction, so what this run records may be the "
        + "camera rather than the chemistry.\n\nStart anyway?");
      if (!segue) return;
    }

    let sessao = null;
    try {
      await LF.nucleo.storage.persiste();
      sessao = await LF.nucleo.storage.criaSessao({
        modo: LF.estado.modo, canal: LF.estado.canal,
        gama: String(LF.estado.gama), n_col: LF.estado.nCol,
        roi: LF.roi.get(), assinatura: LF.estado.assinatura,
        media_n: LF.estado.mediaN,
        camera: { rotulo: (LF.q("#dispositivo").selectedOptions[0] || {}).textContent || "",
          ajustes: JSON.parse(JSON.stringify(LF.camera.ajustes || {})) },
        cal: LF.estado.cal ? { coef: LF.estado.cal.coef, ordem: LF.estado.cal.ordem,
          rms: LF.estado.cal.rms } : null,
      });
      /* The dark and the reference are ordinary spectra with a different type,
         written once at the head of the run so the archive is self-contained. */
      const q = LF.estado.quadros;
      for (const k of ["escuro", "referencia", "branco"]) {
        if (q[k]) {
          await LF.nucleo.storage.gravaEspectro(sessao.id, q[k],
            { tipo: k, t: 0, comSigma: true });
        }
      }
    } catch (e) {
      LF.mensagem("could not open the database, the run will not be saved: "
        + e.message, true);
    }

    corrida = {
      sessao: sessao, inicio: Date.now(),
      tempos: [], valores: [], erros: 0,
    };
    proximo = 0;
    LF.espectrograma.limpa();
    LF.q("#bt-corrida").textContent = "Stop run";
    LF.q("#rot-corrida").textContent = "running";
    LF.q("#rot-corrida").className = "marca";
    LF.mensagem("run started" + (sessao ? " and saving to the browser database" : ""));
  }

  async function para() {
    if (!corrida) return;
    if (corrida.sessao) {
      corrida.sessao.encerrada = Date.now();
      corrida.sessao.n_espectros = corrida.tempos.length;
      try { await LF.nucleo.storage.atualizaSessao(corrida.sessao); } catch (e) { }
    }
    const n = corrida.tempos.length;
    corrida = null;
    LF.q("#bt-corrida").textContent = "Start run";
    LF.q("#rot-corrida").textContent = "not running";
    LF.mensagem("run stopped after " + n + " spectra");
    LF.telas.dados.recarrega();
  }

  /* ------------------------------------------------------------- feeding */

  function aoEspectro(m) {
    const y = LF.telas.espectro.serieDe(LF.estado.canal);
    if (!y) return;
    LF.espectrograma.defineEixo(LF.eixoAtual(y.length),
      LF.telas.espectro.unidade());

    if (!corrida) {
      /* Not recording: the map still scrolls, so the operator can watch the
         reaction settle and decide when to press start. Nothing is written and
         nothing is kept. */
      if (!t0Ocioso) t0Ocioso = m.t;
      LF.espectrograma.poe(y, (m.t - t0Ocioso) / 1000);
      return;
    }
    t0Ocioso = 0;

    const t = (m.t - corrida.inicio) / 1000;
    const intervalo = parseFloat(LF.q("#intervalo").value) || 0;
    if (t < proximo) return;
    proximo = t + intervalo;

    corrida.tempos.push(t);
    corrida.valores.push(y.slice());
    LF.espectrograma.poe(y, t);

    if (corrida.sessao) {
      LF.nucleo.storage.gravaEspectro(corrida.sessao.id, m, {
        t: t, tipo: "amostra", canais: [LF.estado.canal],
      }).catch(function (e) {
        corrida.erros++;
        if (corrida.erros === 1) {
          LF.mensagem("the database refused a write: " + e.message, true);
        }
      });
    }

    LF.q("#rot-corrida").textContent = "running · " + corrida.tempos.length
      + " spectra · " + LF.num(t, 0) + " s";
    agenda();
  }

  function agenda() {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; pintaCinetica(); });
  }

  /* --------------------------------------------------------------- bands */

  function adicionaBanda() {
    const centro = parseFloat(LF.q("#banda-nm").value);
    const largura = parseFloat(LF.q("#banda-larg").value) * 2;
    if (!isFinite(centro) || !isFinite(largura)) return;
    if (bandas.length >= 4) {
      LF.mensagem("four bands is the limit; remove one first", true);
      return;
    }
    bandas.push({
      centro: centro, largura: largura,
      cor: LF.cor.seq[bandas.length % LF.cor.seq.length],
    });
    criaCinetica();
    pintaCinetica();
  }

  function criaCinetica() {
    const el = LF.q("#g-cinetica");
    if (plot) { plot.destroy(); plot = null; }
    const uni = LF.telas.espectro.unidade();
    plot = new uPlot({
      width: 600, height: 200,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [LF.eixo("Time (s)", 0), LF.eixo(uni, "auto")],
      series: [{}].concat(bandas.map(function (b) {
        return LF.serie(LF.num(b.centro, 0) + " ± " + LF.num(b.largura / 2, 1) + " nm", b.cor);
      })),
    }, [LF.vazio(2)].concat(bandas.map(function () { return LF.vazio(2); })), el);
    LF.ajusta(plot, el);
  }

  /* Rebuilds every band trace from the stored spectra. Cheap enough at a few
     hundred points, and it means changing a band centre re-reads the whole run
     instead of only affecting what comes next. */
  function pintaCinetica() {
    if (!plot) return;
    if (!corrida || !corrida.tempos.length || !bandas.length) {
      plot.setData([LF.vazio(2)].concat(bandas.map(function () { return LF.vazio(2); })));
      LF.ajusta(plot, LF.q("#g-cinetica"));
      return;
    }
    const xs = LF.eixoAtual(corrida.valores[0].length);
    const dados = [corrida.tempos.slice()];
    bandas.forEach(function (b) {
      const s = new Array(corrida.tempos.length);
      for (let k = 0; k < corrida.tempos.length; k++) {
        s[k] = LF.nucleo.peaks.media(xs, corrida.valores[k], b.centro, b.largura);
      }
      b.y = s;
      dados.push(s);
    });
    plot.setData(dados);
    plot.axes[1].label = LF.telas.espectro.unidade();
    LF.ajusta(plot, LF.q("#g-cinetica"));
  }

  /* ----------------------------------------------------------- selection */

  function aoSelecionar(s) {
    selecao = s;
    const el = LF.q("#rot-selecao");
    if (!s) {
      el.textContent = "drag on the map to select a time range";
      return;
    }
    el.textContent = "selected " + LF.num(s.t0, 1) + " s to " + LF.num(s.t1, 1)
      + " s  ·  " + s.n + " spectra";
  }

  function indicesDaSelecao() {
    if (!corrida || !selecao) return [];
    const k = [];
    for (let i = 0; i < corrida.tempos.length; i++) {
      if (corrida.tempos[i] >= selecao.t0 && corrida.tempos[i] <= selecao.t1) k.push(i);
    }
    return k;
  }

  function exportaSelecao() {
    const k = indicesDaSelecao();
    if (!k.length) { LF.mensagem("nothing selected, or the run is not saved", true); return; }
    const xs = LF.eixoAtual(corrida.valores[0].length);
    const texto = LF.nucleo.exportfile.csvCorrida(
      k.map(function (i) { return corrida.tempos[i]; }),
      xs,
      k.map(function (i) { return corrida.valores[i]; }),
      { modo: LF.estado.modo, canal: LF.estado.canal,
        unidade: LF.telas.espectro.unidade(), calibrado: LF.calibrado(),
        inicio: corrida.inicio });
    LF.baixa("lightflow-selection.csv", texto, "text/csv");
    LF.mensagem("exported " + k.length + " spectra");
  }

  /* The mean of the selected spectra, promoted to the current sample. Averaging
     a quiet stretch of a run is the cheapest way to get a low-noise spectrum of
     one state of the reaction. */
  function mediaSelecao() {
    const k = indicesDaSelecao();
    if (!k.length) { LF.mensagem("nothing selected", true); return; }
    const n = corrida.valores[0].length;
    const soma = new Float64Array(n);
    const conta = new Int32Array(n);
    k.forEach(function (i) {
      const v = corrida.valores[i];
      for (let j = 0; j < n; j++) if (isFinite(v[j])) { soma[j] += v[j]; conta[j]++; }
    });
    const y = new Float32Array(n);
    for (let j = 0; j < n; j++) y[j] = conta[j] ? soma[j] / conta[j] : NaN;
    const xs = LF.eixoAtual(n);
    LF.baixa("lightflow-selection-mean.csv",
      LF.nucleo.exportfile.csvEspectro(xs, y, {
        x: LF.calibrado() ? "wavelength_nm" : "column_px",
        y: LF.estado.modo + "_mean_of_" + k.length,
        canal: LF.estado.canal, unidade: LF.telas.espectro.unidade(),
        calibrado: LF.calibrado(),
      }), "text/csv");
    LF.mensagem("averaged " + k.length + " spectra and exported them as one");
  }

  function recalibra() {
    if (plot) { pintaCinetica(); }
  }

  function inicia() {
    LF.espectrograma.inicia(aoSelecionar);
    LF.aoEspectro(aoEspectro);
    criaCinetica();
    LF.q("#bt-corrida").addEventListener("click", function () {
      if (rodando()) para(); else comeca();
    });
    LF.q("#bt-banda").addEventListener("click", adicionaBanda);
    LF.q("#bt-banda-limpar").addEventListener("click", function () {
      bandas = []; criaCinetica(); pintaCinetica();
    });
    LF.q("#bt-sel-exportar").addEventListener("click", exportaSelecao);
    LF.q("#bt-sel-media").addEventListener("click", mediaSelecao);
    LF.q("#bt-sel-limpar").addEventListener("click", function () {
      LF.espectrograma.limpaSelecao();
    });
  }

  return {
    inicia: inicia, recalibra: recalibra,
    get corrida() { return corrida; },
    aoEntrar: function () {
      LF.espectrograma.redimensiona();
      LF.ajusta(plot, LF.q("#g-cinetica"));
      pintaCinetica();
    },
  };
})();
