// =========================================================
// State
// =========================================================

let mediaSource = 'webcam'; // 'webcam' | 'image' | 'video'
let capture, uploadedImage, uploadedVideo;
let currentMedia = null;

let cols = 200;
let aspectRatio = 0.5;
let rows = 100;

let charSizePx = 8;
let fps = 12;

let density = "█▓▒░ ";
let densityReversed = true; // canvas bg is black, so bright input should map to dense/visible chars

let renderMode = 'normal';

let grayscaleMethod = 'perceptual';
let invertEnabled = false;
let thresholdEnabled = false;
let thresholdValue = 128;
let posterizeLevels = 0;
let edgeDetectionEnabled = false;
let hueBased = false;
let pixelation = 1;
let blurAmount = 0;
let sharpenAmount = 0;

let brightnessValue = 0;
let contrastValue = 1;

let colorSource = 'grayscale';
let solidColor = '#00ff00';
let gradientColor1 = '#1a0033';
let gradientColor2 = '#ff3366';
let gradientColor3 = '#ffcc00';

let backgroundColor = '#000000';

let ditherMethod = 'none'; // 'none' | 'ordered' | 'floyd'

let trailEnabled = false;
let trailAmount = 0.15;

let fontFamily = "'Courier New', monospace";

let mirror = true;
let paused = false;

const emojiSet = ['⬛', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬜'];
const matrixChars = "01アイウエオカキクケコサシスセソ$+-*/=<>";

let mainCanvas;
let ctx2d;
let outputWrapperElt;
let plainTextOutput = "";

let buffers = {};
let matrixCols = [];

let defaults = {};

let uiRefs = {};

let needsFit = true;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingEndedHandler = null;

let gifEncoder = null;
let isGifRecording = false;
let gifRecordStart = 0;
const GIF_MAX_MS = 8000;

let audioEnabled = false;
let audioSensitivity = 1;
let mic = null;
let audioLevel = 0;
let audioSmoothed = 0;

let bannerText = 'HELLO';
let textBannerGfx = null;
let bannerFontFamily = 'Arial';
let bannerBold = true;
let bannerOutline = false;
let bannerAnimation = 'none'; // 'none' | 'scroll' | 'pulse' | 'wave' | 'typewriter'
let bannerAnimSpeed = 1;


// =========================================================
// Setup
// =========================================================

function setup() {

  // Keep every canvas/graphics buffer at a 1:1 logical-to-actual pixel
  // ratio. sampleMedia() below indexes .pixels manually using plain
  // width*height math; on a display with devicePixelRatio > 1, p5's
  // default pixel density would make the real pixel buffer larger than
  // that, corrupting every manual pixel lookup.
  pixelDensity(1);

  frameRate(fps);

  mainCanvas = createCanvas(computeCanvasW(), computeCanvasH());
  mainCanvas.parent('outputWrapper');
  mainCanvas.class('mainCanvas');
  ctx2d = drawingContext;

  outputWrapperElt = document.getElementById('outputWrapper');

  setupControls();
  setupDragDrop();
  captureDefaults();

  applyFontAndSize();
  applyBackgroundColor();
  regenerateTextBanner();
  switchSource('webcam');
  setupMatrixCols();
}


function computeCanvasW() {
  return Math.max(1, Math.ceil(cols * charSizePx * 0.6));
}

function computeCanvasH() {
  return Math.max(1, Math.ceil(rows * charSizePx));
}

function resizeMainCanvas() {
  resizeCanvas(computeCanvasW(), computeCanvasH());
  requestFit();
}


// =========================================================
// Buffers / sampling helpers
// =========================================================

function getBuffer(key, w, h) {
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  let b = buffers[key];
  if (!b || b.width !== w || b.height !== h) {
    if (b) b.remove();
    b = createGraphics(w, h);
    buffers[key] = b;
  }
  return b;
}


function sampleMedia(w, h) {

  const buf = getBuffer('main', w, h);
  buf.clear();

  // Mirroring is meant for the webcam (and is a fine creative option on
  // uploaded media); it never makes sense for the text banner, which would
  // otherwise render backwards.
  const applyMirror = mirror && mediaSource !== 'text';

  if (pixelation > 1) {

    const pw = Math.max(1, Math.floor(w / pixelation));
    const ph = Math.max(1, Math.floor(h / pixelation));
    const small = getBuffer('pixelate', pw, ph);

    small.image(currentMedia, 0, 0, pw, ph);

    buf.push();
    if (applyMirror) { buf.translate(w, 0); buf.scale(-1, 1); }
    buf.noSmooth();
    buf.image(small, 0, 0, w, h);
    buf.pop();

  } else {

    buf.push();
    if (applyMirror) { buf.translate(w, 0); buf.scale(-1, 1); }
    buf.image(currentMedia, 0, 0, w, h);
    buf.pop();

  }

  if (blurAmount > 0) {
    buf.filter(BLUR, blurAmount);
  }

  buf.loadPixels();
  let px = buf.pixels;

  if (sharpenAmount > 0) {
    px = sharpenPixels(px, w, h, sharpenAmount);
  }

  return { pixels: px, w, h };
}


function sharpenPixels(pixels, w, h, amount) {

  const src = new Uint8ClampedArray(pixels);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      const idx = (x + y * w) * 4;

      for (let c = 0; c < 3; c++) {

        let sum = 0, k = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = constrain(x + kx, 0, w - 1);
            const sy = constrain(y + ky, 0, h - 1);
            sum += src[(sx + sy * w) * 4 + c] * kernel[k];
            k++;
          }
        }

        const orig = src[idx + c];
        pixels[idx + c] = constrain(orig + (sum - orig) * amount, 0, 255);
      }
    }
  }

  return pixels;
}


function computeGray(r, g, b) {
  switch (grayscaleMethod) {
    case 'average': return (r + g + b) / 3;
    case 'red': return r;
    case 'green': return g;
    case 'blue': return b;
    default: return 0.299 * r + 0.587 * g + 0.114 * b;
  }
}


function posterizeChannel(v) {
  if (posterizeLevels <= 1) return v;
  const step = 255 / (posterizeLevels - 1);
  return constrain(Math.round(Math.round(v / step) * step), 0, 255);
}


function computeEdgeMagnitudes(pixels, w, h) {

  const gray = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = computeGray(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
  }

  const mag = new Float32Array(w * h);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      let sx = 0, sy = 0, k = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px_ = constrain(x + kx, 0, w - 1);
          const py_ = constrain(y + ky, 0, h - 1);
          const v = gray[px_ + py_ * w];
          sx += v * gx[k];
          sy += v * gy[k];
          k++;
        }
      }

      mag[x + y * w] = constrain(Math.sqrt(sx * sx + sy * sy), 0, 255);
    }
  }

  return mag;
}


