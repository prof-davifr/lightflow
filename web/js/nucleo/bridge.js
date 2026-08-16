/* The only module script the page loads.

   A <script type="module"> is deferred and a classic <script src> is not, so
   this file runs after every screen file has been parsed and after app.js has
   defined LF.inicia. That ordering is the whole reason this file exists: the
   screens are classic scripts and cannot use `import`, so the pure core is
   handed to them through LF.nucleo, and nothing above may touch LF.nucleo while
   it is still loading. Starting the screens from here, rather than from a
   DOMContentLoaded handler, makes that impossible to get wrong. */

import * as num from "./num.js";
import * as frame from "./frame.js";
import * as photometry from "./photometry.js";
import * as calibration from "./calibration.js";
import * as peaks from "./peaks.js";
import * as locks from "./locks.js";
import * as storage from "./storage.js";
import * as exportfile from "./exportfile.js";

window.LF.nucleo = {
  num: num,
  frame: frame,
  photometry: photometry,
  calibration: calibration,
  peaks: peaks,
  locks: locks,
  storage: storage,
  exportfile: exportfile,
};

window.LF.inicia();
