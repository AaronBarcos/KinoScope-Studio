'use client';

import React, { useState } from 'react';
import {
  Send,
  AlertCircle,
  Loader2,
  Trash2,
  Sparkles,
  Play,
  Scissors,
  Plus,
} from 'lucide-react';
import { AnalysisQueryRecord, THINKING_LEVEL_OPTIONS, VideoChat, validateSceneRange } from '@/lib/video-utils';

interface AnalysisInspectorProps {
  queryInputRef?: React.Ref<HTMLTextAreaElement>;
  activeVideoId?: string | null;
  activeVideoTitle?: string;
  isVideoExpired?: boolean;
  scope: 'full' | 'scene';
  startTimecode: string;
  endTimecode: string;
  maxDurationSec?: number;
  isAnalyzing: boolean;
  errorBanner: string | null;
  onSubmitQuery: (prompt: string) => Promise<void>;
  analyses: AnalysisQueryRecord[];
  chats: VideoChat[];
  activeChatId?: string;
  onSelectChat: (chatId: string) => void;
  onCreateChat: () => void;
  onDeleteAnalysis: (analysisId: string) => void;
  onDeleteChat: () => void;
  onSeekToTimestamp: (seconds: number) => void;
}

const SUGGESTED_QUESTIONS = [
  {
    label: '¿De qué trata el vídeo?',
    prompt:
      'Hazme un resumen claro de lo que ocurre en el vídeo y cuáles son los momentos más importantes [MM:SS].',
  },
  {
    label: 'Luz y colores',
    prompt:
      '¿Qué transmiten la iluminación y los colores en este vídeo? Indica los momentos clave [MM:SS].',
  },
  {
    label: 'Cámara y planos',
    prompt:
      '¿Cómo se usa la cámara y los tipos de plano para contar la historia? Señala ejemplos con su minuto [MM:SS].',
  },
  {
    label: 'Música y sonido',
    prompt:
      '¿Qué papel juegan la música, el sonido o los silencios en las emociones del vídeo [MM:SS]?',
  },
];

