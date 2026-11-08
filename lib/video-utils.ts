export const MAX_FILE_API_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB limit for Gemini File API
export const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB chunks to safely pass Cloud Run 32MB request limits

export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/quicktime',
  'video/avi',
  'video/x-msvideo',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp',
] as const;

export interface VideoSceneItem {
  id: string;
  sceneNumber: number;
  title: string;
  startTime: string; // MM:SS
  endTime: string; // MM:SS
  startSeconds: number;
  endSeconds: number;
  shotType: string;
  cameraMovement: string;
  lightingAndColor: string;
  narrativeAction: string;
  soundDesign: string;
  paletteHex: [string, string, string];
}

export interface UploadedGeminiVideo {
  id: string;
  name: string; // Gemini File API resource name e.g. "files/abc123xyz"
  displayName: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  /** EXPIRED = the Gemini File API deleted it (48 h TTL). Chats are kept locally. */
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED' | 'EXPIRED';
  durationSeconds?: number;
  aspectRatio?: string;
  /** Session-only blob URL of the user's local file, used just for on-screen playback. */
  localObjectUrl?: string;
  expirationTime?: string;
  createdAt: string;
}

/**
 * Returns true when the File API copy of the video is gone or past its expiration time.
 */
export function isVideoExpired(
  video: Pick<UploadedGeminiVideo, 'state' | 'expirationTime'>,
  now: number = Date.now()
): boolean {
  if (video.state === 'EXPIRED') return true;
  if (!video.expirationTime) return false;
  const exp = new Date(video.expirationTime).getTime();
  return Number.isFinite(exp) && exp <= now;
}

/**
 * Human friendly remaining time until the File API deletes the video (e.g. "47 h", "35 min").
 */
