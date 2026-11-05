import { NextRequest, NextResponse } from 'next/server';
import { getGeminiServerClient } from '@/lib/gemini-server';
import {
  buildVideoStreamUrl,
  parseGeminiVideoDuration,
} from '@/lib/video-utils';
import {
  ensureActiveGeminiFile,
  findVideoInServerVault,
  listServerVaultVideos,
  removeVideoFromServerVault,
  updateServerVaultEntryMeta,
} from '@/lib/server-video-vault';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');
  const ensureActive = searchParams.get('ensureActive') === '1';

  try {
    if (name) {
      const cached = await findVideoInServerVault({ fileName: name });

      if (ensureActive) {
        const active = await ensureActiveGeminiFile({
          fileName: name,
          fileUri: cached?.meta?.uri,
          displayName: cached?.meta?.displayName,
          mimeType: cached?.mimeType,
          sizeBytes: cached?.sizeBytes,
        });

        const finalSizeBytes = cached?.sizeBytes || 0;
        return NextResponse.json({
          file: {
            name: active.fileName,
            displayName: active.displayName,
            uri: active.fileUri,
            mimeType: active.mimeType,
            sizeBytes: finalSizeBytes,
            state: 'ACTIVE',
            durationSeconds: active.durationSeconds || cached?.meta?.durationSeconds,
            aspectRatio: cached?.meta?.aspectRatio,
            hasServerCache: Boolean(cached),
            isPermanentVault: Boolean(cached),
            refreshed: active.refreshed,
            streamUrl: buildVideoStreamUrl({
              name: active.fileName,
              uri: active.fileUri,
              displayName: active.displayName,
              sizeBytes: finalSizeBytes,
              mimeType: active.mimeType,
            }),
            createTime: active.createTime || cached?.meta?.createTime,
            expirationTime: active.expirationTime,
          },
        });
      }

      try {
        const ai = getGeminiServerClient();
        const file = await ai.files.get({ name });
        const fileName = file.name || name;
        const displayName =
          file.displayName || cached?.meta?.displayName || fileName;
        const mimeType = file.mimeType || cached?.mimeType || 'video/mp4';
        const sizeBytes = Number(file.sizeBytes || cached?.sizeBytes || 0);
        const durationSeconds =
          parseGeminiVideoDuration(
            file.videoMetadata as Record<string, unknown> | undefined
          ) || cached?.meta?.durationSeconds;

        const vaultMatch =
          cached ||
          (await findVideoInServerVault({
            fileName,
            displayName,
            sizeBytes,
          }));

        if (vaultMatch?.meta?.safeKey && durationSeconds && !vaultMatch.meta.durationSeconds) {
          await updateServerVaultEntryMeta(vaultMatch.meta.safeKey, {
            durationSeconds,
            uri: file.uri || vaultMatch.meta.uri,
            expirationTime: file.expirationTime || vaultMatch.meta.expirationTime,
          });
        }

        return NextResponse.json({
          file: {
            name: fileName,
            displayName,
            uri: file.uri || vaultMatch?.meta?.uri,
            mimeType,
            sizeBytes,
            state: file.state || 'ACTIVE',
            durationSeconds,
            aspectRatio: vaultMatch?.meta?.aspectRatio,
            videoMetadata: file.videoMetadata,
            hasServerCache: Boolean(vaultMatch),
            isPermanentVault: Boolean(vaultMatch),
            streamUrl: buildVideoStreamUrl({
              name: fileName,
              uri: file.uri || vaultMatch?.meta?.uri,
              displayName,
              sizeBytes,
              mimeType,
            }),
            createTime: file.createTime || vaultMatch?.meta?.createTime,
            expirationTime: file.expirationTime,
            error: file.error,
          },
        });
      } catch (remoteErr: unknown) {
        // If Gemini File API expired the file (>48h), serve metadata from the Permanent Vault
        if (cached && cached.meta) {
          return NextResponse.json({
            file: {
              name: cached.meta.fileName,
              displayName: cached.meta.displayName,
              uri: cached.meta.uri || `vault://${cached.meta.safeKey}`,
              mimeType: cached.mimeType,
              sizeBytes: cached.sizeBytes,
              state: 'ACTIVE',
              durationSeconds: cached.meta.durationSeconds,
              aspectRatio: cached.meta.aspectRatio,
              hasServerCache: true,
              isPermanentVault: true,
              streamUrl: buildVideoStreamUrl({
                name: cached.meta.fileName,
                uri: cached.meta.uri,
                displayName: cached.meta.displayName,
                sizeBytes: cached.sizeBytes,
                mimeType: cached.mimeType,
              }),
              createTime: cached.meta.createTime || cached.meta.savedAt,
              expirationTime: cached.meta.expirationTime,
            },
          });
        }
        throw remoteErr;
      }
    }

    // List all videos: merge Permanent Server Vault + active Gemini File API entries
    const vaultVideos = await listServerVaultVideos();
    const mergedByKey = new Map<string, Record<string, unknown>>();
    const vaultNameLookup = new Map<string, string>(); // maps any fileName or previousFileName -> safeKey

    for (const v of vaultVideos) {
      const streamUrl = buildVideoStreamUrl({
        name: v.fileName,
        uri: v.uri,
        displayName: v.displayName,
        sizeBytes: v.sizeBytes,
        mimeType: v.mimeType,
      });

      mergedByKey.set(v.safeKey, {
        name: v.fileName,
        displayName: v.displayName,
        uri: v.uri || `vault://${v.safeKey}`,
        mimeType: v.mimeType || 'video/mp4',
        sizeBytes: v.sizeBytes,
        state: 'ACTIVE',
        durationSeconds: v.durationSeconds,
        aspectRatio: v.aspectRatio,
        hasServerCache: true,
        isPermanentVault: true,
        streamUrl,
        createTime: v.createTime || v.savedAt,
        expirationTime: v.expirationTime,
      });

      vaultNameLookup.set(v.fileName, v.safeKey);
      for (const prevName of v.previousFileNames || []) {
        vaultNameLookup.set(prevName, v.safeKey);
      }
    }

    try {
      const ai = getGeminiServerClient();
      const pager = await ai.files.list({ config: { pageSize: 25 } });
      let count = 0;

      for await (const f of pager) {
        if (!f.mimeType || f.mimeType.startsWith('video/')) {
          const fileName = f.name || '';
          const displayName = f.displayName || fileName || 'Vídeo File API';
          const mimeType = f.mimeType || 'video/mp4';
          const sizeBytes = Number(f.sizeBytes || 0);
          const durationSeconds = parseGeminiVideoDuration(
            f.videoMetadata as Record<string, unknown> | undefined
          );

          const matchedVaultKey = vaultNameLookup.get(fileName);
          const cached =
            matchedVaultKey
              ? vaultVideos.find((v) => v.safeKey === matchedVaultKey)
              : (
                  await findVideoInServerVault({
                    fileName,
                    displayName,
                    sizeBytes,
                  })
                )?.meta;

          if (cached) {
            const existingEntry = mergedByKey.get(cached.safeKey) || {};
            mergedByKey.set(cached.safeKey, {
              ...existingEntry,
              name: fileName,
              displayName: cached.displayName || displayName,
              uri: f.uri || cached.uri,
              mimeType,
              sizeBytes: sizeBytes || cached.sizeBytes,
              state: f.state || 'ACTIVE',
              durationSeconds: durationSeconds || cached.durationSeconds,
              aspectRatio: cached.aspectRatio,
              videoMetadata: f.videoMetadata,
              hasServerCache: true,
              isPermanentVault: true,
              streamUrl: buildVideoStreamUrl({
                name: fileName,
                uri: f.uri || cached.uri,
                displayName: cached.displayName || displayName,
                sizeBytes: sizeBytes || cached.sizeBytes,
                mimeType,
              }),
              createTime: f.createTime || cached.createTime || cached.savedAt,
              expirationTime: f.expirationTime || cached.expirationTime,
            });
          } else {
            mergedByKey.set(fileName, {
              name: fileName,
              displayName,
              uri: f.uri,
              mimeType,
              sizeBytes,
              state: f.state || 'ACTIVE',
              durationSeconds,
              videoMetadata: f.videoMetadata,
              hasServerCache: false,
              isPermanentVault: false,
              streamUrl: buildVideoStreamUrl({
                name: fileName,
                uri: f.uri,
                displayName,
                sizeBytes,
                mimeType,
              }),
              createTime: f.createTime,
              expirationTime: f.expirationTime,
            });
          }
        }
        count++;
        if (count >= 25) break;
      }
    } catch {
      // If Gemini File API listing fails (e.g. offline), still return all Permanent Server Vault videos
    }

    const files = Array.from(mergedByKey.values());
    return NextResponse.json({ files });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo consultar el estado del archivo en la File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName, fileUri, displayName, mimeType, sizeBytes } = body as {
      fileName?: string;
      fileUri?: string;
      displayName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };

    const active = await ensureActiveGeminiFile({
      fileName,
      fileUri,
      displayName,
      mimeType,
      sizeBytes,
    });

    return NextResponse.json({
      file: {
        name: active.fileName,
        uri: active.fileUri,
        displayName: active.displayName,
        mimeType: active.mimeType,
        durationSeconds: active.durationSeconds,
        createTime: active.createTime,
        expirationTime: active.expirationTime,
        state: 'ACTIVE',
        hasServerCache: true,
        isPermanentVault: true,
        refreshed: active.refreshed,
        streamUrl: buildVideoStreamUrl({
          name: active.fileName,
          uri: active.fileUri,
          displayName: active.displayName,
          sizeBytes,
          mimeType: active.mimeType,
        }),
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo renovar el vídeo en Gemini File API.';
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
    try {
      const ai = getGeminiServerClient();
      await ai.files.delete({ name });
    } catch {
      // Ignore if already expired (>48h) in Gemini File API
    }
    await removeVideoFromServerVault(name);
    return NextResponse.json({ deleted: true, name });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al eliminar el archivo de la File API.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
