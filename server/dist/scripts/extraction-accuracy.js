"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Runs the invoice extractor over samples/invoices/*.pdf and compares with samples/invoices/<name>.expected.json
 * (you write the expected values by hand). Prints per-field accuracy. With no samples it says so and exits 0.
 *   npm run extraction:accuracy
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdfText_1 = require("../domain/extraction/pdfText");
const parsers_1 = require("../domain/extraction/parsers");
async function main() {
    const dir = path_1.default.resolve(__dirname, '../../../samples/invoices');
    const pdfs = fs_1.default.existsSync(dir) ? fs_1.default.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
    if (!pdfs.length) {
        console.log(`No PDFs in ${dir}. Add redacted real invoices plus <name>.expected.json files to measure accuracy.`);
        return;
    }
    const tally = {};
    let skipped = 0;
    for (const f of pdfs) {
        const exp = path_1.default.join(dir, f.replace(/\.pdf$/i, '.expected.json'));
        if (!fs_1.default.existsSync(exp)) {
            skipped++;
            console.log(`- ${f}: no expected file, skipped`);
            continue;
        }
        const { text } = await (0, pdfText_1.extractPdfText)(fs_1.default.readFileSync(path_1.default.join(dir, f)));
        const rows = (0, parsers_1.compareWithExpected)((0, parsers_1.parseInvoiceText)(text), JSON.parse(fs_1.default.readFileSync(exp, 'utf8')));
        for (const r of rows) {
            const t = (tally[r.field] ||= { ok: 0, n: 0 });
            t.n++;
            if (r.ok)
                t.ok++;
            else
                console.log(`  ${f}: ${r.field} expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.got)}`);
        }
    }
    console.log('\nPer-field accuracy:');
    for (const [k, t] of Object.entries(tally))
        console.log(`  ${k.padEnd(18)} ${t.ok}/${t.n} (${Math.round((t.ok / t.n) * 100)}%)`);
    if (skipped)
        console.log(`${skipped} file(s) skipped (no expected JSON).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=extraction-accuracy.js.map