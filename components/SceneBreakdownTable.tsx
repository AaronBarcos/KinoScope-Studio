'use client';

import React, { useState } from 'react';
import {
  Search,
  Sparkles,
  Play,
  Crosshair,
  Loader2,
  ListVideo,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { VideoSceneItem } from '@/lib/video-utils';

interface SceneBreakdownTableProps {
  scenes: VideoSceneItem[];
  isGenerating: boolean;
  onGenerateBreakdown: () => void;
  onSeekToScene: (seconds: number) => void;
  onScopeToScene: (scene: VideoSceneItem) => void;
  currentTimeSec?: number;
}

export function SceneBreakdownTable({
  scenes,
  isGenerating,
  onGenerateBreakdown,
  onSeekToScene,
  onScopeToScene,
  currentTimeSec = 0,
}: SceneBreakdownTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [shotFilter, setShotFilter] = useState<
    'all' | 'general' | 'medio' | 'secuencia'
  >('all');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const filteredScenes = scenes.filter((scene) => {
    const matchesSearch =
      !searchQuery.trim() ||
      scene.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.shotType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.lightingAndColor
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      scene.narrativeAction.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (shotFilter === 'all') return true;
    if (shotFilter === 'general')
      return scene.shotType.toLowerCase().includes('general');
    if (shotFilter === 'medio')
      return scene.shotType.toLowerCase().includes('medio');
    if (shotFilter === 'secuencia')
      return scene.shotType.toLowerCase().includes('secuencia');
    return true;
  });

  return (
    <section
      id="desglose-section"
      aria-label="Desglose técnico de escenas y planos"
      className="border border-slate-800/90 bg-[#0d1017] rounded-md overflow-hidden shadow-lg"
    >
      {/* NLE Panel Tab Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b border-slate-800/90 bg-[#0a0c11]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 -my-2 border-t-2 border-amber-500 bg-[#141821] text-slate-100 font-medium text-[11px] tracking-wide">
            <ListVideo className="w-3 h-3 text-amber-400 shrink-0" />
            <span>EDL · Desglose de Planos ({scenes.length})</span>
          </span>
          <span className="hidden md:inline text-[11px] text-slate-400 truncate">
            Selecciona cualquier corte para saltar al TC o acotar el rango In/Out
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onGenerateBreakdown}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-3 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>
              {isGenerating
                ? 'Analizando Bobina...'
                : 'Autodesglosar Vídeo con Gemini 4 Argon'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={
              isCollapsed ? 'Expandir tabla EDL' : 'Contraer tabla EDL'
            }
            className="p-1 rounded border border-slate-800 bg-slate-900 text-slate-400 hover:text-white transition-colors"
          >
            {isCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Search & Interactive Segmented Filter Controls */}
      <div
        className={
          isCollapsed
            ? 'hidden'
            : 'flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 bg-[#0b0e14] border-b border-slate-800/80'
        }
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Filtrar escenas por iluminación, cámara o acción"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar EDL por óptica, iluminación, movimiento o acción..."
            className="w-full rounded border border-slate-800 bg-[#07090d] pl-7 pr-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div
          role="group"
          aria-label="Filtrar por tipo de encuadre"
          className="flex items-center gap-1 p-0.5 bg-[#07090d] border border-slate-800 rounded"
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
              className={`px-2 py-0.5 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 ${
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

      {/* High-Density NLE EDL Data Grid */}
      <div className={isCollapsed ? 'hidden' : 'block'}>
        {filteredScenes.length === 0 ? (
          <div className="p-4 text-center space-y-1.5 bg-[#090b10]">
            <p className="text-xs text-slate-300">
              {scenes.length === 0
                ? 'Sin cortes en la lista EDL. Sube un vídeo y pulsa "Autodesglosar Vídeo con Gemini 4 Argon" para detectar las escenas en el timeline.'
                : 'No se encontraron escenas que coincidan con el filtro actual.'}
            </p>
            {scenes.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setShotFilter('all');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 text-[11px] text-slate-200 hover:bg-slate-700 transition-colors"
              >
                Restablecer Filtros
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-52 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-800 bg-[#0a0d13] text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 px-3 tabular-nums">Corte / TC</th>
                  <th className="py-1.5 px-3">Secuencia y Acción Narrativa</th>
                  <th className="py-1.5 px-3">Óptica y Movimiento</th>
                  <th className="py-1.5 px-3">Esquema Lumínico</th>
                  <th className="py-1.5 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs bg-[#090c12]">
                {filteredScenes.map((sc) => {
                  const isActive =
                    currentTimeSec >= sc.startSeconds &&
                    currentTimeSec < sc.endSeconds;
                  return (
                    <tr
                      key={sc.id}
                      className={`transition-colors group ${
                        isActive
                          ? 'bg-amber-500/10 hover:bg-amber-500/15'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 px-3 align-top font-mono tabular-nums whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-200">
                            0{sc.sceneNumber}
                          </span>
                          {Array.isArray(sc.paletteHex) && (
                            <span className="inline-flex items-center gap-0.5">
                              {sc.paletteHex.slice(0, 3).map((hex, i) => (
                                <span
                                  key={i}
                                  style={{ backgroundColor: hex }}
                                  className="w-2 h-2 rounded-full border border-white/20"
                                />
                              ))}
                            </span>
                          )}
                        </div>
                        <div className="text-amber-400 text-[11px]">
                          {sc.startTime} – {sc.endTime}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {Math.max(1, sc.endSeconds - sc.startSeconds)}s
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top max-w-xs">
                        <div className="font-medium text-slate-100">
                          {sc.title}
                        </div>
                        <p className="text-slate-400 text-[11px] mt-0.5 leading-snug line-clamp-2">
                          {sc.narrativeAction}
                        </p>
                      </td>
                      <td className="py-2 px-3 align-top text-[11px]">
                        <div className="text-slate-200">{sc.shotType}</div>
                        <div className="text-slate-400 mt-0.5">
                          {sc.cameraMovement}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top max-w-[200px] text-[11px]">
                        <div className="text-slate-300 line-clamp-1">
                          {sc.lightingAndColor}
                        </div>
                        <div className="text-slate-500 mt-0.5 line-clamp-1">
                          {sc.soundDesign}
                        </div>
                      </td>
                      <td className="py-2 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSeekToScene(sc.startSeconds)}
                            aria-label={`Ir al plano ${sc.title}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[11px] text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                          >
                            <Play className="w-2.5 h-2.5 text-amber-400" />
                            <span>Ver</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onScopeToScene(sc)}
                            aria-label={`Acotar consulta a ${sc.title}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-300 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0"
                          >
                            <Crosshair className="w-2.5 h-2.5" />
                            <span>Consultar Escena</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
