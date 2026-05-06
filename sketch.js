// === TUNING ===
// All pixel-based constants below are stated at FONT_SIZE_BASE (16px). At runtime, fontSize
// is derived from the viewport and `scale = fontSize / FONT_SIZE_BASE` is applied to every
// pixel-based constant — see rebuildGeometry().
const FONT_SIZE_BASE       = 16;     // baseline font size (all px constants assume this)
const FONT_SIZE_MIN        = 10;     // floor for tiny viewports
const FONT_SIZE_MAX        = 22;     // ceiling for huge viewports
const FONT_SIZE_DIVISOR    = 56;     // fontSize = clamp(MIN, MAX, min(width,height) / this)
const CELL_H_RATIO         = 1.40;   // line height = fontSize * this  (airy)

const BG_COLOR             = '#0066ff';  // pale mint green (Royal Danish "TOGETHER" palette)
const FG_R = 198, FG_G = 200, FG_B = 209;  // #c6c8d1 — pale cool gray

// --- per-row letter spacing (the core mechanic — drives column convergence) ---
const LETTER_SPACING_TIGHT = 12;     // px between letters on the densest rows  (SOBASOBASOBA) — proportional, so leave room
const LETTER_SPACING_WIDE  = 110;    // px between letters on the sparsest rows (S    O    B    A)
const LETTER_SPACING_POWER = 1.45;   // contrast curve — > 1 biases toward tight, < 1 toward wide
const WORD_GAP_RATIO       = 0.55;   // extra gap after each "SOBA" repeat = letterSpacing * this

const NOISE_ROW_SCALE      = 0.055;  // per-row spacing noise frequency (smaller = bigger sweeping bands)
const NOISE_ROW_TIME_MUL   = 0.6;    // how fast spacing bands shift over time
const ROW_DRIFT_PX         = 8;      // small per-row horizontal offset (curves the columns slightly)

// --- ambient density noise (creates within-row negative-space holes) ---
const NOISE_LOCAL_SCALE_X  = 0.0028; // local density noise frequency, x (px)
const NOISE_LOCAL_SCALE_Y  = 0.0055; // local density noise frequency, y (px)
const NOISE_LOW_FREQ_MIX   = 0.40;   // amount of low-freq noise blended in (broader voids)
const SILENT_THRESHOLD     = 0.30;   // drop a letter when localN < this  (raises -> more void)

// --- cursor influence (momentum + carve) ---
const CURSOR_RADIUS        = 230;    // px — cursor influence radius (per trail sample)
const CURSOR_PULL_POW      = 1.5;    // exponent on cursor falloff (higher = sharper edge)
const CURSOR_SPACING_BOOST = 3.0;    // multiplies letterSpacing locally inside cursor zone
const CURSOR_SILENT_BOOST  = 0.28;   // cursor raises silent threshold by up to this

// --- modes (compositional bias on per-row spacing) ---
const MODES                = ['FIELD', 'COMPRESS', 'BAND', 'CORNERS'];
const MODE_AUTO_ENABLED    = true;
const MODE_AUTO_FRAMES     = 60 * 18;  // ~18s per mode
const COMPRESS_BIAS        = 0.55;   // 0 = pure noise; 1 = fully top-wide / bottom-tight gradient
const BAND_FREQ            = 0.18;   // BAND mode — vertical sinusoidal frequency (rad/row)
const BAND_TIME_MUL        = 1.2;    // BAND mode — temporal phase drift speed
const BAND_BIAS            = 0.65;   // BAND mode — strength of the band signal vs noise
const CORNERS_GAP_FRAC     = 0.45;   // CORNERS mode — fraction of canvas left empty in mid-band

// --- momentum trail ---
const TRAIL_MAX            = 22;     // recent cursor samples retained (length of wake)
const TRAIL_DECAY          = 0.93;   // per-frame life decay (lower = wake fades faster)
const TRAIL_DEPOSIT_PX     = 5;      // min smoothed-cursor movement before depositing
const TRAIL_DROP_LIFE      = 0.05;   // drop trail samples below this life

