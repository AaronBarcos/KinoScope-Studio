import { NextRequest, NextResponse } from 'next/server';
import { ThinkingLevel } from '@google/genai';
import { getGeminiServerClient, GEMINI_VIDEO_MODEL } from '@/lib/gemini-server';
import {
  buildVideoPart,
  extractTimestampCitations,
  SupportedThinkingLevel,
  validateThinkingLevelForArgon,
} from '@/lib/video-utils';

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
      fileUri,
      mimeType = 'video/mp4',
      prompt,
      scope = 'full',
      startOffset,
      endOffset,
      fps = 1,
      thinkingLevel: rawThinkingLevel = 'MEDIUM',
    } = body as {
      fileUri?: string;
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

    if (!fileUri || !fileUri.trim()) {
      return NextResponse.json(
        { error: 'Se requiere un vídeo registrado en File API (fileUri) para realizar el análisis.' },
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

      const videoPart = buildVideoPart({
        fileUri,
        mimeType,
        startOffset: scope === 'scene' ? startOffset : undefined,
        endOffset: scope === 'scene' ? endOffset : undefined,
        fps,
      });

      const scopeContext =
        scope === 'scene' && startOffset && endOffset
          ? `Analiza específicamente el fragmento de vídeo comprendido entre startOffset=${startOffset} y endOffset=${endOffset} (muestreado a ${fps} FPS). `
          : `Analiza la totalidad del vídeo cinematográfico (muestreado a ${fps} FPS). `;

      const response = await ai.models.generateContent({
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

      const answerText =
        response.text ||
        'El modelo gemini-4-argon completó la lectura del vídeo sin texto adicional.';

      return NextResponse.json({
        answer: answerText,
        model: GEMINI_VIDEO_MODEL,
        thinkingLevel: resolvedThinkingLevel,
        citations: extractTimestampCitations(answerText),
        usedFileApi: true,
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
