# Working on LightFlow

Read `README.md` first. This file records only what bites.

## Loading order

- `const LF = {...}` at the top of a classic script does **not** become
  `window.LF`. `web/js/util.js` sets `window.LF = LF;` explicitly. Remove that
  line and the ES modules under `nucleo/` stop finding the namespace.
- A `<script type="module">` is deferred; a classic `<script src>` is not. That
  is why `web/js/nucleo/bridge.js` is last in `index.html`, why it is the only
  module the page loads, and why it — not a `DOMContentLoaded` handler — calls
  `LF.inicia()`. **Nothing above it may touch `LF.nucleo` at load time.**
- Screens register themselves in `LF.telas`, which `util.js` declares. Adding a
  screen means adding its file to `index.html` and a `LF.telas.<name>` object
  with `inicia()` and optionally `aoEntrar()`.

## uPlot

- A series that is entirely `null` crashes uPlot: it reads `.length` off it. A
  `null` inside the array is fine. Use `LF.vazio(n)`.
- uPlot does not measure the width of the y axis. The default is 50 px and it
  clips. Every axis must come from `LF.eixo`, which sizes from the widest label.
- The legend is **not** inside the height `setSize` asks for. `LF.ajusta`
  subtracts it; resizing a plot by hand will overflow the box.
- `LF.ajusta` runs on every frame, so the box it measures must get its height
  from the screen, never from its content. Content-sized, the chart loses 16 px
  per frame (Calibration had an `auto` grid row). A neighbour whose height
  changes with the data resizes the chart too: the peak table under Spectrum
  did, and a frozen y axis still bounced. It now keeps eight rows, blank or not.
- Emit `NaN`, never `Infinity`. uPlot draws `NaN` as a gap and `Infinity` as a
  full-height vertical stroke that reads as an enormous real peak.

## The pipeline, in the one order that is correct

1. Saturation is counted on the **raw code value**, before the lookup table.
   After linearization, 250 and 255 are both plausible numbers and the evidence
   is gone. Threshold is `LIMIAR_SATUR = 250`, not 255.
2. Linearization happens **per source pixel**, before the rows are binned. The
   mean of the sRGB curve is not the curve of the mean; binning first costs
   several percent, which is the size of the absorbance being measured.
3. Only then interpolate and average.

Because of point 2 the linearization is frozen into anything written to disk.
The session records which curve was used. **Changing the gamma means measuring
again**, and the program clears the dark and the reference when it changes.

## Camera facts

- **Green is the measurement channel.** `getUserMedia` gives no control over the
  pixel format; the browser negotiates MJPG or YUYV, and both subsample chroma
  *horizontally*, which is the spectral axis. Red and blue arrive at half
  resolution along the very axis being measured. The luminance mix uses Rec.709
  weights on **linear** values for the same reason.
- `applyConstraints` resolving does **not** mean the camera obeyed. Always read
  `getSettings()` back and compare — `locks.confere` does this, and it is the
  only proof the lock took.
- `exposureMode` and `whiteBalanceMode` reach a UVC camera through Chrome on
  Linux. Firefox exposes neither. There is no workaround in the browser.
- Sharpening, hardware gamma and backlight compensation are **not** in the W3C
  image-capture set and cannot be reached from any browser. `locks.comandoV4l2`
  builds the `v4l2-ctl` line; it has to run with the stream already open,
  because Chrome touches some controls when it opens one.
- The Suyin HD Camera on this bench (`1e45:8022`, `/dev/video2`) has **no Gain
  control**. Exposure time is the only sensitivity knob. Do not build a gain UI.
- `requestVideoFrameCallback`, not `requestAnimationFrame`. A background tab
  throttles rAF to about 1 Hz, which tears holes in a long run.
- `getContext("2d", {willReadFrequently: true})` on the capture canvas. Without
  it Chrome keeps the surface on the GPU and every `getImageData` pays a full
  readback, which costs more than the extraction itself.
- `camera.recorta` reads only the rotated ROI's bounding box, not the whole
  frame. At 30 fps that is 12 MB/s instead of 110.

## The house header

- **`#identidade` is the shared header of the scientific tools here**, the same
  one as WaveCal-END and MWFlow: IFBA on the left, name and one line of what
  the program does in the middle, GPEND and GPSC on the right, 50 px and 45 px
  tall. Its measurements are in **pixels**, not `rem`: the root font is 13 px
  here and 16 px in MWFlow, and the same `rem` would give two different
  headers. It changes together with the other tools, never alone.

## Colour ramps

- **The three spectrogram ramps are MWFlow's, point for point** (`jet`,
  `viridis`, `cinza`, with `jet` as the default). The two instruments get read
  side by side, so a colour cannot mean one thing here and another there. A
  ramp changes in both programs or in neither.

## Geometry

- The ROI centre is `x + (w-1)/2`, **not** `x + w/2`. It has to be the centre of
  the set of pixel centres, not of the box drawn around them. The half-pixel
  version puts a permanent half-column shift into every wavelength, and a test
  in `testes/teste_frame.mjs` pins it.
- Bilinear resampling smooths a 3-pixel-sigma line by about 1 % of its peak.
  That cancels in absorbance — sample, dark and reference all get it — but it
  widens a measured line profile, so an FWHM read off this instrument is
  slightly generous.

## Numerics

- `num.polyfit` centres and scales x before fitting and undoes the shift after.
  A cubic in raw column indices up to 1280 puts about 4e18 into the
  normal-equations matrix and double precision loses the small coefficients.
  Do not "simplify" that away.
- `num.solve` throws on a singular matrix rather than returning NaN, because a
  singular normal-equations matrix means duplicate calibration points and the
  operator has to be told.
- Frames are `Float32Array`, so about seven decimal digits survive. Test
  tolerances tighter than `1e-6` on a value that passed through a frame are
  testing the storage format, not the arithmetic.

## Formats

- **CSV uses a decimal point and a comma separator**; the screen uses a
  formatted locale. That is deliberate and not an inconsistency to tidy up:
  these files go to pandas, numpy and Origin. Changing it breaks every
  downstream script.
- A missing value is an **empty CSV field** — not `NaN`, which half the tools
  read as a string, and not `0`, which reads as a measurement.
- `JSON.stringify` turns `NaN` into `null` by itself and `JSON.parse` would
  refuse a bare `NaN`, so the round trip is safe as long as nothing writes one
  by hand.

## Storage

- **Raw goes to disk, the correction happens on read.** The dark, the reference
  and the blank are ordinary rows in `espectros` with a different `tipo`; the
  session stores only their ids. Changing which dark a run uses is a pointer
  edit and never destroys data.
- Call `navigator.storage.persist()` before a long run. Without it the browser
  may evict the whole database under disk pressure, silently, mid-run.
- One channel of a 1280-column ROI is 5.1 kB a spectrum. All three at one a
  second is 55 MB an hour, which is why the default writes only the selected
  channel at a two-second interval.

## Tests

`node --test 'testes/**/*.mjs'`. A bare `node --test testes/` does **not** work:
Node's directory discovery only picks up files matching its own naming
convention, and these are named `teste_*.mjs`.

Everything under `web/js/nucleo/` is pure and testable in Node. Keep it that
way — the moment a formula touches the DOM it stops being checkable, and the
Pages workflow gates publication on these tests.

## Git

- **No AI is credited anywhere in this repository.** No `Co-Authored-By: Claude`
  trailer, no mention in the README, the LICENSE or the page.
- `lightflow` is its own repository. Never run `git add -A` from
  `/home/davi/projetos/Pesquisa` — the parent tree holds about 43 GB of
  untracked simulation data.
