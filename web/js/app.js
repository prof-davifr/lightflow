"use strict";
/* Tabs, the global state, and the one frame loop everything else feeds off.

   There is exactly one loop and one accumulator. Every screen subscribes to the
   averaged line it produces instead of grabbing its own frames, so the spectrum
   on the Spectrum tab and the line going into the spectrogram are the same
   numbers, not two independent measurements of the same instant. */

LF.estado = {
  canal: "g",
  modo: "absorbance",
  mediaN: 16,
  gama: "srgb",
  quadros: { amostra: null, escuro: null, referencia: null, branco: null },
  cal: null,
  eixo: null,           // Float64Array of nm, or null while uncalibrated
  nCol: 0,
  assinatura: "",
};

LF.telaAtual = "camera";

(function () {
  let lut = null, acumulador = null;
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

    if (!acumulador || acumulador.w !== roi.w) {
      acumulador = new LF.nucleo.frame.Acumulador(roi.w);
      LF.estado.nCol = roi.w;
      LF.estado.assinatura = LF.nucleo.frame.assinatura(roi, corte.larg, corte.alt);
    }
    acumulador.poe(linha);

    LF.telas.camera.aoQuadroCru(linha);

    if (acumulador.pronto(LF.estado.mediaN)) {
      const m = acumulador.media();
      acumulador.limpa();
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

  /* Captures N frames into a fresh accumulator and stores the mean under a
     name. The dark and the reference are ordinary frames; the only thing that
     makes them special is which slot they sit in. */
  LF.captura = function (nome, n, aoFim) {
    const roi = LF.roi.get();
    if (!LF.camera.aberta()) { LF.mensagem("open the camera first", true); return; }
    const ac = new LF.nucleo.frame.Acumulador(roi.w);
    let restam = n;
    LF.mensagem("capturing " + n + " frames for the " + nome + " …");
    const passo = function (linha) {
      if (linha.r.length !== ac.w) return;   // the ROI moved mid-capture
      ac.poe(linha);
      restam--;
      if (restam > 0) return;
      const k = ouvintesCru.indexOf(passo);
      if (k >= 0) ouvintesCru.splice(k, 1);
      const m = ac.media();
      m.t = Date.now(); m.roi = roi; m.tipo = nome;
      LF.estado.quadros[nome] = m;
      LF.mensagem(nome + " captured from " + n + " frames");
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

  function ligaPainel() {
    LF.q("#bt-abrir").addEventListener("click", function () { LF.telas.camera.abre(); });
    LF.q("#bt-fechar").addEventListener("click", function () {
      LF.camera.fecha();
      LF.selo("#selo-camera", "no camera");
      LF.selo("#selo-trava", "unlocked", "mau");
      LF.mensagem("camera closed");
    });
    LF.q("#bt-travar").addEventListener("click", travar);

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

    LF.q("#canal").addEventListener("change", function () {
      LF.estado.canal = this.value;
      LF.mensagem("measuring on the " + this.options[this.selectedIndex].text.split(" —")[0] + " channel");
      LF.telas.espectro.redesenha();
    });
    LF.q("#modo").addEventListener("change", function () {
      LF.estado.modo = this.value;
      LF.telas.espectro.trocaModo();
    });
    LF.q("#media-n").addEventListener("change", function () {
      LF.estado.mediaN = parseInt(this.value, 10);
      if (acumulador) acumulador.limpa();
    });
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

  function mostra(nome) {
    LF.telaAtual = nome;
    LF.qq("#abas button").forEach(function (b) {
      b.classList.toggle("ativa", b.dataset.tela === nome);
    });
    LF.qq(".tela").forEach(function (t) {
      t.classList.toggle("ativa", t.id === "tela-" + nome);
    });
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
      if (acumulador) acumulador.limpa();
      LF.telas.camera.mostraRoi();
    });
    Object.keys(LF.telas).forEach(function (k) {
      if (LF.telas[k].inicia) LF.telas[k].inicia();
    });
    LF.telas.camera.listaDispositivos();
    mostraExposicao();
    window.addEventListener("beforeunload", function () { LF.camera.fecha(); });
  };

  /* The loop can only start once a stream exists, so opening the camera calls
     this rather than LF.inicia doing it hopefully. */
  LF.rodaLoop = function () {
    LF.camera.para();
    if (acumulador) acumulador.limpa();
    LF.camera.comeca(porQuadro);
  };
  LF.mostraExposicao = mostraExposicao;
  LF.travar = travar;
})();
