'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Film,
  Maximize2,
  Upload,
  RotateCcw,
  FolderOpen,
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
}

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
      if (scope === 'scene' && clampedEndSec > clampedStartSec && next >= clampedEndSec) {
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
    const target = Math.max(0, Math.min(safeDuration, currentTimeSec + delta));
    onTimeChange(target);
    if (videoRef.current && !hasStreamError) {
      try {
        videoRef.current.currentTime = target;
      } catch {
        // Ignore seek error
      }
    }
  };

  const handleStartRangeInput = (newStartRaw: number) => {
    const next = normalizeSceneRange(
      newStartRaw,
      clampedEndSec,
      safeDuration,
      'start'
    );
    onRangeChange(next.startSec, next.endSec, 'start');
    onTimeChange(next.startSec);
    if (videoRef.current && !hasStreamError) {
      try {
        videoRef.current.currentTime = next.startSec;
      } catch {
        // Ignore
      }
    }
  };

  const handleEndRangeInput = (newEndRaw: number) => {
    const next = normalizeSceneRange(
      clampedStartSec,
      newEndRaw,
      safeDuration,
      'end'
    );
    onRangeChange(next.startSec, next.endSec, 'end');
    onTimeChange(next.endSec);
    if (videoRef.current && !hasStreamError) {
      try {
        videoRef.current.currentTime = next.endSec;
      } catch {
        // Ignore
      }
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rangeTrackRef.current) return;
    // Only handle clicks directly on the track background (not thumb drags)
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const rect = rangeTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const clickedSec = Math.round(ratio * safeDuration);

    const distToStart = Math.abs(clickedSec - clampedStartSec);
    const distToEnd = Math.abs(clickedSec - clampedEndSec);

    if (distToStart <= distToEnd) {
      handleStartRangeInput(clickedSec);
    } else {
      handleEndRangeInput(clickedSec);
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

  if (!video) {
    return (
      <section
        aria-label="Monitor de referencia cinematográfica"
        className="border border-slate-800 bg-slate-900/70 rounded-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/60 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="font-medium text-slate-400">Monitor de Vídeo</span>
          </div>
          <span className="font-mono tabular-nums text-slate-500">
            TC 00:00:00 / 00:00:00
          </span>
        </div>

        <div className="relative bg-slate-950 aspect-video w-full flex flex-col items-center justify-center p-6 text-center border-b border-slate-800">
          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
            <Film className="w-6 h-6 text-slate-500" />
          </div>
          <h3 className="text-base font-display font-semibold text-slate-200">
            Sin bobina seleccionada
          </h3>
          <p className="text-xs text-slate-400 max-w-md mt-1 mb-4 leading-relaxed">
            Sube un archivo de vídeo (hasta 2.00 GB) o selecciona una bobina
            guardada en la File API de Gemini para visualizar el vídeo, elegir
            el inicio y fin de la escena y realizar consultas cinematográficas.
          </p>
          {onOpenUpload && (
            <button
              type="button"
              onClick={onOpenUpload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Subir Vídeo a File API</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Monitor de referencia cinematográfica"
      className="border border-slate-800 bg-slate-900/70 rounded-xl overflow-hidden"
    >
      {/* Top technical status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-950/60 text-xs text-slate-400">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-medium text-slate-200 truncate max-w-[200px] sm:max-w-[240px]">
            {video.displayName}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
            {video.aspectRatio || '16:9'}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="font-mono tabular-nums text-emerald-400 whitespace-nowrap shrink-0">
            {video.state}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
          <span className="whitespace-nowrap">
            TC{' '}
            <strong className="text-amber-300">
              {formatSecondsToTimecode(currentTimeSec, true)}
            </strong>{' '}
            /{' '}
            {knownDurationSec
              ? formatSecondsToTimecode(knownDurationSec, true)
              : formatSecondsToTimecode(safeDuration, true)}
          </span>
          <button
            type="button"
            onClick={() => setShowGuides((g) => !g)}
            className="px-2.5 py-1 rounded border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            {showGuides ? 'Ocultar Retícula' : 'Mostrar Retícula'}
          </button>
        </div>
      </div>

      {/* Main Video Player Viewport */}
      <div className="relative bg-black aspect-video w-full overflow-hidden flex items-center justify-center">
        {playbackUrl && !hasStreamError ? (
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
            className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-slate-950/95"
          >
            <Film className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-sm font-display font-semibold text-white">
              {video.displayName}
            </p>
            <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
              Este vídeo está activo en Gemini File API para análisis con IA
              {knownDurationSec
                ? ` (Duración detectada: ${formatSecondsToTimecode(knownDurationSec)})`
                : ''}
              , pero se subió desde otra sesión y el navegador no tiene aún el
              archivo de vídeo local para mostrar la imagen en pantalla.
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
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Vincular archivo de vídeo local para verlo en pantalla</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Optional rule-of-thirds safe area guides */}
        {showGuides && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
          >
            <div className="border-r border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-b border-white/15" />
            <div className="border-r border-white/15" />
            <div className="border-r border-white/15" />
            <div />
          </div>
        )}

        {/* Subtle bottom HUD bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-8 pb-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-mono tabular-nums text-amber-300/90 truncate">
              {activeScene
                ? `Escena 0${activeScene.sceneNumber} · ${activeScene.startTime} – ${activeScene.endTime} · ${activeScene.shotType}`
                : `Posición ${formatSecondsToTimecode(currentTimeSec)} de ${formatSecondsToTimecode(safeDuration)}`}
            </p>
            <h2 className="text-sm font-display font-semibold text-white tracking-tight truncate">
              {activeScene ? activeScene.title : video.displayName}
            </h2>
          </div>

          <div className="text-right font-mono tabular-nums text-xs text-slate-200 whitespace-nowrap shrink-0">
            {scope === 'scene'
              ? `Escena: ${formatSecondsToTimecode(clampedStartSec)} → ${formatSecondsToTimecode(clampedEndSec)} (${clipDurationSec}s)`
              : `Vídeo Completo (${formatSecondsToTimecode(safeDuration)})`}
          </div>
        </div>
      </div>

      {/* Interactive Scene Range Selector & Timeline Controls */}
      <div className="p-4 space-y-3.5 bg-slate-950/90 border-t border-slate-800">
        {/* Scene Range Input Block (Targeted by CSS selector 2) */}
        <div className="space-y-2.5">
          {/* Header Row: Selected Start & End Readout */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-medium text-slate-200">
                Seleccionar Escena (Arrastra Inicio y Final)
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300">
                Inicio: <strong>{formatSecondsToTimecode(clampedStartSec)}</strong>
              </span>
              <span className="text-slate-500">→</span>
              <span className="px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300">
                Final: <strong>{formatSecondsToTimecode(clampedEndSec)}</strong>
              </span>
              <span className="text-slate-400">
                ({formatSecondsToTimecode(clipDurationSec)})
              </span>
            </div>
          </div>

          {/* Dual-Handle Range Input Track (div:nth-of-type(2) > input:nth-of-type(1) & input:nth-of-type(2)) */}
          <div
            ref={rangeTrackRef}
            onClick={handleTrackClick}
            className="relative h-11 flex items-center select-none cursor-pointer px-2 rounded-lg bg-slate-900/90 border border-slate-800"
          >
            {/* Base Timeline Rail */}
            <div className="pointer-events-none absolute inset-x-2 h-2.5 rounded-full bg-slate-800 border border-slate-700/80" />

            {/* Highlighted Selected Scene Interval [Inicio -> Final] */}
            <div
              aria-hidden="true"
              style={{
                left: `calc(${startPct}% + 6px)`,
                width: `calc(${Math.max(0.5, endPct - startPct)}% - 4px)`,
              }}
              className="pointer-events-none absolute h-3.5 rounded-sm bg-amber-500/35 border-x-2 border-amber-400 transition-all duration-75"
            />

            {/* Current Playhead Vertical Indicator */}
            <div
              aria-hidden="true"
              style={{ left: `calc(${playheadPct}% + 6px)` }}
              className="pointer-events-none absolute top-1.5 bottom-1.5 w-0.5 bg-white/80 z-10"
            />

            {/* Input 1: Start of Scene (Inicio) */}
            <input
              type="range"
              aria-label="Inicio de la escena a analizar"
              min={0}
              max={safeDuration}
              step={1}
              value={clampedStartSec}
              onChange={(e) => handleStartRangeInput(Number(e.target.value))}
              className={`pointer-events-none absolute inset-x-1 w-[calc(100%-8px)] h-3 appearance-none bg-transparent focus:outline-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-ew-resize hover:[&::-webkit-slider-thumb]:bg-amber-300 hover:[&::-webkit-slider-thumb]:scale-105 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:bg-amber-400 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:cursor-ew-resize ${
                startThumbOnTop ? 'z-30' : 'z-20'
              }`}
            />

            {/* Input 2: End of Scene (Final) */}
            <input
              type="range"
              aria-label="Fin de la escena a analizar"
              min={0}
              max={safeDuration}
              step={1}
              value={clampedEndSec}
              onChange={(e) => handleEndRangeInput(Number(e.target.value))}
              className="pointer-events-none absolute inset-x-1 w-[calc(100%-8px)] h-3 appearance-none bg-transparent z-20 focus:outline-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-ew-resize hover:[&::-webkit-slider-thumb]:bg-amber-300 hover:[&::-webkit-slider-thumb]:scale-105 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:bg-amber-500 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:cursor-ew-resize"
            />
          </div>

          {/* Timecode Scale & Direct Fine-Adjustment Bar */}
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
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

        {/* Scene timeline quick-jump segments */}
        {scenes.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            {scenes.map((sc) => {
              const isCurrent =
                currentTimeSec >= sc.startSeconds &&
                currentTimeSec < sc.endSeconds;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onSelectSceneRange(sc)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'bg-slate-800/90 border-amber-500/60 text-slate-100'
                      : 'bg-slate-900/60 border-slate-800/90 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-amber-400">
                    <span className="whitespace-nowrap">
                      Escena 0{sc.sceneNumber}
                    </span>
                    <span className="whitespace-nowrap">
                      {sc.startTime}–{sc.endTime}
                    </span>
                  </div>
                  <div className="text-xs font-medium truncate mt-0.5">
                    {sc.title}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Transport & Quick Scope Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => stepSeconds(-5)}
              aria-label="Retroceder 5 segundos"
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar reproducción' : 'Reproducir vídeo'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span>{isPlaying ? 'Pausar' : 'Reproducir'}</span>
            </button>
            <button
              type="button"
              onClick={() => stepSeconds(5)}
              aria-label="Avanzar 5 segundos"
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onTimeChange(clampedStartSec);
                if (videoRef.current && !hasStreamError) {
                  try {
                    videoRef.current.currentTime = clampedStartSec;
                  } catch {
                    // Ignore
                  }
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>Ir al Inicio ({formatSecondsToTimecode(clampedStartSec)})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onRangeChange(0, safeDuration);
                onScopeChange?.('full');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Todo el Vídeo ({formatSecondsToTimecode(safeDuration)})</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
