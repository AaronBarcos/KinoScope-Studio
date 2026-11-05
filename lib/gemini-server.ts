import { GoogleGenAI } from '@google/genai';

export const GEMINI_VIDEO_MODEL = 'gemini-4-argon';

export function getGeminiServerClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el servidor. Verifica el panel Settings > Secrets.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
