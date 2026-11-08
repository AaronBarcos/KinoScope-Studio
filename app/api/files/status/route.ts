import { NextRequest, NextResponse } from 'next/server';
import { getGeminiServerClient } from '@/lib/gemini-server';
import { parseGeminiVideoDuration } from '@/lib/video-utils';

export const runtime = 'nodejs';

type GeminiFileLike = {
  name?: string;
  displayName?: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: string | number;
  state?: string;
  videoMetadata?: unknown;
  createTime?: string;
  expirationTime?: string;
};

function toClientFile(f: GeminiFileLike) {
  return {
    name: f.name || '',
    displayName: f.displayName || f.name || 'Vídeo',
    uri: f.uri || '',
    mimeType: f.mimeType || 'video/mp4',
    sizeBytes: Number(f.sizeBytes || 0),
    state: f.state || 'ACTIVE',
    durationSeconds: parseGeminiVideoDuration(
      f.videoMetadata as Record<string, unknown> | undefined
    ),
    createTime: f.createTime,
    expirationTime: f.expirationTime,
  };
}

/**
 * GET ?name=files/abc → status of one video in the Gemini File API.
 * GET (no params)      → list of every video currently stored in the Gemini File API.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  try {
    const ai = getGeminiServerClient();

    if (name) {
      try {
        const file = await ai.files.get({ name });
        return NextResponse.json({ file: toClientFile(file) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('403')) {
          return NextResponse.json({ file: { name, state: 'EXPIRED' } });
        }
        throw err;
      }
    }

    const files: ReturnType<typeof toClientFile>[] = [];
    const pager = await ai.files.list({ config: { pageSize: 100 } });
    for await (const f of pager) {
      if (!f.mimeType || f.mimeType.startsWith('video/')) {
        files.push(toClientFile(f));
      }
      if (files.length >= 200) break;
    }
    return NextResponse.json({ files });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'No se pudo consultar la File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  if (!name) {
    return NextResponse.json({ error: 'Falta el parámetro "name".' }, { status: 400 });
  }

  try {
    const ai = getGeminiServerClient();
    await ai.files.delete({ name });
  } catch {
    // Already expired (> 48 h) or deleted
  }
  return NextResponse.json({ deleted: true, name });
}
