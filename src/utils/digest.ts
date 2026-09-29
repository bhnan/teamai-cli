import path from 'node:path';
import crypto from 'node:crypto';
import { listFilesRecursive, pathExists, readFileSafe } from './fs.js';

/** SHA-256 of one file's bytes ('' for an unreadable file). */
export async function fileDigest(file: string): Promise<string> {
  const raw = await readFileSafe(file);
  return crypto.createHash('sha256').update(raw ?? '', 'utf-8').digest('hex');
}

/**
 * Deterministic content digest of a directory: every file's relative path and
 * bytes, in sorted order. Null when the directory does not exist, so "absent"
 * stays distinguishable from "empty".
 */
export async function dirDigest(dir: string): Promise<string | null> {
  if (!(await pathExists(dir))) return null;
  const hash = crypto.createHash('sha256');
  for (const rel of (await listFilesRecursive(dir)).sort()) {
    const raw = await readFileSafe(path.join(dir, rel));
    hash.update(rel);
    hash.update('\0');
    hash.update(raw ?? '');
    hash.update('\0');
  }
  return hash.digest('hex');
}
