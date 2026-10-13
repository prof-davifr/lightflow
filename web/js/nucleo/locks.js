/* Locking the camera. This is the single most important file in the program.

   Automatic exposure and automatic white balance are control loops that push
   the image back towards a mid-grey average. Put a reaction in front of them
   and they will quietly undo it: the solution darkens, the camera lengthens the
   exposure, and the recorded absorbance stays flat. Worse, they act over
   seconds to tens of seconds, which is the same timescale as a slow reaction,
   so what comes out looks exactly like kinetics. A run measured with the
   automatic modes on is a picture of the camera's control loop.

   The policy below is pure, so the tests can check the clamping and the
   missing-capability reporting without a camera. */

/* What the program asks for. Values are filled from the capabilities. */
export function plano(cap, desejado) {
  cap = cap || {};
  desejado = desejado || {};
  const restricoes = {};
  const faltando = [];
  const avisos = [];

  if (lista(cap.exposureMode).indexOf("manual") >= 0) {
    restricoes.exposureMode = "manual";
    if (cap.exposureTime) {
      restricoes.exposureTime = prende(desejado.exposureTime, cap.exposureTime);
    }
  } else {
    faltando.push("exposureMode");
  }

  if (lista(cap.whiteBalanceMode).indexOf("manual") >= 0) {
    restricoes.whiteBalanceMode = "manual";
    if (cap.colorTemperature) {
      restricoes.colorTemperature = prende(desejado.colorTemperature, cap.colorTemperature);
    }
  } else {
    faltando.push("whiteBalanceMode");
  }

  /* Autofocus hunting moves the stripe across the sensor. If the camera has no
     focus control at all there is nothing to hunt, so this is not an error. */
  if (lista(cap.focusMode).indexOf("manual") >= 0) {
    restricoes.focusMode = "manual";
  }

  if (faltando.indexOf("exposureMode") >= 0) {
    avisos.push("This browser or camera will not hand over manual exposure. "
      + "Any change measured over time may be the camera, not the sample. "
      + "Chrome on Linux does support it for UVC cameras; Firefox does not.");
  }
  if (faltando.indexOf("whiteBalanceMode") >= 0) {
    avisos.push("Automatic white balance stays on, so the ratio between the "
      + "red, green and blue channels can drift on its own. Measure on a "
      + "single channel and treat colour comparisons with suspicion.");
  }
  return { restricoes: restricoes, faltando: faltando, avisos: avisos };
}

/* The way back. A UVC camera keeps its controls after the stream closes, so a
   lock outlives the page and the next program to open the camera inherits a
   fixed exposure. Releasing hands each loop back to the camera, using the
   automatic mode it declares. A camera that declares none has nothing to hand
   back, and that mode is left alone. */
export function solta(cap) {
  cap = cap || {};
  const restricoes = {};
  ["exposureMode", "whiteBalanceMode", "focusMode"].forEach(function (k) {
    if (lista(cap[k]).indexOf("continuous") >= 0) restricoes[k] = "continuous";
  });
  return restricoes;
}

function lista(v) { return Array.isArray(v) ? v : (v === undefined ? [] : [v]); }

/* Clamps into the declared range and snaps onto the declared step. A value off
   the step makes some drivers reject the whole applyConstraints, taking the
   mode change down with it. */
function prende(v, faixa) {
  if (v === undefined || !isFinite(v)) v = faixa.min;
  let x = Math.min(faixa.max, Math.max(faixa.min, v));
  if (faixa.step && faixa.step > 0) {
    x = faixa.min + Math.round((x - faixa.min) / faixa.step) * faixa.step;
    x = Math.min(faixa.max, Math.max(faixa.min, x));
  }
  return x;
}

/* Compares what was asked for with what getSettings() reported afterwards.

   THIS IS THE ONLY PROOF THAT THE LOCK TOOK. `applyConstraints` resolving means
   the browser accepted the request, not that the driver honoured it. Several
   UVC cameras resolve happily and go on doing whatever they were doing. */
export function confere(restricoes, settings) {
  settings = settings || {};
  const divergente = [];
  Object.keys(restricoes).forEach(function (k) {
    const pedido = restricoes[k], obtido = settings[k];
    if (obtido === undefined) {
      divergente.push({ campo: k, pedido: pedido, obtido: "not reported" });
    } else if (typeof pedido === "number") {
      /* Drivers round. Anything within one percent counts as honoured. */
      const tol = Math.max(1e-9, Math.abs(pedido) * 0.01);
      if (Math.abs(obtido - pedido) > tol) {
        divergente.push({ campo: k, pedido: pedido, obtido: obtido });
      }
    } else if (obtido !== pedido) {
      divergente.push({ campo: k, pedido: pedido, obtido: obtido });
    }
  });
  const modosOk = (restricoes.exposureMode === undefined
      || settings.exposureMode === "manual")
    && (restricoes.whiteBalanceMode === undefined
      || settings.whiteBalanceMode === "manual");
  return { ok: divergente.length === 0, modosOk: modosOk, divergente: divergente };
}

/* Whether a kinetics run may start. The screens call this and nothing else, so
   the rule lives in one place. */
export function podeMedir(estado) {
  if (!estado) return { pode: false, motivo: "no camera" };
  if (estado.faltando && estado.faltando.indexOf("exposureMode") >= 0) {
    return { pode: false, motivo: "exposure is not locked" };
  }
  if (estado.confere && !estado.confere.modosOk) {
    return { pode: false, motivo: "the camera did not accept the manual modes" };
  }
  return { pode: true, motivo: "" };
}

/* The controls this camera has that no browser can reach, and the command that
   sets them. Sharpness is not cosmetic here: it is a spatial filter, and its
   overshoot on the edge of a narrow spectral line changes the line's area,
   which is the quantity a band integration reports. */
export function comandoV4l2(dev) {
  dev = dev || "/dev/video2";
  return "v4l2-ctl -d " + dev
    + " --set-ctrl=sharpness=0,gamma=100,backlight_compensation=0,"
    + "brightness=0,contrast=32,saturation=64";
}

/* Undoes comandoV4l2 and the browser lock together: every control either of
   them touches goes back to the default the driver declares, read from the
   camera itself rather than written in here. Nothing else is reset, so a
   setting the operator chose, such as the 60 Hz mains filter, survives.

   The automatic modes go last. A driver refuses a manual value while its
   automatic mode is on, so the values have to be in place first. */
export const CONTROLES_V4L2 = [
  "brightness", "contrast", "saturation", "gamma", "sharpness",
  "backlight_compensation", "exposure_time_absolute",
  "white_balance_temperature", "focus_absolute",
  "auto_exposure", "white_balance_automatic", "focus_automatic_continuous",
];

export function comandoRestaura(dev) {
  dev = dev || "/dev/video2";
  return "v4l2-ctl -d " + dev + " --list-ctrls | awk -v ordem=\""
    + CONTROLES_V4L2.join(" ") + "\" "
    + "'/default=/ { for (i = 1; i <= NF; i++) if ($i ~ /^default=/) p[$1] = substr($i, 9) } "
    + "END { n = split(ordem, o, \" \"); for (k = 1; k <= n; k++) if (o[k] in p) print o[k] \"=\" p[o[k]] }' "
    + "| xargs -I{} v4l2-ctl -d " + dev + " --set-ctrl={}";
}
