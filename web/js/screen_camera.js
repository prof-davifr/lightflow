"use strict";
/* Tab 1 — pick the camera, lock it, and put the box on the stripe.

   The capability table is the point of this screen. It shows what the camera
   said it could do next to what it reported after the request, because those
   two columns are the only evidence that the lock took. */

LF.telas.camera = (function () {
  let plot = null, ultima = null, pendente = false;

  async function listaDispositivos() {
    const sel = LF.q("#dispositivo");
    let ds = [];
    try { ds = await LF.camera.lista(); } catch (e) { }
    const anterior = sel.value || localStorage.getItem("lf.dispositivo") || "";
    sel.innerHTML = "";
    if (!ds.length) {
      sel.innerHTML = '<option value="">— no camera found —</option>';
      LF.mensagem("No camera found. The page needs https or localhost, and the "
        + "browser needs permission.", true);
      return;
    }
    ds.forEach(function (d, k) {
      const o = document.createElement("option");
      o.value = d.deviceId;
      /* Before permission is granted the labels are empty strings, which is why
         the list is rebuilt after the stream opens. */
      o.textContent = d.label || ("camera " + (k + 1) + " (name hidden until "
        + "you allow access)");
      sel.appendChild(o);
    });
    if (anterior && ds.some(function (d) { return d.deviceId === anterior; })) {
      sel.value = anterior;
    }
  }

  async function abre() {
    const sel = LF.q("#dispositivo");
    const res = LF.q("#resolucao").value.split("x");
    try {
      LF.mensagem("opening the camera …");
      const r = await LF.camera.abre(sel.value, parseInt(res[0], 10), parseInt(res[1], 10));
      localStorage.setItem("lf.dispositivo", sel.value);
      await listaDispositivos();          // labels arrive only after permission
      sel.value = LF.camera.ajustes.deviceId || sel.value;

      const t = LF.camera.tamanho();
      LF.selo("#selo-camera", t.larg + "×" + t.alt, "ok");
      LF.selo("#selo-trava", "unlocked", "mau");
      ajustaRoiAoQuadro(t);
      LF.rodaLoop();
      mostraEstado(LF.camera.estado());
      LF.mensagem("camera open at " + t.larg + " by " + t.alt
        + ". Lock it before measuring anything.");
      /* Locking straight away is what the operator wants nine times out of ten,
         and leaving it unlocked is the mistake this program exists to prevent. */
      await LF.travar();
      LF.roi.centraNaFaixa();
    } catch (e) {
      LF.selo("#selo-camera", "no camera", "mau");
      LF.mensagem("could not open the camera: " + e.message, true);
    }
  }

  /* Keeps a saved ROI inside a frame that may be a different size. */
  function ajustaRoiAoQuadro(t) {
    const r = LF.roi.get();
    if (r.x + r.w > t.larg || r.w > t.larg) { r.x = 0; r.w = t.larg; }
    if (r.y + r.h > t.alt) { r.y = Math.max(0, Math.floor((t.alt - r.h) / 2)); }
    if (r.h > t.alt) r.h = Math.min(61, t.alt);
    LF.roi.set(r, false);
    mostraRoi();
  }

  function mostraRoi() {
    const r = LF.roi.get();
    poe("#roi-x", r.x); poe("#roi-y", r.y);
    poe("#roi-w", r.w); poe("#roi-h", r.h);
    poe("#roi-a", LF.num(r.angle, 2));
  }

  function poe(sel, v) {
    const el = LF.q(sel);
    if (el && document.activeElement !== el) el.value = v;
  }

  function leRoi() {
    LF.roi.set({
      x: LF.q("#roi-x").value, y: LF.q("#roi-y").value,
      w: LF.q("#roi-w").value, h: LF.q("#roi-h").value,
      angle: LF.q("#roi-a").value,
    });
  }

  /* ------------------------------------------------------- capability table */

  function mostraEstado(e) {
    const corpo = LF.q("#tab-capacidades tbody");
    corpo.innerHTML = "";
    const cap = e.capacidades || {}, aj = e.ajustes || {};
    const campos = ["exposureMode", "exposureTime", "whiteBalanceMode",
      "colorTemperature", "focusMode", "frameRate", "width", "height"];
    campos.forEach(function (k) {
      if (cap[k] === undefined && aj[k] === undefined) return;
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + k + "</td><td>" + descreve(cap[k])
        + "</td><td class=\"num\">" + descreve(aj[k]) + "</td>";
      if (k === "exposureMode" || k === "whiteBalanceMode") {
        if (aj[k] !== "manual") tr.lastChild.classList.add("ruim");
      }
      corpo.appendChild(tr);
    });
    if (!corpo.children.length) {
      corpo.innerHTML = '<tr><td colspan="3">The camera reports no adjustable '
        + 'controls at all. On Linux this normally means Firefox.</td></tr>';
    } else {
      const cab = document.createElement("tr");
      cab.innerHTML = "<td></td><td><b>can do</b></td><td class=\"num\"><b>is doing</b></td>";
      corpo.insertBefore(cab, corpo.firstChild);
    }

    const av = LF.q("#aviso-trava");
    av.textContent = (e.avisos || []).join(" ");
    if (e.travada) {
      LF.selo("#selo-trava", "locked", "ok");
    } else {
      LF.selo("#selo-trava", e.aberta ? "AUTO — not a measurement" : "unlocked", "mau");
    }
    LF.mostraExposicao();
  }

  function descreve(v) {
    if (v === undefined) return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (v && typeof v === "object") {
      return LF.num(v.min, 0) + " to " + LF.num(v.max, 0)
        + (v.step ? " step " + v.step : "");
    }
    return typeof v === "number" ? LF.num(v, 2) : String(v);
  }

  /* ------------------------------------------------------------ live plot */

  function cria() {
    const el = LF.q("#g-cru");
    const n = Math.max(2, LF.roi.get().w);
    plot = new uPlot({
      width: 600, height: 220,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [LF.eixo("Column (px)", 0), LF.eixo("Linear intensity", "auto")],
      series: [
        {},
        LF.serie("R", LF.cor.canal.r),
        LF.serie("G", LF.cor.canal.g),
        LF.serie("B", LF.cor.canal.b),
      ],
    }, [LF.vazio(n), LF.vazio(n), LF.vazio(n), LF.vazio(n)], el);
    LF.ajusta(plot, el);
  }

  /* Called on every single frame, so it must be cheap. The redraw is deferred
     to the next animation frame: a 30 fps camera can outrun uPlot on a wide
     ROI, and queueing one redraw per frame would only build a backlog. */
  function aoQuadroCru(linha) {
    ultima = linha;
    if (LF.telaAtual !== "camera" || pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; pinta(); });
  }

  function pinta() {
    if (!plot || !ultima) return;
    const n = ultima.r.length;
    const xs = new Array(n);
    for (let i = 0; i < n; i++) xs[i] = i;
    plot.setData([xs, Array.from(ultima.r), Array.from(ultima.g), Array.from(ultima.b)]);
    LF.ajusta(plot, LF.q("#g-cru"));
  }

  function inicia() {
    cria();
    ["#roi-x", "#roi-y", "#roi-w", "#roi-h", "#roi-a"].forEach(function (s) {
      LF.q(s).addEventListener("change", leRoi);
    });
    LF.q("#bt-roi-centro").addEventListener("click", function () {
      LF.roi.centraNaFaixa(); mostraRoi();
    });
    LF.q("#bt-roi-tudo").addEventListener("click", function () {
      LF.roi.larguraToda(); mostraRoi();
    });
    LF.q("#dispositivo").addEventListener("change", function () {
      if (LF.camera.aberta()) abre();
    });
    LF.q("#resolucao").addEventListener("change", function () {
      if (LF.camera.aberta()) abre();
    });
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", listaDispositivos);
    }
    mostraRoi();
  }

  return {
    inicia: inicia, abre: abre, listaDispositivos: listaDispositivos,
    mostraEstado: mostraEstado, mostraRoi: mostraRoi,
    aoQuadroCru: aoQuadroCru,
    aoEntrar: function () { LF.ajusta(plot, LF.q("#g-cru")); pinta(); },
  };
})();
