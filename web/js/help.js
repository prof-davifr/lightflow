"use strict";
/* Tab 6 — the Help section.

   The help lives in the page, not in a file somewhere else, because it is read
   at the bench next to the instrument and often with no network.

   ONE SOURCE FOR EVERY DEFINITION. The GLOSSARIO object below builds the
   glossary AND fills the `title` of every label carrying a matching
   data-termo. A term is written once, so the tooltip and the glossary cannot
   drift apart, which is the failure mode of every in-app help that has two. */

LF.telas.ajuda = (function () {

  const GLOSSARIO = {
    device: {
      rot: "Device",
      txt: "Which camera to read. The names stay hidden until you allow access "
        + "once, so the list may show \"camera 1\" and \"camera 2\" the first "
        + "time. Pick the spectrometer, not the laptop's own webcam.",
    },
    lock: {
      rot: "Lock",
      txt: "Turns off automatic exposure and automatic white balance and fixes "
        + "them at the values you set. Nothing measured over time means "
        + "anything until this is done.",
    },
    channel: {
      rot: "Channel",
      txt: "Which of the camera's colour channels carries the measurement. "
        + "Green is the default because it is the only one delivered at full "
        + "resolution along the spectral axis. Red and blue are useful as "
        + "cross-checks and at the ends where green runs out.",
    },
    mode: {
      rot: "Mode",
      txt: "What quantity to compute from the frames: absorbance, "
        + "transmittance, emission or fluorescence. Each one needs different "
        + "reference frames, and the strip under the spectrum says which are "
        + "still missing.",
    },
    averaging: {
      rot: "Frames to average",
      txt: "How many camera frames go into one spectrum. The noise falls as the "
        + "square root of this number, and so does the number of spectra per "
        + "second. Sixteen is a good starting point at 30 frames a second.",
    },
    linearization: {
      rot: "Linearization",
      txt: "The curve that turns the camera's 8-bit values back into intensity. "
        + "Absorbance is a ratio of intensities, so this has to be right or "
        + "every number is wrong. The inverse sRGB curve is the sensible "
        + "default. Changing it invalidates the dark and the reference.",
    },
    roi: {
      rot: "Region of interest",
      txt: "The box over the spectral stripe. Its width is the number of "
        + "columns in the spectrum, its height is how many rows get averaged "
        + "into each column, and its angle follows the tilt of the stripe.",
    },
    binning: {
      rot: "Rows binned",
      txt: "How many image rows are averaged into each column of the spectrum. "
        + "More rows means less noise, up to the point where the box starts "
        + "collecting rows that are not on the stripe.",
    },
    dark: {
      rot: "Dark frame",
      txt: "What the camera reads with no light reaching it. Cover the slit and "
        + "capture. It removes the sensor's own offset, and its spread is what "
        + "sets the largest absorbance the instrument can honestly report.",
    },
    reference: {
      rot: "Reference",
      txt: "The full-intensity spectrum: the lamp through everything except the "
        + "thing being measured. For a solution that is the cuvette with "
        + "solvent only. Absorbance is measured against this.",
    },
    blank: {
      rot: "Blank",
      txt: "For fluorescence: the solvent with the excitation on but no "
        + "fluorophore. It carries the scattered excitation and the solvent's "
        + "own emission, and it is SUBTRACTED, not divided out.",
    },
    fwhm: {
      rot: "FWHM",
      txt: "Full width at half maximum: how wide a peak is, halfway up from its "
        + "local baseline. For an instrument line it measures the resolution; "
        + "for an absorption band it is a property of the substance.",
    },
    residual: {
      rot: "Residual",
      txt: "For one calibration point, the difference in nanometres between the "
        + "wavelength you assigned and the wavelength the fitted polynomial "
        + "puts there. A large one usually means a peak was matched to the "
        + "wrong line.",
    },
    amax: {
      rot: "A max",
      txt: "The largest absorbance worth quoting, computed from the measured "
        + "dark noise as log10((R-D)/3σ). Above it the transmitted light is "
        + "smaller than the noise, and any number printed there is noise "
        + "wearing a value. An 8-bit camera rarely gets past about 1.5.",
    },
  };

  const SECOES = [
    { id: "quickstart", rot: "Quick start", html: function () {
      return `
      <ol>
        <li>Choose the spectrometer in <b>Device</b> and press <b>Open</b>.
          Allow the camera when the browser asks.</li>
        <li>Press <b>Lock camera</b>. The pill in the header must turn green.
          If it stays red, read <a href="#" data-ir="troubleshooting">Troubleshooting</a>
          before going on.</li>
        <li>Set the exposure so the brightest part of the stripe sits high but
          nothing is marked as clipped.</li>
        <li>On the <b>Camera</b> tab, put the box over the stripe. Turn the
          angle until the peaks in the profile below are as narrow as they get,
          then raise <b>Rows binned</b> until the noise settles.</li>
        <li>Point the slit at a fluorescent tube. On <b>Calibration</b>, press
          <b>Add the strongest unused peak</b> once per visible line, press
          <b>Load its lines</b>, choose order 2, and press <b>Fit</b>. Accept it
          when the rms is well under a nanometre.</li>
        <li>Cover the slit and press <b>Capture dark</b>. Put the blank in and
          press <b>Capture reference</b>.</li>
        <li>The absorbance curve should now sit flat near zero. That flat line
          is the real proof that the whole chain works.</li>
        <li>Put the sample in. To follow a reaction, go to <b>Kinetics</b> and
          press <b>Start run</b>.</li>
      </ol>`;
    } },

    { id: "modes", rot: "The four modes", html: function () {
      return `
      <h4>Absorbance — AU</h4>
      <div class="formula">A = −log10( (S − D) / (R − D) )</div>
      <p>Needs a dark frame and a reference. This is the mode for reaction
        kinetics and for Beer's law. A column comes back empty rather than
        infinite where no light gets through, because a gap is honest and a
        vertical spike looks like a real, enormous peak.</p>

      <h4>Transmittance — %</h4>
      <div class="formula">T = 100 × (S − D) / (R − D)</div>
      <p>The same ratio without the logarithm. Reflectance is the identical
        arithmetic with a white standard in the reference position.</p>

      <h4>Emission — linear, arbitrary units</h4>
      <div class="formula">E = S − D</div>
      <p>The spectrum of a source in its own right: a lamp, an LED, a flame. No
        reference is involved, so the shape carries the camera's own spectral
        response as well as the source's.</p>

      <h4>Fluorescence — linear, arbitrary units</h4>
      <div class="formula">F = S − B</div>
      <p>The blank is <b>subtracted</b>, not divided out. It carries the
        scattered excitation and the solvent's own emission, and both add to the
        signal rather than multiplying it. Reaching for the absorbance formula
        here is the classic mistake and it gives a spectrum that is wrong
        wherever the background is not flat.</p>`;
    } },

    { id: "roi", rot: "The region of interest", html: function () {
      return `
      <p>The box sets three things at once: how many columns the spectrum has,
        how many image rows are averaged into each column, and which way the
        stripe runs.</p>
      <p><b>The angle matters more than it looks.</b> A tilt of one degree over
        a thousand columns drags the line across seventeen rows, so binning
        sixty rows at that tilt smears every peak. Turn the angle until the
        peaks in the raw profile are as tall and narrow as they get; that is
        the same criterion as focusing.</p>
      <p><b>More rows is not always better.</b> Raise the row count while the
        noise falls. Once the box starts collecting rows off the stripe, the
        extra rows add background instead of signal and the peaks get shorter.</p>
      <div class="regra"><b>Any calibration belongs to one geometry.</b> Moving
        the box, changing the resolution, or nudging the camera invalidates it.
        The program compares a signature and warns when it can, but it cannot
        detect somebody bumping the grating.</div>`;
    } },

    { id: "calibration", rot: "Calibration", html: function () {
      return `
      <p>A fluorescent tube is the standard source for this, and there is one in
        almost every ceiling. Its mercury lines are narrow, bright, and at known
        wavelengths: 404.66, 435.83, 546.07 and the yellow pair at 576.96 and
        579.07 nm. The broad red band at 611.6 nm comes from the phosphor.</p>
      <p><b>The yellow pair is 2.1 nm apart</b> and almost nothing homemade
        resolves it. If only one hump appears there, call it 578.01 nm — its
        midpoint — rather than picking one of the two, which writes a
        nanometre of error into the fit before it starts.</p>
      <p><b>Order 2 is right nearly always.</b> The grating equation is a sine,
        and over the fan a small grating covers, its departure from a straight
        line is a quadratic to well under a tenth of a nanometre. Order 1 exists
        so a two-laser calibration is possible; order 3 is for a badly tilted
        camera.</p>
      <p><b>Read the residuals, not just the rms.</b> One point far out means a
        peak was matched to the wrong line. Raising the order will hide that and
        give a smooth wrong answer.</p>
      <p><b>Keep one line out of the fit.</b> Leave the 611.6 nm band unticked,
        fit on the mercury lines, and then look at where 611.6 lands. A point
        that was not fitted cannot be flattered by the fit, so that residual is
        the only independent check the calibration gets.</p>`;
    } },

    { id: "kinetics", rot: "Following a reaction", html: function () {
      return `
      <p>The map shows wavelength across and time down, newest at the bottom.
        The colour scale follows the fifth and ninety-fifth percentiles so a
        single hot column does not flatten everything else.</p>
      <p><b>Drag on the map</b> to select a time range. The buttons under it
        then export just those spectra, or average them into one low-noise
        spectrum of that stage of the reaction.</p>
      <p><b>Bands, not single wavelengths.</b> A trace at "546 nm ± 5 nm"
        averages every column in that window, which is quieter than one column
        and still narrow enough to follow a band.</p>
      <p><b>Interval.</b> Two seconds is a sensible default. At one spectrum a
        second, one channel of a 1280-column ROI costs about 18 MB an hour.</p>
      <div class="regra"><b>Keep this tab visible.</b> Browsers throttle a
        background tab hard, which would tear holes in the time axis. The
        program asks for a screen wake lock while the camera runs, but it cannot
        stop you switching to another tab.</div>
      <p><b>Run the control first.</b> Leave the blank in the beam and record
        for twenty minutes. If the absorbance drifts by more than about 0.005,
        the drift is the lamp or the camera, and no kinetics measured on this
        bench means anything until that is fixed.</p>`;
    } },

    { id: "export", rot: "Data and export", html: function () {
      return `
      <p>Everything stays in this browser, on this machine. Nothing is uploaded
        anywhere, and there is no server to upload it to.</p>
      <p><b>What is stored is raw.</b> Each spectrum goes to the database as the
        linearized intensity the camera gave, and the dark and the reference are
        stored beside it as ordinary spectra. Absorbance, the choice of channel
        and the wavelength axis are all recomputed when a run is exported. That
        means a run can be re-exported later against a better reference or a
        better calibration without repeating the chemistry.</p>
      <p>The one thing frozen into the stored numbers is the linearization,
        because it has to be applied before the rows are binned. Changing it
        means measuring again.</p>
      <p><b>CSV uses a decimal point and a comma separator</b>, because these
        files are read by pandas, numpy and Origin. A missing value is an empty
        field, which those tools read back as missing; "NaN" and zero would both
        be read as something else.</p>
      <p><b>Press "Ask the browser to keep this data".</b> Without it the
        browser may evict the whole database under disk pressure, silently, in
        the middle of a long run.</p>`;
    } },

    { id: "glossary", rot: "Glossary", html: function () {
      let h = "<dl>";
      Object.keys(GLOSSARIO).forEach(function (k) {
        h += "<dt>" + GLOSSARIO[k].rot + "</dt><dd>" + GLOSSARIO[k].txt + "</dd>";
      });
      return h + "</dl>";
    } },

    { id: "troubleshooting", rot: "Troubleshooting", html: function () {
      const linhas = [
        ["The device list is empty",
          "The page is not on https or localhost, or the camera permission was "
          + "refused. Opening index.html by double-clicking gives a file:// page, "
          + "and no browser hands a file:// page a camera."],
        ["The lock pill stays red",
          "Firefox exposes no manual camera controls on Linux at all. Use "
          + "Chrome. If Chrome also refuses, the capability table on the Camera "
          + "tab will show exposureMode missing."],
        ["The absorbance drifts slowly with nothing changing",
          "Automatic exposure or automatic white balance is still on, and you "
          + "are recording the camera's control loop. Check the pill. If it is "
          + "green, the drift is the lamp warming up."],
        ["Columns marked in red",
          "Saturation. Shorten the exposure. A clipped column is reported as "
          + "missing, not as a number, because its top has been cut off."],
        ["The absorbance is flat and noisy at once",
          "The exposure is too short, or the reference is too close to the dark. "
          + "Check A max in the header of the Spectrum tab."],
        ["The peaks are wide and shallow",
          "The ROI angle is wrong, or the box is collecting rows off the stripe, "
          + "or the slit is too wide."],
        ["Every wavelength is shifted",
          "The setup moved after the calibration. Fit it again."],
        ["The fit rms is several columns wide",
          "A peak was matched to the wrong line. Check the labels before raising "
          + "the order — a higher order will hide the mistake."],
        ["The time axis has gaps",
          "The tab was in the background and the browser throttled it. Keep the "
          + "tab visible for the whole run."],
        ["A run stopped saving partway through",
          "The storage quota filled, or the database was evicted. Press \"Ask "
          + "the browser to keep this data\" before a long run."],
      ];
      let h = '<table class="tabela"><thead><tr><th>Symptom</th><th>Cause</th>'
        + "</tr></thead><tbody>";
      linhas.forEach(function (l) {
        h += "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td></tr>";
      });
      return h + "</tbody></table>";
    } },

    { id: "warnings", rot: "The three rules", html: function () {
      return `
      <div class="regra"><b>1. Lock the camera.</b> Automatic exposure and
        automatic white balance push the image back towards a mid-grey average
        over seconds to tens of seconds — the same timescale as a slow reaction.
        A run recorded with them on is a picture of the camera's control loop,
        and it looks exactly like kinetics.</div>
      <div class="regra"><b>2. Watch the saturation.</b> A column whose top has
        been cut off carries no information about how much light there was. The
        program reports those columns as missing rather than as numbers, and the
        header counts them.</div>
      <div class="regra"><b>3. Calibrate again after anything moves.</b> The
        wavelength scale belongs to one arrangement of camera, grating and slit.
        Nudging any of them invalidates it, and nothing in software can detect
        that.</div>
      <h4>What this instrument cannot do</h4>
      <p>The browser hands over 8 bits per channel. There is no raw Bayer data
        and no 10-bit path in any browser. That puts the theoretical ceiling on
        absorbance at log10(255) ≈ 2.4, and the real one, once the dark noise is
        counted, at about 1.5. The A max figure on the Spectrum tab is computed
        from your own dark frame and is the number to trust.</p>
      <p>The camera also applies its own gamma, sharpening and colour processing
        before the browser sees anything, and no browser API reaches those
        controls. On Linux they can be set outside the browser:</p>
      <div class="formula" id="cmd-v4l2">…</div>
      <p>Run it with the stream already open, then check with
        <code>v4l2-ctl -d /dev/video2 --all</code>. Sharpening is not cosmetic:
        it is a spatial filter, and its overshoot at the edge of a narrow line
        changes the line's area, which is exactly what a band integration
        reports.</p>`;
    } },
  ];

  function monta() {
    const el = LF.q("#corpo-ajuda");
    let h = '<p class="nota">' + SECOES.map(function (s) {
      return '<a href="#" data-ir="' + s.id + '">' + s.rot + "</a>";
    }).join(" · ") + "</p>";
    SECOES.forEach(function (s) {
      h += '<h3 id="ajuda-' + s.id + '">' + s.rot + "</h3>" + s.html();
    });
    el.innerHTML = h;
    const cmd = LF.q("#cmd-v4l2");
    if (cmd) cmd.textContent = LF.nucleo.locks.comandoV4l2("/dev/video2");
    el.addEventListener("click", function (ev) {
      const a = ev.target.closest("[data-ir]");
      if (!a) return;
      ev.preventDefault();
      vaiPara(a.dataset.ir);
    });
  }

  /* Every label with a data-termo gets its tooltip from the same object that
     builds the glossary. */
  function ligaDicas() {
    LF.qq("[data-termo]").forEach(function (el) {
      const g = GLOSSARIO[el.dataset.termo];
      if (!g) return;
      el.title = g.txt;
    });
  }

  function vaiPara(id) {
    LF.mostraTela("ajuda");
    const alvo = LF.q("#ajuda-" + (id || "quickstart"));
    if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function inicia() {
    monta();
    ligaDicas();
  }

  return { inicia: inicia, vaiPara: vaiPara, GLOSSARIO: GLOSSARIO };
})();
