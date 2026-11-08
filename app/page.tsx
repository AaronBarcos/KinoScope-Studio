'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Film,
  Upload,
  Trash2,
  CheckCircle2,
  Clock,
  Plus,
} from 'lucide-react';
import {
  AnalysisQueryRecord,
  AnalysisSettings,
  DEFAULT_ANALYSIS_SETTINGS,
  formatAnalysisErrorMessage,
  formatSecondsToTimecode,
  formatTimeRemaining,
  isVideoExpired,
  normalizeSceneRange,
  parseTimecodeToSeconds,
  probeLocalVideoMetadata,
  safeParseJsonResponse,
  toGeminiOffsetString,
  UploadedGeminiVideo,
  VideoChat,
  VideoSceneItem,
} from '@/lib/video-utils';
import {
  getChatAnalyses,
  loadAnalysisSettings,
  saveAnalysisSettings,
  loadChatStateFromLocalStorage,
  loadBreakdownsMapFromLocalStorage,
  loadVideosFromLocalStorage,
  saveChatStateToLocalStorage,
  saveBreakdownsMapToLocalStorage,
  saveVideosToLocalStorage,
} from '@/lib/analysis-storage';
import { CinemaMonitor } from '@/components/CinemaMonitor';
import { SceneBreakdownTable } from '@/components/SceneBreakdownTable';
import { AnalysisInspector } from '@/components/AnalysisInspector';
import { FileUploadModal } from '@/components/FileUploadModal';
import { AnalysisSettingsPanel } from '@/components/AnalysisSettingsPanel';
import { VideoTimeline } from '@/components/VideoTimeline';

