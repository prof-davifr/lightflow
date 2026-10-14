# Test data from the bench

`cfl_2026-10-13.json` is a compact fluorescent lamp seen through this bench's
spectrometer on 13 October 2026, reduced to what `teste_cfl_real.mjs` needs:

- the Suyin HD Camera (`1e45:8022`) at 1280 × 800 MJPG, exposure locked,
  white balance manual at 4600 K, gamma 400 and sharpness 93 (the driver's
  defaults, not the values `locks.comandoV4l2` sets);
- two exposures, 160 ms with nothing clipped and 640 ms with the green line
  clipped, each the mean of five frames;
- per exposure: `perfilLinhas` (R+G+B per image row, every eighth column, from
  the first frame), the strip's top row `y` that `frame.faixaVertical` chose,
  `perfilColunas` (R+G+B per column over that strip, first frame), and the
  linearized `r`, `g`, `b` lines over the full width of that strip, with `clip`.

The lines were extracted with `frame.extract` and the inverse sRGB curve, so
they carry the linearization; changing it means regenerating the file. The
camera frames themselves stay outside the repository, in `capturas/`.