function rgbToHueSat(r, g, b) {

  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0, s = 0;

  if (d !== 0) {

    s = d / (1 - Math.abs(2 * l - 1));

    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }

    h *= 60;
    if (h < 0) h += 360;
  }

  return { h: Math.round(h), s: Math.round(s * 100) };
}


function gradientColorFor(average) {
  const t = constrain(average / 255, 0, 1);
  const c1 = color(gradientColor1), c2 = color(gradientColor2), c3 = color(gradientColor3);
  const c = t < 0.5 ? lerpColor(c1, c2, t * 2) : lerpColor(c2, c3, (t - 0.5) * 2);
  return `rgb(${Math.round(red(c))},${Math.round(green(c))},${Math.round(blue(c))})`;
}


function getDisplayColor(r, g, b, average) {

  if (hueBased) {
    const { h, s } = rgbToHueSat(r, g, b);
    const lightness = map(average, 0, 255, 20, 80);
    return `hsl(${h},${s}%,${lightness}%)`;
  }

  switch (colorSource) {

    case 'color':
      return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

    case 'solid':
      return solidColor;

    case 'gradient':
      return gradientColorFor(average);

    case 'hue': {
      const { h, s } = rgbToHueSat(r, g, b);
      const lightness = map(average, 0, 255, 20, 80);
      return `hsl(${h},${s}%,${lightness}%)`;
    }

    case 'green':
      return `rgb(0,${Math.round(average)},0)`;

    case 'amber':
      return `rgb(${Math.round(average)},${Math.round(average * 0.6)},0)`;

    case 'blue':
      return `rgb(0,${Math.round(average * 0.7)},${Math.round(average)})`;

    case 'rainbow': {
      const hue = map(average, 0, 255, 0, 300);
      return `hsl(${Math.round(hue)},80%,55%)`;
    }

    default:
      return `rgb(${Math.round(average)},${Math.round(average)},${Math.round(average)})`;
  }
}


function getActiveDensityString() {
  let d = density.length ? density : ' ';
  if (densityReversed) {
    d = d.split('').reverse().join('');
  }
  return d;
}


function hexToRgba(hex, alpha) {
  const n = hex.replace('#', '');
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}


function applyBackgroundColor() {
  if (outputWrapperElt) outputWrapperElt.style.background = backgroundColor;
}


// Clears/fades the canvas at the start of a frame. When motion trail is on,
// this fills with a translucent version of the background color instead of
// an opaque one, so the previous frame's glyphs bleed through and decay
// rather than being fully erased.
function clearFrame() {
  ctx2d.fillStyle = trailEnabled ? hexToRgba(backgroundColor, 1 - trailAmount) : backgroundColor;
  ctx2d.fillRect(0, 0, width, height);
}


// ---- Dithering ----
// Only the glyph/threshold selection is dithered, never the display color -
// getDisplayColor() always reads the true, non-dithered average, so colored
// renders stay smooth while the character choice gets proper error diffusion.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function orderedDitherOffset(x, y, levelStep) {
  return (BAYER4[(x % 4) + (y % 4) * 4] / 16 - 0.5) * levelStep;
}


// Builds a Floyd-Steinberg error-diffusion state usable across a single
// row-major (y outer, x inner) pass over a w-wide grid.
function createFloydDither(w) {
  return {
    curr: new Float32Array(w + 2),
    next: new Float32Array(w + 2),
    // Reads accumulated error for column x (offset by 1 to allow x-1/x+1),
    // diffuses `error` (actual - quantized) to neighboring cells.
    diffuse(x, error) {
      this.curr[x + 2] += error * 7 / 16;
      this.next[x] += error * 3 / 16;
      this.next[x + 1] += error * 5 / 16;
      this.next[x + 2] += error * 1 / 16;
    },
    errorAt(x) {
      return this.curr[x + 1];
    },
    nextRow() {
      this.curr = this.next;
      this.next = new Float32Array(w + 2);
    }
  };
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// =========================================================
// Video recording (records the live ASCII canvas, not the source)
// =========================================================

function getRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  return '';
}


function updateRecordButtonUI() {
  if (!uiRefs.recordBtn) return;
  uiRefs.recordBtn.textContent = isRecording ? 'Stop & download video' : 'Record ASCII video';
  uiRefs.recordBtn.classList.toggle('recording', isRecording);
}


function startRecording() {

  if (isRecording) return;

  if (!mainCanvas || typeof mainCanvas.elt.captureStream !== 'function') {
    alert('Video recording is not supported in this browser.');
    return;
  }

  const mimeType = getRecorderMimeType();
  if (mimeType === null) {
    alert('Video recording is not supported in this browser.');
    return;
  }

  const stream = mainCanvas.elt.captureStream(fps);
  recordedChunks = [];

  try {
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (e) {
    alert('Video recording is not supported in this browser.');
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const outType = mediaRecorder.mimeType || 'video/webm';
    const ext = outType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type: outType });
    recordedChunks = [];
    downloadBlob(blob, `ascii-video-${Date.now()}.${ext}`);
  };

  // For an uploaded video, capture exactly one full playthrough: play it
  // from the start without looping, and auto-stop when it ends.
  if (mediaSource === 'video' && uploadedVideo) {
    uploadedVideo.elt.loop = false;
    uploadedVideo.elt.currentTime = 0;
    recordingEndedHandler = () => stopRecording();
    uploadedVideo.elt.addEventListener('ended', recordingEndedHandler, { once: true });
  }

  mediaRecorder.start();
  isRecording = true;
  updateRecordButtonUI();
}


function stopRecording() {

  if (!isRecording) return;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;

  if (mediaSource === 'video' && uploadedVideo) {
    uploadedVideo.elt.loop = true;
    if (recordingEndedHandler) {
      uploadedVideo.elt.removeEventListener('ended', recordingEndedHandler);
      recordingEndedHandler = null;
    }
  }

  updateRecordButtonUI();
}


// =========================================================
// GIF export (captures the live ASCII canvas via vendored gif.js)
// =========================================================

function updateGifButtonUI() {
  if (!uiRefs.gifBtn) return;
  uiRefs.gifBtn.textContent = isGifRecording ? 'Stop & download GIF' : 'Record GIF';
  uiRefs.gifBtn.classList.toggle('recording', isGifRecording);
}


