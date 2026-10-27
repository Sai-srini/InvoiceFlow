/**
 * Runs the invoice extractor over samples/invoices/*.pdf and compares with samples/invoices/<name>.expected.json
 * (you write the expected values by hand). Prints per-field accuracy. With no samples it says so and exits 0.
 *   npm run extraction:accuracy
 */
import fs from 'fs'; import path from 'path';
import { extractPdfText } from '../domain/extraction/pdfText';
import { parseInvoiceText, compareWithExpected } from '../domain/extraction/parsers';

async function main() {
  const dir = path.resolve(__dirname, '../../../samples/invoices');
  const pdfs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  if (!pdfs.length) { console.log(`No PDFs in ${dir}. Add redacted real invoices plus <name>.expected.json files to measure accuracy.`); return; }
  const tally: Record<string, { ok: number; n: number }> = {}; let skipped = 0;
  for (const f of pdfs) {
    const exp = path.join(dir, f.replace(/\.pdf$/i, '.expected.json'));
    if (!fs.existsSync(exp)) { skipped++; console.log(`- ${f}: no expected file, skipped`); continue; }
    const { text } = await extractPdfText(fs.readFileSync(path.join(dir, f)));
    const rows = compareWithExpected(parseInvoiceText(text), JSON.parse(fs.readFileSync(exp, 'utf8')));
    for (const r of rows) { const t = (tally[r.field] ||= { ok: 0, n: 0 }); t.n++; if (r.ok) t.ok++; else console.log(`  ${f}: ${r.field} expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.got)}`); }
  }
  console.log('\nPer-field accuracy:'); for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(18)} ${t.ok}/${t.n} (${Math.round((t.ok / t.n) * 100)}%)`);
  if (skipped) console.log(`${skipped} file(s) skipped (no expected JSON).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
