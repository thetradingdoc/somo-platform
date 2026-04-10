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

