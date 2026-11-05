import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getGeminiServerClient } from '@/lib/gemini-server';
import {
  buildVideoStreamUrl,
  MAX_FILE_API_BYTES,
  parseGeminiVideoDuration,
} from '@/lib/video-utils';
import {
  findVideoInServerVault,
  saveVideoToServerVault,
} from '@/lib/server-video-vault';

export const runtime = 'nodejs';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'upload';
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'single';

  try {
    // 1. Chunked upload mode: appends binary slice to /tmp/kinoscope_<uploadId>.part
    if (action === 'chunk') {
      const uploadId = sanitizeId(searchParams.get('uploadId') || '');
      const chunkIndex = Number(searchParams.get('chunkIndex') || '0');
      if (!uploadId) {
        return NextResponse.json(
          { error: 'Falta el identificador de subida (uploadId).' },
          { status: 400 }
        );
      }

      const tmpFilePath = path.join(os.tmpdir(), `kinoscope_${uploadId}.part`);
      const arrayBuffer = await req.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (chunkIndex === 0) {
        await fs.writeFile(tmpFilePath, buffer);
      } else {
        await fs.appendFile(tmpFilePath, buffer);
      }

      const stat = await fs.stat(tmpFilePath);
      if (stat.size > MAX_FILE_API_BYTES) {
        await fs.unlink(tmpFilePath).catch(() => {});
        return NextResponse.json(
          { error: 'El archivo excede el límite máximo de 2GB de la File API de Gemini.' },
          { status: 413 }
        );
      }

      return NextResponse.json({
        ok: true,
        uploadId,
        chunkIndex,
        receivedBytes: stat.size,
      });
    }

    // 2. Hydrate permanent server vault from browser IndexedDB without forcing a duplicate File API upload if already active
    if (action === 'hydrate-vault') {
      const body = await req.json();
      const uploadId = sanitizeId(body.uploadId || '');
      const fileName = String(body.fileName || `files/${uploadId}`);
      const displayName = String(body.displayName || 'video_cinematografico.mp4');
      const mimeType = String(body.mimeType || 'video/mp4');
      const uri = body.uri ? String(body.uri) : undefined;
      const durationSeconds =
        typeof body.durationSeconds === 'number' && body.durationSeconds > 0
          ? body.durationSeconds
          : undefined;
      const aspectRatio = body.aspectRatio ? String(body.aspectRatio) : undefined;

      const tmpFilePath = path.join(os.tmpdir(), `kinoscope_${uploadId}.part`);
      let savedInVault = false;
      try {
        const stat = await fs.stat(tmpFilePath);
        await saveVideoToServerVault({
          sourceFilePath: tmpFilePath,
          fileName,
          displayName,
          uri,
          mimeType,
          sizeBytes: stat.size,
          durationSeconds,
          aspectRatio,
        });
        savedInVault = true;

        return NextResponse.json({
          ok: true,
          fileName,
          hasServerCache: true,
          isPermanentVault: true,
          streamUrl: buildVideoStreamUrl({
            name: fileName,
            uri,
            displayName,
            sizeBytes: stat.size,
            mimeType,
          }),
        });
      } finally {
        if (!savedInVault) {
          await fs.unlink(tmpFilePath).catch(() => {});
        }
      }
    }

    // 3. Finalize chunked upload: sends the assembled file to Gemini File API and stores permanently in .kinoscope_vault
    if (action === 'finalize') {
      const body = await req.json();
      const uploadId = sanitizeId(body.uploadId || '');
      const mimeType = body.mimeType || 'video/mp4';
      const displayName = body.displayName || 'video_cinematografico.mp4';
      const clientDurationSeconds =
        typeof body.durationSeconds === 'number' && body.durationSeconds > 0
          ? body.durationSeconds
          : undefined;
      const clientAspectRatio = body.aspectRatio ? String(body.aspectRatio) : undefined;

      const tmpFilePath = path.join(os.tmpdir(), `kinoscope_${uploadId}.part`);
      let savedInVault = false;
      try {
        const stat = await fs.stat(tmpFilePath);
        if (stat.size > MAX_FILE_API_BYTES) {
          return NextResponse.json(
            { error: 'El archivo supera los 2GB permitidos por la File API.' },
            { status: 413 }
          );
        }

        // Check if an identical video already exists in the permanent vault so we can link its previousFileNames
        const existingInVault = await findVideoInServerVault({
          displayName,
          sizeBytes: stat.size,
        });

        const ai = getGeminiServerClient();
        const uploadedFile = await ai.files.upload({
          file: tmpFilePath,
          config: {
            mimeType,
            displayName,
          },
        });

        const fileName = uploadedFile.name || `files/${uploadId}`;
        const finalDisplayName = uploadedFile.displayName || displayName;
        const finalMimeType = uploadedFile.mimeType || mimeType;
        const finalSizeBytes = Number(uploadedFile.sizeBytes || stat.size);

        const durationSeconds =
          parseGeminiVideoDuration(
            uploadedFile.videoMetadata as Record<string, unknown> | undefined
          ) || clientDurationSeconds;

        await saveVideoToServerVault({
          sourceFilePath: tmpFilePath,
          fileName,
          displayName: finalDisplayName,
          uri: uploadedFile.uri,
          mimeType: finalMimeType,
          sizeBytes: finalSizeBytes,
          durationSeconds,
          aspectRatio: clientAspectRatio,
          createTime: uploadedFile.createTime,
          expirationTime: uploadedFile.expirationTime,
          previousFileNames: existingInVault?.meta?.fileName
            ? [existingInVault.meta.fileName]
            : undefined,
        });
        savedInVault = true;

        return NextResponse.json({
          file: {
            name: fileName,
            displayName: finalDisplayName,
            uri: uploadedFile.uri,
            mimeType: finalMimeType,
            sizeBytes: finalSizeBytes,
            state: uploadedFile.state || 'PROCESSING',
            durationSeconds,
            aspectRatio: clientAspectRatio,
            videoMetadata: uploadedFile.videoMetadata,
            hasServerCache: true,
            isPermanentVault: true,
            streamUrl: buildVideoStreamUrl({
              name: fileName,
              uri: uploadedFile.uri,
              displayName: finalDisplayName,
              sizeBytes: finalSizeBytes,
              mimeType: finalMimeType,
            }),
            createTime: uploadedFile.createTime,
            expirationTime: uploadedFile.expirationTime,
          },
        });
      } finally {
        if (!savedInVault) {
          await fs.unlink(tmpFilePath).catch(() => {});
        }
      }
    }

    // 4. Standard single FormData upload (for small/medium files)
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return NextResponse.json(
        { error: 'No se recibió ningún archivo de vídeo en la solicitud.' },
        { status: 400 }
      );
    }

    const displayName =
      (formData.get('displayName') as string) ||
      (fileEntry as File).name ||
      'video_cinematografico.mp4';
    const mimeType =
      (formData.get('mimeType') as string) || fileEntry.type || 'video/mp4';

    if (fileEntry.size > MAX_FILE_API_BYTES) {
      return NextResponse.json(
        { error: 'El vídeo supera el límite máximo de 2GB de la File API.' },
        { status: 413 }
      );
    }

    const tempName = `kinoscope_single_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
    const tmpFilePath = path.join(os.tmpdir(), tempName);
    let savedInVault = false;

    try {
      const arrayBuffer = await fileEntry.arrayBuffer();
      await fs.writeFile(tmpFilePath, Buffer.from(arrayBuffer));

      const ai = getGeminiServerClient();
      const uploadedFile = await ai.files.upload({
        file: tmpFilePath,
        config: {
          mimeType,
          displayName,
        },
      });

      const fileName = uploadedFile.name || `files/${tempName}`;
      const finalDisplayName = uploadedFile.displayName || displayName;
      const finalMimeType = uploadedFile.mimeType || mimeType;
      const finalSizeBytes = Number(uploadedFile.sizeBytes || fileEntry.size);

      const durationSeconds = parseGeminiVideoDuration(
        uploadedFile.videoMetadata as Record<string, unknown> | undefined
      );

      await saveVideoToServerVault({
        sourceFilePath: tmpFilePath,
        fileName,
        displayName: finalDisplayName,
        uri: uploadedFile.uri,
        mimeType: finalMimeType,
        sizeBytes: finalSizeBytes,
        durationSeconds,
        createTime: uploadedFile.createTime,
        expirationTime: uploadedFile.expirationTime,
      });
      savedInVault = true;

      return NextResponse.json({
        file: {
          name: fileName,
          displayName: finalDisplayName,
          uri: uploadedFile.uri,
          mimeType: finalMimeType,
          sizeBytes: finalSizeBytes,
          state: uploadedFile.state || 'PROCESSING',
          durationSeconds,
          videoMetadata: uploadedFile.videoMetadata,
          hasServerCache: true,
          isPermanentVault: true,
          streamUrl: buildVideoStreamUrl({
            name: fileName,
            uri: uploadedFile.uri,
            displayName: finalDisplayName,
            sizeBytes: finalSizeBytes,
            mimeType: finalMimeType,
          }),
          createTime: uploadedFile.createTime,
          expirationTime: uploadedFile.expirationTime,
        },
      });
    } finally {
      if (!savedInVault) {
        await fs.unlink(tmpFilePath).catch(() => {});
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al subir el vídeo a Gemini File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