async function startGifCapture() {

  if (isGifRecording) return;

  if (typeof GIF === 'undefined') {
    alert('GIF export is not available (gif.js failed to load).');
    return;
  }

  // GIF encoding runs on a Web Worker (libraries/gif.worker.js). Most
  // browsers refuse to spawn workers for pages opened directly as
  // file://, which fails silently otherwise (button stuck "recording"
  // forever with no output). Fail fast with a clear message instead.
  try {
    await fetch('libraries/gif.worker.js', { method: 'HEAD' });
  } catch (e) {
    alert('GIF export needs this page to be served over http(s) - opening index.html directly (file://) blocks the Web Worker it relies on. Run a local server (e.g. "npx serve" in this folder) and open it from there, or use "Record ASCII video" instead.');
    return;
  }

  gifEncoder = new GIF({
    workers: 2,
    quality: 10,
    workerScript: 'libraries/gif.worker.js'
  });

  gifEncoder.on('finished', (blob) => {
    downloadBlob(blob, `ascii-art-${Date.now()}.gif`);
  });

  isGifRecording = true;
  gifRecordStart = millis();
  updateGifButtonUI();
}


function stopGifCapture() {

  if (!isGifRecording || !gifEncoder) return;

  isGifRecording = false;
  updateGifButtonUI();
  gifEncoder.render();
}


// =========================================================
// Draw
// =========================================================

function draw() {

  if (!currentMedia) return;

  if (audioEnabled && mic) {
    audioLevel = mic.getLevel();
    audioSmoothed = lerp(audioSmoothed, audioLevel, 0.3);
  } else {
    audioSmoothed = lerp(audioSmoothed, 0, 0.3);
  }

  if (paused && renderMode !== 'matrix') return;

  if (mediaSource === 'text') regenerateTextBanner();

  if (renderMode === 'matrix') {
    drawMatrixMode();
  } else if (renderMode === 'braille') {
    drawBrailleMode();
  } else if (renderMode === 'halfblock') {
    drawHalfBlockMode();
  } else {
    drawStandardMode();
  }

  if (needsFit) {
    applyFit();
  } else if (audioEnabled) {
    applyCanvasTransform();
  }

  if (isGifRecording) {
    gifEncoder.addFrame(mainCanvas.elt, { copy: true, delay: 1000 / fps });
    if (millis() - gifRecordStart > GIF_MAX_MS) stopGifCapture();
  }
}


// =========================================================
// Fit-to-screen
// =========================================================

function requestFit() {
  needsFit = true;
}

let baseFitScale = 1;

function applyFit() {

  if (!outputWrapperElt || !mainCanvas) return;

  const natW = computeCanvasW();
  const natH = computeCanvasH();

  const wrapperW = outputWrapperElt.clientWidth;
  const wrapperH = outputWrapperElt.clientHeight;
  if (!wrapperW || !wrapperH) return;

  baseFitScale = Math.min(1, wrapperW / natW, wrapperH / natH);
  applyCanvasTransform();

  needsFit = false;
}


// Applies the fit scale plus a cheap, render-free "beat zoom" driven by the
// audio-reactive level. Runs every frame (CSS transform only, no re-render)
// so the pulse stays smooth even though applyFit() itself only reruns on resize.
function applyCanvasTransform() {
  const audioZoom = audioEnabled ? 1 + audioSmoothed * audioSensitivity * 0.12 : 1;
  mainCanvas.elt.style.transform = `translate(-50%, -50%) scale(${baseFitScale * audioZoom})`;
}


// All render*Mode() functions below draw straight onto mainCanvas via the
// raw Canvas2D context (ctx2d), not through p5's fill()/text() wrappers and
// never through the DOM. An earlier version built one HTML <span> per
// character and replaced the whole output div's innerHTML every frame -
// at a default 200x100 grid that's 20,000 DOM nodes destroyed and rebuilt
// ~12x/sec, which is what was hanging/crashing the tab. Canvas drawing has
// no DOM/layout cost per glyph, so this is orders of magnitude cheaper.

function drawStandardMode() {

  const w = cols, h = rows;
  const sample = sampleMedia(w, h);
  const px = sample.pixels;

  const useEdge = edgeDetectionEnabled || renderMode === 'edge';
  const edgeMag = useEdge ? computeEdgeMagnitudes(px, w, h) : null;

  const activeDensity = getActiveDensityString();
  const uniformColor = (colorSource === 'solid' && !hueBased && renderMode !== 'emoji') ? solidColor : null;

  const audioBoost = audioEnabled ? audioSmoothed * audioSensitivity * 80 : 0;

  const levels = renderMode === 'binary' ? 2 : renderMode === 'emoji' ? emojiSet.length : activeDensity.length;
  const levelStep = 255 / levels;
  const floyd = ditherMethod === 'floyd' ? createFloydDither(w) : null;

  clearFrame();
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  if (uniformColor) ctx2d.fillStyle = uniformColor;

  const cw = width / w;
  const chH = height / h;

  if (renderMode === 'emoji') {
    // Emoji glyphs come from a fallback color-emoji font (the monospace
    // fontFamily has no emoji), and that fallback font's metrics can be
    // wildly larger than the requested px size - fillText() then draws
    // glyphs several times the cell size. Measure a sample glyph and scale
    // the font size down until it actually fits the cell.
    ctx2d.font = `${charSizePx}px ${fontFamily}`;
    const sampleWidth = ctx2d.measureText(emojiSet[0]).width;
    const targetSize = Math.min(cw, chH) * 0.85;
    const fitSize = sampleWidth > 0 ? Math.max(4, charSizePx * (targetSize / sampleWidth)) : charSizePx;
    ctx2d.font = `${fitSize}px ${fontFamily}`;
  } else {
    ctx2d.font = `${charSizePx}px ${fontFamily}`;
  }

  let plain = '';

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      const idx = (x + y * w) * 4;
      let r = px[idx], g = px[idx + 1], b = px[idx + 2];

      if (posterizeLevels > 0) {
        r = posterizeChannel(r);
        g = posterizeChannel(g);
        b = posterizeChannel(b);
      }

      const gray = computeGray(r, g, b);

      let average = edgeMag ? (255 - edgeMag[x + y * w]) : gray;

      average += brightnessValue + audioBoost;
      average = (average - 128) * contrastValue + 128;
      average = constrain(average, 0, 255);

      if (thresholdEnabled && ditherMethod === 'none') {
        average = average < thresholdValue ? 0 : 255;
      }

      if (invertEnabled) {
        average = 255 - average;
      }

      // glyphValue drives character selection and may be perturbed by
      // dithering; average (the true brightness) always drives color, so
      // colored output stays smooth even with dithering enabled.
      let glyphValue = average;

      if (ditherMethod === 'ordered') {
        glyphValue = constrain(glyphValue + orderedDitherOffset(x, y, levelStep), 0, 255);
      } else if (ditherMethod === 'floyd') {
        glyphValue = constrain(glyphValue + floyd.errorAt(x), 0, 255);
      }

      let ch, levelIndex;

      if (renderMode === 'binary') {
        const set = densityReversed ? "10" : "01";
        levelIndex = glyphValue < 128 ? 0 : 1;
        ch = set[levelIndex];
      } else if (renderMode === 'emoji') {
        const set = densityReversed ? [...emojiSet].reverse() : emojiSet;
        levelIndex = Math.min(set.length - 1, Math.floor(map(glyphValue, 0, 255, 0, set.length)));
        ch = set[levelIndex];
      } else {
        levelIndex = Math.floor(map(glyphValue, 0, 255, 0, activeDensity.length - 1));
        ch = activeDensity.charAt(levelIndex);
      }

      if (floyd) {
        const quantized = (levelIndex + 0.5) * levelStep;
        floyd.diffuse(x, glyphValue - quantized);
      }

      plain += ch;

      if (ch === ' ') continue;

      if (!uniformColor) {
        ctx2d.fillStyle = getDisplayColor(r, g, b, average);
      }

      ctx2d.fillText(ch, x * cw + cw / 2, y * chH + chH / 2);
    }

    if (floyd) floyd.nextRow();

    plain += '\n';
  }

  plainTextOutput = plain;
}


