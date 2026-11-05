'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Film,
  Upload,
  RotateCcw,
  FolderOpen,
  MousePointer,
  Magnet,
  Layers,
  Volume2,
  Eye,
  Lock,
  Sparkles,
  Loader2,
  Crosshair,
  Bookmark,
} from 'lucide-react';
import {
  formatSecondsToTimecode,
  normalizeSceneRange,
  UploadedGeminiVideo,
  VideoSceneItem,
} from '@/lib/video-utils';

interface CinemaMonitorProps {
  video: UploadedGeminiVideo | null;
  scenes: VideoSceneItem[];
  currentTimeSec: number;
  onTimeChange: (sec: number) => void;
  scope: 'full' | 'scene';
  onScopeChange?: (scope: 'full' | 'scene') => void;
  startSec?: number;
  endSec?: number;
  onRangeChange: (
    startSec: number,
    endSec: number,
    changedHandle?: 'start' | 'end'
  ) => void;
  onSetStartFromPlayhead: (sec: number) => void;
  onSetEndFromPlayhead: (sec: number) => void;
  onSelectSceneRange: (scene: VideoSceneItem) => void;
  onDurationDetected?: (
    videoId: string,
    durationSec: number,
    aspectRatio?: string
  ) => void;
  onAttachLocalVideoFile?: (videoId: string, file: File) => void;
  onOpenUpload?: () => void;
  citations?: Array<{ label: string; seconds: number }>;
  isGeneratingBreakdown?: boolean;
  onGenerateBreakdown?: () => void;
}

// Deterministic pseudo-waveform heights for the A1 Audio Track in the NLE Timeline
const WAVEFORM_BARS = Array.from({ length: 72 }, (_, idx) => {
  const v = Math.abs(Math.sin(idx * 0.65) * Math.cos(idx * 0.23));
  return Math.max(18, Math.min(95, Math.round(v * 90 + (idx % 5) * 6)));
});

