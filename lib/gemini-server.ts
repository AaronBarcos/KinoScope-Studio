import { GoogleGenAI } from '@google/genai';

export const GEMINI_VIDEO_MODEL = 'gemini-4-argon';

export function resolveServerGeminiApiKey(explicitKey?: string): string {
  const candidates = [
    explicitKey,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ];

  for (const key of candidates) {
    if (key && typeof key === 'string' && key.trim() && key.trim() !== 'MY_GEMINI_API_KEY') {
      return key.trim();
    }
  }

  throw new Error(
    'GEMINI_API_KEY no está configurada en el servidor. Configúrala en tu archivo .env.local o en el panel Settings > Secrets.'
  );
}

export function getGeminiServerClient(explicitKey?: string): GoogleGenAI {
  const apiKey = resolveServerGeminiApiKey(explicitKey);

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
