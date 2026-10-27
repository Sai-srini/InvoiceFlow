import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider, StoredFileResult } from './storage.interface';
import { env } from '../../config/env';

/** Files live OUTSIDE any web root and are only reachable through authenticated, permission-checked endpoints. */
export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir || env.UPLOAD_DIR);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }
  private resolve(key: string) {
    const full = path.resolve(this.baseDir, key);
    if (full !== this.baseDir && !full.startsWith(this.baseDir + path.sep)) throw new Error('Access denied: invalid storage key.');
    return full;
  }
  async save(buffer: Buffer, originalName: string, mimeType: string, folder: string): Promise<StoredFileResult> {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : (path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin');
    const key = path.posix.join(folder.replace(/[^A-Za-z0-9_\-/]/g, ''), `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    const full = this.resolve(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer, { flag: 'wx' });
    return { key, fileHash: hash, fileSize: buffer.length, mimeType, originalName: path.basename(originalName).slice(0, 200) };
  }
  read(key: string) { return fs.promises.readFile(this.resolve(key)); }
  async remove(key: string) { const f = this.resolve(key); if (fs.existsSync(f)) await fs.promises.unlink(f); }
  async exists(key: string) { try { return fs.existsSync(this.resolve(key)); } catch { return false; } }
}
let instance: LocalStorageProvider | null = null;
export const storage = (): StorageProvider => (instance ||= new LocalStorageProvider());
export const setStorageForTests = (s: LocalStorageProvider) => { instance = s; };