function drawBrailleMode() {

  const w = cols * 2, h = rows * 4;
  const sample = sampleMedia(w, h);
  const px = sample.pixels;

  const dotBits = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
  const uniformColor = (colorSource === 'solid' && !hueBased) ? solidColor : null;

  const audioBoost = audioEnabled ? audioSmoothed * audioSensitivity * 80 : 0;
  const floyd = ditherMethod === 'floyd' ? createFloydDither(w) : null;
  const levelStep = 255 / 2;

  // Pass 1: raster-order dark/light dot bitmap over the full w x h dot grid.
  // This has to be a separate raster-order pass because the cell-assembly
  // loop below visits dots column-major within each 2x4 character cell,
  // which is not raster order and would break Floyd-Steinberg diffusion.
  const darkDots = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      const idx = (x + y * w) * 4;
      let r = px[idx], g = px[idx + 1], b = px[idx + 2];

      if (posterizeLevels > 0) {
        r = posterizeChannel(r);
        g = posterizeChannel(g);
        b = posterizeChannel(b);
      }

      let gray = computeGray(r, g, b);
      gray += brightnessValue + audioBoost;
      gray = constrain((gray - 128) * contrastValue + 128, 0, 255);
      if (invertEnabled) gray = 255 - gray;

      let ditherVal = gray;
      if (ditherMethod === 'ordered') {
        ditherVal = constrain(gray + orderedDitherOffset(x, y, levelStep), 0, 255);
      } else if (ditherMethod === 'floyd') {
        ditherVal = constrain(gray + floyd.errorAt(x), 0, 255);
      }

      const isDark = ditherVal < thresholdValue;
      darkDots[x + y * w] = isDark ? 1 : 0;

      if (floyd) {
        floyd.diffuse(x, ditherVal - (isDark ? 0 : 255));
      }
    }

    if (floyd) floyd.nextRow();
  }

  clearFrame();
  ctx2d.font = `${charSizePx}px ${fontFamily}`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  if (uniformColor) ctx2d.fillStyle = uniformColor;

  const cw = width / cols;
  const chH = height / rows;

  let plain = '';

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {

      let code = 0x2800;
      let sumR = 0, sumG = 0, sumB = 0, count = 0;

      for (let sx = 0; sx < 2; sx++) {
        for (let sy = 0; sy < 4; sy++) {

          const px_x = cx * 2 + sx, px_y = cy * 4 + sy;
          const idx = (px_x + px_y * w) * 4;

          let r = px[idx], g = px[idx + 1], b = px[idx + 2];

          if (posterizeLevels > 0) {
            r = posterizeChannel(r);
            g = posterizeChannel(g);
            b = posterizeChannel(b);
          }

          const bitIndex = sx * 4 + sy;
          if (darkDots[px_x + px_y * w]) code |= dotBits[bitIndex];

          sumR += r; sumG += g; sumB += b; count++;
        }
      }

      const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
      const avgGray = computeGray(avgR, avgG, avgB);
      const ch = String.fromCharCode(code);

      plain += ch;

      if (!uniformColor) {
        ctx2d.fillStyle = getDisplayColor(avgR, avgG, avgB, avgGray);
      }

      ctx2d.fillText(ch, cx * cw + cw / 2, cy * chH + chH / 2);
    }

    plain += '\n';
  }

  plainTextOutput = plain;
}


function processPixelColor(px, idx) {

  let r = px[idx], g = px[idx + 1], b = px[idx + 2];

  if (posterizeLevels > 0) {
    r = posterizeChannel(r);
    g = posterizeChannel(g);
    b = posterizeChannel(b);
  }

  const audioBoost = audioEnabled ? audioSmoothed * audioSensitivity * 80 : 0;

  const gray = computeGray(r, g, b);
  let average = gray + brightnessValue + audioBoost;
  average = constrain((average - 128) * contrastValue + 128, 0, 255);
  if (invertEnabled) average = 255 - average;

  if (!hueBased && colorSource === 'grayscale') {
    return `rgb(${Math.round(average)},${Math.round(average)},${Math.round(average)})`;
  }

  return getDisplayColor(r, g, b, average);
}


function drawHalfBlockMode() {

  const w = cols, h = rows * 2;
  const sample = sampleMedia(w, h);
  const px = sample.pixels;

  clearFrame();

  const cw = width / cols;
  const chH = height / rows;
  const halfH = chH / 2;

  let plain = '';

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < w; cx++) {

      const topIdx = (cx + (cy * 2) * w) * 4;
      const botIdx = (cx + (cy * 2 + 1) * w) * 4;

      ctx2d.fillStyle = processPixelColor(px, topIdx);
      ctx2d.fillRect(cx * cw, cy * chH, cw, halfH);

      ctx2d.fillStyle = processPixelColor(px, botIdx);
      ctx2d.fillRect(cx * cw, cy * chH + halfH, cw, halfH);

      plain += '▀';
    }

    plain += '\n';
  }

  plainTextOutput = plain;
}


function setupMatrixCols() {
  matrixCols = new Array(cols).fill(0).map(() => ({
    y: Math.random() * rows,
    speed: 0.3 + Math.random() * 0.7
  }));
}


