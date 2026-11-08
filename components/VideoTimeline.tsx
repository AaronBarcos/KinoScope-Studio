'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Film, Layers3, Scissors, ZoomIn, ZoomOut, CornerDownLeft } from 'lucide-react';
import { formatSecondsToTimecode, normalizeSceneRange, parseTimecodeToSeconds, UploadedGeminiVideo, VideoSceneItem } from '@/lib/video-utils';

interface Props {
  video: UploadedGeminiVideo;
  scenes: VideoSceneItem[];
  currentTimeSec: number;
  startSec: number;
  endSec: number;
  scope: 'full' | 'scene';
  onTimeChange: (seconds: number) => void;
  onScopeChange: (scope: 'full' | 'scene') => void;
  onRangeChange: (start: number, end: number, handle?: 'start' | 'end') => void;
  onSelectScene: (scene: VideoSceneItem) => void;
  onAskSelection: () => void;
}

/** Small, local previews; never download the model's private File API URL. */
function VideoFilmstrip({ src, duration }: { src?: string; duration: number }) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    video.muted = true;
    video.preload = 'auto';
    const waitFor = (event: 'loadeddata' | 'seeked', action: () => void) => new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        video.removeEventListener(event, success);
        video.removeEventListener('error', failure);
        resolve(ok);
      };
      const success = () => finish(true);
      const failure = () => finish(false);
      const timer = setTimeout(failure, 4000);
      video.addEventListener(event, success, { once: true });
      video.addEventListener('error', failure, { once: true });
      action();
    });
    void (async () => {
      if (!await waitFor('loadeddata', () => { video.src = src; })) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const previews: string[] = [];
      for (let i = 0; i < 12 && !cancelled; i++) {
        const time = Math.min(video.duration - 0.05, (i + 0.5) * duration / 12);
        if (!await waitFor('seeked', () => { video.currentTime = Math.max(0, time); }) || cancelled) break;
        context.drawImage(video, 0, 0, 160, 90);
        previews.push(canvas.toDataURL('image/jpeg', 0.6));
      }
      if (!cancelled) setFrames(previews);
    })().catch(() => { /* The timeline remains usable if previews cannot be decoded. */ });
    return () => {
      cancelled = true;
      video.removeAttribute('src');
      video.load();
    };
  }, [src, duration]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-60">
      {frames.map((frame, index) => (
        // Native images are generated only in memory from the user's local video.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={index} src={frame} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
      ))}
    </div>
  );
}