export function formatTimeRemaining(
  expirationTime?: string,
  now: number = Date.now()
): string | null {
  if (!expirationTime) return null;
  const exp = new Date(expirationTime).getTime();
  if (!Number.isFinite(exp)) return null;
  const diffMs = exp - now;
  if (diffMs <= 0) return null;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours} h`;
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  return `${minutes} min`;
}

/**
 * Formats seconds as a friendly duration ("1 min 25 s", "45 s", "1 h 02 min").
 */
export function formatFriendlyDuration(totalSeconds?: number): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return sec > 0 ? `${m} min ${sec} s` : `${m} min`;
  return `${sec} s`;
}

export type SupportedThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export const THINKING_LEVEL_OPTIONS: Array<{
  value: SupportedThinkingLevel;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: 'LOW',
    label: 'Rápido',
    shortLabel: 'Rápido',
    description: 'Menos razonamiento para preguntas directas.',
  },
  {
    value: 'MEDIUM',
    label: 'Equilibrado',
    shortLabel: 'Medio',
    description: 'Equilibra profundidad y tiempo de respuesta.',
  },
  {
    value: 'HIGH',
    label: 'Profundo',
    shortLabel: 'Alto',
    description: 'Más razonamiento para escenas y preguntas complejas.',
  },
];

export function validateThinkingLevelForArgon(input?: string): {
  valid: boolean;
  level: SupportedThinkingLevel;
  error?: string;
} {
  if (!input) {
    return { valid: true, level: 'MEDIUM' };
  }
  const upper = input.trim().toUpperCase();
  if (upper === 'MINIMAL') {
    return {
      valid: false,
      level: 'MEDIUM',
      error: 'ThinkingLevel.MINIMAL no está soportado en gemini-4-argon. Usa LOW, MEDIUM o HIGH.',
    };
  }
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') {
    return { valid: true, level: upper };
  }
  return {
    valid: false,
    level: 'MEDIUM',
    error: 'Nivel de thinking no válido. Selecciona LOW, MEDIUM o HIGH.',
  };
}

export interface AnalysisSettings {
  fps: number;
  thinkingLevel: SupportedThinkingLevel;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  fps: 1,
  thinkingLevel: 'MEDIUM',
};

/** Shared by both API routes and persisted browser preferences. */
export function validateAnalysisSettings(input: {
  fps?: unknown;
  thinkingLevel?: unknown;
}): { valid: true; settings: AnalysisSettings } | { valid: false; error: string } {
  const fps = input.fps === undefined ? DEFAULT_ANALYSIS_SETTINGS.fps : input.fps;
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > 24) {
    return { valid: false, error: 'Los FPS deben ser un número mayor que 0 y menor o igual que 24.' };
  }
  if (input.thinkingLevel !== undefined && typeof input.thinkingLevel !== 'string') {
    return { valid: false, error: 'Selecciona un nivel de razonamiento: LOW, MEDIUM o HIGH.' };
  }
  const thinking = validateThinkingLevelForArgon(input.thinkingLevel as string | undefined);
  if (!thinking.valid) return { valid: false, error: thinking.error! };
  return { valid: true, settings: { fps, thinkingLevel: thinking.level } };
}

export interface AnalysisQueryRecord {
  id: string;
  chatId: string;
  videoId: string;
  videoTitle: string;
  scope: 'full' | 'scene';
  startTimecode?: string;
  endTimecode?: string;
  startOffset?: string;
  endOffset?: string;
  fps: number;
  thinkingLevel: SupportedThinkingLevel;
  prompt: string;
  answer: string;
  model: string;
  createdAt: string;
  citations: Array<{ label: string; seconds: number }>;
}

export interface VideoChat {
  id: string;
  videoId: string;
  title: string;
  createdAt: string;
}

export interface VideoChatState {
  chats: VideoChat[];
  analyses: AnalysisQueryRecord[];
}

/**
 * Parses a timecode string ("MM:SS", "HH:MM:SS", or "45s") into total integer seconds.
 * Returns null if the format is invalid or negative.
 */
export function parseTimecodeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Support "45s" format directly
  if (/^\d+(\.\d+)?s$/i.test(trimmed)) {
    const val = Math.floor(parseFloat(trimmed.slice(0, -1)));
    return Number.isFinite(val) && val >= 0 ? val : null;
  }

  // Support plain integer seconds if only digits
  if (/^\d+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
  }

  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formats seconds into "MM:SS" or "HH:MM:SS"
 */
export function formatSecondsToTimecode(totalSeconds: number, forceHours = false): string {
  const clamped = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0 || forceHours) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Converts a timecode ("01:25") or number of seconds (85) into Gemini's Protobuf Duration string ("85s").
 */
export function toGeminiOffsetString(tcOrSeconds: string | number | undefined): string | undefined {
  if (tcOrSeconds === undefined || tcOrSeconds === null || tcOrSeconds === '') {
    return undefined;
  }
  if (typeof tcOrSeconds === 'number') {
    if (!Number.isFinite(tcOrSeconds) || tcOrSeconds < 0) return undefined;
    return `${Math.floor(tcOrSeconds)}s`;
  }
  const sec = parseTimecodeToSeconds(tcOrSeconds);
  if (sec === null) return undefined;
  return `${sec}s`;
}

/**
 * Validates a scene start and end timecode range.
 */
export function validateSceneRange(
  startTc: string,
  endTc: string,
  maxDurationSec?: number
): {
  valid: boolean;
  error?: string;
  startSec?: number;
  endSec?: number;
  startOffset?: string;
  endOffset?: string;
} {
  const startSec = parseTimecodeToSeconds(startTc);
  if (startSec === null) {
    return {
      valid: false,
      error: 'El tiempo de inicio debe tener formato MM:SS o HH:MM:SS válido (ej. 00:15).',
    };
  }

  const endSec = parseTimecodeToSeconds(endTc);
  if (endSec === null) {
    return {
      valid: false,
      error: 'El tiempo de fin debe tener formato MM:SS o HH:MM:SS válido (ej. 01:30).',
    };
  }

  if (endSec <= startSec) {
    return {
      valid: false,
      error: 'El código de tiempo final debe ser posterior al tiempo de inicio.',
    };
  }

  if (maxDurationSec !== undefined && maxDurationSec > 0 && endSec > Math.ceil(maxDurationSec)) {
    return {
      valid: false,
      error: `El intervalo supera la duración total del vídeo (${formatSecondsToTimecode(maxDurationSec)}).`,
    };
  }

  return {
    valid: true,
    startSec,
    endSec,
    startOffset: `${startSec}s`,
    endOffset: `${endSec}s`,
  };
}

/**
 * Extracts video duration in seconds from Gemini File API videoMetadata object.
 * Gemini File API returns `{ videoDuration: "45s" }` or `{ videoDuration: "45.500000s" }`.
 */
export function parseGeminiVideoDuration(
  videoMetadata?: Record<string, unknown> | null
): number | undefined {
  if (!videoMetadata || typeof videoMetadata !== 'object') return undefined;
  const raw =
    videoMetadata.videoDuration ??
    videoMetadata.duration ??
    videoMetadata.durationSeconds;

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw));
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+(\.\d+)?s$/i.test(trimmed)) {
      const parsed = parseFloat(trimmed.slice(0, -1));
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.round(parsed));
      }
    }
    const tcSec = parseTimecodeToSeconds(trimmed);
    if (tcSec !== null && tcSec > 0) {
      return tcSec;
    }
  }

  return undefined;
}

/**
 * Normalizes and clamps a scene [startSec, endSec] interval within [0, maxDurationSec]
 * so that 0 <= startSec < endSec <= maxDurationSec is always guaranteed without errors.
 */
export function normalizeSceneRange(
  startSec: number,
  endSec: number,
  maxDurationSec?: number,
  changedHandle?: 'start' | 'end'
): {
  startSec: number;
  endSec: number;
  startTimecode: string;
  endTimecode: string;
} {
  const safeMax = Math.max(
    1,
    Math.floor(
      typeof maxDurationSec === 'number' &&
        Number.isFinite(maxDurationSec) &&
        maxDurationSec > 0
        ? maxDurationSec
        : 60
    )
  );

  let s = Number.isFinite(startSec) ? Math.floor(startSec) : 0;
  let e = Number.isFinite(endSec) ? Math.floor(endSec) : safeMax;

  if (changedHandle === 'start') {
    s = Math.max(0, Math.min(safeMax - 1, s));
    e = Math.max(1, Math.min(safeMax, e));
    if (e <= s) {
      e = Math.min(safeMax, s + 1);
    }
  } else if (changedHandle === 'end') {
    e = Math.max(1, Math.min(safeMax, e));
    s = Math.max(0, Math.min(safeMax - 1, s));
    if (s >= e) {
      s = Math.max(0, e - 1);
    }
  } else {
    if (s < 0 || s >= safeMax) {
      s = 0;
    }
    if (e <= s || e > safeMax) {
      e = safeMax;
    }
  }

  return {
    startSec: s,
    endSec: e,
    startTimecode: formatSecondsToTimecode(s),
    endTimecode: formatSecondsToTimecode(e),
  };
}

/**
 * Validates a video file against Gemini File API constraints (max 2GB, video MIME type).
 */
export function validateVideoFile(file: {
  name: string;
  size: number;
  type: string;
}): { valid: boolean; error?: string; normalizedMimeType?: string } {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return { valid: false, error: 'El archivo seleccionado está vacío o no es válido.' };
  }

  if (file.size > MAX_FILE_API_BYTES) {
    return {
      valid: false,
      error: `El archivo supera el límite máximo de 2.00 GB de la File API de Gemini (${formatByteSize(file.size)}).`,
    };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const extToMime: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mpeg: 'video/mpeg',
    mpg: 'video/mpg',
    avi: 'video/x-msvideo',
    flv: 'video/x-flv',
    wmv: 'video/wmv',
    '3gp': 'video/3gpp',
  };

  const rawType = (file.type || '').toLowerCase();
  const inferredMime = extToMime[ext] || rawType;

  const isSupported =
    SUPPORTED_VIDEO_MIME_TYPES.includes(inferredMime as (typeof SUPPORTED_VIDEO_MIME_TYPES)[number]) ||
    rawType.startsWith('video/');

  if (!isSupported) {
    return {
      valid: false,
      error: 'Formato no compatible. Sube un archivo de vídeo válido (MP4, MOV, WebM, MPEG, AVI).',
    };
  }

  return {
    valid: true,
    normalizedMimeType: inferredMime || 'video/mp4',
  };
}

/**
 * Builds the exact @google/genai Part structure with fileData and optional videoMetadata.
 */
export function buildVideoPart(params: {
  fileUri: string;
  mimeType: string;
  startOffset?: string;
  endOffset?: string;
  fps?: number;
}) {
  const { fileUri, mimeType, startOffset, endOffset, fps } = params;

  const videoMetadata: {
    startOffset?: string;
    endOffset?: string;
    fps?: number;
  } = {};

  if (startOffset) videoMetadata.startOffset = startOffset;
  if (endOffset) videoMetadata.endOffset = endOffset;
  if (fps !== undefined && fps > 0 && fps <= 24) {
    videoMetadata.fps = fps;
  }

  const hasVideoMetadata = Object.keys(videoMetadata).length > 0;

  return {
    fileData: {
      fileUri,
      mimeType: mimeType || 'video/mp4',
    },
    ...(hasVideoMetadata ? { videoMetadata } : {}),
  };
}

/**
 * Extracts timestamp citations like [00:15], [01:24 - 01:40], or (02:10) from analysis text.
 */
export function extractTimestampCitations(
  text: string
): Array<{ label: string; seconds: number }> {
  if (!text) return [];
  const regex = /\[?(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]?/g;
  const seen = new Set<number>();
  const results: Array<{ label: string; seconds: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const startTc = match[1];
    const sec = parseTimecodeToSeconds(startTc);
    if (sec !== null && !seen.has(sec)) {
      seen.add(sec);
      results.push({
        label: formatSecondsToTimecode(sec),
        seconds: sec,
      });
    }
  }

  return results.sort((a, b) => a.seconds - b.seconds);
}

/**
 * Formats bytes into human-readable KB / MB / GB with tabular precision.
 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Computes byte slice ranges for chunked uploading.
 */
export function calculateChunkPlan(
  fileSize: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE_BYTES
): Array<{ index: number; start: number; end: number }> {
  if (fileSize <= 0 || chunkSize <= 0) return [];
  const chunks: Array<{ index: number; start: number; end: number }> = [];
  let offset = 0;
  let index = 0;
  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    chunks.push({ index, start: offset, end });
    offset = end;
    index++;
  }
  return chunks;
}

/**
 * Reads duration and resolution of a local video file in the browser (no upload needed).
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

/**
 * Safely parses a Fetch Response as JSON without throwing `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
 * when an API route or proxy returns an HTML error page (e.g., 404, 403, 502).
 */
