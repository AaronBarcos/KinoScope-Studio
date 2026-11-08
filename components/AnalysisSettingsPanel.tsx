'use client';

import { Brain, ScanLine } from 'lucide-react';
import { AnalysisSettings, THINKING_LEVEL_OPTIONS } from '@/lib/video-utils';

interface Props {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
  disabled: boolean;
  sampledDuration: number;
}

export function AnalysisSettingsPanel({ settings, onChange, disabled, sampledDuration }: Props) {
  return (
    <section aria-label="Ajustes del análisis" className="rounded-2xl border border-white/10 bg-[#15171d] px-4 py-4 sm:px-5">
      <div className="grid gap-5 md:grid-cols-[1fr_260px] md:items-center">
        <fieldset disabled={disabled} className="min-w-0 disabled:opacity-60">
          <legend className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <Brain className="h-4 w-4 text-amber-400" /> Cuánto piensa el modelo
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {THINKING_LEVEL_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={settings.thinkingLevel === option.value}
                title={option.description}
                onClick={() => onChange({ ...settings, thinkingLevel: option.value })}
                className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-wait ${settings.thinkingLevel === option.value ? 'border-amber-400/60 bg-amber-400/10 text-amber-200' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/5'}`}>
                <span className="block text-xs font-semibold">{option.label}</span>
                <span className="mt-1 hidden text-[11px] leading-relaxed text-zinc-400 sm:block">{option.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="analysis-fps" className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <ScanLine className="h-4 w-4 text-amber-400" /> Fotogramas que ve el modelo
          </label>
          <select id="analysis-fps" value={settings.fps} disabled={disabled}
            onChange={(event) => onChange({ ...settings, fps: Number(event.target.value) })}
            className="w-full rounded-xl border border-white/15 bg-[#101218] px-3 py-2 text-sm text-white disabled:opacity-60">
            {[0.25, 0.5, 1, 2, 4, 5, 8, 10, 12, 15, 24].map((fps) => (
              <option key={fps} value={fps}>{fps.toLocaleString('es-ES')} FPS{fps === 1 ? ' · predeterminado' : ''}</option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            Más FPS permiten ver más detalle en movimientos rápidos y consumen más tokens.
            {' '}≈ {Math.ceil(sampledDuration * settings.fps).toLocaleString('es-ES')} fotogramas en el intervalo actual.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">Se aplican a las próximas preguntas y a la detección de escenas. Preferencias guardadas en este navegador.</p>
    </section>
  );
}
