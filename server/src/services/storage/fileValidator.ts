export type AllowedMimeType = 'application/pdf' | 'image/png' | 'image/jpeg';

export interface ValidationResult {
  valid: boolean;
  detectedMime?: AllowedMimeType;
  error?: string;
}

/**
 * Validates a file buffer by checking magic bytes (file signature),
 * completely ignoring client-provided Content-Type or file extension.
 */
export function validateFileMagicBytes(buffer: Buffer): ValidationResult {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'File is empty or corrupt.' };
  }

  // PDF signature: %PDF- (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return { valid: true, detectedMime: 'application/pdf' };
  }

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, detectedMime: 'image/png' };
  }

  // JPEG signature: FF D8 FF
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { valid: true, detectedMime: 'image/jpeg' };
  }

  return {
    valid: false,
    error: 'Invalid file format. Only authentic PDF, PNG, and JPEG documents are permitted (verified by magic bytes).',
  };
}