// --- substitution ---
const KO_BASE_PROB         = 0.03;   // hangul swap probability far from cursor
const KO_HOT_PROB          = 0.50;   // hangul swap probability at cursor center
const FLICKER_INTERVAL_MIN = 18;     // frames between per-letter char re-rolls (min)
const FLICKER_INTERVAL_MAX = 140;    // frames between per-letter char re-rolls (max)

const ALPHA_COLD           = 220;    // 0–255 alpha far from cursor
const ALPHA_HOT            = 255;    // 0–255 alpha at cursor center
const EDGE_FADE_PX         = 0;      // 0 = hard edges (matches reference); > 0 = soft falloff

const CURSOR_LERP          = 0.18;   // smoothing on tracked cursor position
const VELOCITY_LERP        = 0.18;   // smoothing on cursor velocity vector
const TIME_TICK            = 0.0017; // global time step per frame (drives noise drift)

const PULSE_SPEED          = 9;      // px/frame ring radius growth
const PULSE_LIFE           = 80;     // frames until ring dies
const PULSE_RING_WIDTH     = 90;     // px — band of letters carved away by an active ring

const SOBA = ['S', 'O', 'B', 'A'];
// Hangul pool — 수 and 연 weighted heavily so 수연 reads through the field.
const KO_POOL = [
  '수','수','수',
  '연','연','연'
];

const FONT_EN = 'Switzer';
const FONT_KO = 'Orbit';

// === STATE ===
let rowsCount = 0;
let cellH = 0;
let cellWApprox = 0;        // approximate monospace advance, used only for tight-pulse spacing floor
let fontSize = FONT_SIZE_BASE;

let mx = 0, my = 0;
let pmx = 0, pmy = 0;
let vx = 0, vy = 0;
let mouseSpeed = 0;

let trail = [];
let pulses = [];
let frozen = false;
let tNoise = 0;

let rowStates = [];         // rowStates[rowIdx] = [{swap, flickerLeft}, ...]
let modeIndex = 0;
let mode = MODES[modeIndex];
let modeAutoTimer = 0;

let currentFont = '';

// viewport-scaled values (recomputed in rebuildGeometry)
let scale = 1;
let s_letterSpacingTight = LETTER_SPACING_TIGHT;
let s_letterSpacingWide  = LETTER_SPACING_WIDE;
let s_cursorRadius       = CURSOR_RADIUS;
let s_cursorRadiusSq     = CURSOR_RADIUS * CURSOR_RADIUS;
let s_rowDriftPx         = ROW_DRIFT_PX;
let s_pulseSpeed         = PULSE_SPEED;
let s_pulseRingWidth     = PULSE_RING_WIDTH;
let s_trailDepositPx     = TRAIL_DEPOSIT_PX;

let hudTL, hudTR, hudBL;

function isKorean(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  // Hangul syllables
  return code >= 0xAC00 && code <= 0xD7A3;
}

function setFont(name) {
  if (currentFont !== name) {
    textFont(name);
    currentFont = name;
  }
}

function setup() {
  pixelDensity(Math.min(2, displayDensity()));
  const c = createCanvas(windowWidth, windowHeight);
  c.style('display', 'block');

  setFont(FONT_EN);
  textAlign(CENTER, CENTER);
  noiseSeed(1337);

  hudTL = document.getElementById('hud-tl');
  hudTR = document.getElementById('hud-tr');
  hudBL = document.getElementById('hud-bl');
  hudBL.textContent = 'MOVE · DRAG · CLICK PULSE · [SPACE] FREEZE · [M] MODE · [R] RESET';

  mx = pmx = width / 2;
  my = pmy = height / 2;

  rebuildGeometry();
}

