import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createReadStream,
  ensureVaultDir,
  findVideoInServerVault,
  saveVideoToServerVault,
  toSafeVaultKey,
  VAULT_DIR,
} from '@/lib/server-video-vault';
import { getGeminiServerClient } from '@/lib/gemini-server';

export const runtime = 'nodejs';

async function tryFetchFromGeminiFileApi(params: {
  fileName: string;
  uri?: string;
  displayName?: string;
  mimeType?: string;
}): Promise<{ binPath: string; mimeType: string; sizeBytes: number } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !params.fileName) return null;

  await ensureVaultDir();
  const safeKey = toSafeVaultKey(params.fileName);
  const tempDownloadPath = path.join(VAULT_DIR, `${safeKey}_dl_${Date.now()}.part`);

  // Attempt 1: SDK ai.files.download
  try {
    const ai = getGeminiServerClient();
    await ai.files.download({
      file: params.fileName,
      downloadPath: tempDownloadPath,
    });
    const stat = await fs.stat(tempDownloadPath);
    if (stat.isFile() && stat.size > 0) {
      const savedPath = await saveVideoToServerVault({
        sourceFilePath: tempDownloadPath,
        fileName: params.fileName,
        displayName: params.displayName || params.fileName,
        mimeType: params.mimeType || 'video/mp4',
        sizeBytes: stat.size,
      });
      return {
        binPath: savedPath,
        mimeType: params.mimeType || 'video/mp4',
        sizeBytes: stat.size,
      };
    }
  } catch {
    await fs.unlink(tempDownloadPath).catch(() => {});
  }

  // Attempt 2: Direct REST media endpoint with API key
  const cleanName = params.fileName.startsWith('files/')
    ? params.fileName
    : `files/${params.fileName}`;
  const candidateUrls = [
    `https://generativelanguage.googleapis.com/v1beta/${cleanName}:download?alt=media`,
    `https://generativelanguage.googleapis.com/v1beta/${cleanName}?alt=media`,
    ...(params.uri ? [`${params.uri}${params.uri.includes('?') ? '&' : '?'}alt=media`] : []),
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'x-goog-api-key': apiKey,
        },
      });
      const contentType = res.headers.get('content-type') || '';
      if (
        res.ok &&
        !contentType.includes('application/json') &&
        !contentType.includes('text/html')
      ) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          await fs.writeFile(tempDownloadPath, Buffer.from(arrayBuf));
          const savedPath = await saveVideoToServerVault({
            sourceFilePath: tempDownloadPath,
            fileName: params.fileName,
            displayName: params.displayName || params.fileName,
            mimeType: params.mimeType || contentType || 'video/mp4',
            sizeBytes: arrayBuf.byteLength,
          });
          return {
            binPath: savedPath,
            mimeType: params.mimeType || contentType || 'video/mp4',
            sizeBytes: arrayBuf.byteLength,
          };
        }
      }
    } catch {
      await fs.unlink(tempDownloadPath).catch(() => {});
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') || '';
  const displayName = searchParams.get('displayName') || '';
  const uri = searchParams.get('uri') || '';
  const mimeTypeParam = searchParams.get('mimeType') || 'video/mp4';
  const sizeBytesParam = Number(searchParams.get('sizeBytes') || '0');

  let found = await findVideoInServerVault({
    fileName: name,
    displayName,
    sizeBytes: sizeBytesParam,
  });

  if (!found && name) {
    found = await tryFetchFromGeminiFileApi({
      fileName: name,
      uri,
      displayName,
      mimeType: mimeTypeParam,
    });
  }

  if (!found) {
    return NextResponse.json(
      {
        error:
          'El flujo de vídeo local no está en caché en este servidor. Vincula el archivo local o súbelo de nuevo para reproducirlo.',
      },
      { status: 404 }
    );
  }

  const { binPath, mimeType, sizeBytes } = found;
  const rangeHeader = req.headers.get('range');

  if (rangeHeader) {
    const match = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(match[0], 10);
    const end = match[1] ? parseInt(match[1], 10) : sizeBytes - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end >= sizeBytes ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${sizeBytes}`,
        },
      });
    }

    const chunkLength = end - start + 1;
    const nodeStream = createReadStream(binPath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${sizeBytes}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkLength),
        'Content-Type': mimeType || 'video/mp4',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  const nodeStream = createReadStream(binPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(sizeBytes),
      'Content-Type': mimeType || 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