export async function safeParseJsonResponse<T = Record<string, unknown>>(
  res: Response,
  fallbackContext = 'El servidor'
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const status = res.status;
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return {
      ok: false,
      status,
      data: null,
      error: `${fallbackContext} no pudo leer la respuesta de red (HTTP ${status}).`,
    };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      ok: res.ok,
      status,
      data: null,
      error: res.ok ? undefined : `${fallbackContext} devolvió una respuesta vacía (HTTP ${status}).`,
    };
  }

  // Detect HTML responses (<!DOCTYPE html>, <html>, etc.) before calling JSON.parse
  if (trimmed.startsWith('<') || /^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const cleanTitle = titleMatch ? titleMatch[1].trim() : '';
    if (status === 403) {
      return {
        ok: false,
        status,
        data: null,
        error:
          'Permiso denegado (HTTP 403). Verifica la clave GEMINI_API_KEY.',
      };
    }
    if (status === 404) {
      return {
        ok: false,
        status,
        data: null,
        error:
          'Ruta de API no encontrada (HTTP 404). Asegúrate de ejecutar el servidor con `npm run dev`.',
      };
    }
    if (status === 413) {
      return {
        ok: false,
        status,
        data: null,
        error: 'El bloque enviado supera el tamaño permitido por el servidor (HTTP 413).',
      };
    }
    return {
      ok: false,
      status,
      data: null,
      error: `${fallbackContext} devolvió HTML en lugar de JSON (HTTP ${status}${cleanTitle ? `: ${cleanTitle}` : ''}).`,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    const errField =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? (parsed as Record<string, unknown>).error
        : undefined;
    const extractedError =
      typeof errField === 'string'
        ? errField
        : errField && typeof errField === 'object' && 'message' in errField
          ? String((errField as Record<string, unknown>).message)
          : undefined;

    return {
      ok: res.ok,
      status,
      data: parsed,
      error: res.ok ? undefined : extractedError || `Error HTTP ${status}`,
    };
  } catch {
    return {
      ok: false,
      status,
      data: null,
      error: `Respuesta con formato no válido (HTTP ${status}): ${trimmed.slice(0, 120)}`,
    };
  }
}

