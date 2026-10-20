"use strict";
/* The Response panel in the sidebar: load, compute, export and switch the
   instrument response correction. The arithmetic is in nucleo/resposta.js.

   The curve is kept in localStorage, not in the database: it belongs to the
   bench, like a calibration, and it has to survive a reload without a run. It
   is applied on read, to emission and fluorescence only, so nothing stored is
   ever changed by it. */

LF.resposta = (function () {
  const CHAVE = "lightflow-resposta";
  let cache = null;          // {curva, eixo, k}: the coefficients on one axis

  function modoUsa(modo) { return modo === "emission" || modo === "fluorescence"; }

  /* True when the correction will be applied to this mode on this axis. */
  function ativa(modo, eixo) {
    return !!(LF.estado.respostaLigada && LF.estado.resposta && eixo && modoUsa(modo));
  }

  function coef(eixo) {
    const c = LF.estado.resposta;
    if (!cache || cache.curva !== c || cache.eixo !== eixo) {
      cache = { curva: c, eixo: eixo, k: LF.nucleo.resposta.coeficientesEm(c, eixo) };
    }
    return cache.k;
  }

  /* y corrected for the response, or y as it was. `eixo` is the wavelength
     axis in nm the values sit on; without one there is nothing to look the
     coefficients up by, and the values pass through. */
  function corrige(y, modo, eixo) {
    if (!y || !ativa(modo, eixo) || eixo.length !== y.length) return { y: y, aplicada: false };
    return { y: LF.nucleo.resposta.aplica(y, coef(eixo)), aplicada: true };
  }

  function guarda() {
    const c = LF.estado.resposta;
    try {
      if (!c) { localStorage.removeItem(CHAVE); return; }
      localStorage.setItem(CHAVE, JSON.stringify({
        nm: Array.from(c.nm), k: Array.from(c.k), nome: c.nome,
      }));
    } catch (e) { /* private mode: the curve lasts for this page only */ }
  }

  function recupera() {
    try {
      const t = localStorage.getItem(CHAVE);
      if (!t) return;
      const o = JSON.parse(t);
      LF.estado.resposta = { nm: Float64Array.from(o.nm), k: Float64Array.from(o.k), nome: o.nome };
    } catch (e) { LF.estado.resposta = null; }
  }

  function mostra() {
    const c = LF.estado.resposta, el = LF.q("#resposta-val");
    LF.q("#resposta").value = LF.estado.respostaLigada ? "on" : "off";
    if (!c) {
      el.textContent = "no curve loaded";
    } else {
      el.textContent = c.nome + " · " + LF.num(c.nm[0], 0) + " to "
        + LF.num(c.nm[c.nm.length - 1], 0) + " nm · " + c.nm.length + " points";
    }
    LF.q("#bt-resposta-exporta").disabled = !c;
    LF.q("#bt-resposta-tira").disabled = !c;
  }

  function poe(curva, nome) {
    curva.nome = nome;
    LF.estado.resposta = curva;
    LF.estado.respostaLigada = true;
    guarda(); mostra();
    LF.telas.espectro.redesenha();
  }

  function abre(ev) {
    const arq = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!arq) return;
    arq.text().then(function (texto) {
      const c = LF.nucleo.resposta.leCoeficientes(texto);
      poe(c, arq.name.replace(/\.[^.]+$/, ""));
      LF.mensagem("response curve \"" + arq.name + "\" loaded and switched on: "
        + "emission and fluorescence now read as relative irradiance");
    }).catch(function (e) {
      LF.mensagem("could not read " + arq.name + ": " + e.message, true);
    });
  }

  /* From the lamp in front of the slit now, against the dark. */
  function daLampada() {
    const q = LF.estado.quadros, canal = LF.estado.canal;
    if (!LF.calibrado()) {
      LF.mensagem("calibrate first: the curve is a function of wavelength", true); return;
    }
    if (!q.escuro) {
      LF.mensagem("capture a dark first, with the slit covered", true); return;
    }
    if (!q.amostra) { LF.mensagem("open the camera first", true); return; }
    if (q.amostra.clipTotal > 0) {
      LF.mensagem("the lamp clips: lower the exposure, or the curve is wrong exactly "
        + "where the lamp is brightest", true);
      return;
    }
    const t = prompt("Colour temperature of the lamp, in kelvin.\n\nA halogen bulb "
      + "runs at about 2800 to 3200 K; the box or the datasheet gives it. An LED or "
      + "a fluorescent lamp is not a black body and cannot be used here.", "3000");
    if (t === null) return;
    const T = parseFloat(String(t).replace(",", "."));
    if (!(T >= 1500 && T <= 4000)) {
      LF.mensagem("a halogen filament is between 1500 and 4000 K; " + t + " is not", true);
      return;
    }
    try {
      const c = LF.nucleo.resposta.deLampada(q.amostra[canal], q.escuro[canal], LF.estado.eixo, T);
      poe(c, "lamp " + T + " K, " + new Date().toLocaleDateString());
      LF.mensagem("response curve computed from a " + T + " K lamp over "
        + LF.num(c.nm[0], 0) + " to " + LF.num(c.nm[c.nm.length - 1], 0)
        + " nm, and switched on. Export it to keep a copy.");
    } catch (e) {
      LF.mensagem(e.message, true);
    }
  }

  function exporta() {
    const c = LF.estado.resposta;
    if (!c) return;
    const nome = String(c.nome).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
    LF.baixa("lightflow-response-" + nome + ".csv",
      LF.nucleo.resposta.escreveCoeficientes(c, { name: c.nome }), "text/csv");
  }

  function tira() {
    LF.estado.resposta = null;
    LF.estado.respostaLigada = false;
    guarda(); mostra();
    LF.telas.espectro.redesenha();
    LF.mensagem("response curve removed");
  }

  function inicia() {
    recupera();
    LF.q("#resposta").addEventListener("change", function () {
      if (this.value === "on" && !LF.estado.resposta) {
        this.value = "off";
        LF.mensagem("load a response curve first, or compute one from a lamp", true);
        return;
      }
      LF.estado.respostaLigada = this.value === "on";
      if (LF.estado.respostaLigada && !modoUsa(LF.estado.modo)) {
        LF.mensagem("the response correction only changes emission and fluorescence: "
          + "in absorbance it cancels in S / R");
      }
      LF.telas.espectro.redesenha();
    });
    LF.q("#bt-resposta-abre").addEventListener("click", function () { LF.q("#arq-resposta").click(); });
    LF.q("#arq-resposta").addEventListener("change", abre);
    LF.q("#bt-resposta-lampada").addEventListener("click", daLampada);
    LF.q("#bt-resposta-exporta").addEventListener("click", exporta);
    LF.q("#bt-resposta-tira").addEventListener("click", tira);
    mostra();
  }

  /* Registered as a screen so LF.inicia starts it with the others. */
  LF.telas.resposta = { inicia: inicia };

  return { ativa: ativa, corrige: corrige };
})();
