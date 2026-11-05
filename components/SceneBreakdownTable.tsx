'use client';

import React, { useState } from 'react';
import { Search, Sparkles, Play, Crosshair, Loader2 } from 'lucide-react';
import { VideoSceneItem } from '@/lib/video-utils';

interface SceneBreakdownTableProps {
  scenes: VideoSceneItem[];
  isGenerating: boolean;
  onGenerateBreakdown: () => void;
  onSeekToScene: (seconds: number) => void;
  onScopeToScene: (scene: VideoSceneItem) => void;
}

export function SceneBreakdownTable({
  scenes,
  isGenerating,
  onGenerateBreakdown,
  onSeekToScene,
  onScopeToScene,
}: SceneBreakdownTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [shotFilter, setShotFilter] = useState<'all' | 'general' | 'medio' | 'secuencia'>('all');

  const filteredScenes = scenes.filter((scene) => {
    const matchesSearch =
      !searchQuery.trim() ||
      scene.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.shotType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.lightingAndColor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.narrativeAction.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (shotFilter === 'all') return true;
    if (shotFilter === 'general') return scene.shotType.toLowerCase().includes('general');
    if (shotFilter === 'medio') return scene.shotType.toLowerCase().includes('medio');
    if (shotFilter === 'secuencia') return scene.shotType.toLowerCase().includes('secuencia');
    return true;
  });

  return (
    <section
      id="desglose-section"
      aria-label="Desglose técnico de escenas y planos"
      className="border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden"
    >
      {/* Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-800">
        <div>
          <h3 className="text-base font-display font-semibold text-white">
            Desglose Cinematográfico de Planos y Escenas
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Selecciona cualquier escena para saltar al código de tiempo o acotar las consultas de gemini-4-argon
          </p>
        </div>

        <button
          type="button"
          onClick={onGenerateBreakdown}
          disabled={isGenerating}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          {isGenerating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span>
            {isGenerating ? 'Analizando Bobina...' : 'Autodesglosar Vídeo con Gemini 4 Argon'}
          </span>
        </button>
      </div>

      {/* Search & Interactive Segmented Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-slate-950/50 border-b border-slate-800">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Filtrar escenas por iluminación, cámara o acción"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar por óptica, iluminación, movimiento o acción..."
            className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div
          role="group"
          aria-label="Filtrar por tipo de encuadre"
          className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg"
        >
          {(
            [
              { id: 'all', label: 'Todos los Planos' },
              { id: 'general', label: 'Plano General' },
              { id: 'medio', label: 'Plano Medio' },
              { id: 'secuencia', label: 'Plano Secuencia' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setShotFilter(tab.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                shotFilter === tab.id
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* High-Density Data Grid */}
      {filteredScenes.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <p className="text-sm text-slate-300">
            {scenes.length === 0
              ? 'No hay escenas desglosadas aún. Sube un vídeo y pulsa "Autodesglosar Vídeo con Gemini 4 Argon".'
              : 'No se encontraron escenas que coincidan con el filtro actual.'}
          </p>
          {scenes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setShotFilter('all');
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
            >
              Restablecer Filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-4 font-mono tabular-nums">Escena / TC</th>
                <th className="py-2.5 px-4">Secuencia y Acción Narrativa</th>
                <th className="py-2.5 px-4">Óptica y Movimiento</th>
                <th className="py-2.5 px-4">Esquema Lumínico</th>
                <th className="py-2.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {filteredScenes.map((sc) => (
                <tr
                  key={sc.id}
                  className="hover:bg-slate-800/40 transition-colors group"
                >
                  <td className="py-3 px-4 align-top font-mono tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-200">0{sc.sceneNumber}</div>
                    <div className="text-amber-400">
                      {sc.startTime} – {sc.endTime}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {Math.max(1, sc.endSeconds - sc.startSeconds)}s
                    </div>
                  </td>
                  <td className="py-3 px-4 align-top max-w-xs">
                    <div className="font-medium text-slate-100">{sc.title}</div>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      {sc.narrativeAction}
                    </p>
                  </td>
                  <td className="py-3 px-4 align-top">
                    <div className="text-slate-200">{sc.shotType}</div>
                    <div className="text-slate-400 mt-0.5">{sc.cameraMovement}</div>
                  </td>
                  <td className="py-3 px-4 align-top max-w-[220px]">
                    <div className="text-slate-300">{sc.lightingAndColor}</div>
                    <div className="text-slate-500 mt-0.5">{sc.soundDesign}</div>
                  </td>
                  <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSeekToScene(sc.startSeconds)}
                        aria-label={`Ir al plano ${sc.title}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3 h-3 text-amber-400" />
                        <span>Ver</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onScopeToScene(sc)}
                        aria-label={`Acotar consulta a ${sc.title}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Consultar Escena</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
