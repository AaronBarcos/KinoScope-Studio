'use client';

import React, { useState } from 'react';
import {
  Send,
  Clock,
  Sliders,
  Download,
  AlertCircle,
  Loader2,
  BookmarkCheck,
  Cpu,
  Trash2,
  Cloud,
  HardDrive,
  LogIn,
  LogOut,
  Search,
  Film,
} from 'lucide-react';
import {
  AnalysisQueryRecord,
  formatSecondsToTimecode,
  normalizeSceneRange,
  parseTimecodeToSeconds,
  SupportedThinkingLevel,
  THINKING_LEVEL_OPTIONS,
  validateSceneRange,
} from '@/lib/video-utils';

interface AnalysisInspectorProps {
  activeVideoId?: string | null;
  activeVideoTitle?: string;
  scope: 'full' | 'scene';
  onScopeChange: (scope: 'full' | 'scene') => void;
  startTimecode: string;
  endTimecode: string;
  onStartTimecodeChange: (tc: string) => void;
  onEndTimecodeChange: (tc: string) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  thinkingLevel: SupportedThinkingLevel;
  onThinkingLevelChange: (level: SupportedThinkingLevel) => void;
  maxDurationSec?: number;
  isAnalyzing: boolean;
  errorBanner: string | null;
  onSubmitQuery: (prompt: string) => Promise<void>;
  analyses: AnalysisQueryRecord[];
  onDeleteAnalysis: (analysisId: string) => void;
  onSeekToTimestamp: (seconds: number) => void;
  onExportMarkdown: () => void;
  userEmail?: string | null;
  isAuthReady?: boolean;
  onSignInGoogle?: () => void;
  onSignOut?: () => void;
}

const PRESET_PROMPTS = [
  {
    label: 'Iluminación y Color',
    prompt:
      'Analiza el esquema de iluminación, la relación de contraste y la evolución de la temperatura de color indicando marcas de tiempo exactas [MM:SS].',
  },
  {
    label: 'Cámara y Óptica',
    prompt:
      'Identifica los tipos de plano, distancia focal aproximada y movimientos de cámara clave en cada corte con sus códigos de tiempo [MM:SS].',
  },
  {
    label: 'Raccord y Montaje',
    prompt:
      'Evalúa el ritmo de montaje, la duración de los planos y la continuidad visual y espacial entre cortes [MM:SS].',
  },
  {
    label: 'Subtexto y Sonido',
    prompt:
      'Explica cómo interactúan el diseño sonoro, el encuadre y la puesta en escena para construir tensión dramática [MM:SS].',
  },
];