function TimecodeField({ label, seconds, onChange }: { label: string; seconds: number; onChange: (seconds: number) => void }) {
  const value = formatSecondsToTimecode(seconds);
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
      {label}
      <input key={value} defaultValue={value} aria-label={label} spellCheck={false}
        onBlur={(event) => {
          const parsed = parseTimecodeToSeconds(event.target.value);
          event.target.value = value;
          if (parsed !== null) onChange(parsed);
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-amber-200" />
    </label>
  );
}

type DragState = { mode: 'select' | 'start' | 'end' | 'move'; anchor: number; start: number; end: number };

export function VideoTimeline({ video, scenes, currentTimeSec, startSec, endSec, scope, onTimeChange, onScopeChange, onRangeChange, onSelectScene, onAskSelection }: Props) {
  const [zoom, setZoom] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const duration = Math.max(1, Math.floor(video.durationSeconds || 60));
  const range = normalizeSceneRange(startSec, endSec, duration);
  const selected = scope === 'scene';
  const percent = (seconds: number) => `${Math.max(0, Math.min(100, seconds / duration * 100))}%`;
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, Math.round((clientX - rect.left) / rect.width * duration)));
  };
  const updateDrag = (seconds: number, drag: DragState) => {
    if (drag.mode === 'start') onRangeChange(seconds, drag.end, 'start');
    else if (drag.mode === 'end') onRangeChange(drag.start, seconds, 'end');
    else if (drag.mode === 'move') {
      const width = drag.end - drag.start;
      const start = Math.max(0, Math.min(duration - width, drag.start + seconds - drag.anchor));
      onRangeChange(start, start + width);
    } else {
      const start = Math.min(drag.anchor, seconds, duration - 1);
      onRangeChange(start, Math.max(start + 1, drag.anchor, seconds));
    }
  };
  const startDrag = (event: React.PointerEvent, mode: DragState['mode']) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    trackRef.current?.setPointerCapture(event.pointerId);
    const anchor = timeAt(event.clientX);
    const drag = { mode, anchor, start: range.startSec, end: range.endSec };
    dragRef.current = drag;
    onScopeChange('scene');
    if (mode === 'select') updateDrag(anchor, drag);
  };
  const handleSliderKey = (event: React.KeyboardEvent, handle: 'start' | 'end') => {
    const current = handle === 'start' ? range.startSec : range.endSec;
    const step = event.shiftKey ? 10 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onRangeChange(handle === 'start' ? next : range.startSec, handle === 'end' ? next : range.endSec, handle);
  };
  const ticks = Array.from(new Set(Array.from({ length: 11 }, (_, i) => Math.round(i * duration / 10))));

  return (
    <section aria-label="Editor de escenas" tabIndex={0}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
        if (event.key.toLowerCase() === 'i') onRangeChange(currentTimeSec, range.endSec, 'start');
        else if (event.key.toLowerCase() === 'o') onRangeChange(range.startSec, currentTimeSec, 'end');
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onTimeChange(Math.max(0, Math.min(duration, currentTimeSec + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1))));
        }
      }}
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#101217] shadow-xl focus-visible:outline-amber-400">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Layers3 className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold">Línea de tiempo</h2>
          <span className="rounded bg-white/5 px-2 py-1 font-mono text-xs text-zinc-400">{formatSecondsToTimecode(currentTimeSec)} / {formatSecondsToTimecode(duration)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Alejar línea de tiempo" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom / 2))} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" aria-label="Ajustar todo el vídeo" title="Ajustar todo el vídeo" onClick={() => setZoom(1)} className="w-12 text-xs text-zinc-300">{zoom}×</button>
          <button type="button" aria-label="Acercar línea de tiempo" disabled={zoom >= 8} onClick={() => setZoom(Math.min(8, zoom * 2))} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><ZoomIn className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="flex">
        <div aria-hidden="true" className="w-20 shrink-0 border-r border-white/10 bg-[#14161c] text-[10px] font-semibold tracking-wider text-zinc-500 sm:w-24">
          <div className="h-10 border-b border-white/5 px-3 pt-3">PISTAS</div>
          <div className="flex h-24 items-center gap-2 px-3 text-sky-300"><Film className="h-3.5 w-3.5" /> V1</div>
          <div className="flex h-14 items-center px-3">ESCENAS</div>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: `${zoom * 100}%` }} className="relative min-w-full">
            <div className="relative h-10 border-b border-white/10 bg-[#171920]">
              {ticks.map((time, index) => <span key={time} style={{ left: percent(time) }} className={`pointer-events-none absolute top-1.5 border-l border-white/15 pl-1 font-mono text-[10px] text-zinc-500 ${index % 2 !== 0 && time !== duration ? 'hidden sm:block' : ''} ${time === duration ? '-translate-x-full border-l-0 border-r pr-1' : ''}`}>{formatSecondsToTimecode(time)}</span>)}
              <input type="range" min={0} max={duration} step={1} value={Math.min(duration, currentTimeSec)} aria-label="Cabezal de reproducción"
                onChange={(event) => onTimeChange(Number(event.target.value))}
                className="timeline-scrubber absolute inset-x-0 bottom-0 h-4 w-full cursor-ew-resize" />
            </div>
            <div ref={trackRef} aria-label="Arrastra para seleccionar un fragmento" className="relative h-24 touch-none cursor-crosshair select-none border-y-4 border-[#101217] bg-sky-950/60"
              onPointerDown={(event) => startDrag(event, 'select')}
              onPointerMove={(event) => { if (dragRef.current) updateDrag(timeAt(event.clientX), dragRef.current); }}
              onPointerUp={(event) => {
                if (dragRef.current) {
                  const drag = dragRef.current;
                  const time = timeAt(event.clientX);
                  updateDrag(time, drag);
                  onTimeChange(drag.mode === 'select' ? Math.min(drag.anchor, time, duration - 1) : drag.mode === 'end' ? time : range.startSec);
                }
                dragRef.current = null;
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onLostPointerCapture={() => { dragRef.current = null; }}>
              <VideoFilmstrip key={video.localObjectUrl || video.id} src={video.localObjectUrl} duration={duration} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-sky-950/70 px-3 py-1 text-[10px] text-sky-200">{video.displayName}</div>
              {selected && <>
                <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/65" style={{ width: percent(range.startSec) }} />
                <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/65" style={{ width: percent(duration - range.endSec) }} />
                <div onPointerDown={(event) => startDrag(event, 'move')} style={{ left: percent(range.startSec), width: percent(range.endSec - range.startSec) }} className="absolute inset-y-0 cursor-grab border-y-2 border-amber-400 bg-amber-400/10 active:cursor-grabbing">
                  {(['start', 'end'] as const).map((handle) => (
                    <button type="button" role="slider" key={handle} aria-label={handle === 'start' ? 'Inicio del fragmento' : 'Fin del fragmento'}
                      aria-valuemin={handle === 'start' ? 0 : 1} aria-valuemax={handle === 'start' ? duration - 1 : duration}
                      aria-valuenow={handle === 'start' ? range.startSec : range.endSec}
                      aria-valuetext={formatSecondsToTimecode(handle === 'start' ? range.startSec : range.endSec)}
                      onKeyDown={(event) => handleSliderKey(event, handle)} onPointerDown={(event) => startDrag(event, handle)}
                      className={`absolute inset-y-0 z-20 flex w-4 touch-none cursor-ew-resize items-center justify-center bg-amber-400 text-zinc-950 focus-visible:outline-2 focus-visible:outline-white ${handle === 'start' ? 'left-0 rounded-l' : 'right-0 rounded-r'}`}>
                      <span className="h-5 border-x-2 border-zinc-900/60 px-px" />
                    </button>
                  ))}
                </div>
              </>}
            </div>
            <div className="relative h-14 border-y-4 border-[#101217] bg-white/[0.02]">
              {scenes.length === 0 ? <span className="absolute left-3 top-3 text-[11px] text-zinc-500">Detecta las escenas para seleccionarlas aquí.</span> : scenes.map((scene) => {
                const start = Math.max(0, Math.min(duration, scene.startSeconds));
                const end = Math.min(duration, scene.endSeconds);
                if (end <= start) return null;
                return <button key={scene.id} type="button" title={`${scene.title} · ${scene.startTime}–${scene.endTime}`} onClick={() => onSelectScene(scene)} style={{ left: percent(start), width: percent(end - start) }}
                  className={`absolute inset-y-0 overflow-hidden truncate rounded border px-2 text-left text-[11px] transition-colors ${selected && range.startSec === start && range.endSec === end ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-violet-400/30 bg-violet-500/15 text-violet-200 hover:bg-violet-400/30'}`}>{scene.sceneNumber}. {scene.title}</button>;
              })}
            </div>
            <div aria-hidden="true" style={{ left: percent(currentTimeSec) }} className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400"><div className="absolute -left-1 top-7 h-2 w-2 rotate-45 bg-rose-400" /></div>
          </div>
        </div>
      </div>
      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <TimecodeField label="Entrada" seconds={range.startSec} onChange={(time) => onRangeChange(time, range.endSec, 'start')} />
            <TimecodeField label="Salida" seconds={range.endSec} onChange={(time) => onRangeChange(range.startSec, time, 'end')} />
            <span className="font-mono text-[11px] text-zinc-500">{selected ? `${range.endSec - range.startSec} s seleccionados` : 'Vídeo completo'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onRangeChange(currentTimeSec, range.endSec, 'start')} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5">Marcar entrada <kbd className="ml-1 text-zinc-500">I</kbd></button>
            <button type="button" onClick={() => onRangeChange(range.startSec, currentTimeSec, 'end')} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5">Marcar salida <kbd className="ml-1 text-zinc-500">O</kbd></button>
            {selected && <button type="button" onClick={() => onScopeChange('full')} className="px-2 py-1.5 text-xs text-zinc-400 hover:text-white">Quitar selección</button>}
            <button type="button" disabled={!selected} onClick={onAskSelection} className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-30"><Scissors className="h-3.5 w-3.5" /> Preguntar sobre selección <CornerDownLeft className="h-3 w-3" /></button>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">Arrastra sobre V1 para seleccionar. Ajusta los bordes amarillos o mueve el fragmento. Usa la regla para buscar un momento. Con el editor enfocado: I / O marcan entrada y salida; ← / → desplazan el cabezal.</p>
      </div>
    </section>
  );
}
