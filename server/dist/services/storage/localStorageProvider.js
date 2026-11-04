"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setStorageForTests = exports.storage = exports.LocalStorageProvider = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../../config/env");
/** Files live OUTSIDE any web root and are only reachable through authenticated, permission-checked endpoints. */
class LocalStorageProvider {
    baseDir;
    constructor(baseDir) {
        this.baseDir = path_1.default.resolve(baseDir || env_1.env.UPLOAD_DIR);
        fs_1.default.mkdirSync(this.baseDir, { recursive: true });
    }
    resolve(key) {
        const full = path_1.default.resolve(this.baseDir, key);
        if (full !== this.baseDir && !full.startsWith(this.baseDir + path_1.default.sep))
            throw new Error('Access denied: invalid storage key.');
        return full;
    }
    async save(buffer, originalName, mimeType, folder) {
        const hash = crypto_1.default.createHash('sha256').update(buffer).digest('hex');
        const ext = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : (path_1.default.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin');
        const key = path_1.default.posix.join(folder.replace(/[^A-Za-z0-9_\-/]/g, ''), `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}${ext}`);
        const full = this.resolve(key);
        await fs_1.default.promises.mkdir(path_1.default.dirname(full), { recursive: true });
        await fs_1.default.promises.writeFile(full, buffer, { flag: 'wx' });
        return { key, fileHash: hash, fileSize: buffer.length, mimeType, originalName: path_1.default.basename(originalName).slice(0, 200) };
    }
    read(key) { return fs_1.default.promises.readFile(this.resolve(key)); }
    async remove(key) { const f = this.resolve(key); if (fs_1.default.existsSync(f))
        await fs_1.default.promises.unlink(f); }
    async exists(key) { try {
        return fs_1.default.existsSync(this.resolve(key));
    }
    catch {
        return false;
    } }
}
exports.LocalStorageProvider = LocalStorageProvider;
let instance = null;
const storage = () => (instance ||= new LocalStorageProvider());
exports.storage = storage;
const setStorageForTests = (s) => { instance = s; };
exports.setStorageForTests = setStorageForTests;
//# sourceMappingURL=localStorageProvider.js.map