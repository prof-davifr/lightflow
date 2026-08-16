import test from "node:test";
import assert from "node:assert/strict";
import {
  toLinear, fromLinear, makeLut, makeRoi, extract, Acumulador,
  LIMIAR_SATUR, assinatura,
} from "../web/js/nucleo/frame.js";

test("the sRGB transfer inverts itself", () => {
  for (let k = 0; k <= 100; k++) {
    const v = k / 100;
    assert.ok(Math.abs(fromLinear(toLinear(v)) - v) < 1e-9, `at ${v}`);
  }
});

test("the lookup table is anchored, monotone and matches the standard", () => {
  const lut = makeLut();
  assert.equal(lut[0], 0);
  assert.ok(Math.abs(lut[255] - 1) < 1e-6);
  for (let i = 1; i < 256; i++) assert.ok(lut[i] > lut[i - 1], `not monotone at ${i}`);
  /* sRGB EOTF of 128/255, the value every colour-management text prints. */
  assert.ok(Math.abs(lut[128] - 0.2158605) < 1e-5, `got ${lut[128]}`);
});

test("a plain gamma of 1 is the identity", () => {
  const lut = makeLut(1);
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(lut[i] - i / 255) < 1e-6);
});

/* Builds an image whose brightness depends only on the position along an axis
   tilted by `graus`. Extracting along that same axis must give the profile back
   exactly, which is the whole claim the rotated ROI makes. */
function imagemInclinada(W, H, graus, f) {
  const d = new Uint8ClampedArray(W * H * 4);
  const rad = graus * Math.PI / 180;
  const co = Math.cos(rad), si = Math.sin(rad);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x - cx) * co + (y - cy) * si;
      const cod = Math.round(255 * fromLinear(Math.max(0, Math.min(1, f(u)))));
      const o = (y * W + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = cod; d[o + 3] = 255;
    }
  }
  return { data: d, width: W, height: H };
}

const GAUSS = (u) => 0.05 + 0.7 * Math.exp(-(u * u) / (2 * 9));

/* An odd width and an odd height put the ROI centre exactly on the image centre
   the generator used, so the comparison is not measuring a half-pixel offset. */
const ROI_W = 201, ROI_H = 61;

test("the rotated ROI recovers a tilted profile", () => {
  const W = 400, H = 200, ang = 7;
  const img = imagemInclinada(W, H, ang, GAUSS);
  const roi = makeRoi(W / 2 - (ROI_W - 1) / 2, H / 2 - (ROI_H - 1) / 2, ROI_W, ROI_H, ang);
  const s = extract(img, roi, makeLut());
  let pior = 0;
  for (let i = 0; i < roi.w; i++) {
    const u = i - (roi.w - 1) / 2;
    pior = Math.max(pior, Math.abs(s.g[i] - GAUSS(u)));
  }
  /* Two systematic costs live in this number and neither is a defect:
     8-bit quantisation is worth about 0.002 in linear units near mid-grey, and
     bilinear resampling smooths a 3-pixel-sigma line by roughly 1 % of its
     peak. The smoothing cancels in absorbance, because sample, dark and
     reference all get it, but it does widen a measured line profile. */
  assert.ok(pior < 0.015, `worst deviation ${pior}`);
});

test("the ROI angle is doing real work, not decorating the panel", () => {
  /* Extract the same tilted image with the angle set to zero. Binning 61 rows
     across a 7-degree tilt drags the line sideways by 7.5 pixels end to end,
     and a 3-pixel-sigma line cannot survive that. If this ever passes, the
     angle control is being ignored somewhere. */
  const W = 400, H = 200, ang = 7;
  const img = imagemInclinada(W, H, ang, GAUSS);
  const lut = makeLut();
  const x0 = W / 2 - (ROI_W - 1) / 2, y0 = H / 2 - (ROI_H - 1) / 2;
  const certo = extract(img, makeRoi(x0, y0, ROI_W, ROI_H, ang), lut);
  const torto = extract(img, makeRoi(x0, y0, ROI_W, ROI_H, 0), lut);
  const picoCerto = Math.max(...certo.g);
  const picoTorto = Math.max(...torto.g);
  assert.ok(picoTorto < 0.9 * picoCerto,
    `tilted peak ${picoTorto} should be well below the aligned ${picoCerto}`);
});

test("binning averages the rows", () => {
  /* A vertical ramp inside the ROI: the mean of the rows is the middle row. */
  const W = 40, H = 40;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = y * 4; d[o + 3] = 255;
    }
  }
  const img = { data: d, width: W, height: H };
  const lut = makeLut();
  const s = extract(img, makeRoi(10, 10, 20, 11, 0), lut);
  /* Rows 10 to 20 inclusive — eleven pixel rows, starting at the ROI's own top
     edge. Anything else means the centring is off by half a pixel. */
  let esperado = 0;
  for (let y = 10; y <= 20; y++) esperado += lut[y * 4];
  esperado /= 11;
  assert.ok(Math.abs(s.g[5] - esperado) < 1e-6, `got ${s.g[5]}, expected ${esperado}`);
});

