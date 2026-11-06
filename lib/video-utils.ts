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
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  durationSeconds?: number;
  aspectRatio?: string;
  isDemoReel?: boolean;
  localObjectUrl?: string;
  streamUrl?: string;
  hasServerCache?: boolean;
  isPermanentVault?: boolean;
  expirationTime?: string;
  createdAt: string;
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
    label: 'LOW · Rápido',
    shortLabel: 'LOW',
    description: 'Minimiza la latencia y el coste para consultas directas de planos.',
  },
  {
    value: 'MEDIUM',
    label: 'MEDIUM · Medio',
    shortLabel: 'MEDIUM',
    description: 'Nivel por defecto en gemini-4-argon: equilibra profundidad y velocidad.',
  },
  {
    value: 'HIGH',
    label: 'HIGH · Alto',
    shortLabel: 'HIGH',
    description: 'Maximiza el razonamiento para subtexto narrativo, montaje y raccord complejo.',
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

export interface AnalysisQueryRecord {
  id: string;
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
 * Builds the deterministic server streaming endpoint URL for a video.
 */
export function buildVideoStreamUrl(params: {
  name?: string;
  uri?: string;
  displayName?: string;
  sizeBytes?: number;
  mimeType?: string;
}): string {
  const name = params.name || '';
  const uri = params.uri || '';
  const displayName = params.displayName || name || 'video.mp4';
  const sizeBytes = Number.isFinite(params.sizeBytes) ? Number(params.sizeBytes) : 0;
  const mimeType = params.mimeType || 'video/mp4';

  return `/api/files/stream?name=${encodeURIComponent(name)}&uri=${encodeURIComponent(uri)}&displayName=${encodeURIComponent(displayName)}&sizeBytes=${sizeBytes}&mimeType=${encodeURIComponent(mimeType)}`;
}

/**
 * Resolves the direct playback URL for the center Program Monitor without requiring
 * the user to manually relink a local file.
 */
export function resolveVideoPlaybackUrl(
  video: Pick<
    UploadedGeminiVideo,
    'localObjectUrl' | 'streamUrl' | 'name' | 'uri' | 'displayName' | 'sizeBytes' | 'mimeType'
  > | null
): string | undefined {
  if (!video) return undefined;
  if (video.localObjectUrl) return video.localObjectUrl;
  if (video.streamUrl) return video.streamUrl;
  if (video.name || video.displayName || video.uri) {
    return buildVideoStreamUrl({
      name: video.name,
      uri: video.uri,
      displayName: video.displayName,
      sizeBytes: video.sizeBytes,
      mimeType: video.mimeType,
    });
  }
  return undefined;
}

/**
 * Safely parses a Fetch Response as JSON without throwing `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
 * when an API route or proxy returns an HTML error page (e.g., 404, 403, 502, or Firebase Hosting SPA fallback).
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
          'Permiso denegado (HTTP 403). Verifica la clave GEMINI_API_KEY o las restricciones de dominio/API en Google Cloud / Firebase.',
      };
    }
    if (status === 404) {
      return {
        ok: false,
        status,
        data: null,
        error:
          'Ruta de API no encontrada (HTTP 404). Asegúrate de ejecutar el servidor con soporte de rutas API (`npm run dev` en localhost o Firebase App Hosting).',
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
 * Formats raw Gemini / Firebase 403 or domain errors into clear, actionable Spanish messages.
 */
export function formatAnalysisErrorMessage(rawError: unknown): string {
  const msg = rawError instanceof Error ? rawError.message : String(rawError || '');

  if (
    /<!doctype/i.test(msg) ||
    msg.includes('Unexpected token') ||
    msg.includes('is not valid JSON')
  ) {
    return 'El servidor devolvió una página HTML (<!DOCTYPE...>) en lugar de una respuesta JSON válida. Asegúrate de que el servidor Next.js esté activo y la clave GEMINI_API_KEY esté configurada.';
  }

  if (msg.includes('auth/unauthorized-domain') || msg.includes('unauthorized-domain')) {
    return 'Este dominio (ej. localhost) no está autorizado en Firebase Auth para ventanas emergentes de Google. Tus análisis se guardan localmente sin pérdida de datos; para activar la nube en localhost, añade "localhost" en Firebase Console > Authentication > Settings > Authorized domains (Dominios autorizados).';
  }

  if (msg.includes('NEEDS_VAULT_HYDRATION')) {
    return 'El identificador de este vídeo en Gemini File API pertenecía a otra clave/proyecto (Error 403) o ha caducado (>48h), y el archivo binario no está en la caché local de este navegador. Por favor, vuelve a subir el vídeo con «Subir Vídeo» o vincúlalo en el monitor para analizarlo con tu clave actual.';
  }

  if (
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions')
  ) {
    if (msg.toLowerCase().includes('file') || msg.includes('files/')) {
      return 'El archivo de vídeo en Gemini File API pertenecía a otra clave o sesión (Error 403 PERMISSION_DENIED). Vuelve a subir o sincronizar el vídeo para analizarlo con tu clave actual.';
    }
    if (msg.includes('API_KEY_HTTP_REFERRER_BLOCKED') || msg.includes('referer')) {
      return 'La clave de API tiene restricciones de dominio HTTP (Error 403). En localhost o servidor backend, usa una GEMINI_API_KEY sin restricción de HTTP Referrer.';
    }
    return 'Permiso denegado (Error 403). Verifica que la clave GEMINI_API_KEY tenga permisos para Gemini API / File API o vuelve a subir el vídeo si fue creado con otra cuenta.';
  }

  return msg || 'Error al procesar el análisis de la secuencia.';
}