export function AnalysisInspector({
  queryInputRef,
  activeVideoId,
  activeVideoTitle,
  isVideoExpired = false,
  scope,
  startTimecode,
  endTimecode,
  maxDurationSec,
  isAnalyzing,
  errorBanner,
  onSubmitQuery,
  analyses,
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  onDeleteAnalysis,
  onDeleteChat,
  onSeekToTimestamp,
}: AnalysisInspectorProps) {
  const [promptText, setPromptText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Show chronological order (oldest -> newest) like a natural chat
  const chatMessages = [...analyses].reverse();

  const sendQuestion = async (text: string) => {
    setFormError(null);
    if (!text.trim()) {
      setFormError('Escribe una pregunta antes de enviar.');
      return;
    }
    if (scope === 'scene') {
      const rangeCheck = validateSceneRange(
        startTimecode,
        endTimecode,
        maxDurationSec
      );
      if (!rangeCheck.valid) {
        setFormError(rangeCheck.error || 'El fragmento elegido no es válido.');
        return;
      }
    }
    setPromptText('');
    await onSubmitQuery(text.trim());
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendQuestion(promptText);
  };

  return (
    <aside
      aria-label="Chat sobre el vídeo"
      className="flex flex-col h-full rounded-3xl border border-white/10 bg-[#15171d] overflow-hidden shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-400/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-semibold text-white truncate">
              Pregúntale al vídeo
            </h2>
            <p className="text-xs text-zinc-400 truncate">
              Tus conversaciones se guardan en este navegador
            </p>
          </div>
        </div>

        {chats.length > 0 && (
          <button
            type="button"
            onClick={onDeleteChat}
            disabled={isAnalyzing}
            className="text-xs text-zinc-400 hover:text-red-300 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Borrar chat
          </button>
        )}
      </div>

      {activeVideoId && (
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 shrink-0">
          <select
            aria-label="Chat del vídeo"
            value={activeChatId || ''}
            onChange={(event) => onSelectChat(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#12141a] px-3 py-2 text-sm text-zinc-200 focus:border-amber-400/60 focus:outline-none"
          >
            {chats.length === 0 ? (
              <option value={activeChatId}>Nuevo chat</option>
            ) : chats.map((chat, index) => (
              <option key={chat.id} value={chat.id}>
                {chat.title === 'Nuevo chat' ? `Nuevo chat (${chats.length - index})` : chat.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onCreateChat}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-400/20 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo chat
          </button>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 min-h-[160px] overflow-y-auto p-5 space-y-5">
        {chatMessages.length === 0 && !isAnalyzing ? (
          <div className="h-full flex flex-col justify-center items-center text-center py-8 px-3 space-y-4">
            <div className="space-y-1.5 max-w-sm">
              <p className="text-base font-medium text-zinc-100">
                ¿Qué te gustaría saber sobre{' '}
                {activeVideoTitle ? `«${activeVideoTitle}»` : 'tu vídeo'}?
              </p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Elige una idea rápida o escribe tu propia pregunta abajo.
              </p>
            </div>

            {!isVideoExpired && activeVideoId && (
              <div className="flex flex-wrap justify-center gap-2 max-w-md pt-1">
                {SUGGESTED_QUESTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => void sendQuestion(item.prompt)}
                    className="px-3.5 py-2 rounded-full bg-white/[0.04] hover:bg-amber-400/15 border border-white/10 hover:border-amber-400/40 text-xs font-medium text-zinc-200 hover:text-amber-200 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          chatMessages.map((item) => (
            <div key={item.id} className="kino-fade-in space-y-3">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-400 text-zinc-950 px-4 py-2.5 text-sm font-medium shadow-sm">
                  {item.scope === 'scene' && item.startTimecode && (
                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold opacity-75 mb-0.5">
                      <Scissors className="w-3 h-3" />
                      <span>
                        Fragmento {item.startTimecode} – {item.endTimecode}
                      </span>
                    </div>
                  )}
                  <p>{item.prompt}</p>
                </div>
              </div>

              {/* Assistant bubble */}
              <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <p className="text-[10px] text-zinc-500">{item.fps ?? 1} FPS · Razonamiento {THINKING_LEVEL_OPTIONS.find((option) => option.value === item.thinkingLevel)?.shortLabel.toLowerCase() || 'medio'}</p>
                <div className="text-sm text-zinc-200 leading-relaxed space-y-2">
                  {item.answer.split('\n').map((rawLine, idx) => {
                    const line = rawLine.trim();
                    if (!line) return null;
                    if (line.startsWith('### ') || line.startsWith('## ')) {
                      return (
                        <h4
                          key={idx}
                          className="font-display text-sm font-semibold text-amber-300 pt-1"
                        >
                          {line.replace(/^#{2,3}\s+/, '').replace(/\*\*/g, '')}
                        </h4>
                      );
                    }
                    const cleaned = line.replace(/^[-*]\s+/, '• ');
                    const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
                    return (
                      <p key={idx} className="text-zinc-200">
                        {parts.map((part, pIdx) =>
                          part.startsWith('**') && part.endsWith('**') ? (
                            <strong
                              key={pIdx}
                              className="font-semibold text-white"
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

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.citations.map((cit) => (
                      <button
                        key={`${item.id}-${cit.seconds}`}
                        type="button"
                        onClick={() => onSeekToTimestamp(cit.seconds)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400/15 hover:bg-amber-400 text-amber-200 hover:text-zinc-950 text-xs font-medium transition-colors"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>{cit.label}</span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteAnalysis(item.id)}
                    aria-label="Eliminar mensaje"
                    title="Eliminar este mensaje"
                    className="p-1 text-zinc-500 hover:text-red-400 transition-colors ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        {isAnalyzing && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
            <span>Viendo el vídeo y preparando la respuesta…</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleFormSubmit}
        className="p-4 border-t border-white/5 bg-[#12141a] space-y-3 shrink-0"
      >
        {/* Quick chips when there are already messages */}
        {chatMessages.length > 0 && !isVideoExpired && activeVideoId && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {SUGGESTED_QUESTIONS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isAnalyzing}
                onClick={() => void sendQuestion(item.prompt)}
                className="px-3 py-1 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/5 text-xs text-zinc-300 transition-colors shrink-0"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {scope === 'scene' && (
          <div className="flex items-center gap-1.5 text-xs text-amber-300">
            <Scissors className="w-3.5 h-3.5" />
            <span>
              Preguntando solo por el fragmento {startTimecode} – {endTimecode}
            </span>
          </div>
        )}

        {(formError || errorBanner) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-200"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{formError || errorBanner}</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={queryInputRef}
            aria-label="Pregunta sobre el vídeo o la selección"
            rows={2}
            value={promptText}
            disabled={!activeVideoId || isVideoExpired || isAnalyzing}
            onChange={(e) => {
              if (formError) setFormError(null);
              setPromptText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleFormSubmit(e);
              }
            }}
            placeholder={
              !activeVideoId
                ? 'Sube primero un vídeo para hacer preguntas…'
                : isVideoExpired
                  ? 'Este vídeo ha caducado (48 h). Vuelve a subirlo para seguir preguntando.'
                  : scope === 'scene' ? 'Escribe tu pregunta sobre la selección…' : 'Escribe tu pregunta sobre el vídeo…'
            }
            className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/60 focus:outline-none resize-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={
              !activeVideoId ||
              isVideoExpired ||
              isAnalyzing ||
              !promptText.trim()
            }
            aria-label="Enviar pregunta"
            className="h-11 px-5 rounded-2xl bg-amber-400 text-zinc-950 font-semibold text-sm hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Preguntar</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
