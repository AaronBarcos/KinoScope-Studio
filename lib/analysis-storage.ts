'use client';

/**
 * All app data lives in the browser's localStorage:
 *  - the list of uploaded videos (metadata only — the video itself lives in the Gemini File API for 48 h)
 *  - independent chats and their questions & answers for every video
 *  - the AI scene breakdowns
 */

import type { AnalysisQueryRecord, AnalysisSettings, UploadedGeminiVideo, VideoChat, VideoChatState, VideoSceneItem } from './video-utils';
import { DEFAULT_ANALYSIS_SETTINGS, validateAnalysisSettings } from './video-utils.ts';

const LOCAL_VIDEOS_KEY = 'kinoscope_saved_videos_v1';
const LOCAL_ANALYSES_KEY = 'kinoscope_saved_analyses_v1';
const LOCAL_CHATS_KEY = 'kinoscope_saved_chats_v2';
const LOCAL_BREAKDOWNS_KEY = 'kinoscope_saved_breakdowns_v1';
const LOCAL_SETTINGS_KEY = 'kinoscope_analysis_settings_v1';

const MAX_SCENES_COUNT = 50;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAnalysisSettings(): AnalysisSettings {
  const parsed = readJson<unknown>(LOCAL_SETTINGS_KEY, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_ANALYSIS_SETTINGS;
  const result = validateAnalysisSettings(parsed);
  return result.valid ? result.settings : DEFAULT_ANALYSIS_SETTINGS;
}

export function saveAnalysisSettings(settings: AnalysisSettings): void {
  writeJson(LOCAL_SETTINGS_KEY, settings);
}

export function loadVideosFromLocalStorage(): UploadedGeminiVideo[] {
  const parsed = readJson<unknown>(LOCAL_VIDEOS_KEY, []);
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
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      uri: item.uri,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      state: item.state,
      durationSeconds: item.durationSeconds,
      aspectRatio: item.aspectRatio,
      expirationTime: item.expirationTime,
      createdAt: item.createdAt,
      // Blob URLs never survive a reload
      localObjectUrl: undefined,
    }));
}

export function saveVideosToLocalStorage(videos: UploadedGeminiVideo[]): void {
  writeJson(
    LOCAL_VIDEOS_KEY,
    videos.map((v) => ({ ...v, localObjectUrl: undefined }))
  );
}

export function loadAnalysesFromLocalStorage(): AnalysisQueryRecord[] {
  const parsed = readJson<unknown>(LOCAL_ANALYSES_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is AnalysisQueryRecord =>
      item &&
      typeof item.id === 'string' &&
      typeof item.prompt === 'string' &&
      typeof item.answer === 'string'
  );
}

export function saveAnalysesToLocalStorage(records: AnalysisQueryRecord[]): void {
  writeJson(LOCAL_ANALYSES_KEY, records);
}

export function getChatAnalyses(
  analyses: AnalysisQueryRecord[],
  chat: Pick<VideoChat, 'id' | 'videoId'>
): AnalysisQueryRecord[] {
  return analyses.filter((item) => item.chatId === chat.id && item.videoId === chat.videoId);
}

export function loadChatStateFromLocalStorage(): VideoChatState {
  const saved = readJson<VideoChatState | null>(LOCAL_CHATS_KEY, null);
  const chats = Array.isArray(saved?.chats)
    ? saved.chats.filter((chat) => chat && typeof chat.id === 'string' &&
      typeof chat.videoId === 'string' && typeof chat.title === 'string' &&
      typeof chat.createdAt === 'string')
    : [];
  const rawAnalyses = Array.isArray(saved?.analyses)
    ? saved.analyses
    : loadAnalysesFromLocalStorage();
  const analyses = rawAnalyses
    .filter((item) => item && typeof item.id === 'string' &&
      typeof item.videoId === 'string' && typeof item.prompt === 'string' &&
      typeof item.answer === 'string')
    .map((item) => ({ ...item, chatId: item.chatId || `chat_legacy_${item.videoId}` }));

  // Preserve the old per-video history as one chat, matching by ID rather than title.
  for (const item of [...analyses].reverse()) {
    if (chats.some((chat) => chat.id === item.chatId && chat.videoId === item.videoId)) continue;
    chats.push({
      id: item.chatId,
      videoId: item.videoId,
      title: item.prompt.slice(0, 60) || 'Chat anterior',
      createdAt: item.createdAt,
    });
  }
  return { chats, analyses };
}

export function saveChatStateToLocalStorage(state: VideoChatState): void {
  // Persist sessions and messages together so reloads cannot separate them.
  writeJson(LOCAL_CHATS_KEY, state);
}

export function loadBreakdownsMapFromLocalStorage(): Record<string, VideoSceneItem[]> {
  const parsed = readJson<unknown>(LOCAL_BREAKDOWNS_KEY, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, VideoSceneItem[]>;
}

export function saveBreakdownsMapToLocalStorage(
  map: Record<string, VideoSceneItem[]>
): void {
  const bounded: Record<string, VideoSceneItem[]> = {};
  for (const [videoId, scenes] of Object.entries(map)) {
    bounded[videoId] = scenes.slice(0, MAX_SCENES_COUNT);
  }
  writeJson(LOCAL_BREAKDOWNS_KEY, bounded);
}
