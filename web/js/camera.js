"use strict";
/* Everything that touches the camera. The rest of the program sees only frames.

   Two browser facts shape this file.

   getUserMedia needs a secure context, so the page works on https and on
   localhost and nowhere else. Opening index.html by double-clicking it gives a
   file:// page and an empty device list, and that is the first thing anyone
   trying this will do.

   requestAnimationFrame is throttled to about one call a second in a background
   tab, which would tear holes in a two-hour run. requestVideoFrameCallback
   fires once per decoded frame instead, carries the media timestamp, and does
   not repeat a frame that has not changed. */

LF.camera = (function () {
  let stream = null, track = null, video = null;
  let capacidades = null, ajustes = null, plano = null, conferido = null;
  let lona = null, ctx = null;              // offscreen canvas for the pixels
  let rodando = false, aoQuadro = null;
  let quadros = 0, t0 = 0, taxa = 0;
  let wakeLock = null;

  /* Labels come back empty until the user has granted permission once, so the
     list is asked for twice: before, to see whether anything is there at all,
     and again after the stream opens, to get the names. */
  async function lista() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const ds = await navigator.mediaDevices.enumerateDevices();
    return ds.filter(function (d) { return d.kind === "videoinput"; });
  }

  async function abre(deviceId, larg, alt) {
    fecha();
    const restricoes = {
      audio: false,
      video: {
        width: { ideal: larg }, height: { ideal: alt },
        frameRate: { ideal: 30 },
      },
    };
    if (deviceId) restricoes.video.deviceId = { exact: deviceId };
    stream = await navigator.mediaDevices.getUserMedia(restricoes);
    track = stream.getVideoTracks()[0];
    video = LF.q("#video");
    video.srcObject = stream;
    await video.play();

    capacidades = track.getCapabilities ? track.getCapabilities() : {};
    ajustes = track.getSettings ? track.getSettings() : {};

    lona = document.createElement("canvas");
    /* willReadFrequently keeps the canvas on the CPU side. Without it Chrome
       keeps the surface on the GPU and every getImageData pays a full readback,
       which on a 1280-wide frame costs more than the whole extraction. */
    ctx = lona.getContext("2d", { willReadFrequently: true });
    quadros = 0; t0 = performance.now(); taxa = 0;
    return { capacidades: capacidades, ajustes: ajustes };
  }

  function fecha() {
    para();
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; track = null; capacidades = null; ajustes = null;
    plano = null; conferido = null;
    if (video) video.srcObject = null;
    soltaWakeLock();
  }

  function aberta() { return !!track && track.readyState === "live"; }

  function tamanho() {
    if (!video) return { larg: 0, alt: 0 };
    return { larg: video.videoWidth || 0, alt: video.videoHeight || 0 };
  }

  /* --------------------------------------------------------------- locks */

  /* Asks for manual exposure and manual white balance, then READS BACK what the
     camera actually did. applyConstraints resolving only means the browser
     accepted the request; several UVC cameras resolve and carry on regardless,
     which is why the comparison is the real result of this function. */
  async function trava(desejado) {
    if (!track) throw new Error("no camera is open");
    const N = LF.nucleo.locks;
    plano = N.plano(capacidades, desejado);
    if (Object.keys(plano.restricoes).length) {
      try {
        await track.applyConstraints({ advanced: [plano.restricoes] });
      } catch (e) {
        plano.avisos.push("The camera refused the constraints: " + e.message);
      }
    }
    ajustes = track.getSettings ? track.getSettings() : {};
    conferido = N.confere(plano.restricoes, ajustes);
    return estado();
  }

  function estado() {
    return {
      aberta: aberta(),
      capacidades: capacidades || {},
      ajustes: ajustes || {},
      faltando: plano ? plano.faltando : ["exposureMode", "whiteBalanceMode"],
      avisos: plano ? plano.avisos : [],
      confere: conferido,
      travada: !!(conferido && conferido.modosOk),
    };
  }

  /* ------------------------------------------------------------- capture */

  /* Reads only the pixels the ROI can reach, not the whole frame.

     A 1280 by 61 strip is 410 kB; the whole 1280 by 720 frame is 3.7 MB, and at
     30 frames a second the difference is 110 MB of allocation every second
     against 12. The rotated corners set the box, so a tilted ROI still gets
     everything it needs, and the ROI is handed back in the crop's own
     coordinates. */
  function recorta(roi) {
    const t = tamanho();
    if (!t.larg || !t.alt) return null;
    if (lona.width !== t.larg || lona.height !== t.alt) {
      lona.width = t.larg; lona.height = t.alt;
    }
    ctx.drawImage(video, 0, 0, t.larg, t.alt);

    const rad = (roi.angle || 0) * Math.PI / 180;
    const co = Math.abs(Math.cos(rad)), si = Math.abs(Math.sin(rad));
    const cx = roi.x + (roi.w - 1) / 2, cy = roi.y + (roi.h - 1) / 2;
    const meiaL = (roi.w * co + roi.h * si) / 2 + 2;
    const meiaA = (roi.w * si + roi.h * co) / 2 + 2;

    const x0 = Math.max(0, Math.floor(cx - meiaL));
    const y0 = Math.max(0, Math.floor(cy - meiaA));
    const x1 = Math.min(t.larg, Math.ceil(cx + meiaL) + 1);
    const y1 = Math.min(t.alt, Math.ceil(cy + meiaA) + 1);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;

    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    return {
      img: img,
      roi: { x: roi.x - x0, y: roi.y - y0, w: roi.w, h: roi.h, angle: roi.angle || 0 },
      larg: t.larg, alt: t.alt,
    };
  }

  /* Full-frame pixels, for the preview overlay only. */
  function quadroInteiro() {
    const t = tamanho();
    if (!t.larg) return null;
    if (lona.width !== t.larg || lona.height !== t.alt) {
      lona.width = t.larg; lona.height = t.alt;
    }
    ctx.drawImage(video, 0, 0, t.larg, t.alt);
    return ctx.getImageData(0, 0, t.larg, t.alt);
  }

  /* --------------------------------------------------------------- loop */

  function comeca(cb) {
    if (rodando) return;
    rodando = true; aoQuadro = cb;
    quadros = 0; t0 = performance.now();
    passo();
    pedeWakeLock();
  }

  function para() {
    rodando = false; aoQuadro = null;
    soltaWakeLock();
  }

  function passo() {
    if (!rodando || !video) return;
    try {
      if (aoQuadro) aoQuadro();
    } catch (e) {
      LF.mensagem("frame loop stopped: " + e.message, true);
      rodando = false;
      return;
    }
    quadros++;
    const dt = performance.now() - t0;
    if (dt > 1000) { taxa = quadros * 1000 / dt; quadros = 0; t0 = performance.now(); }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(passo);
    else requestAnimationFrame(passo);
  }

  function fps() { return taxa; }

  /* A screen wake lock keeps the tab from being throttled or the display from
     sleeping in the middle of a long run. It is dropped whenever the camera
     stops, so nothing holds the screen awake by accident. */
  async function pedeWakeLock() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (e) { /* not fatal; the run just needs the tab kept visible */ }
  }
  function soltaWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) { } wakeLock = null; }
  }

  return {
    lista: lista, abre: abre, fecha: fecha, aberta: aberta, tamanho: tamanho,
    trava: trava, estado: estado,
    recorta: recorta, quadroInteiro: quadroInteiro,
    comeca: comeca, para: para, fps: fps,
    get capacidades() { return capacidades || {}; },
    get ajustes() { return ajustes || {}; },
  };
})();