function rebuildGeometry() {
  fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX,
    Math.round(Math.min(width, height) / FONT_SIZE_DIVISOR)));
  scale = fontSize / FONT_SIZE_BASE;
  textSize(fontSize);
  cellH = fontSize * CELL_H_RATIO;
  cellWApprox = fontSize * 0.62;
  rowsCount = Math.ceil(height / cellH) + 2;

  // scale every absolute-pixel constant by `scale`
  s_letterSpacingTight = LETTER_SPACING_TIGHT * scale;
  s_letterSpacingWide  = LETTER_SPACING_WIDE  * scale;
  s_cursorRadius       = CURSOR_RADIUS        * scale;
  s_cursorRadiusSq     = s_cursorRadius * s_cursorRadius;
  s_rowDriftPx         = ROW_DRIFT_PX         * scale;
  s_pulseSpeed         = PULSE_SPEED          * scale;
  s_pulseRingWidth     = PULSE_RING_WIDTH     * scale;
  s_trailDepositPx     = TRAIL_DEPOSIT_PX     * scale;

  rowStates = new Array(rowsCount);
  for (let i = 0; i < rowsCount; i++) rowStates[i] = [];
}

function setMode(nextIdx) {
  modeIndex = ((nextIdx % MODES.length) + MODES.length) % MODES.length;
  mode = MODES[modeIndex];
  modeAutoTimer = 0;
  // Clear states so flicker pacing resets cleanly per mode.
  for (let i = 0; i < rowStates.length; i++) rowStates[i] = [];
}

// Per-row letterSpacing in pixels — driven by mode + noise.
function rowLetterSpacing(rowIdx) {
  let n = noise(rowIdx * NOISE_ROW_SCALE, tNoise * NOISE_ROW_TIME_MUL);

  if (mode === 'COMPRESS') {
    // Top wide → bottom tight (canonical TOGETHER vertical compression).
    const bias = 1 - rowIdx / Math.max(1, rowsCount - 1);  // 1 at top, 0 at bottom
    n = n * (1 - COMPRESS_BIAS) + bias * COMPRESS_BIAS;
  } else if (mode === 'BAND') {
    // Sinusoidal compression bands stacked vertically.
    const phase = rowIdx * BAND_FREQ + tNoise * BAND_TIME_MUL;
    const band = (Math.sin(phase) + 1) * 0.5;
    n = n * (1 - BAND_BIAS) + band * BAND_BIAS;
  }
  // FIELD / CORNERS: just use noise as-is for spacing; CORNERS handles negative space differently.

  const t = Math.pow(Math.max(0, Math.min(1, n)), LETTER_SPACING_POWER);
  return lerp(s_letterSpacingTight, s_letterSpacingWide, t);
}

// CORNERS mode — left/right "windows" that the row's letters are constrained to.
// Returns { startX, endX } of the visible band for this row (or null = silent row).
function cornersWindow(rowIdx) {
  const u = rowIdx / Math.max(1, rowsCount - 1);  // 0 at top, 1 at bottom
  const halfGap = CORNERS_GAP_FRAC * 0.5;
  // Top half: anchored left, growing rightward as we approach the middle.
  // Bottom half: anchored right, growing leftward as we approach the middle.
  // Mid band: silent.
  if (u < 0.5 - halfGap) {
    const k = u / (0.5 - halfGap);                    // 0..1 down through top half
    const grow = 0.20 + k * 0.55;                     // visible fraction grows 0.2 → 0.75
    return { startX: 0, endX: width * grow };
  } else if (u > 0.5 + halfGap) {
    const k = (u - (0.5 + halfGap)) / (0.5 - halfGap); // 0..1 down through bottom half
    const grow = 0.20 + k * 0.55;
    return { startX: width * (1 - grow), endX: width };
  }
  return null;
}

function updateTrail() {
  for (let i = 0; i < trail.length; i++) trail[i].life *= TRAIL_DECAY;
  while (trail.length && trail[0].life < TRAIL_DROP_LIFE) trail.shift();

  if (trail.length === 0) {
    trail.push({ x: mx, y: my, life: 1.0 });
    return;
  }
  const last = trail[trail.length - 1];
  const moved = Math.hypot(mx - last.x, my - last.y);
  if (moved >= s_trailDepositPx) {
    trail.push({ x: mx, y: my, life: 1.0 });
    if (trail.length > TRAIL_MAX) trail.shift();
  } else {
    last.x = mx;
    last.y = my;
    last.life = 1.0;
  }
}

