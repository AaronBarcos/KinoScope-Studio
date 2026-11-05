import { NextRequest, NextResponse } from 'next/server';
import { getGeminiServerClient } from '@/lib/gemini-server';
import { parseGeminiVideoDuration } from '@/lib/video-utils';
import {
  findVideoInServerVault,
  removeVideoFromServerVault,
} from '@/lib/server-video-vault';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  try {
    const ai = getGeminiServerClient();

    if (name) {
      const file = await ai.files.get({ name });
      const fileName = file.name || name;
      const displayName = file.displayName || fileName;
      const mimeType = file.mimeType || 'video/mp4';
      const sizeBytes = Number(file.sizeBytes || 0);
      const durationSeconds = parseGeminiVideoDuration(
        file.videoMetadata as Record<string, unknown> | undefined
      );
      const cached = await findVideoInServerVault({
        fileName,
        displayName,
        sizeBytes,
      });

      return NextResponse.json({
        file: {
          name: fileName,
          displayName,
          uri: file.uri,
          mimeType,
          sizeBytes,
          state: file.state,
          durationSeconds,
          videoMetadata: file.videoMetadata,
          hasServerCache: Boolean(cached),
          streamUrl: `/api/files/stream?name=${encodeURIComponent(fileName)}&uri=${encodeURIComponent(file.uri || '')}&displayName=${encodeURIComponent(displayName)}&sizeBytes=${sizeBytes}&mimeType=${encodeURIComponent(mimeType)}`,
          createTime: file.createTime,
          expirationTime: file.expirationTime,
          error: file.error,
        },
      });
    }

    const pager = await ai.files.list({ config: { pageSize: 15 } });
    const files: Array<Record<string, unknown>> = [];
    for await (const f of pager) {
      if (!f.mimeType || f.mimeType.startsWith('video/')) {
        const fileName = f.name || '';
        const displayName = f.displayName || fileName || 'Vídeo File API';
        const mimeType = f.mimeType || 'video/mp4';
        const sizeBytes = Number(f.sizeBytes || 0);
        const durationSeconds = parseGeminiVideoDuration(
          f.videoMetadata as Record<string, unknown> | undefined
        );
        const cached = await findVideoInServerVault({
          fileName,
          displayName,
          sizeBytes,
        });

        files.push({
          name: fileName,
          displayName,
          uri: f.uri,
          mimeType,
          sizeBytes,
          state: f.state || 'ACTIVE',
          durationSeconds,
          videoMetadata: f.videoMetadata,
          hasServerCache: Boolean(cached),
          streamUrl: `/api/files/stream?name=${encodeURIComponent(fileName)}&uri=${encodeURIComponent(f.uri || '')}&displayName=${encodeURIComponent(displayName)}&sizeBytes=${sizeBytes}&mimeType=${encodeURIComponent(mimeType)}`,
          createTime: f.createTime,
          expirationTime: f.expirationTime,
        });
      }
      if (files.length >= 15) break;
    }

    return NextResponse.json({ files });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo consultar el estado del archivo en la File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  if (!name) {
    return NextResponse.json(
      { error: 'Se requiere el parámetro "name" (ej. files/abc123).' },
      { status: 400 }
    );
  }

  try {
    const ai = getGeminiServerClient();
    await ai.files.delete({ name });
    await removeVideoFromServerVault(name);
    return NextResponse.json({ deleted: true, name });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al eliminar el archivo de la File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