/**
 * Turns raw server / Gemini errors into short, friendly Spanish messages for non-technical users.
 */
export function formatAnalysisErrorMessage(rawError: unknown): string {
  const msg = rawError instanceof Error ? rawError.message : String(rawError || '');

  if (
    /<!doctype/i.test(msg) ||
    msg.includes('Unexpected token') ||
    msg.includes('is not valid JSON')
  ) {
    return 'No se ha podido conectar con el servidor. Comprueba que la aplicación está en marcha y vuelve a intentarlo.';
  }

  if (msg.includes('GEMINI_API_KEY')) {
    return 'Falta configurar la clave de Gemini (GEMINI_API_KEY) en el servidor.';
  }

  if (
    msg.includes('VIDEO_EXPIRED') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND')
  ) {
    return 'Este vídeo ya no está disponible (los vídeos se guardan solo 48 horas). Vuelve a subirlo para seguir preguntando.';
  }

  if (
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('permission-denied')
  ) {
    if (msg.toLowerCase().includes('file') || msg.includes('files/')) {
      return 'No se puede acceder a este vídeo con la clave actual. Vuelve a subirlo para seguir preguntando.';
    }
    return 'Permiso denegado. Verifica que la clave GEMINI_API_KEY es correcta.';
  }

  return msg || 'Algo ha salido mal. Vuelve a intentarlo en unos segundos.';
}
