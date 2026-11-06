'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
   Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  AnalysisQueryRecord,
  buildVideoStreamUrl,
  extractTimestampCitations,
  SupportedThinkingLevel,
  UploadedGeminiVideo,
  VideoSceneItem,
} from './video-utils';

const LOCAL_VIDEOS_KEY = 'kinoscope_saved_videos_v1';
const LOCAL_ANALYSES_KEY = 'kinoscope_saved_analyses_v1';
const LOCAL_BREAKDOWNS_KEY = 'kinoscope_saved_breakdowns_v1';

// Blueprint-synchronized validation & truncation constants
export const MAX_OWNER_ID_LEN = 128;
export const MAX_VIDEO_ID_LEN = 256;
export const MAX_VIDEO_TITLE_LEN = 300;
export const MAX_SCOPE_LEN = 16;
export const MAX_TIMECODE_LEN = 32;
export const MAX_THINKING_LEN = 16;
export const MAX_PROMPT_LEN = 4000;
export const MAX_ANSWER_LEN = 50000;
export const MAX_MODEL_LEN = 120;
export const MAX_CLIENT_CREATED_AT_LEN = 64;
export const MAX_SCENES_COUNT = 50;
export const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned.length > 0 && VALID_ID_REGEX.test(cleaned)
    ? cleaned
    : `rec_${Date.now()}`;
}

export function loadVideosFromLocalStorage(): UploadedGeminiVideo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_VIDEOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is UploadedGeminiVideo =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.displayName === 'string'
      )
      .map((item) => ({
        ...item,
        localObjectUrl: undefined,
        streamUrl:
          item.streamUrl ||
          buildVideoStreamUrl({
            name: item.name,
            uri: item.uri,
            displayName: item.displayName,
            sizeBytes: item.sizeBytes,
            mimeType: item.mimeType,
          }),
      }));
  } catch {
    return [];
  }
}

export function saveVideosToLocalStorage(videos: UploadedGeminiVideo[]): void {
  if (typeof window === 'undefined') return;
  try {
    const serializable = videos.map((v) => ({
      ...v,
      localObjectUrl: undefined,
    }));
    window.localStorage.setItem(LOCAL_VIDEOS_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAnalysesFromLocalStorage(): AnalysisQueryRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_ANALYSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AnalysisQueryRecord =>
        item &&
        typeof item.id === 'string' &&
        typeof item.prompt === 'string' &&
        typeof item.answer === 'string'
    );
  } catch {
    return [];
  }
}

export function saveAnalysesToLocalStorage(records: AnalysisQueryRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_ANALYSES_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadBreakdownsMapFromLocalStorage(): Record<string, VideoSceneItem[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_BREAKDOWNS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, VideoSceneItem[]>;
  } catch {
    return {};
  }
}