export default function KinoScopeStudioPage() {
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_ANALYSIS_SETTINGS);
  const queryInputRef = useRef<HTMLTextAreaElement>(null);
  const [videos, setVideos] = useState<UploadedGeminiVideo[]>([]);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [breakdownsByVideo, setBreakdownsByVideo] = useState<
    Record<string, VideoSceneItem[]>
  >({});
  const [chatState, setChatState] = useState<ReturnType<typeof loadChatStateFromLocalStorage>>({ chats: [], analyses: [] });
  const { chats, analyses } = chatState;
  const [activeChatByVideo, setActiveChatByVideo] = useState<Record<string, string>>({});
  const pendingQueries = useRef(new Set<string>());
  const [pendingChatIds, setPendingChatIds] = useState<string[]>([]);
  const [chatErrors, setChatErrors] = useState<Record<string, string | null>>({});

  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [scope, setScope] = useState<'full' | 'scene'>('full');
  const [startTimecode, setStartTimecode] = useState<string>('00:00');
  const [endTimecode, setEndTimecode] = useState<string>('01:00');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isGeneratingBreakdown, setIsGeneratingBreakdown] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const activeVideo: UploadedGeminiVideo | null =
    videos.find((v) => v.id === activeVideoId) || videos[0] || null;

  const videoChats = activeVideo ? chats.filter((chat) => chat.videoId === activeVideo.id) : [];
  const activeChat: VideoChat | null = activeVideo
    ? videoChats.find((chat) => chat.id === activeChatByVideo[activeVideo.id]) || videoChats[0] || {
        id: `chat_default_${activeVideo.id}`,
        videoId: activeVideo.id,
        title: 'Nuevo chat',
        createdAt: activeVideo.createdAt,
      }
    : null;
  const activeAnalyses = activeChat ? getChatAnalyses(analyses, activeChat) : [];
  const isAnalyzing = Boolean(activeChat && pendingChatIds.includes(activeChat.id));

  useEffect(() => {
    setVideos(loadVideosFromLocalStorage());
    setBreakdownsByVideo(loadBreakdownsMapFromLocalStorage());
    setChatState(loadChatStateFromLocalStorage());
    setIsStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (isStorageLoaded) saveChatStateToLocalStorage(chatState);
  }, [chatState, isStorageLoaded]);

  const scenes: VideoSceneItem[] = activeVideo
    ? breakdownsByVideo[activeVideo.id] ||
      breakdownsByVideo[activeVideo.name] ||
      []
    : [];

  const activeDurationSec = activeVideo?.durationSeconds || 60;
  const rawStartSec = parseTimecodeToSeconds(startTimecode) ?? 0;
  const rawEndSec = parseTimecodeToSeconds(endTimecode) ?? activeDurationSec;
  const normalizedRange = normalizeSceneRange(
    rawStartSec,
    rawEndSec,
    activeDurationSec
  );

  useEffect(() => {
    setSettings(loadAnalysisSettings());
  }, []);

  const handleSettingsChange = (next: AnalysisSettings) => {
    setSettings(next);
    saveAnalysisSettings(next);
  };

  // Save videos to localStorage whenever the list changes
  useEffect(() => {
    if (isStorageLoaded) saveVideosToLocalStorage(videos);
  }, [videos, isStorageLoaded]);

  // Sync active videos from the Gemini File API on startup
  const syncFromFileApi = useCallback(async () => {
    try {
      const res = await fetch('/api/files/status');
      if (!res.ok) return;
      const data = (await res.json()) as {
        files?: Array<{
          name?: string;
          displayName?: string;
          uri?: string;
          mimeType?: string;
          sizeBytes?: number;
          state?: UploadedGeminiVideo['state'];
          durationSeconds?: number;
          createTime?: string;
          expirationTime?: string;
        }>;
      };
      const remoteFiles = Array.isArray(data?.files) ? data.files : [];
      const remoteByName = new Map(
        remoteFiles.filter((f) => f.name).map((f) => [String(f.name), f])
      );

      setVideos((prev) => {
        const seen = new Set<string>();
        const updated: UploadedGeminiVideo[] = [];

        for (const local of prev) {
          seen.add(local.name);
          const remote = remoteByName.get(local.name);
          if (remote) {
            updated.push({
              ...local,
              uri: remote.uri || local.uri,
              state: remote.state || 'ACTIVE',
              durationSeconds: local.durationSeconds || remote.durationSeconds,
              expirationTime: remote.expirationTime || local.expirationTime,
            });
          } else {
            updated.push({
              ...local,
              state: 'EXPIRED',
            });
          }
        }

        for (const remote of remoteFiles) {
          const name = String(remote.name || '');
          if (!name || seen.has(name)) continue;
          updated.push({
            id: name,
            name,
            displayName: String(remote.displayName || name),
            uri: String(remote.uri || ''),
            mimeType: String(remote.mimeType || 'video/mp4'),
            sizeBytes: Number(remote.sizeBytes || 0),
            state: remote.state || 'ACTIVE',
            durationSeconds: remote.durationSeconds,
            expirationTime: remote.expirationTime,
            createdAt: String(remote.createTime || new Date().toISOString()),
          });
        }

        return updated;
      });
    } catch {
      // Keep local list if offline
    }
  }, []);

  useEffect(() => {
    void syncFromFileApi();
  }, [syncFromFileApi]);

  const handleRangeChange = useCallback(
    (
      newStartSec: number,
      newEndSec: number,
      changedHandle?: 'start' | 'end'
    ) => {
      if (changedHandle) setScope('scene');
      const norm = normalizeSceneRange(
        newStartSec,
        newEndSec,
        activeDurationSec,
        changedHandle
      );
      setStartTimecode(norm.startTimecode);
      setEndTimecode(norm.endTimecode);
      setErrorBanner(null);
    },
    [activeDurationSec]
  );

  const handleSelectSceneRange = (scene: VideoSceneItem) => {
    setCurrentTimeSec(scene.startSeconds);
    setScope('scene');
    setStartTimecode(scene.startTime);
    setEndTimecode(scene.endTime);
    setErrorBanner(null);
  };

  const handleDurationDetected = useCallback(
    (videoId: string, detectedSeconds: number, aspectRatio?: string) => {
      if (!Number.isFinite(detectedSeconds) || detectedSeconds <= 0) return;
      const cleanSec = Math.max(1, Math.round(detectedSeconds));

      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId
            ? {
                ...v,
                durationSeconds: cleanSec,
                ...(aspectRatio ? { aspectRatio } : {}),
              }
            : v
        )
      );

      setEndTimecode((prevEnd) => {
        const e = parseTimecodeToSeconds(prevEnd);
        if (e === null || e > cleanSec || e <= 0 || prevEnd === '01:00') {
          return formatSecondsToTimecode(cleanSec);
        }
        return formatSecondsToTimecode(e);
      });
    },
    []
  );

  const handleSelectVideo = (vid: UploadedGeminiVideo) => {
    setActiveVideoId(vid.id);
    setCurrentTimeSec(0);
    setScope('full');
    setErrorBanner(null);
    setStartTimecode('00:00');
    setEndTimecode(formatSecondsToTimecode(vid.durationSeconds || 60));
  };

  const handleAttachLocalVideoFile = async (videoId: string, file: File) => {
    const localUrl = URL.createObjectURL(file);
    const meta = await probeLocalVideoMetadata(file);

    setVideos((prev) =>
      prev.map((v) =>
        v.id === videoId
          ? {
              ...v,
              localObjectUrl: localUrl,
              durationSeconds: meta.durationSeconds || v.durationSeconds,
              aspectRatio: meta.aspectRatio || v.aspectRatio,
            }
          : v
      )
    );

    if (meta.durationSeconds) {
      setStartTimecode('00:00');
      setEndTimecode(formatSecondsToTimecode(meta.durationSeconds));
    }
  };

  const handleSubmitQuery = async (prompt: string) => {
    if (!activeVideo || !activeChat) {
      setErrorBanner('Sube o elige un vídeo antes de hacer una pregunta.');
      return;
    }

    if (pendingQueries.current.has(activeChat.id)) return;
    pendingQueries.current.add(activeChat.id);
    setPendingChatIds((prev) => [...prev, activeChat.id]);
    setChatErrors((prev) => ({ ...prev, [activeChat.id]: null }));
    setErrorBanner(null);
    setChatState((prev) => {
      const existing = prev.chats.find((chat) => chat.id === activeChat.id);
      const titledChat = { ...activeChat, title: prompt.slice(0, 60) };
      return {
        ...prev,
        chats: existing
          ? prev.chats.map((chat) => chat.id === activeChat.id && chat.title === 'Nuevo chat' ? titledChat : chat)
          : [titledChat, ...prev.chats],
      };
    });

    const startOffset =
      scope === 'scene'
        ? toGeminiOffsetString(normalizedRange.startTimecode)
        : undefined;
    const endOffset =
      scope === 'scene'
        ? toGeminiOffsetString(normalizedRange.endTimecode)
        : undefined;

    const priorTurns = getChatAnalyses(analyses, activeChat)
      .slice(0, 6)
      .reverse()
      .map((a) => ({
        prompt: a.scope === 'scene' ? `[Fragmento ${a.startTimecode}–${a.endTimecode}] ${a.prompt}` : a.prompt,
        answer: a.answer,
      }));

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: activeVideo.name,
          fileUri: activeVideo.uri,
          prompt,
          startOffset,
          endOffset,
          history: priorTurns,
          ...settings,
        }),
      });

      const parsed = await safeParseJsonResponse<{
        error?: string;
        answer?: string;
        model?: string;
        citations?: Array<{ label: string; seconds: number }>;
      }>(res, 'Consulta');

      if (!parsed.ok || !parsed.data) {
        if (res.status === 410) {
          setVideos((prev) =>
            prev.map((v) =>
              v.id === activeVideo.id ? { ...v, state: 'EXPIRED' } : v
            )
          );
        }
        throw new Error(
          parsed.error ||
            parsed.data?.error ||
            'No se ha podido analizar el vídeo.'
        );
      }

      const data = parsed.data;
      const newRecord: AnalysisQueryRecord = {
        id: `ans_${crypto.randomUUID()}`,
        chatId: activeChat.id,
        videoId: activeVideo.id,
        videoTitle: activeVideo.displayName,
        scope,
        startTimecode:
          scope === 'scene' ? normalizedRange.startTimecode : undefined,
        endTimecode:
          scope === 'scene' ? normalizedRange.endTimecode : undefined,
        startOffset,
        endOffset,
        fps: settings.fps,
        thinkingLevel: settings.thinkingLevel,
        prompt,
        answer: data.answer || '',
        model: data.model || 'gemini-4-argon',
        createdAt: new Date().toISOString(),
        citations: data.citations || [],
      };

      setChatState((prev) => ({ ...prev, analyses: [newRecord, ...prev.analyses] }));
    } catch (err: unknown) {
      setChatErrors((prev) => ({ ...prev, [activeChat.id]: formatAnalysisErrorMessage(err) }));
    } finally {
      pendingQueries.current.delete(activeChat.id);
      setPendingChatIds((prev) => prev.filter((id) => id !== activeChat.id));
    }
  };

  const handleDeleteAnalysis = (analysisId: string) => {
    setChatState((prev) => ({ ...prev, analyses: prev.analyses.filter((a) => a.id !== analysisId) }));
  };

  const handleCreateChat = () => {
    if (!activeVideo) return;
    const chat: VideoChat = {
      id: `chat_${crypto.randomUUID()}`,
      videoId: activeVideo.id,
      title: 'Nuevo chat',
      createdAt: new Date().toISOString(),
    };
    setChatState((prev) => ({ ...prev, chats: [chat, ...prev.chats] }));
    setActiveChatByVideo((prev) => ({ ...prev, [activeVideo.id]: chat.id }));
    setErrorBanner(null);
  };

  const handleDeleteChat = () => {
    if (!activeChat || pendingQueries.current.has(activeChat.id)) return;
    setChatState((prev) => ({
      chats: prev.chats.filter((chat) => chat.id !== activeChat.id),
      analyses: prev.analyses.filter((item) => item.chatId !== activeChat.id),
    }));
    setChatErrors((prev) => ({ ...prev, [activeChat.id]: null }));
  };

  const handleGenerateBreakdown = async () => {
    if (!activeVideo) return;

    setIsGeneratingBreakdown(true);
    setErrorBanner(null);

    try {
      const res = await fetch('/api/analyze/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: activeVideo.name,
          fileUri: activeVideo.uri,
          ...settings,
        }),
      });

      const parsed = await safeParseJsonResponse<{
        error?: string;
        scenes?: VideoSceneItem[];
      }>(res, 'Escenas');

      if (!parsed.ok || !parsed.data) {
        if (res.status === 410) {
          setVideos((prev) =>
            prev.map((v) =>
              v.id === activeVideo.id ? { ...v, state: 'EXPIRED' } : v
            )
          );
        }
        throw new Error(
          parsed.error ||
            parsed.data?.error ||
            'No se han podido detectar las escenas.'
        );
      }

      if (Array.isArray(parsed.data.scenes) && parsed.data.scenes.length > 0) {
        const detected = parsed.data.scenes;
        setBreakdownsByVideo((prev) => {
          const updated = { ...prev, [activeVideo.id]: detected };
          saveBreakdownsMapToLocalStorage(updated);
          return updated;
        });
        setStatusNotice(
          `Se han encontrado ${detected.length} escenas en tu vídeo.`
        );
      }
    } catch (err: unknown) {
      setErrorBanner(formatAnalysisErrorMessage(err));
    } finally {
      setIsGeneratingBreakdown(false);
    }
  };

  const handleDeleteVideo = async (video: UploadedGeminiVideo) => {
    try {
      if (video.name && !isVideoExpired(video)) {
        await fetch(
          `/api/files/status?name=${encodeURIComponent(video.name)}`,
          { method: 'DELETE' }
        );
      }
    } catch {
      // Ignore remote deletion errors
    }
    const remaining = videos.filter((v) => v.id !== video.id);
    setVideos(remaining);
    saveVideosToLocalStorage(remaining);
    if (activeVideoId === video.id) {
      setActiveVideoId(remaining[0]?.id || null);
      setCurrentTimeSec(0);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Friendly header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#0e0f13]/80 border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
              <Film className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="font-display text-lg sm:text-xl font-semibold text-white tracking-tight">
                KinoScope
              </h1>
              <p className="text-xs text-zinc-400 hidden sm:block">
                Sube un vídeo y conversa con él
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-400 text-zinc-950 text-xs sm:text-sm font-semibold hover:bg-amber-300 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" />
            <span>Subir vídeo</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        {statusNotice && (
          <div className="kino-fade-in flex items-center justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs sm:text-sm text-emerald-100">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-emerald-200/70 hover:text-white text-xs"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Video selector pills when the user has videos */}
        {videos.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {videos.map((vid) => {
              const isSelected = vid.id === activeVideo?.id;
              const expired = isVideoExpired(vid);
              const remaining = formatTimeRemaining(vid.expirationTime);
              const chatCount = chats.filter((chat) => chat.videoId === vid.id).length;

              return (
                <div
                  key={vid.id}
                  className={`group inline-flex items-center gap-2 pl-3.5 pr-2 py-1.5 rounded-full border text-xs transition-colors shrink-0 ${
                    isSelected
                      ? 'border-amber-400/60 bg-amber-400/15 text-white'
                      : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectVideo(vid)}
                    className="inline-flex items-center gap-2 text-left"
                  >
                    <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-medium max-w-[180px] truncate">
                      {vid.displayName}
                    </span>
                    {expired ? (
                      <span className="text-[11px] text-amber-300">
                        Caducado
                      </span>
                    ) : remaining ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                        <Clock className="w-3 h-3" />
                        {remaining}
                      </span>
                    ) : null}
                    {chatCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[11px] text-zinc-200">
                        {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteVideo(vid)}
                    aria-label={`Quitar ${vid.displayName}`}
                    title="Eliminar vídeo"
                    className="p-1 rounded-full text-zinc-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => setIsUploadModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-dashed border-white/15 hover:border-amber-400/50 text-xs text-zinc-300 hover:text-amber-200 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Otro vídeo</span>
            </button>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Editor de vídeo</h2>
          <p className="mt-1 text-xs text-zinc-500">Selecciona un fragmento y conversa sobre esa escena.</p>
        </div>

        <AnalysisSettingsPanel settings={settings} onChange={handleSettingsChange}
          disabled={pendingChatIds.length > 0 || isGeneratingBreakdown}
          sampledDuration={activeVideo ? (scope === 'scene' ? normalizedRange.endSec - normalizedRange.startSec : activeDurationSec) : 0} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-6">
            <CinemaMonitor
              key={activeVideo?.id || 'no-video'}
              video={activeVideo}
              scenes={scenes}
              currentTimeSec={currentTimeSec}
              onTimeChange={setCurrentTimeSec}
              scope={scope}
              startSec={normalizedRange.startSec}
              endSec={normalizedRange.endSec}
              onDurationDetected={handleDurationDetected}
              onAttachLocalVideoFile={handleAttachLocalVideoFile}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              isGeneratingBreakdown={isGeneratingBreakdown}
              onGenerateBreakdown={handleGenerateBreakdown}
            />
          </div>

          <div className="lg:col-span-5 h-[520px] lg:h-[min(580px,65vh)]">
            <AnalysisInspector
              key={activeChat?.id || 'no-video'}
              activeVideoId={activeVideo?.id}
              activeVideoTitle={activeVideo?.displayName}
              isVideoExpired={activeVideo ? isVideoExpired(activeVideo) : false}
              scope={scope}
              startTimecode={normalizedRange.startTimecode}
              endTimecode={normalizedRange.endTimecode}
              maxDurationSec={activeDurationSec}
              isAnalyzing={isAnalyzing}
              errorBanner={(activeChat && chatErrors[activeChat.id]) || errorBanner}
              onSubmitQuery={handleSubmitQuery}
              analyses={activeAnalyses}
              chats={videoChats}
              activeChatId={activeChat?.id}
              onCreateChat={handleCreateChat}
              onSelectChat={(chatId) => {
                if (!activeVideo) return;
                setActiveChatByVideo((prev) => ({ ...prev, [activeVideo.id]: chatId }));
                setErrorBanner(null);
              }}
              onDeleteAnalysis={handleDeleteAnalysis}
              onDeleteChat={handleDeleteChat}
              onSeekToTimestamp={(sec) => setCurrentTimeSec(sec)}
              queryInputRef={queryInputRef}
            />
          </div>
        </div>
        {activeVideo && <VideoTimeline key={activeVideo.id}
          video={activeVideo} scenes={scenes} currentTimeSec={currentTimeSec} scope={scope}
          startSec={normalizedRange.startSec} endSec={normalizedRange.endSec}
          onTimeChange={setCurrentTimeSec} onScopeChange={setScope} onRangeChange={handleRangeChange}
          onSelectScene={handleSelectSceneRange}
          onAskSelection={() => {
            queryInputRef.current?.focus();
            queryInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }} />}
        {scenes.length > 0 && <details className="rounded-2xl border border-white/10 bg-[#15171d]">
          <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-zinc-300">Desglose de escenas · {scenes.length} escenas detectadas</summary>
          <SceneBreakdownTable scenes={scenes} onSeekToScene={setCurrentTimeSec} onScopeToScene={handleSelectSceneRange} currentTimeSec={currentTimeSec} />
        </details>}
      </main>

      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={(newVideo) => {
          setVideos((prev) => [
            newVideo,
            ...prev.filter((v) => v.name !== newVideo.name),
          ]);
          setActiveVideoId(newVideo.id);
          setCurrentTimeSec(0);
          setScope('full');
          const dur = newVideo.durationSeconds || 60;
          setStartTimecode('00:00');
          setEndTimecode(formatSecondsToTimecode(dur));
          setStatusNotice(
            `«${newVideo.displayName}» ya está listo. ¡Hazle tu primera pregunta!`
          );
        }}
      />
    </div>
  );
}
