"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ocrImage = ocrImage;
const env_1 = require("../../config/env");
const errors_1 = require("../../lib/errors");
/** OCR for PNG/JPEG using tesseract.js (optional dependency; downloads language data on first use). */
async function ocrImage(buffer) {
    if (!env_1.env.OCR_ENABLED)
        throw (0, errors_1.notConfigured)('OCR is not enabled. Set OCR_ENABLED=1 and make sure the optional package tesseract.js is installed.');
    let tesseract;
    try {
        tesseract = require('tesseract.js');
    }
    catch {
        throw (0, errors_1.notConfigured)('tesseract.js is not installed.');
    }
    const worker = await tesseract.createWorker('eng');
    try {
        const { data } = await worker.recognize(buffer);
        return data.text;
    }
    finally {
        await worker.terminate();
    }
}
//# sourceMappingURL=ocr.js.map