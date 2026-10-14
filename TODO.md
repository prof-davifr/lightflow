# What is left

Written 22 September 2026, after the calibration and plot fixes were published.
Every item says what to check and where, so none of it has to be found again.

## On the bench, with the real instrument

Frames of a real compact fluorescent lamp were captured on 13 October 2026 and
`testes/teste_cfl_real.mjs` now runs the calibration on them. They answered two
of the three bench questions:

- The yellow mercury pair is one hump, at about column 641. But a terbium band
  at 587.6 nm sits nine columns from it and is brighter; that is the orange
  peak the button marks first. The preset now names it.
- `Load its lines` names four or five real peaks correctly with the violet line
  unmarked and the red end on the left. Three peaks stay ambiguous.

Still owed, with a blank in the cuvette:

- After a fit, is the absorbance of the blank flat near zero? That flat line is
  the proof of the whole chain, not the rms.

## Found on the real lamp and not fixed

- **The green point is probably a nanometre low.** Terbium 543.4 nm sits under
  mercury 546.07 at this slit width; the second order splits them at about equal
  height. Both checks, violet 404.66 and terbium 487.7, land 1 nm low. A
  blended value for that point would fix it, but the ratio belongs to the lamp.
- **A line centre moves 0.3 columns between 80 and 320 ms with nothing
  clipped.** The camera's gamma control was at 400, so the camera's curve may
  not be the sRGB one the program undoes. Measure the curve before trusting
  sub-column positions.
- **`Centre on the stripe` runs on every camera open.** It now also sets the
  columns, so the ROI, and with it the signature of a saved calibration, may
  change between sessions on a lamp that flickers near the thresholds.

## Faults found and not fixed

- **Portuguese leaks into the English interface.** With no dark frame the
  Spectrum tab reads `raw intensity — escuro and referencia missing`. The names
  come from `LF.estado.quadros` keys, joined in `mostraTira` of
  `web/js/screen_spectrum.js`, which already has an English label map.
- **A gap between the chart and its legend.** Every plot shows about 40 px of
  empty canvas under the x axis label. `LF.ajusta` in `web/js/util.js`
  subtracts the legend height and 16 px; one of the two is counted twice.

## To check, not yet reproduced

- **A calibration loaded before the camera opens.** `aplica` in
  `web/js/screen_calibration.js` builds the axis with `LF.estado.nCol`, which is
  0 until the first frame arrives, and nothing rebuilds it afterwards. Load a
  saved calibration with the camera closed, then open it, and see whether the
  header still says calibrated and the Spectrum x axis is in nanometres.
- **The same layout fault on the other tabs.** The chart box must take its
  height from the screen, never from its content — see AGENTS.md. The Camera
  tab has an `auto` grid row over the raw profile, and the Kinetics tab has a
  reading strip under the map whose text changes with the cursor.
- **Two peaks only.** `nomeia` cannot choose between the sets of lines that two
  peaks fit, so it keeps the leftmost pair and flags the choice as ambiguous.
  A two-laser calibration therefore needs the labels checked by hand.

## Not committed

`README.md` carries an edit from before this work: the published address and
the note that Chrome is the browser to open it in. It is still outside every
commit.