function draw() {
  background(BG_COLOR);

  // smooth cursor + velocity
  pmx = mx; pmy = my;
  mx += (mouseX - mx) * CURSOR_LERP;
  my += (mouseY - my) * CURSOR_LERP;
  const ivx = mx - pmx;
  const ivy = my - pmy;
  vx += (ivx - vx) * VELOCITY_LERP;
  vy += (ivy - vy) * VELOCITY_LERP;
  mouseSpeed = Math.hypot(vx, vy);

  if (!frozen) tNoise += TIME_TICK;

  updateTrail();

  // Trail bounding box (with cursor-radius padding) for cheap skip.
  let trailMinX = Infinity, trailMinY = Infinity;
  let trailMaxX = -Infinity, trailMaxY = -Infinity;
  for (let ti = 0; ti < trail.length; ti++) {
    const t = trail[ti];
    if (t.x < trailMinX) trailMinX = t.x;
    if (t.y < trailMinY) trailMinY = t.y;
    if (t.x > trailMaxX) trailMaxX = t.x;
    if (t.y > trailMaxY) trailMaxY = t.y;
  }
  trailMinX -= s_cursorRadius; trailMinY -= s_cursorRadius;
  trailMaxX += s_cursorRadius; trailMaxY += s_cursorRadius;
  const radSq = s_cursorRadiusSq;

  // Mode auto-cycle
  if (MODE_AUTO_ENABLED && !frozen) {
    modeAutoTimer++;
    if (modeAutoTimer >= MODE_AUTO_FRAMES) setMode(modeIndex + 1);
  }

  // Update pulses
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.r += s_pulseSpeed;
    p.life -= 1;
    if (p.life <= 0) pulses.splice(i, 1);
  }

  textSize(fontSize);
  noStroke();
  const ringHalf = s_pulseRingWidth * 0.5;

  // === walk each row, lay "SOBA" left-to-right with per-row letter spacing ===
  for (let r = 0; r < rowsCount; r++) {
    const cy = r * cellH + cellH * 0.5;
    if (cy < -cellH || cy > height + cellH) continue;

    const baseSpacing = rowLetterSpacing(r);
    const wordGap = baseSpacing * WORD_GAP_RATIO;
    const driftN = noise(r * NOISE_ROW_SCALE * 2.1 + 100, tNoise * 0.7);
    const drift = (driftN - 0.5) * s_rowDriftPx;

    // CORNERS: confine the row to a left/right window (or skip it entirely).
    let xStart = drift;
    let xEnd = width + baseSpacing;
    if (mode === 'CORNERS') {
      const win = cornersWindow(r);
      if (!win) continue;
      xStart = win.startX + drift;
      xEnd = win.endX;
    }

    let states = rowStates[r];
    if (!states) { states = []; rowStates[r] = states; }

    let x = xStart;
    let letterIdx = r & 3;  // diagonal stagger of SOBA across rows
    let safety = 0;
    const safetyMax = 1500;

    while (x < xEnd && safety++ < safetyMax) {
      const charInWord = letterIdx & 3;
      const baseChar = SOBA[charInWord];

      // local cursor influence (momentum trail)
      let inflRaw = 0;
      if (x >= trailMinX && x <= trailMaxX && cy >= trailMinY && cy <= trailMaxY) {
        for (let ti = 0; ti < trail.length; ti++) {
          const tp = trail[ti];
          const dxm = x - tp.x;
          const dym = cy - tp.y;
          const d2 = dxm * dxm + dym * dym;
          if (d2 < radSq) {
            const local = (1 - Math.sqrt(d2) / s_cursorRadius) * tp.life;
            if (local > inflRaw) inflRaw = local;
          }
        }
      }
      const inflE = Math.pow(inflRaw, CURSOR_PULL_POW);
      const cursorMul = 1 + inflE * (CURSOR_SPACING_BOOST - 1);

      // ambient density (two-octave) — creates organic voids
      const localNHi = noise(x * NOISE_LOCAL_SCALE_X, cy * NOISE_LOCAL_SCALE_Y, tNoise);
      const localNLo = noise(x * NOISE_LOCAL_SCALE_X * 0.35 + 50,
                             cy * NOISE_LOCAL_SCALE_Y * 0.35 + 50,
                             tNoise * 0.6);
      const localN = localNHi * (1 - NOISE_LOW_FREQ_MIX) + localNLo * NOISE_LOW_FREQ_MIX;
      const silentThresh = SILENT_THRESHOLD + inflE * CURSOR_SILENT_BOOST;
      const silent = localN < silentThresh;

      // pulse carve
      let carved = false;
      for (let pi = 0; pi < pulses.length; pi++) {
        const p = pulses[pi];
        const pdx = x - p.x;
        const pdy = cy - p.y;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy);
        if (Math.abs(pd - p.r) < ringHalf) { carved = true; break; }
      }

      // per-letter state
      let st = states[letterIdx];
      if (!st) {
        st = states[letterIdx] = {
          swap: '',
          flickerLeft: FLICKER_INTERVAL_MIN +
            ((Math.random() * (FLICKER_INTERVAL_MAX - FLICKER_INTERVAL_MIN)) | 0)
        };
      }
      if (!frozen) {
        st.flickerLeft -= 1;
        if (st.flickerLeft <= 0) {
          const koProb = lerp(KO_BASE_PROB, KO_HOT_PROB, inflE);
          st.swap = (Math.random() < koProb)
            ? KO_POOL[(Math.random() * KO_POOL.length) | 0]
            : '';
          st.flickerLeft = FLICKER_INTERVAL_MIN +
            ((Math.random() * (FLICKER_INTERVAL_MAX - FLICKER_INTERVAL_MIN)) | 0);
        }
      }

      const onScreen = x >= 0 && x < width && cy >= 0 && cy < height;
      if (!silent && !carved && onScreen) {
        const ch = st.swap || baseChar;
        const edge = EDGE_FADE_PX > 0
          ? Math.min(1, Math.min(x, width - x, cy, height - cy) / EDGE_FADE_PX)
          : 1;
        if (edge > 0) {
          const alpha = lerp(ALPHA_COLD, ALPHA_HOT, inflE) * edge;
          fill(FG_R, FG_G, FG_B, alpha);
          setFont(isKorean(ch) ? FONT_KO : FONT_EN);
          text(ch, x, cy);
        }
      }

      // advance: letterSpacing each step, plus a word gap after each "A"
      let advance = baseSpacing * cursorMul;
      if (charInWord === 3) advance += wordGap;
      // safety floor — don't allow advance < ~half a monospace cell, even if cursor squeezes
      if (advance < cellWApprox * 0.6) advance = cellWApprox * 0.6;

      letterIdx++;
      x += advance;
    }
  }

  updateHUD();
}