export function AnalysisInspector({
  activeVideoId,
  activeVideoTitle,
  scope,
  onScopeChange,
  startTimecode,
  endTimecode,
  onStartTimecodeChange,
  onEndTimecodeChange,
  fps,
  onFpsChange,
  thinkingLevel,
  onThinkingLevelChange,
  maxDurationSec,
  isAnalyzing,
  errorBanner,
  onSubmitQuery,
  analyses,
  onDeleteAnalysis,
  onSeekToTimestamp,
  onExportMarkdown,
  userEmail,
  isAuthReady = true,
  onSignInGoogle,
  onSignOut,
}: AnalysisInspectorProps) {
  const [promptText, setPromptText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'active'>('all');
  const [historySearch, setHistorySearch] = useState('');

  const activeThinkingMeta =
    THINKING_LEVEL_OPTIONS.find((opt) => opt.value === thinkingLevel) ||
    THINKING_LEVEL_OPTIONS[1];

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!promptText.trim()) {
      setFormError(
        'Escribe una pregunta o selecciona una pauta de análisis antes de consultar.'
      );
      return;
    }

    if (scope === 'scene') {
      const rangeCheck = validateSceneRange(
        startTimecode,
        endTimecode,
        maxDurationSec
      );
      if (!rangeCheck.valid) {
        setFormError(
          rangeCheck.error || 'El intervalo de escena indicado no es válido.'
        );
        return;
      }
    }

    const toSend = promptText.trim();
    await onSubmitQuery(toSend);
    setPromptText('');
  };

  const filteredAnalyses = analyses.filter((item) => {
    if (
      historyFilter === 'active' &&
      activeVideoId &&
      item.videoId !== activeVideoId &&
      item.videoTitle !== activeVideoTitle
    ) {
      return false;
    }
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      return (
        item.prompt.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.videoTitle.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <aside
      id="consultas-section"
      aria-label="Inspector de consultas con Gemini 4 Argon"
      className="flex flex-col border border-slate-800 bg-slate-900/70 rounded-xl overflow-hidden"
    >
      {/* Inspector Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950/60">
        <div>
          <h2 className="text-base font-display font-semibold text-white">
            Consultas a Gemini 4 Argon
          </h2>
          <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
            models/gemini-4-argon · Thinking {thinkingLevel}
          </p>
        </div>

        <button
          type="button"
          onClick={onExportMarkdown}
          aria-label="Exportar informe en Markdown"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-amber-400" />
          <span>Exportar Informe</span>
        </button>
      </div>

      {/* Persistence & Cloud Sync Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-950/90 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {userEmail ? (
            <>
              <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-300 truncate">
                Guardado en Firebase:{' '}
                <strong className="font-mono text-slate-100">{userEmail}</strong>
              </span>
            </>
          ) : (
            <>
              <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-slate-300 truncate">
                Guardado automático local · Conecta Firebase para sincronizar
              </span>
            </>
          )}
        </div>

        {isAuthReady && (
          <div className="shrink-0">
            {userEmail ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-800 bg-slate-900 text-[11px] text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
              >
                <LogOut className="w-3 h-3 text-slate-400" />
                <span>Salir</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInGoogle}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                <LogIn className="w-3 h-3" />
                <span>Sincronizar en Nube</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Query Configuration & Form */}
      <form
        onSubmit={handleFormSubmit}
        className="p-4 space-y-4 border-b border-slate-800"
      >
        {/* Scope Segmented Selector */}
        <div>
          <span className="block text-xs font-medium text-slate-300 mb-1.5">
            Ámbito Temporal de Análisis
          </span>
          <div
            role="group"
            aria-label="Seleccionar ámbito de análisis"
            className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
          >
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                onScopeChange('full');
              }}
              className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                scope === 'full'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Vídeo Completo
            </button>
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                onScopeChange('scene');
              }}
              className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                scope === 'scene'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Escena Acotada (Offsets)
            </button>
          </div>
        </div>

        {/* Scene Start/End Offset Controls */}
        {scope === 'scene' && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/80">
            <div>
              <label
                htmlFor="scene-start-input"
                className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 mb-1"
              >
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Inicio (startOffset)</span>
              </label>
              <input
                id="scene-start-input"
                type="text"
                value={startTimecode}
                onChange={(e) => {
                  setFormError(null);
                  onStartTimecodeChange(e.target.value);
                }}
                onBlur={() => {
                  const parsedStart = parseTimecodeToSeconds(startTimecode);
                  const parsedEnd = parseTimecodeToSeconds(endTimecode);
                  if (parsedStart !== null) {
                    const norm = normalizeSceneRange(
                      parsedStart,
                      parsedEnd ?? (maxDurationSec || 60),
                      maxDurationSec,
                      'start'
                    );
                    onStartTimecodeChange(norm.startTimecode);
                    onEndTimecodeChange(norm.endTimecode);
                  }
                }}
                placeholder="00:00"
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="scene-end-input"
                className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 mb-1"
              >
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Fin (endOffset)</span>
              </label>
              <input
                id="scene-end-input"
                type="text"
                value={endTimecode}
                onChange={(e) => {
                  setFormError(null);
                  onEndTimecodeChange(e.target.value);
                }}
                onBlur={() => {
                  const parsedStart = parseTimecodeToSeconds(startTimecode);
                  const parsedEnd = parseTimecodeToSeconds(endTimecode);
                  if (parsedEnd !== null) {
                    const norm = normalizeSceneRange(
                      parsedStart ?? 0,
                      parsedEnd,
                      maxDurationSec,
                      'end'
                    );
                    onStartTimecodeChange(norm.startTimecode);
                    onEndTimecodeChange(norm.endTimecode);
                  }
                }}
                placeholder={formatSecondsToTimecode(maxDurationSec || 60)}
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Thinking Level Selector (thinkingConfig.thinkingLevel) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span>Nivel de Thinking (thinkingLevel)</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-amber-400">
              ThinkingLevel.{thinkingLevel}
            </span>
          </div>

          <div
            role="group"
            aria-label="Seleccionar nivel de thinking del modelo"
            className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
          >
            {THINKING_LEVEL_OPTIONS.map((opt) => {
              const isSelected = thinkingLevel === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onThinkingLevelChange(opt.value)}
                  aria-pressed={isSelected}
                  className={`py-1.5 px-1.5 text-[11px] font-mono tabular-nums font-medium rounded-md transition-colors whitespace-nowrap shrink-0 truncate ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            {activeThinkingMeta.description}
          </p>
        </div>

        {/* FPS Frame Sampling Control */}
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="fps-select"
            className="flex items-center gap-1.5 text-xs text-slate-300"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Densidad de muestreo (videoMetadata.fps)</span>
          </label>
          <select
            id="fps-select"
            value={fps}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value={0.5}>0.5 FPS (Largometraje)</option>
            <option value={1}>1.0 FPS (Estándar)</option>
            <option value={2}>2.0 FPS (Escena Rápida)</option>
            <option value={5}>5.0 FPS (Acción / Corte)</option>
          </select>
        </div>

        {/* Preset Quick Prompts */}
        <div>
          <span className="block text-[11px] text-slate-400 mb-1.5">
            Pautas de análisis técnico rápido:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_PROMPTS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setFormError(null);
                  setPromptText(preset.prompt);
                }}
                className="px-2.5 py-1 rounded-md border border-slate-800 bg-slate-950 text-xs text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Textarea */}
        <div>
          <label
            htmlFor="cinema-prompt-textarea"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Pregunta sobre la película o escena seleccionada
          </label>
          <textarea
            id="cinema-prompt-textarea"
            rows={3}
            value={promptText}
            onChange={(e) => {
              if (formError) setFormError(null);
              setPromptText(e.target.value);
            }}
            placeholder="Ej. ¿Cómo cambia la relación entre los personajes en el plano de [00:58] y qué papel juega la luz lateral?"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none resize-none"
          />
        </div>

        {(formError || errorBanner) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-900/70 bg-red-950/40 p-2.5 text-xs text-red-200"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{formError || errorBanner}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isAnalyzing}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Analizando con gemini-4-argon (Thinking {thinkingLevel})...
              </span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>
                {scope === 'scene'
                  ? `Analizar Escena (${startTimecode} – ${endTimecode})`
                  : 'Analizar Vídeo Completo'}
              </span>
            </>
          )}
        </button>
      </form>

      {/* Saved Analysis Log / Responses */}
      <div className="p-4 space-y-3 max-h-[640px] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-200">
            Historial Guardado de Chats y Análisis
          </span>
          <span className="font-mono tabular-nums">
            {filteredAnalyses.length} / {analyses.length} guardados
          </span>
        </div>

        {/* History Filter & Search Controls */}
        {analyses.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setHistoryFilter('all')}
                className={`py-1 px-2 text-[11px] font-medium rounded transition-colors ${
                  historyFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Todos los Vídeos ({analyses.length})
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilter('active')}
                className={`py-1 px-2 text-[11px] font-medium rounded transition-colors ${
                  historyFilter === 'active'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Vídeo Activo
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar en tus análisis guardados..."
                className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        {isAnalyzing && (
          <div
            aria-label="Cargando respuesta de Gemini 4 Argon"
            className="p-4 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2.5 animate-pulse"
          >
            <div className="h-3 w-2/5 bg-slate-800 rounded" />
            <div className="h-3 w-full bg-slate-800 rounded" />
            <div className="h-3 w-5/6 bg-slate-800 rounded" />
          </div>
        )}

        {!isAnalyzing && filteredAnalyses.length === 0 && (
          <div className="p-6 text-center space-y-1.5 border border-slate-800/80 rounded-lg bg-slate-950/40">
            <p className="text-xs text-slate-300 font-medium">
              {analyses.length === 0
                ? 'Sin análisis cinematográficos guardados aún'
                : 'No hay análisis que coincidan con el filtro actual'}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
              Cada consulta realizada a Gemini 4 Argon se guarda automáticamente
              en tu historial local y en Firebase Firestore.
            </p>
          </div>
        )}

        {filteredAnalyses.map((item) => (
          <article
            key={item.id}
            className="p-4 rounded-lg border border-slate-800 bg-slate-950/70 space-y-3"
          >
            {/* Header Metadata & Delete Action */}
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium truncate">
                  <Film className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="truncate">{item.videoTitle}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-400">
                  <span className="text-amber-400 font-medium">{item.model}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.scope === 'scene'
                      ? `Escena ${item.startTimecode}–${item.endTimecode}`
                      : 'Película Completa'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{item.fps} FPS</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300">
                    Thinking: {item.thinkingLevel || 'MEDIUM'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onDeleteAnalysis(item.id)}
                aria-label="Eliminar análisis guardado"
                className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-xs font-medium text-slate-200 border-b border-slate-800/80 pb-2">
              {item.prompt}
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-2">
              {item.answer.split('\n').map((rawLine, idx) => {
                const line = rawLine.trim();
                if (!line) return null;
                if (line.startsWith('### ')) {
                  return (
                    <h4
                      key={idx}
                      className="text-xs font-display font-semibold text-amber-300 pt-1"
                    >
                      {line.replace(/^###\s+/, '').replace(/\*\*/g, '')}
                    </h4>
                  );
                }
                const cleaned = line.replace(/^[-*]\s+/, '• ');
                const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
                return (
                  <p key={idx} className="text-slate-300">
                    {parts.map((part, pIdx) =>
                      part.startsWith('**') && part.endsWith('**') ? (
                        <strong
                          key={pIdx}
                          className="font-semibold text-slate-100"
                        >
                          {part.slice(2, -2)}
                        </strong>
                      ) : (
                        <span key={pIdx}>{part}</span>
                      )
                    )}
                  </p>
                );
              })}
            </div>

            {/* Interactive Timestamp Jump Citations */}
            {item.citations.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80">
                <span className="block text-[11px] text-slate-400 mb-1.5 flex items-center gap-1">
                  <BookmarkCheck className="w-3 h-3 text-amber-400" />
                  <span>Saltar al código de tiempo citado en el monitor:</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {item.citations.map((cit) => (
                    <button
                      key={`${item.id}-${cit.seconds}`}
                      type="button"
                      onClick={() => onSeekToTimestamp(cit.seconds)}
                      className="px-2 py-1 rounded border border-slate-800 bg-slate-900 font-mono tabular-nums text-[11px] text-amber-300 hover:bg-amber-500 hover:text-slate-950 transition-colors whitespace-nowrap shrink-0"
                    >
                      Ir a {cit.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}
