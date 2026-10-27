import { env } from '../../config/env';
import { notConfigured } from '../../lib/errors';

/** OCR for PNG/JPEG using tesseract.js (optional dependency; downloads language data on first use). */
export async function ocrImage(buffer: Buffer): Promise<string> {
  if (!env.OCR_ENABLED) throw notConfigured('OCR is not enabled. Set OCR_ENABLED=1 and make sure the optional package tesseract.js is installed.');
  let tesseract: any;
  try { tesseract = require('tesseract.js'); } catch { throw notConfigured('tesseract.js is not installed.'); }
  const worker = await tesseract.createWorker('eng');
  try { const { data } = await worker.recognize(buffer); return data.text as string; }
  finally { await worker.terminate(); }
}
