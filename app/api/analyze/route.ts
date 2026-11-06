import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { ThinkingLevel } from '@google/genai';
import { getGeminiServerClient, GEMINI_VIDEO_MODEL } from '@/lib/gemini-server';
import {
  buildVideoPart,
  buildVideoStreamUrl,
  extractTimestampCitations,
  SupportedThinkingLevel,
  validateThinkingLevelForArgon,
} from '@/lib/video-utils';
import {
  ensureActiveGeminiFile,
  findVideoInServerVault,
} from '@/lib/server-video-vault';

export const runtime = 'nodejs';

const CINEMA_SYSTEM_INSTRUCTION = `Eres un director de fotografía, montador cinematográfico y analista de guion de primer nivel trabajando en KinoScope Studio.
Analizas vídeos cinematográficos completos o escenas acotadas mediante códigos de tiempo usando el modelo gemini-4-argon.
Reglas de respuesta:
1. Responde siempre en español con precisión técnica cinematográfica (encuadre, óptica estimada, movimiento de cámara, relación de contraste, temperatura de color, montaje, diseño sonoro y subtexto dramático).
2. Incluye siempre marcas de tiempo exactas entre corchetes en formato [MM:SS] (por ejemplo [00:18], [01:05], [02:30]) vinculadas a cada hallazgo visual para que el usuario pueda saltar a ese fotograma en el monitor de vídeo.
3. Estructura tu análisis con subtítulos claros y viñetas concisas.`;

function toSdkThinkingLevel(level: SupportedThinkingLevel): ThinkingLevel {
  switch (level) {
    case 'LOW':
      return ThinkingLevel.LOW;
    case 'HIGH':
      return ThinkingLevel.HIGH;
    case 'MEDIUM':
    default:
      return ThinkingLevel.MEDIUM;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      fileUri,
      displayName,
      sizeBytes,
      mimeType = 'video/mp4',
      prompt,
      scope = 'full',
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
      prompt?: string;
      scope?: 'full' | 'scene';
      startOffset?: string;
      endOffset?: string;
      fps?: number;
      thinkingLevel?: string;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Debes escribir una consulta cinematográfica para analizar el vídeo.' },
        { status: 400 }
      );
    }

    if ((!fileUri || !fileUri.trim()) && (!fileName || !fileName.trim())) {
      return NextResponse.json(
        { error: 'Se requiere un vídeo registrado en File API o en la bóveda permanente para realizar el análisis.' },
        { status: 400 }
      );
    }

    const thinkingValidation = validateThinkingLevelForArgon(rawThinkingLevel);
    if (!thinkingValidation.valid) {
      return NextResponse.json(
        { error: thinkingValidation.error },
        { status: 400 }
      );
    }

    const resolvedThinkingLevel = thinkingValidation.level;
    const sdkThinkingLevel = toSdkThinkingLevel(resolvedThinkingLevel);

    try {
      const ai = getGeminiServerClient();

      // Ensure the Gemini File API resource is ACTIVE (auto-reuploads from permanent vault if >48h expired or 403)
      const scopeContext =
        scope === 'scene' && startOffset && endOffset
          ? `Analiza específicamente el fragmento de vídeo comprendido entre startOffset=${startOffset} y endOffset=${endOffset} (muestreado a ${fps} FPS). `
          : `Analiza la totalidad del vídeo cinematográfico (muestreado a ${fps} FPS). `;

      const runGenerate = async (targetUri: string, targetMime: string) => {
        const videoPart = buildVideoPart({
          fileUri: targetUri,
          mimeType: targetMime,
          startOffset: scope === 'scene' ? startOffset : undefined,
          endOffset: scope === 'scene' ? endOffset : undefined,
          fps,
        });

        return ai.models.generateContent({
          model: GEMINI_VIDEO_MODEL,
          contents: {
            parts: [
              videoPart,
              {
                text: `${scopeContext}\n\nConsulta del usuario: ${prompt.trim()}`,
              },
            ],
          },
          config: {
            systemInstruction: CINEMA_SYSTEM_INSTRUCTION,
            thinkingConfig: {
              thinkingLevel: sdkThinkingLevel,
            },
          },
        });
      };

      const runInlineGenerate = async (binPath: string, targetMime: string) => {
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
                text: `${scopeContext}\n\nConsulta del usuario: ${prompt.trim()}`,
              },
            ],
          },
          config: {
            systemInstruction: CINEMA_SYSTEM_INSTRUCTION,
            thinkingConfig: {
              thinkingLevel: sdkThinkingLevel,
            },
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
        response = await runGenerate(activeFile.fileUri, activeFile.mimeType);
      } catch (firstGenErr: unknown) {
        const errMsg = firstGenErr instanceof Error ? firstGenErr.message : String(firstGenErr);
        // If File API URI returned 403 PERMISSION_DENIED or 404 NOT_FOUND (e.g. uploaded under another API key/project),
        // force a re-upload from the permanent server vault and retry automatically.
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
            response = await runGenerate(activeFile.fileUri, activeFile.mimeType);
          } else {
            throw firstGenErr;
          }
        } catch (retryErr: unknown) {
          // Fallback: if the video is in .kinoscope_vault and <= 20MB, pass as inlineData
          const vaultMatch = await findVideoInServerVault({
            fileName,
            uri: fileUri,
            displayName,
            sizeBytes,
          });
          if (vaultMatch && vaultMatch.sizeBytes <= 20 * 1024 * 1024) {
            response = await runInlineGenerate(
              vaultMatch.binPath,
              vaultMatch.mimeType || mimeType
            );
          } else {
            throw retryErr;
          }
        }
      }

      const answerText =
        response.text ||
        'El modelo gemini-4-argon completó la lectura del vídeo sin texto adicional.';

      return NextResponse.json({
        answer: answerText,
        model: GEMINI_VIDEO_MODEL,
        thinkingLevel: resolvedThinkingLevel,
        citations: extractTimestampCitations(answerText),
        usedFileApi: Boolean(activeFile),
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
        videoMetadataApplied: {
          startOffset: scope === 'scene' ? startOffset : undefined,
          endOffset: scope === 'scene' ? endOffset : undefined,
          fps,
        },
      });
    } catch (sdkError: unknown) {
      const sdkMessage =
        sdkError instanceof Error
          ? sdkError.message
          : 'Error al invocar gemini-4-argon con la File API.';
      return NextResponse.json({ error: sdkMessage }, { status: 502 });
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error interno al procesar el análisis de vídeo.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