export function CinemaMonitor({
  video,
  scenes,
  currentTimeSec,
  onTimeChange,
  scope,
  onScopeChange,
  startSec = 0,
  endSec = 60,
  onRangeChange,
  onSetStartFromPlayhead,
  onSetEndFromPlayhead,
  onSelectSceneRange,
  onDurationDetected,
  onAttachLocalVideoFile,
  onOpenUpload,
  citations = [],
  isGeneratingBreakdown = false,
  onGenerateBreakdown,
}: CinemaMonitorProps) {
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [loadedMetaDuration, setLoadedMetaDuration] = useState<{
    videoId: string;
    seconds: number;
  } | null>(null);
  const [failedStreamVideoId, setFailedStreamVideoId] = useState<string | null>(
    null
  );
  const [showGuides, setShowGuides] = useState(false);
  const [activeTool, setActiveTool] = useState<'select' | 'razor' | 'trim'>(
    'select'
  );
  const [snapEnabled, setSnapEnabled] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localRelinkInputRef = useRef<HTMLInputElement | null>(null);
  const rangeTrackRef = useRef<HTMLDivElement | null>(null);
  const playTimeRef = useRef<number>(currentTimeSec);

  const isPlaying = Boolean(video && playingVideoId === video.id);

  // Determine playable media URL: prefer local blob URL, then server stream URL when cached on server
  const playbackUrl = video
    ? video.localObjectUrl ||
      (video.hasServerCache ? video.streamUrl : undefined)
    : undefined;

  const hasStreamError = Boolean(
    video && failedStreamVideoId === video.id && !video.localObjectUrl
  );

  const knownDurationSec = video
    ? loadedMetaDuration?.videoId === video.id
      ? loadedMetaDuration.seconds
      : video.durationSeconds
    : undefined;

  const safeDuration = Math.max(1, knownDurationSec || 60);

  const normalizedRange = normalizeSceneRange(
    startSec,
    endSec,
    safeDuration
  );
  const clampedStartSec = normalizedRange.startSec;
  const clampedEndSec = normalizedRange.endSec;
  const clipDurationSec = Math.max(1, clampedEndSec - clampedStartSec);

  useEffect(() => {
    playTimeRef.current = currentTimeSec;
    const el = videoRef.current;
    if (el && Math.abs(el.currentTime - currentTimeSec) > 0.5) {
      try {
        el.currentTime = currentTimeSec;
      } catch {
        // Ignore seek before metadata ready
      }
    }
  }, [currentTimeSec]);

  // Fallback timer only when playing a video whose media stream is unavailable locally
  useEffect(() => {
    if (!isPlaying || !video || !hasStreamError) return;
    const interval = window.setInterval(() => {
      const next = playTimeRef.current + 0.25;
      if (
        scope === 'scene' &&
        clampedEndSec > clampedStartSec &&
        next >= clampedEndSec
      ) {
        playTimeRef.current = clampedStartSec;
        onTimeChange(clampedStartSec);
        setPlayingVideoId(null);
      } else if (safeDuration > 0 && next >= safeDuration) {
        playTimeRef.current = 0;
        onTimeChange(0);
        setPlayingVideoId(null);
      } else {
        playTimeRef.current = next;
        onTimeChange(Math.floor(next));
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [
    isPlaying,
    video,
    hasStreamError,
    safeDuration,
    scope,
    clampedStartSec,
    clampedEndSec,
    onTimeChange,
  ]);

  const activeScene =
    scenes.length > 0
      ? scenes.find(
          (s) =>
            currentTimeSec >= s.startSeconds && currentTimeSec < s.endSeconds
        ) || scenes[scenes.length - 1]
      : null;

  const seekVideoTo = (targetSec: number) => {
    const bounded = Math.max(0, Math.min(safeDuration, Math.round(targetSec)));
    onTimeChange(bounded);
    if (videoRef.current && !hasStreamError) {
      try {
        videoRef.current.currentTime = bounded;
      } catch {
        // Ignore seek error
      }
    }
  };

  const togglePlay = () => {
    if (!video) return;
    const el = videoRef.current;
    if (el && !hasStreamError) {
      if (el.paused) {
        // If scoped to a scene and playhead is outside [start, end), jump to start of scene
        if (
          scope === 'scene' &&
          (el.currentTime < clampedStartSec ||
            el.currentTime >= clampedEndSec - 0.2)
        ) {
          el.currentTime = clampedStartSec;
          onTimeChange(clampedStartSec);
        }
        el.play()
          .then(() => {
            setPlayingVideoId(video.id);
          })
          .catch(() => {
            setPlayingVideoId(null);
          });
      } else {
        el.pause();
        setPlayingVideoId(null);
      }
    } else {
      setPlayingVideoId((prev) => (prev === video.id ? null : video.id));
    }
  };

  const stepSeconds = (delta: number) => {
    if (!video) return;
    seekVideoTo(currentTimeSec + delta);
  };

  const handleStartRangeInput = (newStartRaw: number) => {
    const next = normalizeSceneRange(
      newStartRaw,
      clampedEndSec,
      safeDuration,
      'start'
    );
    onRangeChange(next.startSec, next.endSec, 'start');
    seekVideoTo(next.startSec);
  };

  const handleEndRangeInput = (newEndRaw: number) => {
    const next = normalizeSceneRange(
      clampedStartSec,
      newEndRaw,
      safeDuration,
      'end'
    );
    onRangeChange(next.startSec, next.endSec, 'end');
    seekVideoTo(next.endSec);
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rangeTrackRef.current) return;
    // Only handle clicks directly on the track background (not thumb drags)
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const rect = rangeTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const clickedSec = Math.round(ratio * safeDuration);

    if (activeTool === 'select') {
      // In selection/scrub mode, also move playhead or nearest In/Out handle
      const distToStart = Math.abs(clickedSec - clampedStartSec);
      const distToEnd = Math.abs(clickedSec - clampedEndSec);

      if (distToStart <= distToEnd) {
        handleStartRangeInput(clickedSec);
      } else {
        handleEndRangeInput(clickedSec);
      }
    } else {
      const distToStart = Math.abs(clickedSec - clampedStartSec);
      const distToEnd = Math.abs(clickedSec - clampedEndSec);

      if (distToStart <= distToEnd) {
        handleStartRangeInput(clickedSec);
      } else {
        handleEndRangeInput(clickedSec);
      }
    }
  };

  const startPct = Math.min(
    100,
    Math.max(0, (clampedStartSec / safeDuration) * 100)
  );
  const endPct = Math.min(
    100,
    Math.max(startPct, (clampedEndSec / safeDuration) * 100)
  );
  const playheadPct = Math.min(
    100,
    Math.max(0, (Math.min(currentTimeSec, safeDuration) / safeDuration) * 100)
  );

  // Elevate start thumb z-index when near the right edge so it never gets trapped under end thumb
  const startThumbOnTop = clampedStartSec > safeDuration * 0.85;

  // Timecode ruler marks (5 intervals across duration)
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    pct: pct * 100,
    label: formatSecondsToTimecode(Math.round(pct * safeDuration)),
  }));

  return (
    <section
      aria-label="Monitor de referencia cinematográfica"
      className="flex flex-col gap-1.5"
    >
      {/* =====================================================================
          TOP PANEL: NLE PROGRAM MONITOR (Pantalla Central como Premiere / DaVinci)
         ===================================================================== */}
      <div className="border border-slate-800/90 bg-[#10131a] rounded-md overflow-hidden flex flex-col shadow-lg">
        {/* NLE Monitor Panel Tab Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-800/90 bg-[#0a0c11] text-xs text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 -my-1.5 border-t-2 border-amber-500 bg-[#141821] text-slate-100 font-medium text-[11px] tracking-wide">
              <Film className="w-3 h-3 text-amber-400 shrink-0" />
              <span>Monitor de Programa</span>
            </span>
            <span className="text-slate-600" aria-hidden="true">
              |
            </span>
            {video ? (
              <>
                <span className="font-medium text-slate-200 truncate max-w-[180px] sm:max-w-[240px]">
                  {video.displayName}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono tabular-nums text-[10px] text-slate-300 whitespace-nowrap shrink-0">
                  {video.aspectRatio || '16:9'}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 font-mono tabular-nums text-[10px] text-emerald-400 whitespace-nowrap shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {video.state}
                </span>
              </>
            ) : (
              <span className="text-slate-500 font-mono text-[11px]">
                Sin clip en secuencia
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
            <span className="px-2 py-0.5 rounded bg-[#07080c] border border-slate-800/90 text-[11px] whitespace-nowrap">
              TC{' '}
              <strong className="text-amber-400">
                {formatSecondsToTimecode(currentTimeSec, true)}
              </strong>{' '}
              <span className="text-slate-600">/</span>{' '}
              <span className="text-slate-400">
                {knownDurationSec
                  ? formatSecondsToTimecode(knownDurationSec, true)
                  : formatSecondsToTimecode(safeDuration, true)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setShowGuides((g) => !g)}
              className={`px-2 py-0.5 rounded border text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                showGuides
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:border-slate-700'
              }`}
            >
              {showGuides ? 'Ocultar Retícula' : 'Mostrar Retícula'}
            </button>
          </div>
        </div>

        {/* Main Video Player Canvas (NLE Center Viewer) */}
        <div className="relative bg-[#040507] aspect-video max-h-[38vh] xl:max-h-[43vh] w-full overflow-hidden flex items-center justify-center border-b border-slate-800/90">
          {!video ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#06080c]">
              <div className="w-11 h-11 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-center mb-2.5">
                <Film className="w-5 h-5 text-amber-400/80" />
              </div>
              <h3 className="text-sm font-display font-semibold text-slate-200">
                Monitor de Programa — Sin bobina activa
              </h3>
              <p className="text-xs text-slate-400 max-w-md mt-1 mb-3.5 leading-relaxed">
                Importa un vídeo en el panel izquierdo (Proyecto / Medios) o
                sube un archivo de hasta 2.00 GB a Gemini File API para cargarlo
                en el monitor y en la línea de tiempo inferior.
              </p>
              {onOpenUpload && (
                <button
                  type="button"
                  onClick={onOpenUpload}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir Vídeo a File API</span>
                </button>
              )}
            </div>
          ) : playbackUrl && !hasStreamError ? (
            <video
              key={`${video.id}-${playbackUrl}`}
              ref={videoRef}
              src={playbackUrl}
              preload="metadata"
              playsInline
              onClick={togglePlay}
              className="w-full h-full object-contain cursor-pointer bg-black"
              onTimeUpdate={(e) => {
                const rawTime = e.currentTarget.currentTime;
                const sec = Math.floor(rawTime);
                playTimeRef.current = sec;
                onTimeChange(sec);

                // Stop at scene end when playing a scoped scene clip
                if (
                  scope === 'scene' &&
                  !e.currentTarget.paused &&
                  clampedEndSec > clampedStartSec &&
                  rawTime >= clampedEndSec
                ) {
                  e.currentTarget.pause();
                  setPlayingVideoId(null);
                }
              }}
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration;
                if (dur && Number.isFinite(dur) && dur > 0) {
                  const rounded = Math.max(1, Math.round(dur));
                  setLoadedMetaDuration({
                    videoId: video.id,
                    seconds: rounded,
                  });
                  const ratio =
                    e.currentTarget.videoWidth > 0 &&
                    e.currentTarget.videoHeight > 0
                      ? `${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`
                      : undefined;
                  onDurationDetected?.(video.id, rounded, ratio);
                }
              }}
              onPlay={() => setPlayingVideoId(video.id)}
              onPause={() => setPlayingVideoId(null)}
              onEnded={() => setPlayingVideoId(null)}
              onError={() => {
                if (!video.localObjectUrl) {
                  setFailedStreamVideoId(video.id);
                }
              }}
            />
          ) : (
            <div
              data-testid="cinema-monitor-remote-fallback"
              className="w-full h-full flex flex-col items-center justify-center p-5 text-center bg-[#06080c]"
            >
              <Film className="w-7 h-7 text-amber-400 mb-2" />
              <p className="text-sm font-display font-semibold text-white">
                {video.displayName}
              </p>
              <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
                Este vídeo está activo en Gemini File API para análisis con IA
                {knownDurationSec
                  ? ` (Duración detectada: ${formatSecondsToTimecode(knownDurationSec)})`
                  : ''}
                , pero se subió desde otra sesión y el navegador no tiene aún el
                archivo local para previsualizar el fotograma.
              </p>
              {onAttachLocalVideoFile && (
                <div className="mt-3">
                  <input
                    ref={localRelinkInputRef}
                    type="file"
                    accept="video/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFailedStreamVideoId(null);
                        onAttachLocalVideoFile(video.id, file);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => localRelinkInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>
                      Vincular archivo de vídeo local para verlo en pantalla
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Broadcast Safe Area & Rule-of-Thirds Guides */}
          {showGuides && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              {/* Action Safe 90% & Title Safe 80% */}
              <div className="absolute inset-[5%] border border-cyan-400/25" />
              <div className="absolute inset-[10%] border border-amber-400/25" />
              {/* 3x3 Rule of Thirds */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                <div className="border-r border-b border-white/15" />
                <div className="border-r border-b border-white/15" />
                <div className="border-b border-white/15" />
                <div className="border-r border-b border-white/15" />
                <div className="border-r border-b border-white/15 flex items-center justify-center">
                  <Crosshair className="w-4 h-4 text-amber-400/40" />
                </div>
                <div className="border-b border-white/15" />
                <div className="border-r border-white/15" />
                <div className="border-r border-white/15" />
                <div />
              </div>
            </div>
          )}

          {/* Subtle NLE Monitor Bottom Overlay HUD */}
          {video && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3.5 pt-6 pb-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-mono tabular-nums text-amber-300/90 truncate">
                  {activeScene
                    ? `Escena 0${activeScene.sceneNumber} · ${activeScene.startTime} – ${activeScene.endTime} · ${activeScene.shotType}`
                    : `Posición ${formatSecondsToTimecode(currentTimeSec)} de ${formatSecondsToTimecode(safeDuration)}`}
                </p>
                <h2 className="text-xs font-display font-semibold text-white tracking-tight truncate">
                  {activeScene ? activeScene.title : video.displayName}
                </h2>
              </div>

              <div className="text-right font-mono tabular-nums text-[11px] text-slate-200 whitespace-nowrap shrink-0">
                {scope === 'scene'
                  ? `IN/OUT: ${formatSecondsToTimecode(clampedStartSec)} → ${formatSecondsToTimecode(clampedEndSec)} (${clipDurationSec}s)`
                  : `Secuencia Completa (${formatSecondsToTimecode(safeDuration)})`}
              </div>
            </div>
          )}
        </div>

        {/* NLE Program Monitor Transport Deck (Directly under the video screen) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0b0e14] text-xs">
          {/* Left: In/Out Mark Readouts */}
          <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px]">
            <button
              type="button"
              onClick={() => onSetStartFromPlayhead(currentTimeSec)}
              title="Marcar Punto de Entrada (In) en el cabezal actual"
              className="px-2 py-1 rounded border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-colors"
            >
              [ IN:{' '}
              <strong className="text-amber-400">
                {formatSecondsToTimecode(clampedStartSec)}
              </strong>
            </button>
            <button
              type="button"
              onClick={() => onSetEndFromPlayhead(currentTimeSec)}
              title="Marcar Punto de Salida (Out) en el cabezal actual"
              className="px-2 py-1 rounded border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-colors"
            >
              OUT:{' '}
              <strong className="text-amber-400">
                {formatSecondsToTimecode(clampedEndSec)}
              </strong>{' '}
              ]
            </button>
            <span className="hidden sm:inline-block px-2 py-1 rounded bg-slate-950 border border-slate-800/80 text-slate-400">
              DUR: {formatSecondsToTimecode(clipDurationSec)}
            </span>
          </div>

          {/* Center: Classic NLE Transport Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => seekVideoTo(clampedStartSec)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-800 bg-slate-900 text-[11px] font-mono tabular-nums text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Scissors className="w-3 h-3 text-amber-400" />
              <span>
                Ir al Inicio ({formatSecondsToTimecode(clampedStartSec)})
              </span>
            </button>
            <button
              type="button"
              onClick={() => stepSeconds(-5)}
              aria-label="Retroceder 5 segundos"
              className="p-1.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={
                isPlaying ? 'Pausar reproducción' : 'Reproducir vídeo'
              }
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isPlaying ? 'Pausar' : 'Reproducir'}</span>
            </button>
            <button
              type="button"
              onClick={() => stepSeconds(5)}
              aria-label="Avanzar 5 segundos"
              className="p-1.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Reset Sequence / Full Video Scope */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onRangeChange(0, safeDuration);
                onScopeChange?.('full');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-800 bg-slate-900 text-[11px] font-mono tabular-nums text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
              <span>Todo el Vídeo ({formatSecondsToTimecode(safeDuration)})</span>
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          BOTTOM PANEL: NLE MULTI-TRACK TIMELINE (Como Premiere Pro / DaVinci)
         ===================================================================== */}
      <div className="border border-slate-800/90 bg-[#0d1017] rounded-md overflow-hidden shadow-lg">
        {/* Interactive Scene Range Selector & Multi-Track Timeline Block (Targeted by CSS selector 2) */}
        <div className="p-3 space-y-2">
          {/* div:nth-of-type(1) — Timeline Panel Tab Header, NLE Tools & In/Out Readout */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/90 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#151a24] border border-slate-800 text-slate-100 font-medium text-[11px]">
                <Layers className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Timeline · Secuencia 01</span>
              </span>

              {/* Premiere / DaVinci NLE Tool Strip */}
              <div
                role="toolbar"
                aria-label="Herramientas de línea de tiempo NLE"
                className="inline-flex items-center gap-0.5 p-0.5 rounded bg-[#07090d] border border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => setActiveTool('select')}
                  title="Herramienta de Selección (V)"
                  className={`p-1 rounded transition-colors ${
                    activeTool === 'select'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <MousePointer className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('razor')}
                  title="Herramienta Cuchilla / Corte In-Out (C)"
                  className={`p-1 rounded transition-colors ${
                    activeTool === 'razor'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Scissors className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setSnapEnabled((s) => !s)}
                  title="Imán de Ajuste en Línea de Tiempo (S)"
                  className={`p-1 rounded transition-colors ${
                    snapEnabled
                      ? 'text-amber-400 bg-amber-500/15'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Magnet className="w-3 h-3" />
                </button>
              </div>

              <span className="font-medium text-slate-300 text-[11px] hidden xl:inline">
                Seleccionar Escena (Arrastra Inicio y Final)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px]">
              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300">
                Inicio: <strong>{formatSecondsToTimecode(clampedStartSec)}</strong>
              </span>
              <span className="text-slate-500">→</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300">
                Final: <strong>{formatSecondsToTimecode(clampedEndSec)}</strong>
              </span>
              <span className="text-slate-400">
                ({formatSecondsToTimecode(clipDurationSec)})
              </span>

              {onGenerateBreakdown && (
                <button
                  type="button"
                  onClick={onGenerateBreakdown}
                  disabled={isGeneratingBreakdown || !video}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 font-sans font-medium text-[11px] transition-colors disabled:opacity-40"
                >
                  {isGeneratingBreakdown ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  <span>
                    {isGeneratingBreakdown
                      ? 'Detectando cortes...'
                      : 'Autodesglosar Escenas IA'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* div:nth-of-type(2) — Dual-Handle Range Input Track & NLE Multi-Track Lanes
              (Preserves exact selector: div:nth-of-type(2) > input:nth-of-type(1) & input:nth-of-type(2)) */}
          <div
            ref={rangeTrackRef}
            onClick={handleTrackClick}
            className="relative h-36 flex flex-col justify-between select-none cursor-pointer rounded-md bg-[#080a0f] border border-slate-800/90 overflow-hidden"
          >
            {/* 1. TIMECODE RULER BAR (Top of Timeline) */}
            <div className="pointer-events-none relative h-6 w-full bg-[#0c0f17] border-b border-slate-800/90 flex items-end px-2">
              {/* Ruler ticks */}
              <div className="absolute inset-x-2 bottom-0 h-2 flex justify-between">
                {Array.from({ length: 41 }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-px ${
                      idx % 10 === 0
                        ? 'h-2.5 bg-slate-500'
                        : idx % 5 === 0
                          ? 'h-1.5 bg-slate-600'
                          : 'h-1 bg-slate-800'
                    }`}
                  />
                ))}
              </div>
              {/* Ruler Timecode Labels */}
              <div className="relative w-full flex justify-between text-[10px] font-mono tabular-nums text-slate-400 pb-1">
                {rulerTicks.map((t, i) => (
                  <span key={i}>{t.label}</span>
                ))}
              </div>
            </div>

            {/* 2. TRACK V2: AI SCENE CUTS / MARKERS LANE */}
            <div className="pointer-events-none relative h-9 w-full border-b border-slate-800/70 bg-[#0a0d14] flex items-center px-2">
              <div className="z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/95 border border-slate-700/80 text-[9px] font-mono text-amber-300 shadow-sm">
                <Lock className="w-2.5 h-2.5 text-slate-500" />
                <Eye className="w-2.5 h-2.5 text-amber-400" />
                <span>V2 · ESCENAS IA</span>
              </div>

              <div className="absolute inset-x-2 inset-y-1 flex items-center">
                {scenes.length > 0 ? (
                  scenes.map((sc) => {
                    const scStartPct = Math.max(
                      0,
                      Math.min(100, (sc.startSeconds / safeDuration) * 100)
                    );
                    const scEndPct = Math.max(
                      scStartPct + 1,
                      Math.min(100, (sc.endSeconds / safeDuration) * 100)
                    );
                    const isCurrent =
                      currentTimeSec >= sc.startSeconds &&
                      currentTimeSec < sc.endSeconds;
                    return (
                      <div
                        key={sc.id}
                        style={{
                          left: `${scStartPct}%`,
                          width: `${Math.max(1.5, scEndPct - scStartPct)}%`,
                        }}
                        className={`absolute inset-y-0 rounded-sm border px-1.5 flex items-center justify-between overflow-hidden ${
                          isCurrent
                            ? 'bg-indigo-600/45 border-amber-400 text-white'
                            : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                        }`}
                      >
                        <span className="text-[10px] font-mono font-semibold truncate">
                          0{sc.sceneNumber} · {sc.title}
                        </span>
                        <span className="text-[9px] font-mono text-indigo-300/80 ml-1 hidden sm:inline">
                          {sc.shotType}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="w-full h-full rounded-sm border border-dashed border-slate-800 bg-slate-900/30 flex items-center justify-center text-[10px] font-mono text-slate-500">
                    Pista V2: Pulsa &quot;Autodesglosar Escenas IA&quot; para generar cortes de planos en el timeline
                  </div>
                )}
              </div>
            </div>

            {/* 3. TRACK V1: MASTER VIDEO CLIP LANE (Premiere Blue/Cyan Clip Track) */}
            <div className="pointer-events-none relative h-10 w-full border-b border-slate-800/70 bg-[#090c12] flex items-center px-2">
              <div className="z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/95 border border-slate-700/80 text-[9px] font-mono text-sky-300 shadow-sm">
                <Lock className="w-2.5 h-2.5 text-slate-500" />
                <Eye className="w-2.5 h-2.5 text-sky-400" />
                <span>V1 · VÍDEO MASTER</span>
              </div>

              <div className="absolute inset-x-2 inset-y-1 rounded-sm bg-sky-950/65 border border-sky-500/40 overflow-hidden flex items-center">
                {/* Filmstrip frame dividers */}
                <div className="absolute inset-0 grid grid-cols-12 opacity-20">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <div key={idx} className="border-r border-sky-300/50 h-full" />
                  ))}
                </div>
                <span className="relative z-10 ml-28 text-[10px] font-mono text-sky-100 truncate px-2">
                  {video
                    ? `${video.displayName} (${formatSecondsToTimecode(safeDuration)})`
                    : 'Secuencia vacía — Sube o selecciona una bobina en el panel izquierdo'}
                </span>
              </div>
            </div>

            {/* 4. TRACK A1: STEREO AUDIO WAVEFORM LANE (Premiere/DaVinci Emerald Track) */}
            <div className="pointer-events-none relative h-10 w-full bg-[#080b10] flex items-center px-2">
              <div className="z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/95 border border-slate-700/80 text-[9px] font-mono text-emerald-300 shadow-sm">
                <Lock className="w-2.5 h-2.5 text-slate-500" />
                <Volume2 className="w-2.5 h-2.5 text-emerald-400" />
                <span>A1 · AUDIO 48kHz</span>
              </div>

              <div className="absolute inset-x-2 inset-y-1 rounded-sm bg-emerald-950/45 border border-emerald-600/35 overflow-hidden flex items-center justify-between px-2 gap-0.5">
                {WAVEFORM_BARS.map((heightPct, idx) => (
                  <div
                    key={idx}
                    style={{ height: `${video ? heightPct : 15}%` }}
                    className="flex-1 bg-emerald-400/45 rounded-full"
                  />
                ))}
              </div>
            </div>

            {/* 5. AI CITATION TIMESTAMP MARKERS OVERLAY */}
            {citations.length > 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2 top-0 bottom-0 z-10"
              >
                {citations.map((cit) => {
                  const citPct = Math.max(
                    0,
                    Math.min(100, (cit.seconds / safeDuration) * 100)
                  );
                  return (
                    <div
                      key={`${cit.label}-${cit.seconds}`}
                      style={{ left: `${citPct}%` }}
                      className="absolute top-1 bottom-0 w-px bg-emerald-400/60"
                    >
                      <div className="w-2 h-2 -ml-1 rounded-full bg-emerald-400 border border-slate-950" />
                    </div>
                  );
                })}
              </div>
            )}

            {/* 6. HIGHLIGHTED IN / OUT SCENE INTERVAL OVERLAY [Inicio -> Final] */}
            <div
              aria-hidden="true"
              style={{
                left: `calc(${startPct}% + 6px)`,
                width: `calc(${Math.max(0.5, endPct - startPct)}% - 4px)`,
              }}
              className="pointer-events-none absolute top-0 bottom-0 bg-amber-500/20 border-x-2 border-amber-400 transition-all duration-75 z-10"
            >
              {/* Top Work-Area Bar Cap */}
              <div className="h-1.5 w-full bg-amber-400/90" />
            </div>

            {/* 7. NLE VERTICAL PLAYHEAD NEEDLE & CAP */}
            <div
              aria-hidden="true"
              style={{ left: `calc(${playheadPct}% + 6px)` }}
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] z-20"
            >
              <div className="w-3 h-3 -ml-[5px] bg-red-500 rotate-45 rounded-[2px] border border-white/60" />
            </div>

            {/* Input 1: Start of Scene (Inicio / In Point) */}
            <input
              type="range"
              aria-label="Inicio de la escena a analizar"
              min={0}
              max={safeDuration}
              step={1}
              value={clampedStartSec}
              onChange={(e) => handleStartRangeInput(Number(e.target.value))}
              className={`pointer-events-none absolute inset-x-1 top-0 bottom-0 w-[calc(100%-8px)] h-full appearance-none bg-transparent focus:outline-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-28 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-ew-resize hover:[&::-webkit-slider-thumb]:bg-amber-300 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-28 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:bg-amber-400 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:cursor-ew-resize ${
                startThumbOnTop ? 'z-30' : 'z-20'
              }`}
            />

            {/* Input 2: End of Scene (Final / Out Point) */}
            <input
              type="range"
              aria-label="Fin de la escena a analizar"
              min={0}
              max={safeDuration}
              step={1}
              value={clampedEndSec}
              onChange={(e) => handleEndRangeInput(Number(e.target.value))}
              className="pointer-events-none absolute inset-x-1 top-0 bottom-0 w-[calc(100%-8px)] h-full appearance-none bg-transparent z-20 focus:outline-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-28 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-ew-resize hover:[&::-webkit-slider-thumb]:bg-amber-300 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-28 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:bg-amber-500 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:cursor-ew-resize"
            />
          </div>

          {/* div:nth-of-type(3) — Timecode Scale & Direct Fine-Adjustment Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400 pt-0.5">
            <div className="flex items-center gap-1 shrink-0">
              <span>00:00</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">Inicio</span>
              <button
                type="button"
                onClick={() => handleStartRangeInput(clampedStartSec - 1)}
                aria-label="Restar 1 segundo al inicio"
                className="px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              >
                -1s
              </button>
              <button
                type="button"
                onClick={() => handleStartRangeInput(clampedStartSec + 1)}
                aria-label="Sumar 1 segundo al inicio"
                className="px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              >
                +1s
              </button>
            </div>

            <div className="text-slate-300 whitespace-nowrap shrink-0">
              Cabezal:{' '}
              <strong className="text-white">
                {formatSecondsToTimecode(currentTimeSec)}
              </strong>{' '}
              / {formatSecondsToTimecode(safeDuration)}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-300">Final</span>
              <button
                type="button"
                onClick={() => handleEndRangeInput(clampedEndSec - 1)}
                aria-label="Restar 1 segundo al final"
                className="px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              >
                -1s
              </button>
              <button
                type="button"
                onClick={() => handleEndRangeInput(clampedEndSec + 1)}
                aria-label="Sumar 1 segundo al final"
                className="px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              >
                +1s
              </button>
              <span className="text-slate-600">·</span>
              <span>{formatSecondsToTimecode(safeDuration)}</span>
            </div>
          </div>
        </div>

        {/* Scene timeline quick-jump segments & AI citation markers strip */}
        {(scenes.length > 0 || citations.length > 0) && (
          <div className="px-3 pb-2.5 pt-1 border-t border-slate-800/80 space-y-2">
            {scenes.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 shrink-0 mr-1">
                  Clips V2:
                </span>
                {scenes.map((sc) => {
                  const isCurrent =
                    currentTimeSec >= sc.startSeconds &&
                    currentTimeSec < sc.endSeconds;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => onSelectSceneRange(sc)}
                      className={`text-left px-2.5 py-1 rounded border transition-colors shrink-0 ${
                        isCurrent
                          ? 'bg-slate-800 border-amber-500/70 text-slate-100'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums text-amber-400">
                        <span>0{sc.sceneNumber}</span>
                        <span>
                          {sc.startTime}–{sc.endTime}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium truncate max-w-[140px]">
                        {sc.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {citations.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-emerald-400 shrink-0">
                  <Bookmark className="w-2.5 h-2.5" />
                  <span>Marcadores IA:</span>
                </span>
                {citations.map((cit) => (
                  <button
                    key={`${cit.label}-${cit.seconds}`}
                    type="button"
                    onClick={() => seekVideoTo(cit.seconds)}
                    className="px-2 py-0.5 rounded border border-emerald-800/50 bg-emerald-950/40 font-mono tabular-nums text-[10px] text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition-colors shrink-0"
                  >
                    {cit.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
