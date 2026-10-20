/* Finding the exposure once, before the lock.

   The camera's own automatic exposure cannot be left on: it moves between the
   reference and the sample, and the absorbance moves with it. But setting the
   exposure by hand is the first thing a new operator gets wrong, and both ways
   cost: too low wastes the eight bits, too high clips the line that matters.

   So the search runs once, with the camera already on manual exposure: set an
   exposure, read the brightest raw code value in the strip, scale, repeat. The
   result is locked like any other value, and nothing moves after that.

   The peak is the RAW code, before the lookup table, for the same reason
   saturation is counted there: after linearization a clipped pixel is a
   plausible number. */

import { LIMIAR_SATUR, toLinear } from "./frame.js";

/* Raw code the brightest pixel should land on: high, with room for the lamp to
   brighten a little before it reaches LIMIAR_SATUR. */
export const ALVO = 200;

/* A peak in this window is accepted, so the search does not hunt over a
   difference the noise makes from one frame to the next. */
export const JANELA = [170, 235];

/* After this many steps the search stops where it is and says so. */
export const MAX_PASSOS = 10;

/* No single step changes the exposure by more than this factor. A dark strip
   reads as a peak of 2 or 3, and scaling from that alone would jump straight to
   the longest exposure. */
const FATOR_MAX = 16;

function prende(v, faixa) {
  let e = Math.min(faixa.max, Math.max(faixa.min, v));
  if (faixa.step > 0) e = faixa.min + Math.round((e - faixa.min) / faixa.step) * faixa.step;
  return Math.min(faixa.max, Math.max(faixa.min, e));
}

/* One step of the search.

   `exp` is the exposure that produced `pico`, in the camera's own units;
   `faixa` is {min, max, step} from getCapabilities; `gama` the curve the
   program undoes, used to turn codes into something proportional to light.
   The camera's real curve may differ (see TODO), so a step is an estimate and
   the loop corrects it on the next frame.

   Returns {exposicao, pronto, motivo}. */
export function proximo(exp, pico, faixa, gama) {
  if (pico >= JANELA[0] && pico <= JANELA[1] && pico < LIMIAR_SATUR) {
    return { exposicao: exp, pronto: true, motivo: "peak at code " + pico };
  }
  let e;
  if (pico >= LIMIAR_SATUR) {
    /* Clipped: how far over is unknown, so the step is a guess, large enough
       to get out of clipping in one or two frames. */
    e = exp / 4;
  } else {
    const agora = Math.max(toLinear(pico / 255, gama), toLinear(2 / 255, gama));
    const quer = toLinear(ALVO / 255, gama);
    const f = Math.min(FATOR_MAX, Math.max(1 / FATOR_MAX, quer / agora));
    e = exp * f;
  }
  e = prende(e, faixa);
  if (e === exp) {
    const borda = pico >= LIMIAR_SATUR || pico > JANELA[1]
      ? "the shortest exposure still clips" : "the longest exposure is still dim";
    return { exposicao: e, pronto: true, motivo: borda, limite: true };
  }
  return { exposicao: e, pronto: false };
}
