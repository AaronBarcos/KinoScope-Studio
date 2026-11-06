import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { ThinkingLevel, Type } from '@google/genai';
import { getGeminiServerClient, GEMINI_VIDEO_MODEL } from '@/lib/gemini-server';
import {
  buildVideoPart,
  buildVideoStreamUrl,
  parseTimecodeToSeconds,
  validateThinkingLevelForArgon,
} from '@/lib/video-utils';
import {
  ensureActiveGeminiFile,
  findVideoInServerVault,
} from '@/lib/server-video-vault';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      fileUri,
      displayName,
      sizeBytes,
      mimeType = 'video/mp4',
      startOffset,
      endOffset,
      fps = 1,
      thinkingLevel: rawThinkingLevel = 'MEDIUM',
    } = body as {
      fileName?: string;
      fileUri?: string;
      displayName?: string;
      sizeBytes?: number;
      mimeType?: string;
      startOffset?: string;
      endOffset?: string;
      fps?: number;
      thinkingLevel?: string;
    };

    if ((!fileUri || !fileUri.trim()) && (!fileName || !fileName.trim())) {
      return NextResponse.json(
        { error: 'Se requiere un vídeo registrado en File API o en la bóveda permanente para generar el desglose de escenas.' },
        { status: 400 }
      );
    }

    const thinkingCheck = validateThinkingLevelForArgon(rawThinkingLevel);
    const sdkThinkingLevel =
      thinkingCheck.level === 'LOW'
        ? ThinkingLevel.LOW
        : thinkingCheck.level === 'HIGH'
          ? ThinkingLevel.HIGH
          : ThinkingLevel.MEDIUM;

    const ai = getGeminiServerClient();

    const breakdownSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: {
            type: Type.INTEGER,
            description: 'Número correlativo de la escena o plano.',
          },
          title: {
            type: Type.STRING,
            description: 'Título descriptivo breve de la escena.',
          },
          startTime: {
            type: Type.STRING,
            description: 'Código de tiempo inicial en formato MM:SS.',
          },
          endTime: {
            type: Type.STRING,
            description: 'Código de tiempo final en formato MM:SS.',
          },
          shotType: {
            type: Type.STRING,
            description: 'Tipo de encuadre y distancia focal estimada.',
          },
          cameraMovement: {
            type: Type.STRING,
            description: 'Movimiento de cámara (ej. Travelling, Dolly, Estático, Steadicam).',
          },
          lightingAndColor: {
            type: Type.STRING,
            description: 'Esquema de iluminación, contraste y paleta cromática.',
          },
          narrativeAction: {
            type: Type.STRING,
            description: 'Descripción concisa de la acción dramática en pantalla.',
          },
          soundDesign: {
            type: Type.STRING,
            description: 'Elementos sonoros, música o diálogos clave.',
          },
        },
        required: [
          'sceneNumber',
          'title',
          'startTime',
          'endTime',
          'shotType',
          'cameraMovement',
          'lightingAndColor',
          'narrativeAction',
          'soundDesign',
        ],
      },
    };

    const breakdownPromptText =
      'Genera un desglose técnico cinematográfico de las escenas o planos principales de este vídeo en español. Incluye código de tiempo de inicio y fin en formato MM:SS, tipo de plano, movimiento de cámara, esquema de iluminación/color, acción dramática y diseño sonoro.';

    const runBreakdownGenerate = async (targetUri: string, targetMime: string) => {
      const videoPart = buildVideoPart({
        fileUri: targetUri,
        mimeType: targetMime,
        startOffset,
        endOffset,
        fps,
      });

      return ai.models.generateContent({
        model: GEMINI_VIDEO_MODEL,
        contents: {
          parts: [
            videoPart,
            {
              text: breakdownPromptText,
            },
          ],
        },
        config: {
          thinkingConfig: {
            thinkingLevel: sdkThinkingLevel,
          },
          responseMimeType: 'application/json',
          responseSchema: breakdownSchema,
        },
      });
    };

    const runInlineBreakdownGenerate = async (binPath: string, targetMime: string) => {
      const bytes = await fs.readFile(binPath);
      return ai.models.generateContent({
        model: GEMINI_VIDEO_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                data: bytes.toString('base64'),
                mimeType: targetMime,
              },
            },
            {
              text: breakdownPromptText,
            },
          ],
        },
        config: {
          thinkingConfig: {
            thinkingLevel: sdkThinkingLevel,
          },
          responseMimeType: 'application/json',
          responseSchema: breakdownSchema,
        },
      });
    };

    let activeFile: Awaited<ReturnType<typeof ensureActiveGeminiFile>> | null = null;
    let response;
    try {
      activeFile = await ensureActiveGeminiFile({
        fileName,
        fileUri,
        displayName,
        mimeType,
        sizeBytes,
      });
      response = await runBreakdownGenerate(activeFile.fileUri, activeFile.mimeType);
    } catch (firstErr: unknown) {
      const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      try {
        if (
          errMsg.includes('403') ||
          errMsg.includes('PERMISSION_DENIED') ||
          errMsg.includes('404') ||
          errMsg.includes('NOT_FOUND')
        ) {
          activeFile = await ensureActiveGeminiFile({
            fileName,
            fileUri,
            displayName,
            mimeType,
            sizeBytes,
            forceReupload: true,
          });
          response = await runBreakdownGenerate(activeFile.fileUri, activeFile.mimeType);
        } else {
          throw firstErr;
        }
      } catch (retryErr: unknown) {
        const vaultMatch = await findVideoInServerVault({
          fileName,
          uri: fileUri,
          displayName,
          sizeBytes,
        });
        if (vaultMatch && vaultMatch.sizeBytes <= 20 * 1024 * 1024) {
          response = await runInlineBreakdownGenerate(
            vaultMatch.binPath,
            vaultMatch.mimeType || mimeType
          );
        } else {
          throw retryErr;
        }
      }
    }

    const rawJson = (response.text ?? '[]').trim();
    const parsed = JSON.parse(rawJson) as Array<{
      sceneNumber: number;
      title: string;
      startTime: string;
      endTime: string;
      shotType: string;
      cameraMovement: string;
      lightingAndColor: string;
      narrativeAction: string;
      soundDesign: string;
    }>;

    const palettes: Array<[string, string, string]> = [
      ['#0a192f', '#0ea5e9', '#f59e0b'],
      ['#1c1917', '#d97706', '#10b981'],
      ['#090d16', '#38bdf8', '#e11d48'],
      ['#0f172a', '#64748b', '#f97316'],
    ];

    const scenes = parsed.map((item, idx) => ({
      id: `sc-gen-${idx + 1}`,
      sceneNumber: item.sceneNumber || idx + 1,
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
      startSeconds: parseTimecodeToSeconds(item.startTime) ?? idx * 30,
      endSeconds: parseTimecodeToSeconds(item.endTime) ?? (idx + 1) * 30,
      shotType: item.shotType,
      cameraMovement: item.cameraMovement,
      lightingAndColor: item.lightingAndColor,
      narrativeAction: item.narrativeAction,
      soundDesign: item.soundDesign,
      paletteHex: palettes[idx % palettes.length],
    }));

    return NextResponse.json({
      scenes,
      model: GEMINI_VIDEO_MODEL,
      refreshedFile: activeFile?.refreshed
        ? {
            name: activeFile.fileName,
            uri: activeFile.fileUri,
            displayName: activeFile.displayName,
            mimeType: activeFile.mimeType,
            durationSeconds: activeFile.durationSeconds,
            createTime: activeFile.createTime,
            expirationTime: activeFile.expirationTime,
            streamUrl: buildVideoStreamUrl({
              name: activeFile.fileName,
              uri: activeFile.fileUri,
              displayName: activeFile.displayName,
              sizeBytes,
              mimeType: activeFile.mimeType,
            }),
          }
        : undefined,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error al generar el desglose automático de escenas.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
