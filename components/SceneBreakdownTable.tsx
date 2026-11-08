'use client';

import React from 'react';
import { Play, MessageSquare, ListVideo } from 'lucide-react';
import { VideoSceneItem } from '@/lib/video-utils';

interface SceneBreakdownTableProps {
  scenes: VideoSceneItem[];
  onSeekToScene: (seconds: number) => void;
  onScopeToScene: (scene: VideoSceneItem) => void;
  currentTimeSec?: number;
}

export function SceneBreakdownTable({
  scenes,
  onSeekToScene,
  onScopeToScene,
  currentTimeSec = 0,
}: SceneBreakdownTableProps) {
  if (scenes.length === 0) return null;

  return (
    <section
      aria-label="Escenas del vídeo"
      className="rounded-3xl border border-white/10 bg-[#15171d] p-5 shadow-xl space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListVideo className="w-4 h-4 text-amber-400" />
          <h3 className="font-display text-lg font-semibold text-white">
            Escenas detectadas ({scenes.length})
          </h3>
        </div>
        <p className="text-xs text-zinc-400">
          Pulsa en cualquiera para verla o hacer preguntas solo sobre ella
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {scenes.map((sc) => {
          const isActive =
            currentTimeSec >= sc.startSeconds && currentTimeSec < sc.endSeconds;
          return (
            <div
              key={sc.id}
              className={`rounded-2xl border p-4 transition-colors flex flex-col justify-between gap-3 ${
                isActive
                  ? 'border-amber-400/50 bg-amber-400/[0.06]'
                  : 'border-white/5 bg-white/[0.02] hover:border-white/15'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-amber-300">
                    Escena {sc.sceneNumber} · {sc.startTime} – {sc.endTime}
                  </span>
                  {sc.shotType && (
                    <span className="text-xs text-zinc-400 truncate">
                      {sc.shotType}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-semibold text-zinc-100">
                  {sc.title}
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {sc.narrativeAction}
                </p>
                {(sc.lightingAndColor || sc.soundDesign) && (
                  <p className="text-xs text-zinc-400 leading-relaxed pt-1">
                    {sc.lightingAndColor}
                    {sc.lightingAndColor && sc.soundDesign ? ' · ' : ''}
                    {sc.soundDesign}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSeekToScene(sc.startSeconds)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-200 transition-colors"
                >
                  <Play className="w-3 h-3 text-amber-400" />
                  <span>Ir a este momento</span>
                </button>
                <button
                  type="button"
                  onClick={() => onScopeToScene(sc)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400/15 hover:bg-amber-400/25 text-xs font-medium text-amber-200 transition-colors"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Preguntar sobre esta escena</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