function updateHUD() {
  const mixPct = Math.round(KO_HOT_PROB * 100);
  const modeLine = mode + (frozen ? ' · FROZEN' : '');
  hudTL.textContent =
    'FIELD  SOBA × 수연\n' +
    'MODE   ' + modeLine + '\n' +
    'MIX    ' + mixPct + '% KO @ HOT';

  const cycleLeft = MODE_AUTO_ENABLED && !frozen
    ? Math.max(0, ((MODE_AUTO_FRAMES - modeAutoTimer) / 60) | 0)
    : 0;
  hudTR.textContent =
    'X ' + pad4(Math.round(mx)) + '  Y ' + pad4(Math.round(my)) + '\n' +
    'TURB ' + mouseSpeed.toFixed(1) + '  WAKE ' + trail.length + '\n' +
    'NEXT ' + pad2(cycleLeft) + 'S';
}

function pad4(n) {
  const s = String(Math.max(0, n | 0));
  return s.length >= 4 ? s : ('    ' + s).slice(-4);
}
function pad2(n) {
  const s = String(Math.max(0, n | 0));
  return s.length >= 2 ? s : ('  ' + s).slice(-2);
}

function mousePressed() {
  pulses.push({ x: mouseX, y: mouseY, r: 0, life: PULSE_LIFE });
}

function keyPressed() {
  if (key === ' ') {
    frozen = !frozen;
  } else if (key === 'r' || key === 'R') {
    pulses = [];
    trail = [];
    tNoise = 0;
    rebuildGeometry();
  } else if (key === 'm' || key === 'M') {
    setMode(modeIndex + 1);
  } else if (key >= '1' && key <= '4') {
    setMode(parseInt(key, 10) - 1);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  rebuildGeometry();
}
