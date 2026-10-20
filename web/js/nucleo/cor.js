/* The colour a wavelength looks like, for the fill under a spectrum.

   This is a picture, not colorimetry: the piecewise-linear ramp Dan Bruton
   published in 1996, which every hobby spectrometer uses because it reads
   right at a glance. A true CIE conversion gives a duller, less legible strip,
   and nothing is computed from these colours. They never reach a file.

   Below 380 nm and above 780 nm the eye sees nothing and the ramp gives
   black, so the fill fades out at the ends instead of stopping on a colour. */

/* [r, g, b], each 0 to 255, for a wavelength in nm. */
export function rgbDe(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = (440 - nm) / 60; b = 1; }
  else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm >= 490 && nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm >= 580 && nm < 645) { r = 1; g = (645 - nm) / 65; }
  else if (nm >= 645 && nm <= 780) { r = 1; }

  /* The eye's sensitivity falls off at both ends of the visible range. */
  let f = 0;
  if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm >= 420 && nm <= 700) f = 1;
  else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / 80;

  /* Bruton's display gamma of 0.8, so the mixed hues are not muddy. */
  const c = function (v) { return v > 0 ? Math.round(255 * Math.pow(v * f, 0.8)) : 0; };
  return [c(r), c(g), c(b)];
}

/* As a CSS colour string, with an alpha. */
export function cssDe(nm, alfa) {
  const v = rgbDe(nm);
  return "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + (alfa === undefined ? 1 : alfa) + ")";
}
