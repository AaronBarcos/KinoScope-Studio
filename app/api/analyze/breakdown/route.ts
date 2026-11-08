import { NextRequest, NextResponse } from 'next/server';
import { ThinkingLevel, Type } from '@google/genai';
import { getGeminiServerClient, GEMINI_VIDEO_MODEL } from '@/lib/gemini-server';
import { getActiveGeminiFile } from '@/lib/gemini-files';
import { buildVideoPart, parseTimecodeToSeconds, validateAnalysisSettings } from '@/lib/video-utils';

export const runtime = 'nodejs';

const breakdownSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      sceneNumber: { type: Type.INTEGER, description: 'Número correlativo de la escena.' },
      title: { type: Type.STRING, description: 'Título breve y descriptivo de la escena.' },
      startTime: { type: Type.STRING, description: 'Momento de inicio en formato MM:SS.' },
      endTime: { type: Type.STRING, description: 'Momento de fin en formato MM:SS.' },
      shotType: { type: Type.STRING, description: 'Tipo de plano, explicado de forma sencilla.' },
      cameraMovement: { type: Type.STRING, description: 'Cómo se mueve la cámara.' },
      lightingAndColor: { type: Type.STRING, description: 'Luz y colores predominantes.' },
      narrativeAction: { type: Type.STRING, description: 'Qué ocurre en la escena, en una o dos frases.' },
      soundDesign: { type: Type.STRING, description: 'Música, sonidos o diálogos destacados.' },
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

const BREAKDOWN_PROMPT =
  'Divide este vídeo en sus escenas principales. Para cada una indica en español y con lenguaje sencillo: momento de inicio y fin (MM:SS), un título corto, qué ocurre, tipo de plano, movimiento de cámara, luz y color, y sonido.';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName, fileUri, fps, thinkingLevel } = body as {
      fileName?: string; fileUri?: string; fps?: unknown; thinkingLevel?: unknown;
    };
    const settingsCheck = validateAnalysisSettings({ fps, thinkingLevel });
    if (!settingsCheck.valid) {
      return NextResponse.json({ error: settingsCheck.error }, { status: 400 });
    }
    const settings = settingsCheck.settings;

    const activeFile = await getActiveGeminiFile({ fileName, fileUri });
    const ai = getGeminiServerClient();

    const response = await ai.models.generateContent({
      model: GEMINI_VIDEO_MODEL,
      contents: {
        parts: [
          buildVideoPart({ fileUri: activeFile.fileUri, mimeType: activeFile.mimeType, fps: settings.fps }),
          { text: BREAKDOWN_PROMPT },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel[settings.thinkingLevel] },
        responseMimeType: 'application/json',
        responseSchema: breakdownSchema,
      },
    });

    const parsed = JSON.parse((response.text ?? '[]').trim()) as Array<{
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

    return NextResponse.json({ scenes, model: GEMINI_VIDEO_MODEL, ...settings });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al detectar las escenas.';
    const status = message.includes('VIDEO_EXPIRED') ? 410 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
