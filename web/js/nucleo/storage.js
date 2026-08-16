/* IndexedDB. One doctrine, borrowed from the sibling project: WHAT GOES ON DISK
   IS RAW, AND THE CORRECTION HAPPENS ON READ.

   Every spectrum is stored as the linearized per-channel intensity, exactly as
   the camera gave it. Absorbance, transmittance, the choice of channel and the
   wavelength axis are all recomputed when the run is read back. That means a
   dark frame taken badly, a reference measured on the wrong blank, or a
   calibration improved a week later can all be applied to a finished run
   without repeating the chemistry.

   The dark, the reference and the blank are ordinary rows in `espectros` with a
   different `tipo`. The session stores only their ids, so changing which dark a
   run uses is a pointer edit and never destroys data.

   The one thing frozen into the stored numbers is the linearization, because it
   has to happen before the rows are binned. The session records which curve was
   used, and changing it means measuring again. */

const NOME = "lightflow";
const VERSAO = 1;
let db = null;

export async function abre() {
  if (db) return db;
  db = await new Promise(function (ok, falha) {
    const req = indexedDB.open(NOME, VERSAO);
    req.onupgradeneeded = function (ev) {
      const d = ev.target.result;
      if (!d.objectStoreNames.contains("sessoes")) {
        d.createObjectStore("sessoes", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("espectros")) {
        const s = d.createObjectStore("espectros", { keyPath: "id", autoIncrement: true });
        s.createIndex("sessao", "sessao_id", { unique: false });
        s.createIndex("sessao_t", ["sessao_id", "t"], { unique: false });
      }
      if (!d.objectStoreNames.contains("calibracoes")) {
        d.createObjectStore("calibracoes", { keyPath: "nome" });
      }
      if (!d.objectStoreNames.contains("preferencias")) {
        d.createObjectStore("preferencias", { keyPath: "chave" });
      }
    };
    req.onsuccess = function () { ok(req.result); };
    req.onerror = function () { falha(req.error); };
  });
  return db;
}

function transacao(lojas, modo) {
  return db.transaction(lojas, modo);
}

function pede(req) {
  return new Promise(function (ok, falha) {
    req.onsuccess = function () { ok(req.result); };
    req.onerror = function () { falha(req.error); };
  });
}

/* Without this the browser may evict the whole database under disk pressure,
   silently, in the middle of a two-hour run. It is worth asking for once. */
export async function persiste() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function espaco() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  return navigator.storage.estimate();
}

/* ----------------------------------------------------------------- sessions */

export async function criaSessao(meta) {
  await abre();
  const s = Object.assign({
    nome: "run " + new Date().toLocaleString(),
    criada: Date.now(), encerrada: null, n_espectros: 0,
  }, meta);
  const id = await pede(transacao(["sessoes"], "readwrite").objectStore("sessoes").add(s));
  s.id = id;
  return s;
}

export async function atualizaSessao(s) {
  await abre();
  return pede(transacao(["sessoes"], "readwrite").objectStore("sessoes").put(s));
}

export async function listaSessoes() {
  await abre();
  const v = await pede(transacao(["sessoes"]).objectStore("sessoes").getAll());
  return v.sort(function (a, b) { return b.criada - a.criada; });
}

export async function leSessao(id) {
  await abre();
  return pede(transacao(["sessoes"]).objectStore("sessoes").get(id));
}

export async function apagaSessao(id) {
  await abre();
  const tx = transacao(["sessoes", "espectros"], "readwrite");
  tx.objectStore("sessoes").delete(id);
  const idx = tx.objectStore("espectros").index("sessao");
  await new Promise(function (ok, falha) {
    const req = idx.openKeyCursor(IDBKeyRange.only(id));
    req.onsuccess = function () {
      const c = req.result;
      if (!c) { ok(); return; }
      tx.objectStore("espectros").delete(c.primaryKey);
      c.continue();
    };
    req.onerror = function () { falha(req.error); };
  });
}

/* ----------------------------------------------------------------- spectra */

/* `quadro` is the averaged frame from frame.js. Only the channels asked for are
   written: all three at 1280 columns cost 15 kB a spectrum, which is 55 MB an
   hour at one a second, and most runs only ever look at one channel. */
export async function gravaEspectro(sessaoId, quadro, extra) {
  await abre();
  extra = extra || {};
  const canais = extra.canais || ["r", "g", "b"];
  const linha = {
    sessao_id: sessaoId,
    t: extra.t === undefined ? 0 : extra.t,          // seconds from the start
    t_abs: quadro.t || Date.now(),
    tipo: extra.tipo || "amostra",
    n_col: quadro.r.length,
    n_quadros: quadro.n_quadros,
    clip: quadro.clip,
    rotulo: extra.rotulo || "",
  };
  canais.forEach(function (k) { linha[k] = quadro[k]; });
  if (extra.comSigma && quadro.sigma) {
    linha.sigma = {};
    canais.forEach(function (k) { linha.sigma[k] = quadro.sigma[k]; });
  }
  return pede(transacao(["espectros"], "readwrite").objectStore("espectros").add(linha));
}

export async function leEspectros(sessaoId, opc) {
  await abre();
  opc = opc || {};
  const idx = transacao(["espectros"]).objectStore("espectros").index("sessao");
  const v = await pede(idx.getAll(IDBKeyRange.only(sessaoId)));
  let saida = v.sort(function (a, b) { return a.t - b.t; });
  if (opc.tipo) saida = saida.filter(function (r) { return r.tipo === opc.tipo; });
  if (opc.t0 !== undefined) saida = saida.filter(function (r) { return r.t >= opc.t0; });
  if (opc.t1 !== undefined) saida = saida.filter(function (r) { return r.t <= opc.t1; });
  return saida;
}

export async function leEspectro(id) {
  await abre();
  return pede(transacao(["espectros"]).objectStore("espectros").get(id));
}

export async function contaEspectros(sessaoId) {
  await abre();
  const idx = transacao(["espectros"]).objectStore("espectros").index("sessao");
  return pede(idx.count(IDBKeyRange.only(sessaoId)));
}

/* Rough bytes on disk for a session, for the size shown next to it. Four bytes
   a column a channel plus the row overhead; close enough to warn somebody
   before a run fills the quota, which is all the number is for. */
export function tamanhoEstimado(nEspectros, nCol, nCanais) {
  return nEspectros * (nCol * 4 * nCanais + nCol * 2 + 200);
}

/* ------------------------------------------------------------ calibrations */

export async function salvaCal(cal) {
  await abre();
  return pede(transacao(["calibracoes"], "readwrite").objectStore("calibracoes").put(cal));
}

export async function listaCals() {
  await abre();
  const v = await pede(transacao(["calibracoes"]).objectStore("calibracoes").getAll());
  return v.sort(function (a, b) { return (b.criada || 0) - (a.criada || 0); });
}

export async function leCal(nome) {
  await abre();
  return pede(transacao(["calibracoes"]).objectStore("calibracoes").get(nome));
}

export async function apagaCal(nome) {
  await abre();
  return pede(transacao(["calibracoes"], "readwrite").objectStore("calibracoes").delete(nome));
}

/* ------------------------------------------------------------ preferences */

export async function poePref(chave, valor) {
  await abre();
  return pede(transacao(["preferencias"], "readwrite").objectStore("preferencias")
    .put({ chave: chave, valor: valor }));
}

export async function lePref(chave, padrao) {
  await abre();
  const r = await pede(transacao(["preferencias"]).objectStore("preferencias").get(chave));
  return r === undefined ? padrao : r.valor;
}
