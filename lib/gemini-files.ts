import { getGeminiServerClient } from './gemini-server';
import { parseGeminiVideoDuration } from './video-utils';

export interface ActiveGeminiFile {
  fileName: string;
  fileUri: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  createTime?: string;
  expirationTime?: string;
}

function normalizeFileName(name: string): string {
  return name.startsWith('files/') ? name : `files/${name}`;
}

function extractGeminiNameFromUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/\/files\/([a-zA-Z0-9_-]+)/);
  return match && match[1] ? `files/${match[1]}` : undefined;
}

function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED')
  );
}

/**
 * Returns the Gemini File API resource for a video, waiting while it is still PROCESSING.
 * Videos only live 48 h in the File API: when it no longer exists this throws `VIDEO_EXPIRED`.
 */
export async function getActiveGeminiFile(params: {
  fileName?: string;
  fileUri?: string;
}): Promise<ActiveGeminiFile> {
  const candidate = params.fileName || extractGeminiNameFromUri(params.fileUri);
  if (!candidate) {
    throw new Error('VIDEO_EXPIRED: no se indicó ningún vídeo.');
  }

  const name = normalizeFileName(candidate);
  const ai = getGeminiServerClient();

  try {
    let file = await ai.files.get({ name });
    for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      file = await ai.files.get({ name });
    }

    if (file.state === 'FAILED') {
      throw new Error('Gemini no ha podido procesar este vídeo. Prueba a subirlo otra vez.');
    }
    if (file.state !== 'ACTIVE' || !file.uri) {
      throw new Error('El vídeo todavía se está preparando. Espera un momento y vuelve a intentarlo.');
    }

    return {
      fileName: file.name || name,
      fileUri: file.uri,
      displayName: file.displayName || name,
      mimeType: file.mimeType || 'video/mp4',
      sizeBytes: Number(file.sizeBytes || 0),
      durationSeconds: parseGeminiVideoDuration(
        file.videoMetadata as Record<string, unknown> | undefined
      ),
      createTime: file.createTime,
      expirationTime: file.expirationTime,
    };
  } catch (err: unknown) {
    if (isNotFoundError(err)) {
      throw new Error(`VIDEO_EXPIRED: ${name}`);
    }
    throw err;
  }
}
