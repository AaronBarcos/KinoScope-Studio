'use client';

import {
  calculateChunkPlan,
  DEFAULT_CHUNK_SIZE_BYTES,
} from './video-utils';

const DB_NAME = 'kinoscope_video_vault_db';
const STORE_NAME = 'video_blobs';
const DB_VERSION = 1;

export interface StoredVideoRecord {
  key: string;
  fileName: string;
  displayName: string;
  uri?: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds?: number;
  aspectRatio?: string;
  blob: Blob;
  updatedAt: number;
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheVideoBlobInBrowser(params: {
  fileName: string;
  displayName: string;
  uri?: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds?: number;
  aspectRatio?: string;
  blob: Blob;
}): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;

  const primaryKey = params.fileName || `${params.displayName}_${params.sizeBytes}`;
  const fallbackKey = `meta_${params.displayName.toLowerCase()}_${params.sizeBytes}`;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredVideoRecord = {
        key: primaryKey,
        fileName: params.fileName,
        displayName: params.displayName,
        uri: params.uri,
        sizeBytes: params.sizeBytes,
        mimeType: params.mimeType,
        durationSeconds: params.durationSeconds,
        aspectRatio: params.aspectRatio,
        blob: params.blob,
        updatedAt: Date.now(),
      };
      store.put(record);
      store.put({ ...record, key: fallbackKey });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedVideoFromBrowser(params: {
  fileName?: string;
  displayName?: string;
  sizeBytes?: number;
}): Promise<{
  objectUrl: string;
  blob: Blob;
  durationSeconds?: number;
  aspectRatio?: string;
} | null> {
  const db = await openVaultDb();
  if (!db) return null;

  const keysToTry: string[] = [];
  if (params.fileName) keysToTry.push(params.fileName);
  if (params.displayName && params.sizeBytes) {
    keysToTry.push(`meta_${params.displayName.toLowerCase()}_${params.sizeBytes}`);
  }

  for (const key of keysToTry) {
    const rec = await new Promise<StoredVideoRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(key);
        getReq.onsuccess = () => resolve((getReq.result as StoredVideoRecord) || null);
        getReq.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    if (rec && rec.blob instanceof Blob && rec.blob.size > 0) {
      return {
        objectUrl: URL.createObjectURL(rec.blob),
        blob: rec.blob,
        durationSeconds: rec.durationSeconds,
        aspectRatio: rec.aspectRatio,
      };
    }
  }

  return null;
}

export async function listAllCachedVideosFromBrowser(): Promise<
  Array<{
    fileName: string;
    displayName: string;
    uri?: string;
    sizeBytes: number;
    mimeType: string;
    durationSeconds?: number;
    aspectRatio?: string;
    objectUrl: string;
    blob: Blob;
    updatedAt: number;
  }>
> {
  const db = await openVaultDb();
  if (!db) return [];

  const records = await new Promise<StoredVideoRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StoredVideoRecord[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  const deduped = new Map<
    string,
    {
      fileName: string;
      displayName: string;
      uri?: string;
      sizeBytes: number;
      mimeType: string;
      durationSeconds?: number;
      aspectRatio?: string;
      objectUrl: string;
      blob: Blob;
      updatedAt: number;
    }
  >();

  for (const rec of records) {
    if (!rec || !(rec.blob instanceof Blob) || rec.blob.size <= 0) continue;
    // Skip duplicate meta_ keys when the primary record is already present
    const identityKey = `${rec.displayName.toLowerCase()}_${rec.sizeBytes || rec.blob.size}`;
    const existing = deduped.get(identityKey);
    if (!existing || (!rec.key.startsWith('meta_') && rec.updatedAt >= existing.updatedAt)) {
      if (existing) {
        URL.revokeObjectURL(existing.objectUrl);
      }
      deduped.set(identityKey, {
        fileName: rec.fileName,
        displayName: rec.displayName,
        uri: rec.uri,
        sizeBytes: rec.sizeBytes || rec.blob.size,
        mimeType: rec.mimeType || 'video/mp4',
        durationSeconds: rec.durationSeconds,
        aspectRatio: rec.aspectRatio,
        objectUrl: URL.createObjectURL(rec.blob),
        blob: rec.blob,
        updatedAt: rec.updatedAt || Date.now(),
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeCachedVideoFromBrowser(
  fileName: string,
  displayName?: string,
  sizeBytes?: number
): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      if (fileName) {
        store.delete(fileName);
      }
      if (displayName && sizeBytes) {
        store.delete(`meta_${displayName.toLowerCase()}_${sizeBytes}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Background-syncs a browser-cached video Blob to the server's permanent `.kinoscope_vault`
 * if the server does not yet have it cached.
 */
export async function hydrateServerVaultFromBrowserBlob(params: {
  fileName: string;
  displayName: string;
  uri?: string;
  mimeType: string;
  durationSeconds?: number;
  aspectRatio?: string;
  blob: Blob;
}): Promise<boolean> {
  try {
    const uploadId = `hydrate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const chunks = calculateChunkPlan(params.blob.size, DEFAULT_CHUNK_SIZE_BYTES);

    for (const chunk of chunks) {
      const slice = params.blob.slice(chunk.start, chunk.end);
      const res = await fetch(
        `/api/files/upload?action=chunk&uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunk.index}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: slice,
        }
      );
      if (!res.ok) return false;
    }

    const finRes = await fetch('/api/files/upload?action=hydrate-vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        fileName: params.fileName,
        displayName: params.displayName,
        uri: params.uri,
        mimeType: params.mimeType,
        durationSeconds: params.durationSeconds,
        aspectRatio: params.aspectRatio,
      }),
    });

    return finRes.ok;
  } catch {
    return false;
  }
}

/**
 * Probes a local File or Blob in the browser using an offscreen HTMLVideoElement
 * to accurately read its real durationSeconds and aspect ratio before/after upload.
 */
export function probeLocalVideoMetadata(
  fileOrBlob: Blob
): Promise<{ durationSeconds?: number; aspectRatio?: string }> {
  if (typeof window === 'undefined') {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(fileOrBlob);
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.muted = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      tempVideo.removeAttribute('src');
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({});
    }, 4000);

    tempVideo.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const dur =
        Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
          ? Math.max(1, Math.round(tempVideo.duration))
          : undefined;
      let aspectRatio: string | undefined;
      if (tempVideo.videoWidth > 0 && tempVideo.videoHeight > 0) {
        aspectRatio = `${tempVideo.videoWidth}×${tempVideo.videoHeight}`;
      }
      cleanup();
      resolve({ durationSeconds: dur, aspectRatio });
    };

    tempVideo.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve({});
    };

    tempVideo.src = url;
  });
}