function matrixColumnColor(r, g, b, bright01) {

  if (hueBased) {
    const { h, s } = rgbToHueSat(r, g, b);
    return `hsl(${h},${s}%,50%)`;
  }

  switch (colorSource) {
    case 'solid': return solidColor;
    case 'color': return `rgb(${r},${g},${b})`;
    case 'gradient': return gradientColorFor(bright01 * 255);
    case 'amber': return `rgb(${Math.round(bright01 * 255)},${Math.round(bright01 * 150)},0)`;
    case 'blue': return `rgb(0,${Math.round(bright01 * 180)},${Math.round(bright01 * 255)})`;
    case 'rainbow': return `hsl(${Math.round(map(bright01, 0, 1, 0, 300))},80%,55%)`;
    default:
      return `rgb(${Math.round(bright01 * 80)},${Math.round(80 + bright01 * 175)},${Math.round(bright01 * 80)})`;
  }
}


function drawMatrixMode() {

  if (matrixCols.length !== cols) setupMatrixCols();

  const w = cols, h = rows;
  const sample = sampleMedia(w, h);
  const px = sample.pixels;

  ctx2d.fillStyle = hexToRgba(backgroundColor, 0.16);
  ctx2d.fillRect(0, 0, width, height);

  ctx2d.font = `${charSizePx}px ${fontFamily}`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';

  const cw = width / cols;
  const chH = height / rows;

  for (let cx = 0; cx < w; cx++) {

    const col = matrixCols[cx];
    const sampleY = Math.floor(col.y) % h;
    const sy = ((sampleY % h) + h) % h;
    const idx = (cx + sy * w) * 4;

    const r = px[idx], g = px[idx + 1], b = px[idx + 2];
    const gray = computeGray(r, g, b);
    const bright01 = constrain(gray / 255, 0, 1);

    col.speed = 0.2 + bright01 * 1.5;
    col.y += col.speed;
    if (col.y > h + Math.random() * 20) {
      col.y = -Math.random() * 10;
    }

    if (!paused) {
      col.lastChar = matrixChars.charAt(Math.floor(Math.random() * matrixChars.length));
    } else if (!col.lastChar) {
      col.lastChar = matrixChars.charAt(0);
    }

    ctx2d.fillStyle = matrixColumnColor(r, g, b, bright01);
    ctx2d.fillText(col.lastChar, cx * cw + cw / 2, col.y * chH);
  }

  plainTextOutput = '';
}


// =========================================================
// Font / sizing
// =========================================================

function applyFontAndSize() {
  resizeMainCanvas();
}


function updateModeVisibility() {

  if (outputWrapperElt) {
    outputWrapperElt.classList.toggle('terminal-crt', renderMode === 'ansi');
  }

  if (mainCanvas) {
    mainCanvas.elt.style.filter = (renderMode === 'ansi')
      ? 'drop-shadow(0 0 2px rgba(120,255,150,0.65))'
      : '';
  }

  requestFit();
}


// =========================================================
// Source switching
// =========================================================

function switchSource(newSource) {

  if (isRecording) stopRecording();

  mediaSource = newSource;

  // Mirroring makes sense for the webcam (like a real mirror); uploaded
  // media and the text banner should show as given by default.
  mirror = newSource === 'webcam';
  if (uiRefs.mirrorCheckbox) uiRefs.mirrorCheckbox.checked = mirror;

  if (newSource === 'webcam') {

    if (!capture) {
      capture = createCapture(VIDEO);
      capture.size(640, 480);
      capture.hide();
    }
    currentMedia = capture;

  } else if (newSource === 'image') {

    currentMedia = uploadedImage || null;

  } else if (newSource === 'video') {

    currentMedia = uploadedVideo || null;

  } else if (newSource === 'text') {

    if (!textBannerGfx) regenerateTextBanner();
    currentMedia = textBannerGfx;
  }
}


function regenerateTextBanner() {

  const w = 1000, h = 500;

  if (!textBannerGfx) textBannerGfx = createGraphics(w, h);

  const gfx = textBannerGfx;
  const text = bannerText.length ? bannerText : ' ';
  const t = millis() / 1000 * bannerAnimSpeed;

  gfx.background(0);
  gfx.textAlign(CENTER, CENTER);
  gfx.textFont(bannerFontFamily);
  gfx.textStyle(bannerBold ? BOLD : NORMAL);

  if (bannerOutline) {
    gfx.noFill();
    gfx.stroke(255);
    gfx.strokeWeight(4);
  } else {
    gfx.noStroke();
    gfx.fill(255);
  }

  switch (bannerAnimation) {

    case 'scroll': {
      gfx.textSize(140);
      const tw = gfx.textWidth(text);
      const cycle = w + tw;
      const x = w - ((t * 320) % cycle);
      gfx.text(text, x, h / 2);
      break;
    }

    case 'pulse': {
      const scale = 1 + Math.sin(t * 3) * 0.18;
      gfx.push();
      gfx.translate(w / 2, h / 2);
      gfx.scale(scale);
      gfx.textSize(120);
      gfx.text(text, 0, 0);
      gfx.pop();
      break;
    }

    case 'wave': {
      gfx.textSize(120);
      const totalW = gfx.textWidth(text);
      let x = w / 2 - totalW / 2;
      for (const ch of text) {
        const chW = gfx.textWidth(ch);
        const y = h / 2 + Math.sin(t * 4 + x * 0.02) * 34;
        gfx.text(ch, x + chW / 2, y);
        x += chW;
      }
      break;
    }

    case 'typewriter': {
      gfx.textSize(120);
      const holdFrames = 20;
      const cycle = text.length + holdFrames;
      const revealCount = Math.floor(t * 6) % cycle;
      const shown = text.substring(0, Math.min(revealCount, text.length));
      gfx.text(shown, 0, 0, w, h);
      break;
    }

    default:
      gfx.textSize(120);
      gfx.text(text, 0, 0, w, h);
  }
}


function loadImageFile(file) {

  const url = URL.createObjectURL(file);

  loadImage(url, (img) => {
    uploadedImage = img;
    switchSource('image');
    if (uiRefs.sourceSelect) uiRefs.sourceSelect.value = 'image';
    updateSourceUI();
  });
}


function loadVideoFileObj(file) {

  const url = URL.createObjectURL(file);

  if (uploadedVideo) {
    uploadedVideo.remove();
    uploadedVideo = null;
  }

  uploadedVideo = createVideo(url, () => {
    uploadedVideo.loop();
    uploadedVideo.volume(0);
  });
  uploadedVideo.hide();

  switchSource('video');
  if (uiRefs.sourceSelect) uiRefs.sourceSelect.value = 'video';
  updateSourceUI();
}


function updateSourceUI() {
  if (uiRefs.imageFileInput) uiRefs.imageFileInput.closest('.field').style.display = mediaSource === 'image' ? '' : 'none';
  if (uiRefs.videoFileInput) uiRefs.videoFileInput.closest('.field').style.display = mediaSource === 'video' ? '' : 'none';
  if (uiRefs.bannerControlsGroup) uiRefs.bannerControlsGroup.style.display = mediaSource === 'text' ? '' : 'none';
}


