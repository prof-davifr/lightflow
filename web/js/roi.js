"use strict";
/* The region of interest, drawn over the live preview and dragged with a mouse.

   The box rotates about its own centre, and every hit test is done in the box's
   own coordinates rather than the screen's. That keeps the arithmetic to one
   rotation in and one rotation out, and it means a tilted box resizes along its
   own axes — dragging the end of a tilted stripe lengthens the stripe, which is
   what the operator means, instead of stretching it sideways. */

LF.roi = (function () {
  const TOL = 8;                 // grab distance for an edge, in native pixels
  const ALCA = 26;               // how far the rotation handle sits above the box
  let roi = { x: 0, y: 330, w: 1280, h: 61, angle: 0 };
  let lona = null, ctx = null;
  let arraste = null, aoMudar = null;
  let dica = "";

  function get() { return { x: roi.x, y: roi.y, w: roi.w, h: roi.h, angle: roi.angle }; }

  function set(novo, avisa) {
    const t = LF.camera.tamanho();
    roi.x = Math.round(num(novo.x, roi.x));
    roi.y = Math.round(num(novo.y, roi.y));
    roi.w = Math.max(8, Math.round(num(novo.w, roi.w)));
    roi.h = Math.max(1, Math.round(num(novo.h, roi.h)));
    roi.angle = num(novo.angle, roi.angle);
    if (t.larg) {
      roi.w = Math.min(roi.w, t.larg);
      roi.h = Math.min(roi.h, t.alt);
    }
    desenha();
    if (avisa !== false && aoMudar) aoMudar(get());
  }

  function num(v, padrao) {
    const x = parseFloat(v);
    return isFinite(x) ? x : padrao;
  }

  /* Centres a full-width strip on the brightest rows of the frame, which is the
     stripe. Saves the operator from hunting for it by hand the first time. */
  function centraNaFaixa() {
    const img = LF.camera.quadroInteiro();
    if (!img) { LF.mensagem("open the camera first", true); return; }
    const W = img.width, H = img.height, D = img.data;
    const perfil = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      /* Every eighth column is plenty to find a horizontal band. */
      for (let x = 0; x < W; x += 8) {
        const o = (y * W + x) * 4;
        s += D[o] + D[o + 1] + D[o + 2];
      }
      perfil[y] = s;
    }
    /* The window of `h` rows with the most light in it. */
    const h = Math.min(roi.h, H);
    let soma = 0;
    for (let y = 0; y < h; y++) soma += perfil[y];
    let melhor = soma, ondeY = 0;
    for (let y = h; y < H; y++) {
      soma += perfil[y] - perfil[y - h];
      if (soma > melhor) { melhor = soma; ondeY = y - h + 1; }
    }
    set({ x: 0, y: ondeY, w: W, h: h, angle: roi.angle });
    LF.mensagem("strip centred on rows " + ondeY + " to " + (ondeY + h - 1));
  }

  function larguraToda() {
    const t = LF.camera.tamanho();
    if (!t.larg) return;
    set({ x: 0, w: t.larg });
  }

  /* ------------------------------------------------------------ geometry */

  function centro() {
    return { x: roi.x + (roi.w - 1) / 2, y: roi.y + (roi.h - 1) / 2 };
  }

  /* Screen point into the box's own frame. */
  function paraLocal(px, py) {
    const c = centro();
    const rad = roi.angle * Math.PI / 180;
    const co = Math.cos(rad), si = Math.sin(rad);
    const dx = px - c.x, dy = py - c.y;
    return { u: dx * co + dy * si, v: -dx * si + dy * co };
  }

  function paraTela(u, v) {
    const c = centro();
    const rad = roi.angle * Math.PI / 180;
    const co = Math.cos(rad), si = Math.sin(rad);
    return { x: c.x + u * co - v * si, y: c.y + u * si + v * co };
  }

  function quePega(px, py) {
    const l = paraLocal(px, py);
    const hw = roi.w / 2, hh = roi.h / 2;
    if (Math.abs(l.u) < TOL && Math.abs(l.v + hh + ALCA) < TOL + 4) return "girar";
    if (Math.abs(l.u) > hw + TOL || Math.abs(l.v) > hh + TOL) return null;
    if (Math.abs(l.u - hw) < TOL) return "direita";
    if (Math.abs(l.u + hw) < TOL) return "esquerda";
    if (Math.abs(l.v - hh) < TOL) return "baixo";
    if (Math.abs(l.v + hh) < TOL) return "cima";
    return "mover";
  }

  /* --------------------------------------------------------------- mouse */

  function daTela(ev) {
    const r = lona.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * lona.width / r.width,
      y: (ev.clientY - r.top) * lona.height / r.height,
    };
  }

  function desce(ev) {
    if (!LF.camera.aberta()) return;
    const p = daTela(ev);
    const modo = quePega(p.x, p.y);
    if (!modo) return;
    ev.preventDefault();
    arraste = { modo: modo, p0: p, roi0: get(), local0: paraLocal(p.x, p.y) };
    lona.setPointerCapture(ev.pointerId);
  }

  function move(ev) {
    if (!LF.camera.aberta()) return;
    const p = daTela(ev);
    if (!arraste) {
      const m = quePega(p.x, p.y);
      lona.style.cursor = m === "girar" ? "grab"
        : (m === "mover" ? "move"
          : (m === "esquerda" || m === "direita" ? "ew-resize"
            : (m ? "ns-resize" : "crosshair")));
      dica = m || "";
      return;
    }
    ev.preventDefault();
    const r0 = arraste.roi0;
    const c0 = { x: r0.x + (r0.w - 1) / 2, y: r0.y + (r0.h - 1) / 2 };

    if (arraste.modo === "girar") {
      const ang = Math.atan2(p.y - c0.y, p.x - c0.x) * 180 / Math.PI + 90;
      set({ angle: Math.round(ang * 20) / 20 });
      return;
    }
    if (arraste.modo === "mover") {
      set({ x: r0.x + (p.x - arraste.p0.x), y: r0.y + (p.y - arraste.p0.y) });
      return;
    }

    /* Resizing keeps the opposite edge where it was, so the box grows from the
       edge being dragged rather than from its centre. */
    const l = paraLocal(p.x, p.y);
    let w = r0.w, h = r0.h, du = 0, dv = 0;
    if (arraste.modo === "direita") { w = Math.max(8, Math.round(r0.w / 2 + l.u)); du = (w - r0.w) / 2; }
    if (arraste.modo === "esquerda") { w = Math.max(8, Math.round(r0.w / 2 - l.u)); du = -(w - r0.w) / 2; }
    if (arraste.modo === "baixo") { h = Math.max(1, Math.round(r0.h / 2 + l.v)); dv = (h - r0.h) / 2; }
    if (arraste.modo === "cima") { h = Math.max(1, Math.round(r0.h / 2 - l.v)); dv = -(h - r0.h) / 2; }
    const rad = r0.angle * Math.PI / 180;
    const co = Math.cos(rad), si = Math.sin(rad);
    const cx = c0.x + du * co - dv * si, cy = c0.y + du * si + dv * co;
    set({ x: cx - (w - 1) / 2, y: cy - (h - 1) / 2, w: w, h: h });
  }

  function sobe(ev) {
    if (arraste) { try { lona.releasePointerCapture(ev.pointerId); } catch (e) { } }
    arraste = null;
  }

  /* -------------------------------------------------------------- drawing */

  function desenha() {
    if (!lona) return;
    const t = LF.camera.tamanho();
    if (t.larg && (lona.width !== t.larg || lona.height !== t.alt)) {
      lona.width = t.larg; lona.height = t.alt;
    }
    const W = lona.width, H = lona.height;
    ctx.clearRect(0, 0, W, H);
    if (!t.larg) return;

    const hw = roi.w / 2, hh = roi.h / 2;
    const cantos = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
      .map(function (c) { return paraTela(c[0], c[1]); });

    /* Everything outside the box is dimmed, so the strip being measured is
       obvious at a glance even on a busy preview. */
    ctx.save();
    ctx.fillStyle = "rgba(10,14,18,.55)";
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.moveTo(cantos[0].x, cantos[0].y);
    for (let i = 3; i >= 1; i--) ctx.lineTo(cantos[i].x, cantos[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7ec8d8";
    ctx.beginPath();
    ctx.moveTo(cantos[0].x, cantos[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cantos[i].x, cantos[i].y);
    ctx.closePath();
    ctx.stroke();

    /* The spectral axis, so the direction of increasing column is never a
       guess. */
    const a = paraTela(-hw, 0), b = paraTela(hw, 0);
    ctx.strokeStyle = "rgba(126,200,216,.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);

    const alca = paraTela(0, -hh - ALCA);
    const meio = paraTela(0, -hh);
    ctx.strokeStyle = "#7ec8d8";
    ctx.beginPath(); ctx.moveTo(meio.x, meio.y); ctx.lineTo(alca.x, alca.y); ctx.stroke();
    ctx.fillStyle = "#0089a8";
    ctx.beginPath(); ctx.arc(alca.x, alca.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.font = "13px system-ui";
    ctx.fillStyle = "rgba(255,255,255,.92)";
    const rot = roi.w + " × " + roi.h + " px" + (roi.angle ? "  ·  " + LF.num(roi.angle, 2) + "°" : "");
    ctx.fillText(rot, cantos[0].x + 4, cantos[0].y - 8);
  }

  function inicia(cb) {
    aoMudar = cb;
    lona = LF.q("#sobreposto");
    ctx = lona.getContext("2d");
    lona.addEventListener("pointerdown", desce);
    lona.addEventListener("pointermove", move);
    lona.addEventListener("pointerup", sobe);
    lona.addEventListener("pointercancel", sobe);
    window.addEventListener("resize", desenha);
    desenha();
  }

  return {
    inicia: inicia, get: get, set: set, desenha: desenha,
    centraNaFaixa: centraNaFaixa, larguraToda: larguraToda,
    get dica() { return dica; },
  };
})();
