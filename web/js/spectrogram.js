"use strict";
/* The reaction map: wavelength across, time down, newest at the bottom.

   WHY A HAND-WRITTEN CANVAS AND NOT A CHART LIBRARY. No plotting library draws
   a scrolling heat map at frame rate. The recipe, proven in the sibling
   project and kept here unchanged:

   1. A ring `Float32Array(nHist × nCol)` holds the PHYSICAL values — absorbance,
      or whatever the mode is — and NOT pixels. Storing pixels would make it
      impossible to change the scale or the colour ramp without throwing the
      history away.
   2. A 256-entry table turns a value into RGBA.
   3. An offscreen canvas the exact size of the grid. Each new spectrum writes
      ONE line, with putImageData.
   4. Every frame, two drawImage calls unroll the ring onto the visible canvas.
      That is two hardware-accelerated copies and one one-line upload.

   Scrolling the canvas onto itself with drawImage(canvas, 0, 1) was rejected on
   purpose: it resamples the whole image every frame, accumulates interpolation
   error, and makes recolouring impossible. */

LF.espectrograma = (function () {
  let nCol = 0, nHist = 900, anel = null, cabeca = 0, cheio = false;
  let fora = null, foraCtx = null, linhaImg = null;
  let vis = null, visCtx = null, eixos = null, eixosCtx = null;
  let lut = null, vMin = 0, vMax = 1, xs = null, unidade = "";
  let pendente = false, tempos = null;
  let selecao = null, arrastando = null, aoSelecionar = null;

  /* ------------------------------------------------------------- colours */
  function mistura(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  /* The same three ramps as MWFlow, point for point: the two instruments are
     read side by side, and a colour that means one thing on one screen cannot
     mean another thing on the other.

     Jet, the MATLAB ramp, is piecewise linear with a break every 1/8 of the
     range, which is why these NINE evenly spaced points reproduce it exactly
     under linear interpolation. Jet has no monotone luminance: a yellow band
     looks brighter than both of its sides, and that invents an edge the data
     does not have. It is here because it is the ramp the lab reads without
     thinking, and because `viridis` sits next to it to check against. */
  const RAMPAS = {
    jet: [[0, 0, 127], [0, 0, 255], [0, 127, 255], [0, 255, 255], [127, 255, 127],
          [255, 255, 0], [255, 127, 0], [255, 0, 0], [127, 0, 0]],
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
    cinza: [[255, 255, 255], [0, 0, 0]],
  };
  function fazLut(nome) {
    const p = RAMPAS[nome] || RAMPAS.jet;
    const u = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = i / 255 * (p.length - 1);
      const k = Math.min(p.length - 2, Math.floor(x));
      const c = mistura(p[k], p[k + 1], x - k);
      u[i * 4] = c[0]; u[i * 4 + 1] = c[1]; u[i * 4 + 2] = c[2]; u[i * 4 + 3] = 255;
    }
    return u;
  }

  /* ----------------------------------------------------------- the ring */
  function prepara(n) {
    if (n === nCol && anel && anel.length === nHist * nCol) return;
    nCol = n;
    anel = new Float32Array(nHist * nCol).fill(NaN);
    tempos = new Float64Array(nHist);
    cabeca = 0; cheio = false;
    fora = document.createElement("canvas");
    fora.width = nCol; fora.height = nHist;
    foraCtx = fora.getContext("2d", { willReadFrequently: false });
    foraCtx.clearRect(0, 0, nCol, nHist);
    linhaImg = foraCtx.createImageData(nCol, 1);
  }

  function escreveLinha(dados, y) {
    const d = linhaImg.data;
    const esc = 255 / Math.max(1e-12, vMax - vMin);
    for (let i = 0; i < nCol; i++) {
      const v = dados[i];
      if (!isFinite(v)) {
        /* A gap is drawn transparent, so a clipped or dead column reads as a
           hole rather than as the bottom of the colour scale. */
        const o = i * 4;
        d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 0;
        continue;
      }
      let k = Math.round((v - vMin) * esc);
      k = k < 0 ? 0 : (k > 255 ? 255 : k);
      const o = i * 4, q = k * 4;
      d[o] = lut[q]; d[o + 1] = lut[q + 1]; d[o + 2] = lut[q + 2]; d[o + 3] = 255;
    }
    foraCtx.putImageData(linhaImg, 0, y);
  }

  function recoloreTudo() {
    if (!anel) return;
    for (let y = 0; y < nHist; y++) {
      escreveLinha(anel.subarray(y * nCol, (y + 1) * nCol), y);
    }
    pinta();
  }

  function poe(y, t) {
    prepara(y.length);
    anel.set(y, cabeca * nCol);
    tempos[cabeca] = t;
    if (LF.q("#escala").value === "auto") autoEscala(y);
    escreveLinha(y, cabeca);
    cabeca = (cabeca + 1) % nHist;
    if (cabeca === 0) cheio = true;
    agenda();
  }

  function agenda() {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; pinta(); });
  }

  /* Percentiles 5 and 95, so one hot column does not flatten the whole map. */
  let autoConta = 0;
  function autoEscala(v) {
    if (autoConta++ % 8) return;
    const bons = Array.prototype.filter.call(v, isFinite).sort(function (a, b) { return a - b; });
    if (bons.length < 10) return;
    const lo = bons[Math.floor(bons.length * 0.05)];
    const hi = bons[Math.floor(bons.length * 0.95)];
    const faixa = hi - lo;
    if (!(faixa > 0)) return;
    const novoMin = lo - faixa * 0.1, novoMax = hi + faixa * 0.1;
    if (Math.abs(novoMin - vMin) > faixa * 0.15 || Math.abs(novoMax - vMax) > faixa * 0.15) {
      vMin = novoMin; vMax = novoMax;
      LF.q("#esp-min").value = LF.num(vMin, 3);
      LF.q("#esp-max").value = LF.num(vMax, 3);
      recoloreTudo();
    }
  }

  /* -------------------------------------------------------------- drawing */
  function pinta() {
    if (!vis || !fora) return;
    const W = vis.width, H = vis.height;
    visCtx.imageSmoothingEnabled = false;
    visCtx.clearRect(0, 0, W, H);
    const total = cheio ? nHist : cabeca;
    if (!total) { desenhaEixos(); return; }
    /* Two draws unroll the ring: the older part first, then the recent one.
       The newest line ends up at the bottom. */
    const velhas = cheio ? nHist - cabeca : 0;
    const novas = cabeca;
    const h1 = Math.round(H * velhas / total);
    if (velhas > 0) visCtx.drawImage(fora, 0, cabeca, nCol, velhas, 0, 0, W, h1);
    if (novas > 0) visCtx.drawImage(fora, 0, 0, nCol, novas, 0, h1, W, H - h1);
    desenhaEixos();
  }

  function desenhaEixos() {
    if (!eixos) return;
    const W = eixos.width, H = eixos.height;
    const c = eixosCtx;
    c.clearRect(0, 0, W, H);
    c.font = "11px system-ui";
    c.lineWidth = 1;

    if (selecao) {
      const a = Math.min(selecao.y0, selecao.y1), b = Math.max(selecao.y0, selecao.y1);
      c.fillStyle = "rgba(126,200,216,.18)";
      c.fillRect(0, a, W, b - a);
      c.strokeStyle = "rgba(126,200,216,.9)";
      c.beginPath();
      c.moveTo(0, a); c.lineTo(W, a); c.moveTo(0, b); c.lineTo(W, b);
      c.stroke();
    }

    if (xs && nCol) {
      c.strokeStyle = "rgba(255,255,255,.35)";
      for (let k = 0; k <= 5; k++) {
        const x = W * k / 5;
        const i = Math.min(nCol - 1, Math.round((nCol - 1) * k / 5));
        c.beginPath(); c.moveTo(x, H - 16); c.lineTo(x, H); c.stroke();
        const t = LF.calibrado() ? LF.num(xs[i], 0) + " nm" : i + " px";
        c.fillStyle = "rgba(255,255,255,.9)";
        c.fillText(t, Math.min(W - c.measureText(t).width - 3, Math.max(3, x + 3)), H - 4);
      }
    }
    const total = cheio ? nHist : cabeca;
    if (total > 1) {
      const dur = tempos[(cabeca - 1 + nHist) % nHist] - tempos[cheio ? cabeca : 0];
      c.fillStyle = "rgba(255,255,255,.9)";
      c.fillText("oldest  ·  " + LF.num(dur, 0) + " s of history", 6, 14);
      c.fillText("newest", 6, H - 22);
    }
  }

  function ajustaTamanho() {
    const host = LF.q("#g-espectrograma");
    if (!host) return;
    const r = host.getBoundingClientRect();
    [vis, eixos].forEach(function (cv) {
      if (!cv) return;
      cv.width = Math.max(100, Math.floor(r.width));
      cv.height = Math.max(100, Math.floor(r.height));
    });
    pinta();
  }

  /* ------------------------------------------------------------ readback */

  /* Screen row to a position in the history, and from there to a time. */
  function linhaDe(fracao) {
    const total = cheio ? nHist : cabeca;
    if (!total) return null;
    const k = Math.min(total - 1, Math.max(0, Math.floor(fracao * total)));
    const y = cheio ? (cabeca + k) % nHist : k;
    return { k: k, y: y, t: tempos[y], total: total };
  }

  function mostraLeitura(ev) {
    if (!anel || !nCol) return;
    const r = vis.getBoundingClientRect();
    const cx = (ev.clientX - r.left) / r.width;
    const cy = (ev.clientY - r.top) / r.height;
    const i = Math.min(nCol - 1, Math.max(0, Math.floor(cx * nCol)));
    const l = linhaDe(cy);
    if (!l) return;
    const v = anel[l.y * nCol + i];
    const agora = tempos[(cabeca - 1 + nHist) % nHist];
    LF.q("#leitura-esp").innerHTML =
      '<span class="rot">at</span><span class="val">'
      + (LF.calibrado() && xs ? LF.nm(xs[i]) : i + " px") + "</span>"
      + '<span class="rot">value</span><span class="val">'
      + (isFinite(v) ? LF.num(v, 4) + " " + unidade : "no data") + "</span>"
      + '<span class="rot">age</span><span class="val">'
      + LF.num(agora - l.t, 1) + " s ago</span>"
      + '<span class="rot">scale</span><span class="val">'
      + LF.num(vMin, 3) + " to " + LF.num(vMax, 3) + "</span>";
  }

  /* ------------------------------------------------------------ selection */

  function desce(ev) {
    const r = vis.getBoundingClientRect();
    arrastando = { y0: ev.clientY - r.top };
    vis.setPointerCapture(ev.pointerId);
  }

  function move(ev) {
    mostraLeitura(ev);
    if (!arrastando) return;
    const r = vis.getBoundingClientRect();
    selecao = { y0: arrastando.y0, y1: ev.clientY - r.top };
    desenhaEixos();
  }

  function sobe(ev) {
    if (!arrastando) return;
    try { vis.releasePointerCapture(ev.pointerId); } catch (e) { }
    arrastando = null;
    if (!selecao || Math.abs(selecao.y1 - selecao.y0) < 4) { limpaSelecao(); return; }
    const H = vis.getBoundingClientRect().height;
    const a = linhaDe(Math.min(selecao.y0, selecao.y1) / H);
    const b = linhaDe(Math.max(selecao.y0, selecao.y1) / H);
    if (a && b && aoSelecionar) aoSelecionar({ t0: a.t, t1: b.t, n: b.k - a.k + 1 });
    desenhaEixos();
  }

  function limpaSelecao() {
    selecao = null;
    desenhaEixos();
    if (aoSelecionar) aoSelecionar(null);
  }

  function limpa() {
    nCol = 0; anel = null; cabeca = 0; cheio = false;
    selecao = null;
    if (visCtx) visCtx.clearRect(0, 0, vis.width, vis.height);
    desenhaEixos();
  }

  function defineEixo(novo, uni) { xs = novo; unidade = uni || ""; desenhaEixos(); }

  function inicia(cbSelecao) {
    aoSelecionar = cbSelecao;
    vis = LF.q("#esp-canvas"); visCtx = vis.getContext("2d");
    eixos = LF.q("#esp-eixos"); eixosCtx = eixos.getContext("2d");
    lut = fazLut(LF.q("#mapa").value);
    ajustaTamanho();

    vis.addEventListener("pointerdown", desce);
    vis.addEventListener("pointermove", move);
    vis.addEventListener("pointerup", sobe);
    vis.addEventListener("pointercancel", sobe);

    LF.q("#mapa").addEventListener("change", function () {
      lut = fazLut(this.value); recoloreTudo();
    });
    LF.q("#escala").addEventListener("change", function () {
      const manual = this.value === "manual";
      LF.q("#esp-min").disabled = !manual;
      LF.q("#esp-max").disabled = !manual;
    });
    let atraso = null;
    ["#esp-min", "#esp-max"].forEach(function (s) {
      LF.q(s).addEventListener("input", function () {
        if (LF.q("#escala").value !== "manual") return;
        vMin = parseFloat(LF.q("#esp-min").value);
        vMax = parseFloat(LF.q("#esp-max").value);
        clearTimeout(atraso);
        atraso = setTimeout(recoloreTudo, 120);
      });
    });
    LF.q("#bt-limpar-esp").addEventListener("click", limpa);
    window.addEventListener("resize", ajustaTamanho);
  }

  return {
    inicia: inicia, poe: poe, limpa: limpa, redimensiona: ajustaTamanho,
    defineEixo: defineEixo, limpaSelecao: limpaSelecao,
  };
})();
