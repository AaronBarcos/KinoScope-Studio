import { NextRequest, NextResponse } from 'next/server';
import { ThinkingLevel, type Content } from '@google/genai';
import { getGeminiServerClient, GEMINI_VIDEO_MODEL } from '@/lib/gemini-server';
import { getActiveGeminiFile } from '@/lib/gemini-files';
import { buildVideoPart, extractTimestampCitations, validateAnalysisSettings, validateSceneRange } from '@/lib/video-utils';

export const runtime = 'nodejs';

const CINEMA_SYSTEM_INSTRUCTION = `Eres un experto en cine (dirección de fotografía, montaje y guion) que ayuda a cualquier persona a entender un vídeo en KinoScope.
Reglas de respuesta:
1. Responde siempre en español, con un tono cercano y claro. Si usas un término técnico, explícalo en pocas palabras.
2. Incluye marcas de tiempo exactas entre corchetes en formato [MM:SS] (por ejemplo [00:18] o [01:05]) junto a cada cosa que señales, para que el usuario pueda saltar a ese momento del vídeo.
3. Organiza la respuesta con subtítulos cortos y viñetas breves. Evita párrafos largos.`;

const MAX_HISTORY_TURNS = 6;

interface HistoryTurn {
  prompt?: string;
  answer?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      fileUri,
      prompt,
      startOffset,
      endOffset,
      history = [],
      fps,
      thinkingLevel,
    } = body as {
      fileName?: string;
      fileUri?: string;
      prompt?: string;
      startOffset?: string;
      endOffset?: string;
      history?: HistoryTurn[];
      fps?: unknown;
      thinkingLevel?: unknown;
    };

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Escribe una pregunta sobre el vídeo.' },
        { status: 400 }
      );
    }

    const settingsCheck = validateAnalysisSettings({ fps, thinkingLevel });
    if (!settingsCheck.valid) {
      return NextResponse.json({ error: settingsCheck.error }, { status: 400 });
    }
    const settings = settingsCheck.settings;
    const isFragment = startOffset !== undefined || endOffset !== undefined;
    if (isFragment && (typeof startOffset !== 'string' || typeof endOffset !== 'string' || !validateSceneRange(startOffset, endOffset).valid)) {
      return NextResponse.json({ error: 'Selecciona un inicio y un fin válidos para el fragmento.' }, { status: 400 });
    }
    const activeFile = await getActiveGeminiFile({ fileName, fileUri });
    if (isFragment && !validateSceneRange(startOffset!, endOffset!, activeFile.durationSeconds).valid) {
      return NextResponse.json({ error: 'El fragmento supera la duración del vídeo.' }, { status: 400 });
    }

    const scopeContext = isFragment
      ? `Céntrate solo en el fragmento del vídeo entre ${startOffset} y ${endOffset}. Usa marcas de tiempo absolutas respecto al vídeo original, sin reiniciar el contador al inicio del fragmento. `
      : 'Ten en cuenta el vídeo completo. ';

    const previousTurns: Content[] = (Array.isArray(history) ? history : [])
      .filter((t) => t && typeof t.prompt === 'string' && typeof t.answer === 'string')
      .slice(-MAX_HISTORY_TURNS)
      .flatMap((t) => [
        { role: 'user', parts: [{ text: String(t.prompt) }] },
        { role: 'model', parts: [{ text: String(t.answer) }] },
      ]);

    const ai = getGeminiServerClient();
    const response = await ai.models.generateContent({
      model: GEMINI_VIDEO_MODEL,
      contents: [
        ...previousTurns,
        {
          role: 'user',
          parts: [
            buildVideoPart({
              fileUri: activeFile.fileUri,
              mimeType: activeFile.mimeType,
              startOffset: isFragment ? startOffset : undefined,
              endOffset: isFragment ? endOffset : undefined,
              fps: settings.fps,
            }),
            { text: `${scopeContext}\n\nPregunta: ${prompt.trim()}` },
          ],
        },
      ],
      config: {
        systemInstruction: CINEMA_SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: ThinkingLevel[settings.thinkingLevel] },
      },
    });

    const answerText =
      response.text || 'No he encontrado nada que comentar sobre esta pregunta.';

    return NextResponse.json({
      answer: answerText,
      model: GEMINI_VIDEO_MODEL,
      ...settings,
      citations: extractTimestampCitations(answerText),
      file: {
        expirationTime: activeFile.expirationTime,
        durationSeconds: activeFile.durationSeconds,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al analizar el vídeo.';
    const status = message.includes('VIDEO_EXPIRED') ? 410 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
