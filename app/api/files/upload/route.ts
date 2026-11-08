import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getGeminiServerClient } from '@/lib/gemini-server';
import { MAX_FILE_API_BYTES, parseGeminiVideoDuration } from '@/lib/video-utils';

export const runtime = 'nodejs';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'upload';
}

/**
 * Chunked upload to the Gemini File API.
 *  1. `?action=chunk` appends a binary slice to a temporary file.
 *  2. `?action=finalize` sends the assembled file to the File API and deletes the temporary copy.
 * The video is stored ONLY in the Gemini File API (it expires after 48 h).
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || '';

  try {
    if (action === 'chunk') {
      const uploadId = sanitizeId(searchParams.get('uploadId') || '');
      const chunkIndex = Number(searchParams.get('chunkIndex') || '0');

      const tmpFilePath = path.join(os.tmpdir(), `kinoscope_${uploadId}.part`);
      const buffer = Buffer.from(await req.arrayBuffer());

      if (chunkIndex === 0) {
        await fs.writeFile(tmpFilePath, buffer);
      } else {
        await fs.appendFile(tmpFilePath, buffer);
      }

      const stat = await fs.stat(tmpFilePath);
      if (stat.size > MAX_FILE_API_BYTES) {
        await fs.unlink(tmpFilePath).catch(() => {});
        return NextResponse.json(
          { error: 'El vídeo es demasiado grande (máximo 2 GB).' },
          { status: 413 }
        );
      }

      return NextResponse.json({ ok: true, receivedBytes: stat.size });
    }

    if (action === 'finalize') {
      const body = await req.json();
      const uploadId = sanitizeId(body.uploadId || '');
      const mimeType = String(body.mimeType || 'video/mp4');
      const displayName = String(body.displayName || 'video.mp4');
      const tmpFilePath = path.join(os.tmpdir(), `kinoscope_${uploadId}.part`);

      try {
        const stat = await fs.stat(tmpFilePath);
        if (stat.size > MAX_FILE_API_BYTES) {
          return NextResponse.json(
            { error: 'El vídeo es demasiado grande (máximo 2 GB).' },
            { status: 413 }
          );
        }

        const ai = getGeminiServerClient();
        const uploaded = await ai.files.upload({
          file: tmpFilePath,
          config: { mimeType, displayName },
        });

        return NextResponse.json({
          file: {
            name: uploaded.name,
            displayName: uploaded.displayName || displayName,
            uri: uploaded.uri,
            mimeType: uploaded.mimeType || mimeType,
            sizeBytes: Number(uploaded.sizeBytes || stat.size),
            state: uploaded.state || 'PROCESSING',
            durationSeconds: parseGeminiVideoDuration(
              uploaded.videoMetadata as Record<string, unknown> | undefined
            ),
            createTime: uploaded.createTime,
            expirationTime: uploaded.expirationTime,
          },
        });
      } finally {
        await fs.unlink(tmpFilePath).catch(() => {});
      }
    }

    return NextResponse.json({ error: 'Acción de subida no válida.' }, { status: 400 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al subir el vídeo.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
