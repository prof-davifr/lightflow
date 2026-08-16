"use strict";
/* Tab 5 — what is stored, how big it is, and how to get it out.

   Exporting recomputes from the raw frames rather than from whatever the screen
   happened to be showing during the run. A run measured on green with a bad
   reference can be exported on green with a better one, or on blue, or against
   a calibration fitted afterwards, without repeating the chemistry. */

LF.telas.dados = (function () {

  async function recarrega() {
    const corpo = LF.q("#tab-sessoes tbody");
    corpo.innerHTML = "";
    let ss = [];
    try {
      ss = await LF.nucleo.storage.listaSessoes();
    } catch (e) {
      corpo.innerHTML = '<tr><td colspan="6">the browser database is not '
        + "available: " + e.message + "</td></tr>";
      return;
    }
    if (!ss.length) {
      corpo.innerHTML = '<tr><td colspan="6">No runs saved yet. Start one on the '
        + "Kinetics tab.</td></tr>";
    }
    for (const s of ss) {
      const n = await LF.nucleo.storage.contaEspectros(s.id);
      const bytes = LF.nucleo.storage.tamanhoEstimado(n, s.n_col || 0, 1);
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + escapa(s.nome) + "</td>"
        + "<td>" + new Date(s.criada).toLocaleString() + "</td>"
        + '<td class="num">' + n + "</td>"
        + "<td>" + (s.modo || "—") + " · " + (s.canal || "—") + "</td>"
        + '<td class="num">' + tamanho(bytes) + "</td>"
        + "<td><button>CSV</button> <button>JSON</button> <button>×</button></td>";
      const bts = tr.lastChild.children;
      bts[0].addEventListener("click", function () { exportaCsv(s); });
      bts[1].addEventListener("click", function () { exportaJson(s); });
      bts[2].addEventListener("click", async function () {
        if (!confirm("Delete \"" + s.nome + "\" and its " + n + " spectra?")) return;
        await LF.nucleo.storage.apagaSessao(s.id);
        recarrega();
      });
      corpo.appendChild(tr);
    }
    mostraEspaco();
  }

  function escapa(s) {
    const d = document.createElement("span");
    d.textContent = s === undefined || s === null ? "" : s;
    return d.innerHTML;
  }

  function tamanho(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return LF.num(b / 1024, 0) + " kB";
    return LF.num(b / 1048576, 1) + " MB";
  }

  async function mostraEspaco() {
    const el = LF.q("#rot-espaco");
    try {
      const e = await LF.nucleo.storage.espaco();
      if (!e) { el.textContent = "quota unknown"; return; }
      el.textContent = tamanho(e.usage) + " used of " + tamanho(e.quota) + " allowed";
    } catch (err) { el.textContent = "—"; }
  }

  /* Rebuilds the run in whatever mode and channel are selected NOW, from the
     stored raw frames and the stored dark and reference. */
  async function reconstroi(s) {
    const linhas = await LF.nucleo.storage.leEspectros(s.id);
    const especiais = {};
    const amostras = [];
    linhas.forEach(function (r) {
      if (r.tipo === "amostra") amostras.push(r);
      else especiais[r.tipo] = r;
    });
    const canal = LF.estado.canal;
    const modo = LF.estado.modo;
    const quadros = {
      escuro: especiais.escuro, referencia: especiais.referencia,
      branco: especiais.branco,
    };
    const exige = LF.nucleo.photometry.EXIGE[modo] || [];
    const falta = exige.filter(function (k) { return !quadros[k]; });

    const tempos = [], valores = [];
    amostras.forEach(function (r) {
      if (!r[canal]) return;                 // that channel was not stored
      tempos.push(r.t);
      if (falta.length) { valores.push(r[canal]); return; }
      try {
        valores.push(LF.nucleo.photometry.calcula(modo,
          Object.assign({ amostra: r }, quadros), canal));
      } catch (e) {
        valores.push(r[canal]);
      }
    });
    return { tempos: tempos, valores: valores, falta: falta, canal: canal, modo: modo, s: s };
  }

  function eixoDe(s, n) {
    if (s.cal && s.cal.coef) {
      return LF.nucleo.calibration.eixo({ coef: s.cal.coef }, n);
    }
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = i;
    return v;
  }

  async function exportaCsv(s) {
    LF.mensagem("rebuilding \"" + s.nome + "\" …");
    const r = await reconstroi(s);
    if (!r.valores.length) {
      LF.mensagem("nothing stored on the " + r.canal + " channel for this run", true);
      return;
    }
    if (r.falta.length) {
      LF.mensagem("exported as raw intensity: this run has no " + r.falta.join(" or "), true);
    }
    const xs = eixoDe(s, r.valores[0].length);
    const texto = LF.nucleo.exportfile.csvCorrida(r.tempos, xs, r.valores, {
      modo: r.falta.length ? "raw_linear" : r.modo, canal: r.canal,
      unidade: r.falta.length ? "linear, a.u." : LF.nucleo.photometry.UNIDADE[r.modo],
      calibrado: !!(s.cal && s.cal.coef), inicio: s.criada,
    });
    LF.baixa(nomeArquivo(s, "csv"), texto, "text/csv");
    LF.mensagem("exported " + r.tempos.length + " spectra");
  }

  async function exportaJson(s) {
    const r = await reconstroi(s);
    const xs = r.valores.length ? eixoDe(s, r.valores[0].length) : [];
    LF.baixa(nomeArquivo(s, "json"), LF.nucleo.exportfile.json({
      format: "lightflow-run", version: 1,
      session: s, mode: r.modo, channel: r.canal,
      missing: r.falta, axis: xs, times_s: r.tempos, values: r.valores,
    }), "application/json");
  }

  function nomeArquivo(s, ext) {
    const base = String(s.nome).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
    return "lightflow-" + base + "." + ext;
  }

  /* A single spectrum, saved outside any run. */
  async function salvaEspectro(m) {
    if (!m) { LF.mensagem("no spectrum to save", true); return; }
    try {
      const s = await LF.nucleo.storage.criaSessao({
        nome: "spectrum " + new Date().toLocaleString(),
        modo: LF.estado.modo, canal: LF.estado.canal,
        gama: String(LF.estado.gama), n_col: LF.estado.nCol,
        roi: LF.roi.get(), assinatura: LF.estado.assinatura,
        cal: LF.estado.cal ? { coef: LF.estado.cal.coef, ordem: LF.estado.cal.ordem } : null,
        n_espectros: 1, encerrada: Date.now(),
      });
      const q = LF.estado.quadros;
      for (const k of ["escuro", "referencia", "branco"]) {
        if (q[k]) await LF.nucleo.storage.gravaEspectro(s.id, q[k], { tipo: k, t: 0, comSigma: true });
      }
      await LF.nucleo.storage.gravaEspectro(s.id, m, { tipo: "amostra", t: 0, comSigma: true });
      LF.mensagem("spectrum saved with its dark and reference");
      recarrega();
    } catch (e) {
      LF.mensagem("could not save: " + e.message, true);
    }
  }

  function inicia() {
    LF.q("#bt-recarregar").addEventListener("click", recarrega);
    LF.q("#bt-persistir").addEventListener("click", async function () {
      const ok = await LF.nucleo.storage.persiste();
      LF.mensagem(ok
        ? "the browser will keep this data until you delete it"
        : "the browser refused; data may be evicted under disk pressure", !ok);
      mostraEspaco();
    });
  }

  return {
    inicia: inicia, recarrega: recarrega, salvaEspectro: salvaEspectro,
    aoEntrar: recarrega,
  };
})();