test("saturation is counted on the raw code, at the threshold, not at 255", () => {
  const W = 20, H = 20;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4 + 3] = 255; }
  /* One fully saturated column and one column at the threshold minus one. */
  for (let y = 0; y < H; y++) {
    let o = (y * W + 5) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255;
    o = (y * W + 12) * 4;
    d[o] = d[o + 1] = d[o + 2] = LIMIAR_SATUR - 1;
  }
  const s = extract({ data: d, width: W, height: H }, makeRoi(0, 5, 20, 9, 0), makeLut());
  assert.ok(s.clip[5] > 0, "the 255 column must be flagged");
  assert.equal(s.clip[12], 0, "one code below the threshold is not clipping");
  assert.ok(s.clipTotal > 0);
});

test("a column outside the image is NaN, not zero", () => {
  /* Zero would read as a real, very dark measurement. */
  const W = 20, H = 20;
  const d = new Uint8ClampedArray(W * H * 4).fill(128);
  const s = extract({ data: d, width: W, height: H }, makeRoi(-40, 5, 20, 5, 0), makeLut());
  assert.ok(Number.isNaN(s.g[0]), "expected NaN off the left edge");
  assert.equal(s.used[0], 0);
});

test("luminance uses Rec.709 weights on linear values", () => {
  const W = 8, H = 8;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = 200; d[i * 4 + 1] = 100; d[i * 4 + 2] = 50; d[i * 4 + 3] = 255;
  }
  const lut = makeLut();
  const s = extract({ data: d, width: W, height: H }, makeRoi(1, 1, 4, 4, 0), lut);
  const esperado = 0.2126 * lut[200] + 0.7152 * lut[100] + 0.0722 * lut[50];
  assert.ok(Math.abs(s.lum[0] - esperado) < 1e-6, `got ${s.lum[0]}`);
});

test("the accumulator averages and measures the spread", () => {
  const w = 4;
  const ac = new Acumulador(w);
  const valores = [0.2, 0.4, 0.6];
  valores.forEach((v) => {
    ac.poe({
      r: new Float32Array(w).fill(v), g: new Float32Array(w).fill(v),
      b: new Float32Array(w).fill(v), lum: new Float32Array(w).fill(v),
      clip: new Uint16Array(w), clipTotal: 0,
    });
  });
  const m = ac.media();
  assert.equal(m.n_quadros, 3);
  assert.ok(Math.abs(m.g[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(m.sigma.g[0] - 0.2) < 1e-6, `sigma ${m.sigma.g[0]}`);
});

test("averaging N noisy frames cuts the spread like one over root N", () => {
  const w = 1, N = 400;
  let semente = 12345;
  const aleatorio = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    return semente / 0x7fffffff;
  };
  const medias = [];
  for (let bloco = 0; bloco < 40; bloco++) {
    const ac = new Acumulador(w);
    for (let k = 0; k < N; k++) {
      /* Two uniforms make a triangular distribution; the exact shape does not
         matter, only that the mean of N of them narrows as 1/sqrt(N). */
      const v = 0.5 + 0.1 * (aleatorio() + aleatorio() - 1);
      ac.poe({
        r: Float32Array.from([v]), g: Float32Array.from([v]),
        b: Float32Array.from([v]), lum: Float32Array.from([v]),
        clip: new Uint16Array(w), clipTotal: 0,
      });
    }
    const m = ac.media();
    medias.push({ media: m.g[0], sigma: m.sigma.g[0] });
  }
  const espalha = Math.sqrt(medias.reduce((s, x) => {
    const mm = medias.reduce((a, y) => a + y.media, 0) / medias.length;
    return s + (x.media - mm) ** 2;
  }, 0) / (medias.length - 1));
  const sigmaTipico = medias.reduce((a, x) => a + x.sigma, 0) / medias.length;
  const previsto = sigmaTipico / Math.sqrt(N);
  assert.ok(Math.abs(espalha - previsto) / previsto < 0.35,
    `spread of the means ${espalha} against the predicted ${previsto}`);
});

test("the signature changes when the geometry changes", () => {
  const a = assinatura(makeRoi(10, 20, 100, 30, 2), 1280, 720);
  assert.equal(a, assinatura(makeRoi(10, 20, 100, 30, 2), 1280, 720));
  assert.notEqual(a, assinatura(makeRoi(10, 20, 100, 30, 2), 640, 480));
  assert.notEqual(a, assinatura(makeRoi(10, 20, 100, 30, 3), 1280, 720));
  assert.notEqual(a, assinatura(makeRoi(11, 20, 100, 30, 2), 1280, 720));
});
