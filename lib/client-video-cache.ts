'use client';

const DB_NAME = 'kinoscope_video_vault_db';
const STORE_NAME = 'video_blobs';
const DB_VERSION = 1;

interface StoredVideoRecord {
  key: string;
  fileName: string;
  displayName: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds?: number;
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
  sizeBytes: number;
  mimeType: string;
  durationSeconds?: number;
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
        sizeBytes: params.sizeBytes,
        mimeType: params.mimeType,
        durationSeconds: params.durationSeconds,
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
}): Promise<{ objectUrl: string; durationSeconds?: number } | null> {
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
        durationSeconds: rec.durationSeconds,
      };
    }
  }

  return null;
}

export async function removeCachedVideoFromBrowser(fileName: string): Promise<void> {
  const db = await openVaultDb();
  if (!db || !fileName) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(fileName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
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
