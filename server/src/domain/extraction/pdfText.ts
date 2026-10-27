// PDF text-layer extraction using pdfjs-dist's CommonJS build. No OCR here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = require('pdfjs-dist/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group text items into visual lines by their y coordinate.
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) || []), { x: it.transform[4], s: it.str }]);
    }
    const ys = Array.from(rows.keys()).sort((a, b) => b - a);
    pages.push(ys.map((y) => rows.get(y)!.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ')).join('\n'));
  }
  const n = doc.numPages;
  await doc.destroy();
  return { text: pages.join('\n'), pages: n };
}
