"use strict";
/* Tabs, the global state, and the one frame loop everything else feeds off.

   There is exactly one loop and one accumulator. Every screen subscribes to the
   averaged line it produces instead of grabbing its own frames, so the spectrum
   on the Spectrum tab and the line going into the spectrogram are the same
   numbers, not two independent measurements of the same instant. */

LF.estado = {
  canal: "g",           // always green: the only channel at full resolution
  modo: "absorbance",
  mediaN: 16,
  filtro: "bloco",      // frame.js FILTROS: block mean, running mean, peak hold
  gama: "srgb",
  resposta: null,       // instrument response curve {nm, k, nome}, or null
  respostaLigada: false,
  quadros: { amostra: null, escuro: null, referencia: null, branco: null },
  cal: null,
  eixo: null,           // Float64Array of nm, or null while uncalibrated
  nCol: 0,
  assinatura: "",
};

LF.telaAtual = "camera";

(function () {
  let lut = null, filtro = null;
  const ouvintes = [];      // screens, called with the averaged frame
  const ouvintesCru = [];   // capture helpers, called with every single frame

  /* Screens register here and are called with the averaged frame. */
  LF.aoEspectro = function (fn) { ouvintes.push(fn); };

  LF.eixoAtual = function (n) {
    if (LF.estado.eixo && LF.estado.eixo.length === n) return LF.estado.eixo;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = i;
    return v;
  };

  LF.calibrado = function () {
    return !!(LF.estado.eixo && LF.estado.eixo.length === LF.estado.nCol);
  };

  LF.unidadeX = function () { return LF.calibrado() ? "Wavelength (nm)" : "Column (px)"; };

  /* ------------------------------------------------------------- the loop */

  function refazLut() {
    const g = LF.q("#gama").value;
    LF.estado.gama = g === "srgb" ? "srgb" : parseFloat(g);
    lut = LF.nucleo.frame.makeLut(LF.estado.gama);
  }

  function porQuadro() {
    const roi = LF.roi.get();
    const corte = LF.camera.recorta(roi);
    if (!corte) return;
    const linha = LF.nucleo.frame.extract(corte.img, corte.roi, lut);

    /* The raw listeners run first and on a copy of the list, because a capture
       that has just finished removes itself from inside its own callback. */
    if (ouvintesCru.length) {
      const copia = ouvintesCru.slice();
      for (let i = 0; i < copia.length; i++) copia[i](linha);
    }

    if (!filtro || filtro.w !== roi.w) {
      filtro = new LF.nucleo.frame.Filtro(roi.w, LF.estado.filtro, LF.estado.mediaN);
      LF.estado.nCol = roi.w;
      LF.estado.assinatura = LF.nucleo.frame.assinatura(roi, corte.larg, corte.alt);
    }
    const m = filtro.poe(linha);

    LF.telas.camera.aoQuadroCru(linha);

    if (m) {
      m.t = Date.now();
      m.roi = roi;
      LF.estado.quadros.amostra = m;
      selosDeQuadro(m);
      for (let i = 0; i < ouvintes.length; i++) ouvintes[i](m);
    }
  }

  function selosDeQuadro(m) {
    const clip = m.clipTotal;
    if (clip > 0) {
      let colunas = 0;
      for (let i = 0; i < m.clip.length; i++) if (m.clip[i]) colunas++;
      LF.selo("#selo-satur", colunas + " clipped", "mau");
    } else {
      LF.selo("#selo-satur", "no clipping", "ok");
    }
    LF.selo("#selo-taxa", LF.num(LF.camera.fps(), 1) + " fps");
  }

  /* A new filter on the next frame, empty. */
  function zeraFiltro() { filtro = null; }
  LF.zeraFiltro = zeraFiltro;

  /* What a captured frame depends on besides the light. A dark or a reference
     taken under another exposure, white balance or region is a different
     measurement, and dividing by it gives a number that looks right. */
  LF.configAtual = function () {
    return {
      exposicao: valorExposicao(),
      temp: parseFloat(LF.q("#temp-cor").value),
      gama: String(LF.estado.gama),
      assinatura: LF.estado.assinatura,
    };
  };

  /* Captures N frames into a fresh accumulator and stores the mean under a
     name. The dark and the reference are ordinary frames; the only thing that
     makes them special is which slot they sit in. Always a block mean, whatever
     the live filter is: a running mean remembers frames from before the slit
     was covered, and a peak hold is not a measurement. */
  LF.captura = function (nome, n, aoFim) {
    const roi = LF.roi.get();
    if (!LF.camera.aberta()) { LF.mensagem("open the camera first", true); return; }
    const ac = new LF.nucleo.frame.Acumulador(roi.w);
    let restam = n;
    LF.mensagem("capturing " + n + " frames for the " + LF.ROT_QUADRO[nome] + " …");
    const passo = function (linha) {
      if (linha.r.length !== ac.w) return;   // the ROI moved mid-capture
      ac.poe(linha);
      restam--;
      if (restam > 0) return;
      const k = ouvintesCru.indexOf(passo);
      if (k >= 0) ouvintesCru.splice(k, 1);
      const m = ac.media();
      m.t = Date.now(); m.roi = roi; m.tipo = nome; m.config = LF.configAtual();
      LF.estado.quadros[nome] = m;
      LF.mensagem(LF.ROT_QUADRO[nome] + " captured from " + n + " frames");
      if (aoFim) aoFim(m);
    };
    ouvintesCru.push(passo);
  };

  /* ------------------------------------------------------------ the panel */

  function faixaExposicao() {
    const c = LF.camera.capacidades.exposureTime;
    return c && isFinite(c.min) ? c : null;
  }

  function valorExposicao() {
    const f = faixaExposicao();
    if (!f) return undefined;
    const t = parseFloat(LF.q("#exposicao").value) / 100;
    /* Logarithmic, because a linear slider spends nine tenths of its travel in
       exposures far too long to be usable. */
    return f.min * Math.pow(f.max / Math.max(1e-9, f.min), t);
  }

  function mostraExposicao() {
    const v = valorExposicao();
    const el = LF.q("#exposicao-val");
    if (v === undefined) { el.textContent = "not available"; return; }
    /* The specification counts exposureTime in units of 100 microseconds. */
    el.textContent = LF.num(v / 10, 2) + " ms";
  }

  /* What the filter costs in time, from the frame rate the camera is giving. */
  function mostraFiltro() {
    const el = LF.q("#filtro-val");
    const N = LF.estado.mediaN, fps = LF.camera.fps() || 30;
    const s = function (q) { return LF.num(q / fps, q / fps < 10 ? 2 : 0) + " s"; };
    if (LF.estado.filtro === "bloco") {
      el.textContent = "a new spectrum every " + s(N);
    } else if (LF.estado.filtro === "exp") {
      el.textContent = "settles to 1/e in " + s(N) + ", to 5 % in " + s(3 * N);
    } else {
      el.textContent = "keeps each column's highest value until Restart";
    }
  }
  LF.mostraFiltro = mostraFiltro;

  /* The slider position, 0 to 100, for an exposure in the camera's units. */
  function posicaoExposicao(v) {
    const f = faixaExposicao();
    if (!f) return 30;
    const t = Math.log(v / Math.max(1e-9, f.min)) / Math.log(f.max / Math.max(1e-9, f.min));
    return Math.max(0, Math.min(100, 100 * t));
  }

  /* The highest raw code over the next `n` frames, after `pula` frames that
     may still carry the old exposure: a UVC camera takes a frame or two to
     apply a new one, and Chrome may hand over one already in its queue. */
  function picoDosProximos(pula, n) {
    return new Promise(function (ok, falha) {
      let vistos = 0, pico = 0;
      const sai = function () {
        const k = ouvintesCru.indexOf(passo);
        if (k >= 0) ouvintesCru.splice(k, 1);
        clearTimeout(relogio);
      };
      const passo = function (linha) {
        vistos++;
        if (vistos <= pula) return;
        if (linha.pico > pico) pico = linha.pico;
        if (vistos < pula + n) return;
        sai(); ok(pico);
      };
      /* A long exposure slows the frames down; ten seconds is past any of them. */
      const relogio = setTimeout(function () {
        sai(); falha(new Error("no frames came from the camera"));
      }, 10000);
      ouvintesCru.push(passo);
    });
  }

  let buscando = false;

  /* Searches the exposure once, with the camera on manual, and leaves it
     locked there. The search is exposicao.proximo; this only drives it. */
  async function autoExposicao() {
    if (buscando) return;
    if (!LF.camera.aberta()) { LF.mensagem("open the camera first", true); return; }
    const f = faixaExposicao();
    if (!f) {
      LF.mensagem("this camera does not let the browser set the exposure, so there "
        + "is nothing to search: set it with v4l2-ctl", true);
      return;
    }
    if (LF.telas.cinetica.corrida) {
      LF.mensagem("stop the run first: the search changes the exposure under it", true);
      return;
    }
    const E = LF.nucleo.exposicao;
    const faixa = { min: f.min, max: f.max, step: f.step || 0 };
    const temp = parseFloat(LF.q("#temp-cor").value);
    let exp = valorExposicao(), r = null;
    buscando = true;
    LF.q("#bt-auto-exp").disabled = true;
    try {
      for (let k = 0; k < E.MAX_PASSOS; k++) {
        const est = await LF.camera.trava({ exposureTime: exp, colorTemperature: temp });
        const lido = est.ajustes && est.ajustes.exposureTime;
        if (isFinite(lido)) exp = lido;     // what the camera did, not what was asked
        LF.q("#exposicao").value = posicaoExposicao(exp);
        mostraExposicao();
        LF.mensagem("searching the exposure: " + LF.num(exp / 10, 2) + " ms …");
        const pico = await picoDosProximos(4, 3);
        r = E.proximo(exp, pico, faixa, LF.estado.gama);
        if (r.pronto) { r.pico = pico; break; }
        exp = r.exposicao;
      }
      const est = await LF.camera.trava({ exposureTime: exp, colorTemperature: temp });
      LF.telas.camera.mostraEstado(est);
      if (r && r.pronto && !r.limite) {
        LF.mensagem("exposure set to " + LF.num(exp / 10, 2) + " ms and locked: the "
          + "brightest pixel reads " + r.pico + " of 255");
      } else if (r && r.limite) {
        LF.mensagem("exposure left at " + LF.num(exp / 10, 2) + " ms: " + r.motivo, true);
      } else {
        LF.mensagem("the exposure did not settle in " + E.MAX_PASSOS + " steps; it is "
          + "locked at " + LF.num(exp / 10, 2) + " ms. A flickering lamp does this.", true);
      }
      if (LF.estado.quadros.escuro || LF.estado.quadros.referencia) {
        LF.telas.espectro.redesenha();
      }
    } catch (err) {
      LF.mensagem("the exposure search stopped: " + err.message, true);
    } finally {
      buscando = false;
      LF.q("#bt-auto-exp").disabled = false;
    }
  }

  async function travar() {
    try {
      const e = await LF.camera.trava({
        exposureTime: valorExposicao(),
        colorTemperature: parseFloat(LF.q("#temp-cor").value),
      });
      LF.telas.camera.mostraEstado(e);
    } catch (err) {
      LF.mensagem(err.message, true);
    }
  }

  async function soltar() {
    if (!LF.camera.aberta()) {
      LF.mensagem("open the camera first: the release goes through the open stream", true);
      return;
    }
    if (LF.telas.cinetica.corrida && !confirm("A run is recording. Releasing the "
        + "camera lets the exposure drift under it.\n\nRelease anyway?")) return;
    try {
      const r = await LF.camera.solta();
      LF.telas.camera.mostraEstado(r.estado);
      if (r.confere.ok) {
        LF.mensagem("camera released: exposure and white balance are automatic again");
      } else {
        LF.mensagem("the camera did not take the release: " + r.confere.divergente
          .map(function (d) { return d.campo + " is " + d.obtido; }).join(", "), true);
      }
    } catch (err) {
      LF.mensagem("could not release the camera: " + err.message, true);
    }
  }

  function ligaPainel() {
    LF.q("#bt-abrir").addEventListener("click", function () { LF.telas.camera.abre(); });
    LF.q("#bt-fechar").addEventListener("click", function () {
      LF.camera.fecha();
      LF.selo("#selo-camera", "no camera");
      LF.selo("#selo-trava", "unlocked", "mau");
      LF.mensagem("camera closed");
    });
    LF.q("#bt-travar").addEventListener("click", travar);
    LF.q("#bt-soltar").addEventListener("click", soltar);

    LF.q("#exposicao").addEventListener("input", mostraExposicao);
    LF.q("#exposicao").addEventListener("change", function () {
      if (LF.camera.aberta()) travar();
    });
    LF.q("#temp-cor").addEventListener("input", function () {
      LF.q("#temp-cor-val").textContent = this.value;
    });
    LF.q("#temp-cor").addEventListener("change", function () {
      if (LF.camera.aberta()) travar();
    });

    LF.q("#modo").addEventListener("change", function () {
      LF.estado.modo = this.value;
      LF.telas.espectro.trocaModo();
      LF.telas.cinetica.solta();
    });
    LF.q("#media-n").addEventListener("change", function () {
      LF.estado.mediaN = parseInt(this.value, 10);
      zeraFiltro(); mostraFiltro();
    });
    LF.q("#filtro").addEventListener("change", function () {
      LF.estado.filtro = this.value;
      zeraFiltro(); mostraFiltro();
      if (this.value === "pico" && ["absorbance", "transmittance"].indexOf(LF.estado.modo) >= 0) {
        LF.mensagem("peak hold keeps the highest value each column reached: it is "
          + "for flashes in emission, and it makes absorbance meaningless", true);
      }
    });
    LF.q("#bt-filtro-zera").addEventListener("click", function () {
      zeraFiltro();
      LF.mensagem("the live spectrum starts again from the next frame");
    });
    LF.q("#bt-auto-exp").addEventListener("click", autoExposicao);
    LF.q("#gama").addEventListener("change", function () {
      refazLut();
      LF.mensagem("linearization changed — the dark and the reference must be "
        + "captured again", true);
      LF.estado.quadros.escuro = null;
      LF.estado.quadros.referencia = null;
      LF.estado.quadros.branco = null;
      LF.telas.espectro.redesenha();
    });
  }

  function ligaAbas() {
    LF.qq("#abas button").forEach(function (bt) {
      bt.addEventListener("click", function () {
        mostra(bt.dataset.tela);
      });
    });
    LF.qq("button.ajuda").forEach(function (bt) {
      bt.addEventListener("click", function () {
        mostra("ajuda");
        LF.telas.ajuda.vaiPara(bt.dataset.ir);
      });
    });
  }

  /* ---------------------------------------------------------- the header */

  /* The house header starts collapsed to one strip, so the charts get the
     height; a click opens it and the choice is remembered. Help is a page of
     text with room to spare, so it shows the full header without changing
     the choice. MWFlow and WaveCal-END do the same. */
  const CHAVE_CABECALHO = "lf.cabecalho";

  function cabecalhoCheio() {
    return localStorage.getItem(CHAVE_CABECALHO) === "cheio";
  }

  function mostraCabecalho() {
    const el = LF.q("#identidade");
    const cheio = cabecalhoCheio() || LF.telaAtual === "ajuda";
    if (el.classList.contains("compacto") === !cheio) return;
    el.classList.toggle("compacto", !cheio);
    el.setAttribute("aria-expanded", String(cheio));
    el.title = cheio ? "Click to collapse the header" : "Click to show the full header";
    /* The screens get their height from what is left, so they are measured
       again now rather than on the next frame, which may never come. */
    window.dispatchEvent(new Event("resize"));
    const t = LF.telas[LF.telaAtual];
    if (t && t.aoEntrar) t.aoEntrar();
  }

  function ligaCabecalho() {
    const el = LF.q("#identidade");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const troca = function () {
      localStorage.setItem(CHAVE_CABECALHO, cabecalhoCheio() ? "compacto" : "cheio");
      mostraCabecalho();
    };
    el.addEventListener("click", troca);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); troca(); }
    });
    mostraCabecalho();
  }

  function mostra(nome) {
    LF.telaAtual = nome;
    LF.qq("#abas button").forEach(function (b) {
      b.classList.toggle("ativa", b.dataset.tela === nome);
    });
    LF.qq(".tela").forEach(function (t) {
      t.classList.toggle("ativa", t.id === "tela-" + nome);
    });
    mostraCabecalho();
    const t = LF.telas[nome];
    if (t && t.aoEntrar) t.aoEntrar();
  }
  LF.mostraTela = mostra;

  /* --------------------------------------------------------------- start */

  LF.inicia = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      LF.mensagem("This browser gives the page no camera access. On a local "
        + "copy the page must be served over http://localhost — opening the "
        + "file directly does not work.", true);
    }
    refazLut();
    ligaPainel();
    ligaAbas();
    LF.roi.inicia(function () {
      zeraFiltro();
      LF.telas.camera.mostraRoi();
    });
    Object.keys(LF.telas).forEach(function (k) {
      if (LF.telas[k].inicia) LF.telas[k].inicia();
    });
    /* After the screens: opening the header measures the current screen. */
    ligaCabecalho();
    LF.telas.camera.listaDispositivos();
    mostraExposicao();
    mostraFiltro();
    window.addEventListener("beforeunload", function () { LF.camera.fecha(); });
  };

  /* The loop can only start once a stream exists, so opening the camera calls
     this rather than LF.inicia doing it hopefully. */
  LF.rodaLoop = function () {
    LF.camera.para();
    zeraFiltro();
    LF.camera.comeca(porQuadro);
  };
  LF.mostraExposicao = mostraExposicao;
  LF.travar = travar;
})();
