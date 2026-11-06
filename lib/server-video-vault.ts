import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getGeminiServerClient } from './gemini-server';
import { parseGeminiVideoDuration } from './video-utils';

export const PERSISTENT_VAULT_DIR = path.join(process.cwd(), '.kinoscope_vault');
export const LEGACY_TMP_VAULT_DIR = path.join(os.tmpdir(), 'kinoscope_vault');

let activeVaultDir: string = PERSISTENT_VAULT_DIR;
let legacyMigrationDone = false;

export { activeVaultDir as VAULT_DIR };

export interface VaultEntryMeta {
  fileName: string; // e.g. "files/abc123"
  safeKey: string; // e.g. "files_abc123"
  displayName: string;
  uri?: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  aspectRatio?: string;
  createTime?: string;
  expirationTime?: string;
  savedAt: string;
  previousFileNames?: string[];
}

export function toSafeVaultKey(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default_video';
}

async function migrateLegacyTmpVault(targetDir: string): Promise<void> {
  if (legacyMigrationDone || targetDir === LEGACY_TMP_VAULT_DIR) return;
  legacyMigrationDone = true;

  try {
    const entries = await fs.readdir(LEGACY_TMP_VAULT_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.json') && !entry.endsWith('.bin')) continue;
      const srcPath = path.join(LEGACY_TMP_VAULT_DIR, entry);
      const destPath = path.join(targetDir, entry);
      try {
        await fs.access(destPath);
        // Already exists in persistent vault
      } catch {
        try {
          await fs.rename(srcPath, destPath);
        } catch {
          await fs.copyFile(srcPath, destPath).catch(() => {});
        }
      }
    }
  } catch {
    // No legacy /tmp vault directory to migrate
  }
}

export async function ensureVaultDir(): Promise<string> {
  try {
    await fs.mkdir(PERSISTENT_VAULT_DIR, { recursive: true });
    activeVaultDir = PERSISTENT_VAULT_DIR;
    await migrateLegacyTmpVault(PERSISTENT_VAULT_DIR);
    return PERSISTENT_VAULT_DIR;
  } catch {
    await fs.mkdir(LEGACY_TMP_VAULT_DIR, { recursive: true });
    activeVaultDir = LEGACY_TMP_VAULT_DIR;
    return LEGACY_TMP_VAULT_DIR;
  }
}

export async function saveVideoToServerVault(params: {
  sourceFilePath: string;
  fileName: string;
  displayName: string;
  uri?: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  aspectRatio?: string;
  createTime?: string;
  expirationTime?: string;
  previousFileNames?: string[];
}): Promise<string> {
  const vaultDir = await ensureVaultDir();
  const safeKey = toSafeVaultKey(params.fileName);
  const targetBinPath = path.join(vaultDir, `${safeKey}.bin`);
  const targetMetaPath = path.join(vaultDir, `${safeKey}.json`);

  if (path.resolve(params.sourceFilePath) !== path.resolve(targetBinPath)) {
    try {
      await fs.rename(params.sourceFilePath, targetBinPath);
    } catch {
      await fs.copyFile(params.sourceFilePath, targetBinPath);
      await fs.unlink(params.sourceFilePath).catch(() => {});
    }
  }

  let existingMeta: Partial<VaultEntryMeta> = {};
  try {
    existingMeta = JSON.parse(await fs.readFile(targetMetaPath, 'utf8')) as VaultEntryMeta;
  } catch {
    // New entry
  }

  const prevNames = new Set<string>([
    ...(existingMeta.previousFileNames || []),
    ...(params.previousFileNames || []),
  ]);
  if (existingMeta.fileName && existingMeta.fileName !== params.fileName) {
    prevNames.add(existingMeta.fileName);
  }

  const meta: VaultEntryMeta = {
    fileName: params.fileName,
    safeKey,
    displayName: params.displayName || existingMeta.displayName || params.fileName,
    uri: params.uri || existingMeta.uri,
    mimeType: params.mimeType || existingMeta.mimeType || 'video/mp4',
    sizeBytes: params.sizeBytes || existingMeta.sizeBytes || 0,
    durationSeconds: params.durationSeconds ?? existingMeta.durationSeconds,
    aspectRatio: params.aspectRatio || existingMeta.aspectRatio,
    createTime: params.createTime || existingMeta.createTime || new Date().toISOString(),
    expirationTime: params.expirationTime || existingMeta.expirationTime,
    savedAt: existingMeta.savedAt || new Date().toISOString(),
    previousFileNames: Array.from(prevNames),
  };

  await fs.writeFile(targetMetaPath, JSON.stringify(meta, null, 2), 'utf8');
  return targetBinPath;
}