function setupDragDrop() {

  const bodyElt = document.body;

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    bodyElt.classList.add('drag-active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.target === document || e.target === bodyElt) {
      bodyElt.classList.remove('drag-active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    bodyElt.classList.remove('drag-active');

    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      loadImageFile(file);
    } else if (file.type.startsWith('video/')) {
      loadVideoFileObj(file);
    }
  });
}


// =========================================================
// Controls wiring
// =========================================================

function captureDefaults() {
  defaults = {
    cols, aspectRatio, charSizePx, fps,
    density, densityReversed, renderMode,
    grayscaleMethod, invertEnabled, thresholdEnabled, thresholdValue,
    posterizeLevels, edgeDetectionEnabled, hueBased, pixelation,
    blurAmount, sharpenAmount, brightnessValue, contrastValue,
    colorSource, solidColor, gradientColor1, gradientColor2, gradientColor3,
    backgroundColor, ditherMethod, trailEnabled, trailAmount,
    audioSensitivity, bannerText, bannerFontFamily, bannerBold, bannerOutline,
    bannerAnimation, bannerAnimSpeed, fontFamily, mirror
  };
}


function resetAll() {

  cols = defaults.cols;
  aspectRatio = defaults.aspectRatio;
  rows = Math.floor(cols * aspectRatio);
  charSizePx = defaults.charSizePx;
  fps = defaults.fps;
  density = defaults.density;
  densityReversed = defaults.densityReversed;
  renderMode = defaults.renderMode;
  grayscaleMethod = defaults.grayscaleMethod;
  invertEnabled = defaults.invertEnabled;
  thresholdEnabled = defaults.thresholdEnabled;
  thresholdValue = defaults.thresholdValue;
  posterizeLevels = defaults.posterizeLevels;
  edgeDetectionEnabled = defaults.edgeDetectionEnabled;
  hueBased = defaults.hueBased;
  pixelation = defaults.pixelation;
  blurAmount = defaults.blurAmount;
  sharpenAmount = defaults.sharpenAmount;
  brightnessValue = defaults.brightnessValue;
  contrastValue = defaults.contrastValue;
  colorSource = defaults.colorSource;
  solidColor = defaults.solidColor;
  gradientColor1 = defaults.gradientColor1;
  gradientColor2 = defaults.gradientColor2;
  gradientColor3 = defaults.gradientColor3;
  backgroundColor = defaults.backgroundColor;
  ditherMethod = defaults.ditherMethod;
  trailEnabled = defaults.trailEnabled;
  trailAmount = defaults.trailAmount;
  audioSensitivity = defaults.audioSensitivity;
  bannerText = defaults.bannerText;
  bannerFontFamily = defaults.bannerFontFamily;
  bannerBold = defaults.bannerBold;
  bannerOutline = defaults.bannerOutline;
  bannerAnimation = defaults.bannerAnimation;
  bannerAnimSpeed = defaults.bannerAnimSpeed;
  fontFamily = defaults.fontFamily;
  mirror = defaults.mirror;
  paused = false;

  disableAudio();
  if (isGifRecording) stopGifCapture();

  syncUIFromState();
  applyFontAndSize();
  applyBackgroundColor();
  updateColorUI();
  updateModeVisibility();
  setupMatrixCols();
  regenerateTextBanner();
  switchSource('webcam');
}


function syncUIFromState() {

  const u = uiRefs;

  u.densitySelect.value = density;
  u.densityInput.value = density;
  u.reverseDensityCheckbox.checked = densityReversed;
  u.modeSelect.value = renderMode;

  u.resolutionSlider.value = cols;
  u.resolutionValue.textContent = cols;
  u.aspectSlider.value = aspectRatio;
  u.aspectValue.textContent = aspectRatio;
  u.charSizeSlider.value = charSizePx;
  u.charSizeValue.textContent = charSizePx;
  u.fpsSlider.value = fps;
  u.fpsValue.textContent = fps;

  u.colorSourceSelect.value = colorSource;
  u.backgroundColorPicker.value = backgroundColor;
  u.solidColorPicker.value = solidColor;
  u.gradientColor1Picker.value = gradientColor1;
  u.gradientColor2Picker.value = gradientColor2;
  u.gradientColor3Picker.value = gradientColor3;
  u.grayscaleMethodSelect.value = grayscaleMethod;

  u.brightnessSlider.value = brightnessValue;
  u.brightnessValue.textContent = brightnessValue;
  u.contrastSlider.value = contrastValue;
  u.contrastValue.textContent = contrastValue;
  u.invertCheckbox.checked = invertEnabled;
  u.thresholdCheckbox.checked = thresholdEnabled;
  u.thresholdSlider.value = thresholdValue;
  u.thresholdValue.textContent = thresholdValue;
  u.posterizeSlider.value = posterizeLevels;
  u.posterizeValue.textContent = posterizeLevels;
  u.edgeDetectionCheckbox.checked = edgeDetectionEnabled;
  u.hueBasedCheckbox.checked = hueBased;
  u.ditherSelect.value = ditherMethod;
  u.pixelationSlider.value = pixelation;
  u.pixelationValue.textContent = pixelation;
  u.blurSlider.value = blurAmount;
  u.blurValue.textContent = blurAmount;
  u.sharpenSlider.value = sharpenAmount;
  u.sharpenValue.textContent = sharpenAmount;
  u.trailCheckbox.checked = trailEnabled;
  u.trailAmountSlider.value = trailAmount;
  u.trailAmountValue.textContent = trailAmount.toFixed(2);
  u.mirrorCheckbox.checked = mirror;

  u.audioReactiveCheckbox.checked = false;
  u.audioSensitivitySlider.value = audioSensitivity;
  u.audioSensitivityValue.textContent = audioSensitivity.toFixed(1);

  u.bannerTextInput.value = bannerText;
  u.bannerFontSelect.value = bannerFontFamily;
  u.bannerBoldCheckbox.checked = bannerBold;
  u.bannerOutlineCheckbox.checked = bannerOutline;
  u.bannerAnimationSelect.value = bannerAnimation;
  u.bannerAnimSpeedSlider.value = bannerAnimSpeed;
  u.bannerAnimSpeedValue.textContent = bannerAnimSpeed.toFixed(1);

  u.fontSelect.value = fontFamily;

  u.sourceSelect.value = 'webcam';
  updateSourceUI();

  u.pauseBtn.textContent = 'Pause';
}


