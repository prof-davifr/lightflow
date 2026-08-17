# LightFlow

Software for a homemade webcam spectrometer. It runs entirely in the browser:
the page reads the camera, extracts the spectrum, calibrates the wavelength
axis, computes absorbance, and follows a reaction over time on a spectrogram
from which you can select and export the part that matters.

There is no server, no installation and no build step. The published page is a
folder of static files.

## Run it

Use the published page, or serve the folder locally:

```bash
python3 -m http.server 8000 --directory web
```

Then open <http://localhost:8000> in **Chrome**.

Two constraints are worth knowing before you start.

- **`getUserMedia` needs a secure context.** `https://` and `http://localhost`
  both work. Opening `web/index.html` by double-clicking gives a `file://` page,
  and no browser hands a `file://` page a camera.
- **Manual camera control is Chrome-only on Linux.** Firefox exposes no
  `exposureMode` or `whiteBalanceMode` at all, and without those the program
  cannot lock the camera.

## Quick start

1. Choose the spectrometer under **Device** and press **Open**.
2. Press **Lock camera**. The pill in the header must turn green.
3. Set the exposure so the stripe is bright but nothing is flagged as clipped.
4. On the **Camera** tab, put the box over the stripe. Turn the angle until the
   peaks in the profile below are as narrow as they get, then raise **Rows
   binned** until the noise settles.
5. Point the slit at a fluorescent tube. On **Calibration**, add the visible
   peaks, press **Load its lines**, choose order 2 and press **Fit**. Accept it
   when the rms is well under a nanometre.
6. Cover the slit and press **Capture dark**. Put the blank in and press
   **Capture reference**.
7. The absorbance curve should now sit flat near zero. **That flat line is the
   real proof that the whole chain works.**
8. Put the sample in. To follow a reaction, go to **Kinetics** and press
   **Start run**.

Every live plot has a **Y axis** control. On `auto` it refits itself to the data
on every frame, which makes the trace swing and makes two spectra impossible to
compare by eye. `fixed` pins it to the numbers you type, and **Freeze** copies
whatever is on screen into those boxes and pins it there. Fix the axis before
watching a band change. Switching the measurement mode releases it, because a
range set for absorbance would hide transmittance entirely.

The **Help** tab inside the program carries all of this, plus a glossary, the
formula for each mode, and a troubleshooting table.

## The three rules

1. **Lock the camera.** Automatic exposure and automatic white balance push the
   image back towards a mid-grey average over seconds to tens of seconds — the
   same timescale as a slow reaction. A run recorded with them on is a picture
   of the camera's control loop, and it looks exactly like kinetics.
2. **Watch the saturation.** A column whose top has been cut off carries no
   information about how much light there was. Those columns are reported as
   missing rather than as numbers.
3. **Calibrate again after anything moves.** The wavelength scale belongs to one
   arrangement of camera, grating and slit.

## What it measures

| Mode | Formula | Needs |
|---|---|---|
| Absorbance | `A = -log10((S-D)/(R-D))` | dark, reference |
| Transmittance | `T% = 100 (S-D)/(R-D)` | dark, reference |
| Emission | `E = S-D` | dark |
| Fluorescence | `F = S-B` | dark, blank |

Fluorescence **subtracts** the blank rather than dividing by it: the blank
carries the scattered excitation and the solvent's own emission, and both are
additive.

## What it cannot do

The browser hands over 8 bits per channel, with no raw Bayer data and no 10-bit
path anywhere. That puts the theoretical ceiling on absorbance at about 2.4 and
the real one, once the dark noise is counted, near 1.5. The program computes
`A max = log10((R-D)/3σ)` from your own dark frame and shows it on the Spectrum
tab; that is the number to trust.

Red and blue arrive at half resolution along the spectral axis, because both
MJPG and YUYV subsample chroma horizontally and horizontal is the dispersion
direction. **Green is the measurement channel.** Red and blue are for
cross-checks and for the ends where green runs out.

Some camera controls — sharpening, the hardware gamma, backlight compensation —
are applied before the browser sees anything and no browser API reaches them. On
Linux, set them outside the browser with the stream already open:

```bash
v4l2-ctl -d /dev/video2 --set-ctrl=sharpness=0,gamma=100,backlight_compensation=0
v4l2-ctl -d /dev/video2 --all      # check
```

Sharpening is not cosmetic: it is a spatial filter, and its overshoot at the
edge of a narrow line changes the line's area, which is what a band integration
reports.

## Where the data goes

Everything stays in this browser, on this machine. Nothing is uploaded and there
is nowhere to upload it to.

Spectra are stored raw — the linearized per-channel intensity, with the dark and
the reference beside them as ordinary spectra. Absorbance, the choice of
channel and the wavelength axis are recomputed on export, so a finished run can
be re-exported against a better reference or a better calibration without
repeating the chemistry.

Press **Ask the browser to keep this data** on the Data tab before a long run.
Without it the browser may evict the database under disk pressure, silently.

## Layout

```
web/                 the published folder — this is the whole program
  index.html         one page, six tabs
  lightflow.css      hand-written
  vendor/            uPlot, vendored as plain files
  js/                one file per screen, classic scripts on the LF namespace
    nucleo/          pure ES modules: every formula, no DOM, tested in Node
testes/              one test file per core module
```

## Tests

```bash
node --test 'testes/**/*.mjs'
```

They run on the pure core with no dependencies and no browser, and they gate the
publish: if the arithmetic does not pass, the page is not updated.

## Licence

MIT. See [LICENSE](LICENSE).