export async function updateServerVaultEntryMeta(
  currentSafeKey: string,
  updates: Partial<VaultEntryMeta>
): Promise<VaultEntryMeta | null> {
  try {
    const vaultDir = await ensureVaultDir();
    const metaPath = path.join(vaultDir, `${currentSafeKey}.json`);
    const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as VaultEntryMeta;

    const prevNames = new Set<string>([
      ...(raw.previousFileNames || []),
      ...(updates.previousFileNames || []),
    ]);
    if (updates.fileName && raw.fileName && updates.fileName !== raw.fileName) {
      prevNames.add(raw.fileName);
    }

    const updated: VaultEntryMeta = {
      ...raw,
      ...updates,
      safeKey: currentSafeKey,
      previousFileNames: Array.from(prevNames),
    };

    await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch {
    return null;
  }
}

export async function findVideoInServerVault(params: {
  fileName?: string;
  uri?: string;
  displayName?: string;
  sizeBytes?: number;
}): Promise<{
  binPath: string;
  mimeType: string;
  sizeBytes: number;
  meta?: VaultEntryMeta;
} | null> {
  try {
    const vaultDir = await ensureVaultDir();

    if (params.fileName) {
      const safeKey = toSafeVaultKey(params.fileName);
      const directBin = path.join(vaultDir, `${safeKey}.bin`);
      const directMeta = path.join(vaultDir, `${safeKey}.json`);
      try {
        const stat = await fs.stat(directBin);
        if (stat.isFile() && stat.size > 0) {
          let mimeType = 'video/mp4';
          let parsedMeta: VaultEntryMeta | undefined;
          try {
            parsedMeta = JSON.parse(await fs.readFile(directMeta, 'utf8')) as VaultEntryMeta;
            if (parsedMeta.mimeType) mimeType = parsedMeta.mimeType;
          } catch {
            // Use default mimeType
          }
          return {
            binPath: directBin,
            mimeType,
            sizeBytes: stat.size,
            meta: parsedMeta,
          };
        }
      } catch {
        // Fallback to metadata scan
      }
    }

    const entries = await fs.readdir(vaultDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const metaPath = path.join(vaultDir, entry);
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as VaultEntryMeta;

        const matchesExactFileName =
          Boolean(params.fileName) &&
          (raw.fileName === params.fileName ||
            raw.safeKey === toSafeVaultKey(params.fileName!) ||
            (Array.isArray(raw.previousFileNames) &&
              raw.previousFileNames.includes(params.fileName!)));

        const matchesUri =
          Boolean(params.uri) &&
          Boolean(raw.uri) &&
          raw.uri === params.uri;

        const matchesName =
          Boolean(params.displayName) &&
          raw.displayName.toLowerCase() === params.displayName!.toLowerCase();
        const matchesSize =
          !params.sizeBytes ||
          params.sizeBytes <= 0 ||
          Math.abs(raw.sizeBytes - params.sizeBytes) < 1024;

        if (matchesExactFileName || matchesUri || (matchesName && matchesSize)) {
          const binPath = path.join(vaultDir, `${raw.safeKey}.bin`);
          const stat = await fs.stat(binPath);
          if (stat.isFile() && stat.size > 0) {
            return {
              binPath,
              mimeType: raw.mimeType || 'video/mp4',
              sizeBytes: stat.size,
              meta: raw,
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

export async function listServerVaultVideos(): Promise<VaultEntryMeta[]> {
  try {
    const vaultDir = await ensureVaultDir();
    const entries = await fs.readdir(vaultDir);
    const items: VaultEntryMeta[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const metaPath = path.join(vaultDir, entry);
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as VaultEntryMeta;
        const binPath = path.join(vaultDir, `${raw.safeKey}.bin`);
        const stat = await fs.stat(binPath);
        if (stat.isFile() && stat.size > 0) {
          items.push({
            ...raw,
            sizeBytes: raw.sizeBytes || stat.size,
          });
        }
      } catch {
        continue;
      }
    }

    items.sort(
      (a, b) =>
        new Date(b.savedAt || b.createTime || 0).getTime() -
        new Date(a.savedAt || a.createTime || 0).getTime()
    );
    return items;
  } catch {
    return [];
  }
}

export async function removeVideoFromServerVault(fileName: string): Promise<void> {
  try {
    const vaultDir = await ensureVaultDir();
    const safeKey = toSafeVaultKey(fileName);
    await fs.unlink(path.join(vaultDir, `${safeKey}.bin`)).catch(() => {});
    await fs.unlink(path.join(vaultDir, `${safeKey}.json`)).catch(() => {});

    // Also remove any entry whose fileName or previousFileNames matches
    const entries = await fs.readdir(vaultDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const metaPath = path.join(vaultDir, entry);
        const raw = JSON.parse(await fs.readFile(metaPath, 'utf8')) as VaultEntryMeta;
        if (
          raw.fileName === fileName ||
          (Array.isArray(raw.previousFileNames) && raw.previousFileNames.includes(fileName))
        ) {
          await fs.unlink(path.join(vaultDir, `${raw.safeKey}.bin`)).catch(() => {});
          await fs.unlink(metaPath).catch(() => {});
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore errors when cleaning up
  }
}

function extractGeminiNameFromUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/\/files\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `files/${match[1]}`;
  }
  return undefined;
}

/**
 * Ensures a video has an ACTIVE Gemini File API URI.
 * If the 48-hour Gemini File API TTL has expired (or the remote file was deleted),
 * it transparently re-uploads the binary from the permanent `.kinoscope_vault`
 * and waits until the new File API resource reaches ACTIVE state.
 */
export async function ensureActiveGeminiFile(params: {
  fileName?: string;
  fileUri?: string;
  displayName?: string;
  mimeType?: string;
  sizeBytes?: number;
  forceReupload?: boolean;
}): Promise<{
  fileName: string;
  fileUri: string;
  displayName: string;
  mimeType: string;
  durationSeconds?: number;
  createTime?: string;
  expirationTime?: string;
  refreshed: boolean;
}> {
  const ai = getGeminiServerClient();

  const vaultMatch = await findVideoInServerVault({
    fileName: params.fileName,
    uri: params.fileUri,
    displayName: params.displayName,
    sizeBytes: params.sizeBytes,
  });

  const candidateName =
    vaultMatch?.meta?.fileName ||
    params.fileName ||
    extractGeminiNameFromUri(params.fileUri);

  let remoteCheckFailedWith403Or404 = false;

  // 1. Check if the current Gemini File API entry is still ACTIVE (unless forceReupload is requested after a 403)
  if (
    !params.forceReupload &&
    candidateName &&
    !candidateName.startsWith('local-') &&
    !candidateName.startsWith('vault_')
  ) {
    try {
      const normalizedName = candidateName.startsWith('files/')
        ? candidateName
        : `files/${candidateName}`;
      let remoteFile = await ai.files.get({ name: normalizedName });

      // If still PROCESSING, wait briefly
      for (let i = 0; i < 15 && remoteFile.state === 'PROCESSING'; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        remoteFile = await ai.files.get({ name: normalizedName });
      }

      if (remoteFile.state === 'ACTIVE' && remoteFile.uri) {
        const durationSeconds =
          parseGeminiVideoDuration(
            remoteFile.videoMetadata as Record<string, unknown> | undefined
          ) || vaultMatch?.meta?.durationSeconds;

        return {
          fileName: remoteFile.name || normalizedName,
          fileUri: remoteFile.uri,
          displayName:
            remoteFile.displayName ||
            vaultMatch?.meta?.displayName ||
            params.displayName ||
            normalizedName,
          mimeType:
            remoteFile.mimeType ||
            vaultMatch?.mimeType ||
            params.mimeType ||
            'video/mp4',
          durationSeconds,
          createTime: remoteFile.createTime,
          expirationTime: remoteFile.expirationTime,
          refreshed: false,
        };
      }
    } catch (checkErr: unknown) {
      // File expired (>48h), not found (404), or belongs to another project/key (403 PERMISSION_DENIED) — proceed to auto-reupload from permanent vault
      const msg = checkErr instanceof Error ? checkErr.message : String(checkErr);
      if (
        msg.includes('403') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND')
      ) {
        remoteCheckFailedWith403Or404 = true;
      }
    }
  }

  // 2. If not active, expired, or 403 permission denied, re-upload automatically from the permanent server vault
  if (!vaultMatch) {
    if (
      params.fileUri &&
      !params.forceReupload &&
      !remoteCheckFailedWith403Or404 &&
      !params.fileUri.startsWith('vault://')
    ) {
      return {
        fileName: candidateName || 'files/unknown',
        fileUri: params.fileUri,
        displayName: params.displayName || 'Vídeo',
        mimeType: params.mimeType || 'video/mp4',
        refreshed: false,
      };
    }
    throw new Error(
      'NEEDS_VAULT_HYDRATION: El archivo de vídeo en Gemini File API pertenece a otra clave/proyecto (Error 403) o ha caducado (>48h), y la bóveda del servidor necesita hidratarse desde tu navegador.'
    );
  }

  const resolvedMimeType =
    vaultMatch.meta?.mimeType || vaultMatch.mimeType || params.mimeType || 'video/mp4';
  const resolvedDisplayName =
    vaultMatch.meta?.displayName || params.displayName || 'video_cinematografico.mp4';

  let uploaded = await ai.files.upload({
    file: vaultMatch.binPath,
    config: {
      mimeType: resolvedMimeType,
      displayName: resolvedDisplayName,
    },
  });

  const newFileName = uploaded.name || candidateName || `files/renewed_${Date.now()}`;

  for (let attempt = 0; attempt < 30 && uploaded.state === 'PROCESSING'; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    uploaded = await ai.files.get({ name: newFileName });
  }

  if (uploaded.state === 'FAILED' || !uploaded.uri) {
    throw new Error('No se pudo renovar automáticamente el vídeo en Gemini File API.');
  }

  const durationSeconds =
    parseGeminiVideoDuration(
      uploaded.videoMetadata as Record<string, unknown> | undefined
    ) || vaultMatch.meta?.durationSeconds;

  if (vaultMatch.meta?.safeKey) {
    await updateServerVaultEntryMeta(vaultMatch.meta.safeKey, {
      fileName: newFileName,
      uri: uploaded.uri,
      mimeType: uploaded.mimeType || resolvedMimeType,
      displayName: uploaded.displayName || resolvedDisplayName,
      durationSeconds,
      createTime: uploaded.createTime,
      expirationTime: uploaded.expirationTime,
    });
  }

  return {
    fileName: newFileName,
    fileUri: uploaded.uri,
    displayName: uploaded.displayName || resolvedDisplayName,
    mimeType: uploaded.mimeType || resolvedMimeType,
    durationSeconds,
    createTime: uploaded.createTime,
    expirationTime: uploaded.expirationTime,
    refreshed: true,
  };
}

export { createReadStream };
