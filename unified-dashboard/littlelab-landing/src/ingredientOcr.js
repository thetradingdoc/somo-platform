import { createWorker } from 'tesseract.js';

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      return worker;
    })();
  }
  return workerPromise;
}

export async function extractIngredientsFromImage(file) {
  if (!file) throw new Error('image_required');
  const worker = await getWorker();
  const { data } = await worker.recognize(file);
  const text = String(data?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw new Error('ocr_empty');
  return text.slice(0, 3000);
}

/** Slightly higher JPEG quality for small text on labels (cost: a few KB). */
const LABEL_JPEG_QUALITY = 0.88;

/**
 * Grab one JPEG frame from the live camera for label OCR when barcode lookup fails upstream.
 * Downscales so Tesseract stays responsive on mobile.
 */
export async function captureVideoFrameAsJpegFile(video, maxSide = 1280) {
  if (typeof document === 'undefined' || !video || video.readyState < 2) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w < 8 || h < 8) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(8, Math.round(w * scale));
  const ch = Math.max(8, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h, 0, 0, cw, ch);
  } catch (_) {
    return null;
  }
  return await new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(null);
        resolve(new File([blob], 'scan-label.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      LABEL_JPEG_QUALITY
    );
  });
}

/**
 * Full frame + lower “ingredients band” (typical phone framing: barcode upper, INCI below).
 * Accuracy-first: run OCR on the band first; full frame as backup (see extractBestLabelTextFromVideoOrFile).
 */
export async function captureFrameVariantsAsJpegFiles(video, maxSide = 1280) {
  if (typeof document === 'undefined' || !video || video.readyState < 2) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w < 8 || h < 8) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(8, Math.round(w * scale));
  const ch = Math.max(8, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h, 0, 0, cw, ch);
  } catch (_) {
    return null;
  }

  const fullBlob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', LABEL_JPEG_QUALITY);
  });
  if (!fullBlob) return null;

  const bandStartY = Math.floor(ch * 0.38);
  const bandH = Math.max(32, ch - bandStartY);
  const bandCanvas = document.createElement('canvas');
  bandCanvas.width = cw;
  bandCanvas.height = bandH;
  const bctx = bandCanvas.getContext('2d');
  if (!bctx) {
    return { full: new File([fullBlob], 'scan-full.jpg', { type: 'image/jpeg' }), lowerBand: null };
  }
  try {
    bctx.drawImage(canvas, 0, bandStartY, cw, bandH, 0, 0, cw, bandH);
  } catch (_) {
    return { full: new File([fullBlob], 'scan-full.jpg', { type: 'image/jpeg' }), lowerBand: null };
  }
  const bandBlob = await new Promise((resolve) => {
    bandCanvas.toBlob((b) => resolve(b), 'image/jpeg', LABEL_JPEG_QUALITY);
  });
  const lowerBand = bandBlob ? new File([bandBlob], 'scan-label-band.jpg', { type: 'image/jpeg' }) : null;

  return {
    full: new File([fullBlob], 'scan-full.jpg', { type: 'image/jpeg' }),
    lowerBand
  };
}

function normalizeOcrText(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ingredientLikeScore(text) {
  const t = String(text || '');
  if (t.length < 12) return 0;
  let s = 0;
  if (/[a-z]{4,}/i.test(t)) s += 15;
  if (/[,;]/.test(t)) s += 25;
  if (/\(/.test(t)) s += 10;
  if (/\b(aqua|water|glycerin|parfum|fragrance|alcohol|acid|oil|extract)\b/i.test(t)) s += 20;
  return Math.min(100, s + Math.min(t.length, 800) / 40);
}

function ocrQualityScore(confidence, text) {
  const c = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  const ing = ingredientLikeScore(text);
  return c * 0.5 + ing * 0.5;
}

/**
 * Barcode-fallback path: accuracy first, cost-conscious (client-only, ≤2 Tesseract runs in the common case).
 * 1) OCR lower band; if strong (length + confidence), return (1 run).
 * 2) Else OCR full frame and pick the better of the two (≤2 runs).
 */
export async function extractBestLabelTextFromVideoOrFile({ video, file }) {
  const worker = await getWorker();

  if (video && video.readyState >= 2 && video.videoWidth >= 8) {
    const variants = await captureFrameVariantsAsJpegFiles(video);
    if (variants?.lowerBand && variants.full) {
      const rBand = await worker.recognize(variants.lowerBand);
      const textBand = normalizeOcrText(rBand?.data?.text);
      const confBand = Number(rBand?.data?.confidence);
      const strongBand =
        textBand.length >= 38 &&
        confBand >= 52 &&
        ingredientLikeScore(textBand) >= 35;

      if (strongBand) {
        return textBand.slice(0, 3000);
      }

      const rFull = await worker.recognize(variants.full);
      const textFull = normalizeOcrText(rFull?.data?.text);
      const confFull = Number(rFull?.data?.confidence);

      const candidates = [
        { text: textBand, conf: confBand },
        { text: textFull, conf: confFull }
      ].filter((x) => x.text.length >= 8);

      if (!candidates.length) throw new Error('ocr_empty');

      let best = candidates[0];
      let bestScore = ocrQualityScore(best.conf, best.text);
      for (let i = 1; i < candidates.length; i++) {
        const sc = ocrQualityScore(candidates[i].conf, candidates[i].text);
        if (sc > bestScore) {
          best = candidates[i];
          bestScore = sc;
        }
      }
      if (!best.text) throw new Error('ocr_empty');
      return best.text.slice(0, 3000);
    }
  }

  if (file) {
    const { data } = await worker.recognize(file);
    const text = normalizeOcrText(data?.text);
    if (!text) throw new Error('ocr_empty');
    return text.slice(0, 3000);
  }

  throw new Error('image_required');
}
