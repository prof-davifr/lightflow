# What is left

Written 22 September 2026, after the calibration and plot fixes were published.
Every item says what to check and where, so none of it has to be found again.

## On the bench, with the real instrument

The calibration work was driven end to end in Chrome against a synthetic
fluorescent tube of known dispersion, never against the Suyin camera and a real
ceiling tube. That run is the acceptance test the fixes still owe:

- Does the yellow mercury pair come out as one hump at this slit width? The
  preset now names it 578.01 nm, one line. If two humps do show, mark one only,
  or type both wavelengths by hand.
- Does `Load its lines` name the lines correctly with the violet line too faint
  to mark, and with the tube at both ends of the sensor?
- After a fit, is the absorbance of the blank flat near zero? That flat line is
  the proof of the whole chain, not the rms.

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
