'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Film,
  Upload,
  FolderOpen,
  Scissors,
  Clock,
  Sparkles,
  Loader2,
  Play,
  Pause,
} from 'lucide-react';
import {
  formatFriendlyDuration,
  formatSecondsToTimecode,
  formatTimeRemaining,
  isVideoExpired,
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
  startSec?: number;
  endSec?: number;
  onDurationDetected?: (
    videoId: string,
    durationSec: number,
    aspectRatio?: string
  ) => void;
  onAttachLocalVideoFile?: (videoId: string, file: File) => void;
  onOpenUpload?: () => void;
  isGeneratingBreakdown?: boolean;
  onGenerateBreakdown?: () => void;
}

export function CinemaMonitor({
  video,
  scenes,
  currentTimeSec,
  onTimeChange,
  scope,
  startSec = 0,
  endSec = 60,
  onDurationDetected,
  onAttachLocalVideoFile,
  onOpenUpload,
  isGeneratingBreakdown = false,
  onGenerateBreakdown,
}: CinemaMonitorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const safeDuration = Math.max(1, video?.durationSeconds || 60);
  const normalized = normalizeSceneRange(startSec, endSec, safeDuration);
  const clampedStartSec = normalized.startSec;
  const clampedEndSec = normalized.endSec;

  const expired = video ? isVideoExpired(video) : false;
  const remaining = video ? formatTimeRemaining(video.expirationTime) : null;

  useEffect(() => {
    const el = videoRef.current;
    if (el && Math.abs(el.currentTime - currentTimeSec) > 0.75) {
      try {
        el.currentTime = currentTimeSec;
      } catch {
        // Ignore seek before metadata ready
      }
    }
  }, [currentTimeSec]);

  if (!video) {
    return (
      <div className="rounded-3xl border border-white/10 bg-[#15171d] p-8 sm:p-12 text-center shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mx-auto mb-4">
          <Film className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
          Sube un vídeo para empezar
        </h2>
        <p className="mt-2 text-sm sm:text-base text-zinc-400 max-w-md mx-auto leading-relaxed">
          Elige cualquier vídeo o escena de tu ordenador y pregúntale a la IA sobre la historia, los planos, la luz o la música.
        </p>
        {onOpenUpload && (
          <button
            type="button"
            onClick={onOpenUpload}
            className="mt-6 inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-amber-400 text-zinc-950 font-semibold text-sm hover:bg-amber-300 transition-colors shadow-lg shadow-amber-400/10"
          >
            <Upload className="w-4 h-4" />
            <span>Elegir un vídeo</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Reproductor de vídeo"
      className="rounded-3xl border border-white/10 bg-[#15171d] overflow-hidden shadow-xl flex flex-col"
    >
      {/* Top bar: Video title & 48h status */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-400/10 flex items-center justify-center shrink-0">
            <Film className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-100 truncate">
              {video.displayName}
            </h2>
            <p className="text-xs text-zinc-400 flex items-center gap-2">
              {video.durationSeconds ? (
                <span>{formatFriendlyDuration(video.durationSeconds)}</span>
              ) : null}
              {expired ? (
                <span className="text-amber-300 font-medium">
                  Caducado (pasaron 48 h)
                </span>
              ) : remaining ? (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Clock className="w-3 h-3" />
                  Disponible durante {remaining}
                </span>
              ) : (
                <span className="text-emerald-400">Listo para preguntas</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onGenerateBreakdown && !expired && (
            <button
              type="button"
              onClick={onGenerateBreakdown}
              disabled={isGeneratingBreakdown}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-200 transition-colors disabled:opacity-50"
            >
              {isGeneratingBreakdown ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>
                {isGeneratingBreakdown
                  ? 'Buscando escenas…'
                  : scenes.length > 0
                    ? 'Volver a detectar escenas'
                    : 'Dividir en escenas'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Video canvas */}
      <div className="relative bg-black aspect-video max-h-[46vh] w-full flex items-center justify-center">
        {video.localObjectUrl ? (
          <video
            key={`${video.id}-${video.localObjectUrl}`}
            ref={videoRef}
            src={video.localObjectUrl}
            controls
            playsInline
            preload="metadata"
            className="w-full h-full object-contain bg-black"
            onTimeUpdate={(e) => {
              if (previewing && e.currentTarget.currentTime >= clampedEndSec) {
                e.currentTarget.pause();
                setPreviewing(false);
              }
              onTimeChange(Math.floor(e.currentTarget.currentTime));
            }}
            onPause={() => setPreviewing(false)}
            onLoadedMetadata={(e) => {
              const dur = e.currentTarget.duration;
              if (dur && Number.isFinite(dur) && dur > 0) {
                const rounded = Math.max(1, Math.round(dur));
                const ratio =
                  e.currentTarget.videoWidth > 0 &&
                  e.currentTarget.videoHeight > 0
                    ? `${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`
                    : undefined;
                onDurationDetected?.(video.id, rounded, ratio);
              }
            }}
          />
        ) : (
          <div className="p-6 text-center max-w-md space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
              <Film className="w-6 h-6 text-amber-400" />
            </div>
            <p className="text-base font-medium text-zinc-100">
              {expired
                ? 'Este vídeo ya ha caducado tras 48 horas'
                : 'Tu vídeo está listo en la IA para responder preguntas'}
            </p>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {expired
                ? 'Tus conversaciones siguen guardadas aquí. Si quieres hacer nuevas preguntas, vuelve a subir el vídeo.'
                : 'Puedes preguntarle lo que quieras en el chat de la derecha. Si también quieres verlo reproducirse aquí en pantalla, selecciona el archivo de tu ordenador.'}
            </p>
            {onAttachLocalVideoFile && (
              <div>
                <input
                  ref={localFileInputRef}
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onAttachLocalVideoFile(video.id, file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => localFileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-medium text-zinc-100 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span>Mostrar vídeo en pantalla</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#12141a] px-5 py-3 text-xs">
        <span className="text-zinc-400">{scope === 'scene' ? <><Scissors className="mr-1 inline h-3.5 w-3.5 text-amber-400" /> Selección <span className="font-mono text-amber-200">{formatSecondsToTimecode(clampedStartSec)} — {formatSecondsToTimecode(clampedEndSec)}</span></> : 'Selecciona un fragmento en la línea de tiempo.'}</span>
        {scope === 'scene' && video.localObjectUrl && <button type="button" onClick={async () => {
          const el = videoRef.current;
          if (!el) return;
          if (previewing) { el.pause(); setPreviewing(false); return; }
          el.currentTime = clampedStartSec;
          onTimeChange(clampedStartSec);
          setPlaybackError(null);
          try { await el.play(); setPreviewing(true); }
          catch { setPlaybackError('No se ha podido reproducir el fragmento. Prueba con los controles del vídeo.'); }
        }} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10">
          {previewing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{previewing ? 'Pausar selección' : 'Ver selección'}
        </button>}
        {playbackError && <p role="alert" className="w-full text-rose-300">{playbackError}</p>}
      </div>
    </section>
  );
}
