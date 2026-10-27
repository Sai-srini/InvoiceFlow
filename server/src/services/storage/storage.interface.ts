export interface StoredFileResult { key: string; fileHash: string; fileSize: number; mimeType: string; originalName: string; }
export interface StorageProvider {
  save(buffer: Buffer, originalName: string, mimeType: string, folder: string): Promise<StoredFileResult>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