function setupControls() {

  const $ = (id) => document.getElementById(id);

  uiRefs = {
    sourceSelect: $('sourceSelect'),
    imageFileInput: $('imageFileInput'),
    videoFileInput: $('videoFileInput'),
    bannerTextInput: $('bannerTextInput'),

    densitySelect: $('densitySelect'),
    densityInput: $('densityInput'),
    reverseDensityCheckbox: $('reverseDensityCheckbox'),
    randomizeDensityBtn: $('randomizeDensityBtn'),
    modeSelect: $('modeSelect'),

    resolutionSlider: $('resolutionSlider'),
    resolutionValue: $('resolutionValue'),
    aspectSlider: $('aspectSlider'),
    aspectValue: $('aspectValue'),
    charSizeSlider: $('charSizeSlider'),
    charSizeValue: $('charSizeValue'),
    fpsSlider: $('fpsSlider'),
    fpsValue: $('fpsValue'),

    colorSourceSelect: $('colorSourceSelect'),
    backgroundColorPicker: $('backgroundColorPicker'),
    solidColorGroup: $('solidColorGroup'),
    solidColorPicker: $('solidColorPicker'),
    gradientColorGroup: $('gradientColorGroup'),
    gradientColor1Picker: $('gradientColor1Picker'),
    gradientColor2Picker: $('gradientColor2Picker'),
    gradientColor3Picker: $('gradientColor3Picker'),
    grayscaleMethodSelect: $('grayscaleMethodSelect'),

    brightnessSlider: $('brightnessSlider'),
    brightnessValue: $('brightnessValue'),
    contrastSlider: $('contrastSlider'),
    contrastValue: $('contrastValue'),
    invertCheckbox: $('invertCheckbox'),
    thresholdCheckbox: $('thresholdCheckbox'),
    thresholdSlider: $('thresholdSlider'),
    thresholdValue: $('thresholdValue'),
    posterizeSlider: $('posterizeSlider'),
    posterizeValue: $('posterizeValue'),
    edgeDetectionCheckbox: $('edgeDetectionCheckbox'),
    hueBasedCheckbox: $('hueBasedCheckbox'),
    ditherSelect: $('ditherSelect'),
    pixelationSlider: $('pixelationSlider'),
    pixelationValue: $('pixelationValue'),
    blurSlider: $('blurSlider'),
    blurValue: $('blurValue'),
    sharpenSlider: $('sharpenSlider'),
    sharpenValue: $('sharpenValue'),
    trailCheckbox: $('trailCheckbox'),
    trailAmountSlider: $('trailAmountSlider'),
    trailAmountValue: $('trailAmountValue'),
    mirrorCheckbox: $('mirrorCheckbox'),

    audioReactiveCheckbox: $('audioReactiveCheckbox'),
    audioSensitivitySlider: $('audioSensitivitySlider'),
    audioSensitivityValue: $('audioSensitivityValue'),

    fontSelect: $('fontSelect'),

    screenshotBtn: $('screenshotBtn'),
    copyBtn: $('copyBtn'),
    downloadBtn: $('downloadBtn'),
    recordBtn: $('recordBtn'),
    gifBtn: $('gifBtn'),
    fullscreenBtn: $('fullscreenBtn'),
    pauseBtn: $('pauseBtn'),
    resetBtn: $('resetBtn'),

    toggleControlsBtn: $('toggleControlsBtn'),
    controlsPanel: $('controls'),

    bannerControlsGroup: $('bannerControlsGroup'),
    bannerFontSelect: $('bannerFontSelect'),
    bannerBoldCheckbox: $('bannerBoldCheckbox'),
    bannerOutlineCheckbox: $('bannerOutlineCheckbox'),
    bannerAnimationSelect: $('bannerAnimationSelect'),
    bannerAnimSpeedSlider: $('bannerAnimSpeedSlider'),
    bannerAnimSpeedValue: $('bannerAnimSpeedValue')
  };

  const u = uiRefs;

  // ---- Source ----

  u.sourceSelect.addEventListener('change', () => {
    const val = u.sourceSelect.value;
    switchSource(val);
    updateSourceUI();
  });

  u.imageFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImageFile(file);
  });

  u.videoFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadVideoFileObj(file);
  });

  u.bannerTextInput.addEventListener('input', () => {
    bannerText = u.bannerTextInput.value;
    regenerateTextBanner();
  });

  u.bannerFontSelect.addEventListener('change', () => {
    bannerFontFamily = u.bannerFontSelect.value;
    regenerateTextBanner();
  });

  u.bannerBoldCheckbox.addEventListener('change', () => {
    bannerBold = u.bannerBoldCheckbox.checked;
    regenerateTextBanner();
  });

  u.bannerOutlineCheckbox.addEventListener('change', () => {
    bannerOutline = u.bannerOutlineCheckbox.checked;
    regenerateTextBanner();
  });

  u.bannerAnimationSelect.addEventListener('change', () => {
    bannerAnimation = u.bannerAnimationSelect.value;
    regenerateTextBanner();
  });

  u.bannerAnimSpeedSlider.addEventListener('input', () => {
    bannerAnimSpeed = parseFloat(u.bannerAnimSpeedSlider.value);
    u.bannerAnimSpeedValue.textContent = bannerAnimSpeed.toFixed(1);
  });

  updateSourceUI();

  // ---- Density ----

  u.densitySelect.addEventListener('change', () => {
    u.densityInput.value = u.densitySelect.value;
    density = u.densitySelect.value;
  });

  u.densityInput.addEventListener('input', () => {
    density = u.densityInput.value.length ? u.densityInput.value : ' ';
    u.densitySelect.value = "";
  });

  u.reverseDensityCheckbox.addEventListener('change', () => {
    densityReversed = u.reverseDensityCheckbox.checked;
  });

  u.randomizeDensityBtn.addEventListener('click', () => {
    const pool = " .:-=+*#%@█▓▒░●○•·|/\\";
    const len = 4 + Math.floor(Math.random() * 8);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += pool.charAt(Math.floor(Math.random() * pool.length));
    }
    out += ' ';
    density = out;
    u.densityInput.value = out;
    u.densitySelect.value = "";
  });

  u.modeSelect.addEventListener('change', () => {
    renderMode = u.modeSelect.value;
    updateModeVisibility();
  });

  // ---- Resolution & size ----

  u.resolutionSlider.addEventListener('input', () => {
    cols = parseInt(u.resolutionSlider.value);
    rows = Math.max(1, Math.floor(cols * aspectRatio));
    u.resolutionValue.textContent = cols;
    resizeMainCanvas();
    setupMatrixCols();
  });

  u.aspectSlider.addEventListener('input', () => {
    aspectRatio = parseFloat(u.aspectSlider.value);
    rows = Math.max(1, Math.floor(cols * aspectRatio));
    u.aspectValue.textContent = aspectRatio.toFixed(2);
    resizeMainCanvas();
  });

  u.charSizeSlider.addEventListener('input', () => {
    charSizePx = parseInt(u.charSizeSlider.value);
    u.charSizeValue.textContent = charSizePx;
    applyFontAndSize();
  });

  u.fpsSlider.addEventListener('input', () => {
    fps = parseInt(u.fpsSlider.value);
    u.fpsValue.textContent = fps;
    frameRate(fps);
  });

  // ---- Color ----

  u.colorSourceSelect.addEventListener('change', () => {
    colorSource = u.colorSourceSelect.value;
    updateColorUI();
  });

  u.backgroundColorPicker.addEventListener('input', () => {
    backgroundColor = u.backgroundColorPicker.value;
    applyBackgroundColor();
  });

  u.solidColorPicker.addEventListener('input', () => {
    solidColor = u.solidColorPicker.value;
  });

  u.gradientColor1Picker.addEventListener('input', () => {
    gradientColor1 = u.gradientColor1Picker.value;
  });

  u.gradientColor2Picker.addEventListener('input', () => {
    gradientColor2 = u.gradientColor2Picker.value;
  });

  u.gradientColor3Picker.addEventListener('input', () => {
    gradientColor3 = u.gradientColor3Picker.value;
  });

  u.grayscaleMethodSelect.addEventListener('change', () => {
    grayscaleMethod = u.grayscaleMethodSelect.value;
  });

  updateColorUI();

  // ---- Image processing ----

  u.brightnessSlider.addEventListener('input', () => {
    brightnessValue = parseInt(u.brightnessSlider.value);
    u.brightnessValue.textContent = brightnessValue;
  });

  u.contrastSlider.addEventListener('input', () => {
    contrastValue = parseFloat(u.contrastSlider.value);
    u.contrastValue.textContent = contrastValue.toFixed(1);
  });

  u.invertCheckbox.addEventListener('change', () => {
    invertEnabled = u.invertCheckbox.checked;
  });

  u.thresholdCheckbox.addEventListener('change', () => {
    thresholdEnabled = u.thresholdCheckbox.checked;
  });

  u.thresholdSlider.addEventListener('input', () => {
    thresholdValue = parseInt(u.thresholdSlider.value);
    u.thresholdValue.textContent = thresholdValue;
  });

  u.posterizeSlider.addEventListener('input', () => {
    posterizeLevels = parseInt(u.posterizeSlider.value);
    u.posterizeValue.textContent = posterizeLevels;
  });

  u.edgeDetectionCheckbox.addEventListener('change', () => {
    edgeDetectionEnabled = u.edgeDetectionCheckbox.checked;
  });

  u.hueBasedCheckbox.addEventListener('change', () => {
    hueBased = u.hueBasedCheckbox.checked;
  });

  u.ditherSelect.addEventListener('change', () => {
    ditherMethod = u.ditherSelect.value;
  });

  u.pixelationSlider.addEventListener('input', () => {
    pixelation = parseInt(u.pixelationSlider.value);
    u.pixelationValue.textContent = pixelation;
  });

  u.blurSlider.addEventListener('input', () => {
    blurAmount = parseFloat(u.blurSlider.value);
    u.blurValue.textContent = blurAmount;
  });

  u.sharpenSlider.addEventListener('input', () => {
    sharpenAmount = parseFloat(u.sharpenSlider.value);
    u.sharpenValue.textContent = sharpenAmount;
  });

  u.trailCheckbox.addEventListener('change', () => {
    trailEnabled = u.trailCheckbox.checked;
  });

  u.trailAmountSlider.addEventListener('input', () => {
    trailAmount = parseFloat(u.trailAmountSlider.value);
    u.trailAmountValue.textContent = trailAmount.toFixed(2);
  });

  u.mirrorCheckbox.addEventListener('change', () => {
    mirror = u.mirrorCheckbox.checked;
  });

  // ---- Audio reactive ----

  u.audioReactiveCheckbox.addEventListener('change', () => {
    if (u.audioReactiveCheckbox.checked) {
      enableAudio();
    } else {
      disableAudio();
    }
  });

  u.audioSensitivitySlider.addEventListener('input', () => {
    audioSensitivity = parseFloat(u.audioSensitivitySlider.value);
    u.audioSensitivityValue.textContent = audioSensitivity.toFixed(1);
  });

  // ---- Font ----

  u.fontSelect.addEventListener('change', () => {
    fontFamily = u.fontSelect.value;
    applyFontAndSize();
  });

  // ---- Actions ----

  u.screenshotBtn.addEventListener('click', () => {
    mainCanvas.elt.toBlob((blob) => {
      downloadBlob(blob, `ascii-art-${Date.now()}.png`);
    });
  });

  u.copyBtn.addEventListener('click', () => {
    if (!plainTextOutput) return;
    navigator.clipboard.writeText(plainTextOutput).catch(() => {});
  });

  u.recordBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  u.gifBtn.addEventListener('click', () => {
    if (isGifRecording) {
      stopGifCapture();
    } else {
      startGifCapture();
    }
  });

  u.downloadBtn.addEventListener('click', () => {
    if (!plainTextOutput) return;
    const blob = new Blob([plainTextOutput], { type: 'text/plain' });
    downloadBlob(blob, `ascii-art-${Date.now()}.txt`);
  });

  u.fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      outputWrapperElt.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  u.pauseBtn.addEventListener('click', () => {
    paused = !paused;
    u.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  });

  u.resetBtn.addEventListener('click', () => {
    resetAll();
  });

  // ---- Panel visibility ----

  u.toggleControlsBtn.addEventListener('click', () => {
    u.controlsPanel.classList.toggle('hidden');
    requestFit();
    setTimeout(requestFit, 250);
  });

  window.addEventListener('resize', requestFit);
  document.addEventListener('fullscreenchange', requestFit);
}


function updateColorUI() {
  if (uiRefs.solidColorGroup) uiRefs.solidColorGroup.style.display = colorSource === 'solid' ? 'block' : 'none';
  if (uiRefs.gradientColorGroup) uiRefs.gradientColorGroup.style.display = colorSource === 'gradient' ? 'block' : 'none';
}


function enableAudio() {

  if (mic) {
    mic.start();
    audioEnabled = true;
    return;
  }

  try {
    mic = new p5.AudioIn();
    mic.start(
      () => { audioEnabled = true; },
      () => {
        alert('Microphone access failed or was denied.');
        audioEnabled = false;
        if (uiRefs.audioReactiveCheckbox) uiRefs.audioReactiveCheckbox.checked = false;
      }
    );
  } catch (e) {
    alert('Audio input is not supported in this browser.');
    if (uiRefs.audioReactiveCheckbox) uiRefs.audioReactiveCheckbox.checked = false;
  }
}


function disableAudio() {
  audioEnabled = false;
  if (mic) mic.stop();
  audioSmoothed = 0;
}