export function saveBreakdownForVideoLocal(
  videoId: string,
  scenes: VideoSceneItem[]
): void {
  if (typeof window === 'undefined' || !videoId) return;
  try {
    const current = loadBreakdownsMapFromLocalStorage();
    current[videoId] = scenes.slice(0, MAX_SCENES_COUNT);
    window.localStorage.setItem(LOCAL_BREAKDOWNS_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Saves an AnalysisQueryRecord to Firestore `/analyses/{analysisId}` adhering strictly
 * to the `AnalysisRecord` schema in `firebase-blueprint.json` and `firestore.rules`.
 */
export async function saveAnalysisToFirestore(
  userId: string,
  record: AnalysisQueryRecord
): Promise<void> {
  if (!userId || !VALID_ID_REGEX.test(userId)) return;

  const docId = sanitizeFirestoreId(record.id);
  const path = `analyses/${docId}`;

  const payload = {
    ownerId: userId.slice(0, MAX_OWNER_ID_LEN),
    videoId: (record.videoId || 'unknown_video').slice(0, MAX_VIDEO_ID_LEN),
    videoTitle: (record.videoTitle || 'Vídeo sin título').slice(0, MAX_VIDEO_TITLE_LEN),
    scope: (record.scope === 'scene' ? 'scene' : 'full').slice(0, MAX_SCOPE_LEN),
    startTimecode: (record.startTimecode || '').slice(0, MAX_TIMECODE_LEN),
    endTimecode: (record.endTimecode || '').slice(0, MAX_TIMECODE_LEN),
    startOffset: (record.startOffset || '').slice(0, MAX_TIMECODE_LEN),
    endOffset: (record.endOffset || '').slice(0, MAX_TIMECODE_LEN),
    fps:
      typeof record.fps === 'number' && record.fps > 0 && record.fps <= 24
        ? record.fps
        : 1,
    thinkingLevel: (
      ['LOW', 'MEDIUM', 'HIGH'].includes(record.thinkingLevel)
        ? record.thinkingLevel
        : 'MEDIUM'
    ).slice(0, MAX_THINKING_LEN),
    prompt: (record.prompt || 'Consulta').slice(0, MAX_PROMPT_LEN),
    answer: (record.answer || 'Sin respuesta').slice(0, MAX_ANSWER_LEN),
    model: (record.model || 'models/gemini-4-argon').slice(0, MAX_MODEL_LEN),
    clientCreatedAt: (record.createdAt || new Date().toISOString()).slice(
      0,
      MAX_CLIENT_CREATED_AT_LEN
    ),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = doc(db, 'analyses', docId);
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAnalysisFromFirestore(analysisId: string): Promise<void> {
  const docId = sanitizeFirestoreId(analysisId);
  const path = `analyses/${docId}`;
  try {
    await deleteDoc(doc(db, 'analyses', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Saves or updates a scene breakdown for a specific video in `/sceneBreakdowns/{breakdownId}`.
 */
export async function saveSceneBreakdownToFirestore(
  userId: string,
  videoId: string,
  videoTitle: string,
  scenes: VideoSceneItem[]
): Promise<void> {
  if (!userId || !VALID_ID_REGEX.test(userId) || !videoId) return;

  const docId = sanitizeFirestoreId(`${userId}_${videoId}`);
  const path = `sceneBreakdowns/${docId}`;
  const boundedScenes = scenes.slice(0, MAX_SCENES_COUNT).map((s) => ({
    id: String(s.id || ''),
    sceneNumber: Number(s.sceneNumber || 1),
    title: String(s.title || ''),
    startTime: String(s.startTime || '00:00'),
    endTime: String(s.endTime || '00:10'),
    startSeconds: Number(s.startSeconds || 0),
    endSeconds: Number(s.endSeconds || 10),
    shotType: String(s.shotType || ''),
    cameraMovement: String(s.cameraMovement || ''),
    lightingAndColor: String(s.lightingAndColor || ''),
    narrativeAction: String(s.narrativeAction || ''),
    soundDesign: String(s.soundDesign || ''),
    paletteHex: Array.isArray(s.paletteHex)
      ? [
          String(s.paletteHex[0] || '#1e293b'),
          String(s.paletteHex[1] || '#475569'),
          String(s.paletteHex[2] || '#f59e0b'),
        ]
      : ['#1e293b', '#475569', '#f59e0b'],
  }));

  try {
    const ref = doc(db, 'sceneBreakdowns', docId);
    const existingSnap = await getDoc(ref).catch(() => null);
    if (existingSnap && existingSnap.exists()) {
      await updateDoc(ref, {
        scenes: boundedScenes,
        videoTitle: (videoTitle || 'Vídeo').slice(0, MAX_VIDEO_TITLE_LEN),
        updatedAt: serverTimestamp(),
      });
    } else {
      try {
        await setDoc(ref, {
          ownerId: userId.slice(0, MAX_OWNER_ID_LEN),
          videoId: videoId.slice(0, MAX_VIDEO_ID_LEN),
          videoTitle: (videoTitle || 'Vídeo').slice(0, MAX_VIDEO_TITLE_LEN),
          scenes: boundedScenes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        await updateDoc(ref, {
          scenes: boundedScenes,
          videoTitle: (videoTitle || 'Vídeo').slice(0, MAX_VIDEO_TITLE_LEN),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToUserAnalyses(
  userId: string,
  onUpdate: (records: AnalysisQueryRecord[]) => void
): Unsubscribe {
  const path = 'analyses';
  const q = query(collection(db, path), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AnalysisQueryRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const answer = String(d.answer || '');
        const scope = d.scope === 'scene' ? 'scene' : 'full';
        const thinkingLevel: SupportedThinkingLevel =
          d.thinkingLevel === 'LOW' || d.thinkingLevel === 'HIGH'
            ? d.thinkingLevel
            : 'MEDIUM';

        return {
          id: docSnap.id,
          videoId: String(d.videoId || ''),
          videoTitle: String(d.videoTitle || 'Vídeo'),
          scope,
          startTimecode: d.startTimecode ? String(d.startTimecode) : undefined,
          endTimecode: d.endTimecode ? String(d.endTimecode) : undefined,
          startOffset: d.startOffset ? String(d.startOffset) : undefined,
          endOffset: d.endOffset ? String(d.endOffset) : undefined,
          fps: Number(d.fps || 1),
          thinkingLevel,
          prompt: String(d.prompt || ''),
          answer,
          model: String(d.model || 'models/gemini-4-argon'),
          createdAt: String(d.clientCreatedAt || new Date().toISOString()),
          citations: extractTimestampCitations(answer),
        };
      });

      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeToUserSceneBreakdowns(
  userId: string,
  onUpdate: (breakdownsByVideoId: Record<string, VideoSceneItem[]>) => void
): Unsubscribe {
  const path = 'sceneBreakdowns';
  const q = query(collection(db, path), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, VideoSceneItem[]> = {};
      for (const docSnap of snapshot.docs) {
        const d = docSnap.data();
        const vid = String(d.videoId || '');
        if (vid && Array.isArray(d.scenes)) {
          map[vid] = d.scenes as VideoSceneItem[];
        }
      }
      onUpdate(map);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
