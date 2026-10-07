import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Storage interface: { save(buffer, ext) -> key, url(key), remove(key) }.
 * LocalStorage is for development. An S3Storage with the same shape can replace it
 * (select by env var) without touching any route code.
 */
class LocalStorage {
  constructor(dir) { this.dir = path.resolve(dir); }
  async save(buffer, ext) {
    await fs.mkdir(this.dir, { recursive: true });
    const key = `${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(this.dir, key), buffer);
    return key;
  }
  url(key) { return `${config.PUBLIC_API_URL}/uploads/${key}`; }
  async remove(key) { await fs.rm(path.join(this.dir, path.basename(key)), { force: true }); }
}

export const storage = new LocalStorage(config.UPLOAD_DIR);
export const uploadDir = storage.dir;

// Validate by magic bytes, not by client-supplied mimetype/extension.
export function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}
