import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const VAULT_DIR = path.join(os.tmpdir(), 'kinoscope_vault');

export interface VaultEntryMeta {
  fileName: string; // e.g. "files/abc123"
  safeKey: string; // e.g. "files_abc123"
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: string;
}

export function toSafeVaultKey(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default_video';
}

export async function ensureVaultDir(): Promise<string> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
  return VAULT_DIR;
}

export async function saveVideoToServerVault(params: {
  sourceFilePath: string;
  fileName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<string> {
  await ensureVaultDir();
  const safeKey = toSafeVaultKey(params.fileName);
  const targetBinPath = path.join(VAULT_DIR, `${safeKey}.bin`);
  const targetMetaPath = path.join(VAULT_DIR, `${safeKey}.json`);

  try {
    await fs.rename(params.sourceFilePath, targetBinPath);
  } catch {
    await fs.copyFile(params.sourceFilePath, targetBinPath);
    await fs.unlink(params.sourceFilePath).catch(() => {});
  }

  const meta: VaultEntryMeta = {
    fileName: params.fileName,
    safeKey,
    displayName: params.displayName,
    mimeType: params.mimeType || 'video/mp4',
    sizeBytes: params.sizeBytes,
    savedAt: new Date().toISOString(),
  };

  await fs.writeFile(targetMetaPath, JSON.stringify(meta, null, 2), 'utf8');
  return targetBinPath;
}

export async function findVideoInServerVault(params: {
  fileName?: string;
  displayName?: string;
  sizeBytes?: number;
}): Promise<{ binPath: string; mimeType: string; sizeBytes: number } | null> {
  try {
    await ensureVaultDir();

    if (params.fileName) {
      const safeKey = toSafeVaultKey(params.fileName);
      const directBin = path.join(VAULT_DIR, `${safeKey}.bin`);
      const directMeta = path.join(VAULT_DIR, `${safeKey}.json`);
      try {
        const stat = await fs.stat(directBin);
        if (stat.isFile() && stat.size > 0) {
          let mimeType = 'video/mp4';
          try {
            const rawMeta = JSON.parse(await fs.readFile(directMeta, 'utf8')) as VaultEntryMeta;
            if (rawMeta.mimeType) mimeType = rawMeta.mimeType;
          } catch {
            // Use default mimeType
          }
          return { binPath: directBin, mimeType, sizeBytes: stat.size };
        }
      } catch {
        // Fallback to metadata scan
      }
    }

    const entries = await fs.readdir(VAULT_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const metaPath = path.join(VAULT_DIR, entry);
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as VaultEntryMeta;
        const matchesName =
          params.displayName &&
          raw.displayName.toLowerCase() === params.displayName.toLowerCase();
        const matchesSize =
          !params.sizeBytes ||
          params.sizeBytes <= 0 ||
          Math.abs(raw.sizeBytes - params.sizeBytes) < 1024;

        if (matchesName && matchesSize) {
          const binPath = path.join(VAULT_DIR, `${raw.safeKey}.bin`);
          const stat = await fs.stat(binPath);
          if (stat.isFile() && stat.size > 0) {
            return {
              binPath,
              mimeType: raw.mimeType || 'video/mp4',
              sizeBytes: stat.size,
            };
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function removeVideoFromServerVault(fileName: string): Promise<void> {
  try {
    const safeKey = toSafeVaultKey(fileName);
    await fs.unlink(path.join(VAULT_DIR, `${safeKey}.bin`)).catch(() => {});
    await fs.unlink(path.join(VAULT_DIR, `${safeKey}.json`)).catch(() => {});
  } catch {
    // Ignore errors when cleaning up
  }
}

export { createReadStream };
