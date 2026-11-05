'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Film,
  Upload,
  RefreshCw,
  Trash2,
  HardDrive,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  AnalysisQueryRecord,
  formatByteSize,
  formatSecondsToTimecode,
  normalizeSceneRange,
  parseTimecodeToSeconds,
  SupportedThinkingLevel,
  toGeminiOffsetString,
  UploadedGeminiVideo,
  VideoSceneItem,
} from '@/lib/video-utils';
import {
  cacheVideoBlobInBrowser,
  getCachedVideoFromBrowser,
  probeLocalVideoMetadata,
  removeCachedVideoFromBrowser,
} from '@/lib/client-video-cache';
import {
  auth,
  signInWithGooglePopup,
  signOutFirebaseUser,
} from '@/lib/firebase';
import {
  deleteAnalysisFromFirestore,
  loadAnalysesFromLocalStorage,
  loadBreakdownsMapFromLocalStorage,
  saveAnalysesToLocalStorage,
  saveAnalysisToFirestore,
  saveBreakdownForVideoLocal,
  saveSceneBreakdownToFirestore,
  subscribeToUserAnalyses,
  subscribeToUserSceneBreakdowns,
} from '@/lib/analysis-storage';
import { CinemaMonitor } from '@/components/CinemaMonitor';
import { SceneBreakdownTable } from '@/components/SceneBreakdownTable';
import { AnalysisInspector } from '@/components/AnalysisInspector';
import { FileUploadModal } from '@/components/FileUploadModal';

export default function KinoScopeStudioPage() {
  const [videos, setVideos] = useState<UploadedGeminiVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [breakdownsByVideo, setBreakdownsByVideo] = useState<
    Record<string, VideoSceneItem[]>
  >(() => loadBreakdownsMapFromLocalStorage());
  const [analyses, setAnalyses] = useState<AnalysisQueryRecord[]>(() =>
    loadAnalysesFromLocalStorage()
  );

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [scope, setScope] = useState<'full' | 'scene'>('full');
  const [startTimecode, setStartTimecode] = useState<string>('00:00');
  const [endTimecode, setEndTimecode] = useState<string>('01:00');
  const [fps, setFps] = useState<number>(1);
  const [thinkingLevel, setThinkingLevel] =
    useState<SupportedThinkingLevel>('MEDIUM');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingBreakdown, setIsGeneratingBreakdown] = useState(false);
  const [isSyncingVault, setIsSyncingVault] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const activeVideo: UploadedGeminiVideo | null =
    videos.find((v) => v.id === activeVideoId) || videos[0] || null;

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
  const startSec = normalizedRange.startSec;
  const endSec = normalizedRange.endSec;

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  // Subscribe to Firestore analyses & scene breakdowns when authenticated
  useEffect(() => {
    if (!isAuthReady || !currentUser?.uid) return;

    const uid = currentUser.uid;

    // Backfill any locally saved analyses to Firestore
    const localItems = loadAnalysesFromLocalStorage();
    for (const item of localItems) {
      void saveAnalysisToFirestore(uid, item).catch(() => {});
    }

    const unsubAnalyses = subscribeToUserAnalyses(uid, (remoteRecords) => {
      setAnalyses((prev) => {
        const byId = new Map<string, AnalysisQueryRecord>();
        for (const r of remoteRecords) {
          byId.set(r.id, r);
        }
        for (const l of prev) {
          const cleanId = l.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
          if (!byId.has(l.id) && !byId.has(cleanId)) {
            byId.set(l.id, l);
          }
        }
        const merged = Array.from(byId.values()).sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        saveAnalysesToLocalStorage(merged);
        return merged;
      });
    });

    const unsubBreakdowns = subscribeToUserSceneBreakdowns(
      uid,
      (remoteBreakdowns) => {
        setBreakdownsByVideo((prev) => {
          const merged = { ...prev, ...remoteBreakdowns };
          for (const [vid, scList] of Object.entries(remoteBreakdowns)) {
            saveBreakdownForVideoLocal(vid, scList);
          }
          return merged;
        });
      }
    );

    return () => {
      unsubAnalyses();
      unsubBreakdowns();
    };
  }, [isAuthReady, currentUser?.uid]);

  const handleSignInGoogle = async () => {
    try {
      await signInWithGooglePopup();
      setStatusNotice(
        'Sesión iniciada con Google. Tus chats y análisis de IA ahora se sincronizan en Firebase Firestore.'
      );
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión con Google.'
      );
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFirebaseUser();
      setStatusNotice(
        'Sesión de nube cerrada. Los análisis siguen guardándose localmente en este navegador.'
      );
    } catch {
      // Ignore sign out error
    }
  };

  const handleRangeChange = useCallback(
    (
      newStartSec: number,
      newEndSec: number,
      changedHandle?: 'start' | 'end'
    ) => {
      if (changedHandle) {
        setScope('scene');
      }
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

  const handleSetStartFromPlayhead = (sec: number) => {
    handleRangeChange(sec, endSec, 'start');
  };

  const handleSetEndFromPlayhead = (sec: number) => {
    handleRangeChange(startSec, Math.max(1, sec), 'end');
  };

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
        prev.map((v) => {
          if (v.id !== videoId) return v;
          if (
            v.durationSeconds === cleanSec &&
            (!aspectRatio || v.aspectRatio === aspectRatio)
          ) {
            return v;
          }
          return {
            ...v,
            durationSeconds: cleanSec,
            ...(aspectRatio ? { aspectRatio } : {}),
          };
        })
      );

      setStartTimecode((prevStart) => {
        const s = parseTimecodeToSeconds(prevStart) ?? 0;
        if (s >= cleanSec) {
          return '00:00';
        }
        return formatSecondsToTimecode(s);
      });

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

  const handleSelectVideo = async (vid: UploadedGeminiVideo) => {
    setActiveVideoId(vid.id);
    setCurrentTimeSec(0);
    setErrorBanner(null);

    let resolvedDuration = vid.durationSeconds;
    let resolvedLocalUrl = vid.localObjectUrl;

    if (!resolvedLocalUrl || !resolvedLocalUrl.startsWith('blob:')) {
      const cached = await getCachedVideoFromBrowser({
        fileName: vid.name,
        displayName: vid.displayName,
        sizeBytes: vid.sizeBytes,
      });
      if (cached) {
        resolvedLocalUrl = cached.objectUrl;
        if (!resolvedDuration && cached.durationSeconds) {
          resolvedDuration = cached.durationSeconds;
        }
      }
    }

    if (!resolvedDuration && vid.name) {
      try {
        const res = await fetch(
          `/api/files/status?name=${encodeURIComponent(vid.name)}`
        );
        const data = await res.json();
        if (res.ok && data.file?.durationSeconds) {
          resolvedDuration = Number(data.file.durationSeconds);
        }
      } catch {
        // Ignore network error
      }
    }

    if (
      resolvedLocalUrl !== vid.localObjectUrl ||
      resolvedDuration !== vid.durationSeconds
    ) {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === vid.id
            ? {
                ...v,
                ...(resolvedLocalUrl
                  ? { localObjectUrl: resolvedLocalUrl }
                  : {}),
                ...(resolvedDuration
                  ? { durationSeconds: resolvedDuration }
                  : {}),
              }
            : v
        )
      );
    }

    const targetEnd = resolvedDuration || 60;
    setStartTimecode('00:00');
    setEndTimecode(formatSecondsToTimecode(targetEnd));
  };

  const handleAttachLocalVideoFile = async (videoId: string, file: File) => {
    const targetVideo = videos.find((v) => v.id === videoId);
    if (!targetVideo) return;

    const localUrl = URL.createObjectURL(file);
    const meta = await probeLocalVideoMetadata(file);
    const resolvedDuration =
      meta.durationSeconds || targetVideo.durationSeconds;

    await cacheVideoBlobInBrowser({
      fileName: targetVideo.name,
      displayName: targetVideo.displayName,
      sizeBytes: targetVideo.sizeBytes || file.size,
      mimeType: file.type || targetVideo.mimeType || 'video/mp4',
      durationSeconds: resolvedDuration,
      blob: file,
    });

    setVideos((prev) =>
      prev.map((v) =>
        v.id === videoId
          ? {
              ...v,
              localObjectUrl: localUrl,
              durationSeconds: resolvedDuration,
              aspectRatio: meta.aspectRatio || v.aspectRatio,
            }
          : v
      )
    );

    if (resolvedDuration) {
      setStartTimecode('00:00');
      setEndTimecode(formatSecondsToTimecode(resolvedDuration));
    }

    setStatusNotice(
      `Archivo de vídeo "${file.name}" vinculado correctamente para reproducción en pantalla.`
    );
  };

  const handleSyncFileApiVault = useCallback(async (silent = false) => {
    setIsSyncingVault(true);
    if (!silent) setStatusNotice(null);
    try {
      const res = await fetch('/api/files/status');
      const data = await res.json();
      if (res.ok && Array.isArray(data.files)) {
        const remoteVideos: UploadedGeminiVideo[] = await Promise.all(
          data.files.map(async (f: Record<string, unknown>) => {
            const fileName = String(f.name || '');
            const displayName = String(
              f.displayName || f.name || 'Vídeo File API'
            );
            const sizeBytes = Number(f.sizeBytes || 0);
            const mimeType = String(f.mimeType || 'video/mp4');
            const uri = String(f.uri || '');
            const streamUrl =
              typeof f.streamUrl === 'string' && f.streamUrl
                ? f.streamUrl
                : `/api/files/stream?name=${encodeURIComponent(fileName)}&uri=${encodeURIComponent(uri)}&displayName=${encodeURIComponent(displayName)}&sizeBytes=${sizeBytes}&mimeType=${encodeURIComponent(mimeType)}`;

            const cachedBrowser = await getCachedVideoFromBrowser({
              fileName,
              displayName,
              sizeBytes,
            });

            const remoteDuration =
              typeof f.durationSeconds === 'number' && f.durationSeconds > 0
                ? f.durationSeconds
                : cachedBrowser?.durationSeconds;

            return {
              id: fileName || `remote-${Math.random()}`,
              name: fileName,
              displayName,
              uri,
              mimeType,
              sizeBytes,
              state:
                (f.state as 'PROCESSING' | 'ACTIVE' | 'FAILED') || 'ACTIVE',
              durationSeconds: remoteDuration,
              localObjectUrl: cachedBrowser?.objectUrl,
              streamUrl,
              hasServerCache: Boolean(f.hasServerCache),
              aspectRatio: '16:9',
              createdAt: String(f.createTime || new Date().toISOString()),
            };
          })
        );

        setVideos((prev) => {
          const byName = new Map(prev.map((v) => [v.name, v]));
          const merged: UploadedGeminiVideo[] = [];

          for (const rv of remoteVideos) {
            const existing = byName.get(rv.name);
            if (existing) {
              merged.push({
                ...rv,
                localObjectUrl: existing.localObjectUrl || rv.localObjectUrl,
                durationSeconds:
                  existing.durationSeconds || rv.durationSeconds,
                aspectRatio: existing.aspectRatio || rv.aspectRatio,
              });
              byName.delete(rv.name);
            } else {
              merged.push(rv);
            }
          }

          for (const leftover of byName.values()) {
            merged.push(leftover);
          }
          return merged;
        });

        if (remoteVideos.length > 0) {
          setActiveVideoId((prevId) => {
            if (prevId) return prevId;
            const first = remoteVideos[0];
            if (first.durationSeconds) {
              setStartTimecode('00:00');
              setEndTimecode(formatSecondsToTimecode(first.durationSeconds));
            }
            return first.id;
          });
        }

        if (!silent) {
          setStatusNotice(
            `Sincronizado con Gemini File API (${remoteVideos.length} archivos remotos verificados).`
          );
        }
      }
    } catch {
      // Keep local list if offline or empty
    } finally {
      setIsSyncingVault(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void handleSyncFileApiVault(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handleSyncFileApiVault]);

  const handleSubmitQuery = async (prompt: string) => {
    if (!activeVideo) {
      setErrorBanner(
        'Debes subir o seleccionar un vídeo antes de realizar una consulta.'
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorBanner(null);

    const startOffset =
      scope === 'scene'
        ? toGeminiOffsetString(normalizedRange.startTimecode)
        : undefined;
    const endOffset =
      scope === 'scene'
        ? toGeminiOffsetString(normalizedRange.endTimecode)
        : undefined;

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileUri: activeVideo.uri,
          mimeType: activeVideo.mimeType,
          prompt,
          scope,
          startOffset,
          endOffset,
          fps,
          thinkingLevel,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || 'Error al analizar el vídeo con gemini-4-argon.'
        );
      }

      const newRecord: AnalysisQueryRecord = {
        id: `ans_${Date.now()}`,
        videoId: activeVideo.id,
        videoTitle: activeVideo.displayName,
        scope,
        startTimecode:
          scope === 'scene' ? normalizedRange.startTimecode : undefined,
        endTimecode:
          scope === 'scene' ? normalizedRange.endTimecode : undefined,
        startOffset,
        endOffset,
        fps,
        thinkingLevel: data.thinkingLevel || thinkingLevel,
        prompt,
        answer: data.answer,
        model: data.model || 'models/gemini-4-argon',
        createdAt: new Date().toISOString(),
        citations: data.citations || [],
      };

      setAnalyses((prev) => {
        const updated = [newRecord, ...prev];
        saveAnalysesToLocalStorage(updated);
        return updated;
      });

      if (currentUser?.uid) {
        await saveAnalysisToFirestore(currentUser.uid, newRecord);
      }
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Fallo en la consulta a gemini-4-argon.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDeleteAnalysis = async (analysisId: string) => {
    setAnalyses((prev) => {
      const updated = prev.filter((a) => a.id !== analysisId);
      saveAnalysesToLocalStorage(updated);
      return updated;
    });

    if (currentUser?.uid) {
      try {
        await deleteAnalysisFromFirestore(analysisId);
      } catch {
        // Ignore if not present in remote collection
      }
    }
  };

  const handleGenerateBreakdown = async () => {
    if (!activeVideo) {
      setErrorBanner(
        'Debes subir o seleccionar un vídeo antes de generar el desglose de escenas.'
      );
      return;
    }

    setIsGeneratingBreakdown(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/analyze/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileUri: activeVideo.uri,
          mimeType: activeVideo.mimeType,
          fps,
          thinkingLevel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al autodesglosar escenas.');
      }
      if (Array.isArray(data.scenes) && data.scenes.length > 0) {
        const detectedScenes: VideoSceneItem[] = data.scenes;
        setBreakdownsByVideo((prev) => ({
          ...prev,
          [activeVideo.id]: detectedScenes,
        }));
        saveBreakdownForVideoLocal(activeVideo.id, detectedScenes);

        if (currentUser?.uid) {
          await saveSceneBreakdownToFirestore(
            currentUser.uid,
            activeVideo.id,
            activeVideo.displayName,
            detectedScenes
          );
        }

        setStatusNotice(
          `Desglose guardado: ${detectedScenes.length} escenas detectadas con gemini-4-argon (Thinking ${thinkingLevel}).`
        );
      }
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'No se pudo generar el desglose de escenas.'
      );
    } finally {
      setIsGeneratingBreakdown(false);
    }
  };

  const handleDeleteVideo = async (video: UploadedGeminiVideo) => {
    try {
      if (video.name) {
        await fetch(
          `/api/files/status?name=${encodeURIComponent(video.name)}`,
          {
            method: 'DELETE',
          }
        );
        await removeCachedVideoFromBrowser(video.name);
      }
    } catch {
      // Ignore remote deletion error and remove locally
    }
    const remaining = videos.filter((v) => v.id !== video.id);
    setVideos(remaining);
    if (activeVideoId === video.id) {
      setActiveVideoId(remaining[0]?.id || null);
      setCurrentTimeSec(0);
    }
  };

  const handleExportMarkdown = () => {
    const titleName = activeVideo?.displayName || 'Historial_General';
    const lines = [
      `# Informe de Análisis Cinematográfico — KinoScope Studio`,
      `Película / Bobina: ${activeVideo?.displayName || 'Todas las bobinas'}`,
      ...(activeVideo ? [`URI File API: ${activeVideo.uri}`] : []),
      `Modelo: models/gemini-4-argon`,
      ``,
      `## Bitácora Guardada de Consultas (${analyses.length})`,
      ...analyses.map(
        (a, i) =>
          `### ${i + 1}. [${a.videoTitle}] ${a.prompt}\n- Ámbito: ${
            a.scope === 'scene'
              ? `Escena ${a.startTimecode} – ${a.endTimecode} (${a.startOffset} a ${a.endOffset})`
              : 'Película Completa'
          } · ${a.fps} FPS · Thinking: ${a.thinkingLevel || 'MEDIUM'}\n\n${a.answer}\n`
      ),
    ];

    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `informe_${titleName.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusNotice('Informe Markdown exportado correctamente.');
  };

  const totalUsedBytes = videos.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-slate-950/90 sticky top-0 z-30 backdrop-blur">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          KinoScope Studio
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Navegación principal del estudio"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400"
        >
          <a
            href="#monitor-section"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Monitor
          </a>
          <a
            href="#desglose-section"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Desglose
          </a>
          <a
            href="#consultas-section"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Consultas IA
          </a>
          <a
            href="#vault-section"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Archivo File API
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            Subir Vídeo (Hasta 2GB)
          </button>
        </div>
      </header>

      {/* Main Studio Workspace Layout */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {statusNotice && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs text-slate-200">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cerrar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (3 cols on lg): File API Vault & Uploaded Reels */}
          <section
            id="vault-section"
            aria-label="Archivo de bobinas en Gemini File API"
            className="lg:col-span-3 space-y-4"
          >
            <div className="border border-slate-800 bg-slate-900/70 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-display font-semibold text-white">
                    Bobinas en File API
                  </h2>
                  <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    Capacidad máx: 2.00 GB / vídeo
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSyncFileApiVault(false)}
                  disabled={isSyncingVault}
                  aria-label="Sincronizar archivos con Gemini File API"
                  className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isSyncingVault ? 'animate-spin text-amber-400' : ''
                    }`}
                  />
                </button>
              </div>

              {/* Storage Quota Meter */}
              <div className="p-3 rounded-lg border border-slate-800 bg-slate-950 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                    <span>Volumen Activo</span>
                  </span>
                  <span className="text-slate-200">
                    {formatByteSize(totalUsedBytes)} / 2.00 GB
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          (totalUsedBytes / (2 * 1024 * 1024 * 1024)) * 100
                        )
                      )}%`,
                    }}
                    className="h-full bg-amber-400"
                  />
                </div>
              </div>

              {/* Reel List */}
              <div className="space-y-2">
                {videos.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 text-center space-y-1">
                    <p className="text-xs text-slate-300 font-medium">
                      No hay vídeos registrados
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Sube un archivo de hasta 2GB o pulsa sincronizar para
                      cargar tus vídeos de Gemini File API.
                    </p>
                  </div>
                ) : (
                  videos.map((vid) => {
                    const isSelected = vid.id === activeVideo?.id;
                    const savedCount = analyses.filter(
                      (a) =>
                        a.videoId === vid.id || a.videoTitle === vid.displayName
                    ).length;

                    return (
                      <div
                        key={vid.id}
                        className={`p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-amber-500/70 bg-slate-800/90 shadow-sm'
                            : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectVideo(vid)}
                            className="text-left flex-1 min-w-0"
                          >
                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-100 truncate">
                              <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="truncate">{vid.displayName}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-400">
                              <span className="whitespace-nowrap">
                                {formatByteSize(vid.sizeBytes)}
                              </span>
                              {vid.durationSeconds && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap text-amber-300">
                                    {formatSecondsToTimecode(vid.durationSeconds)}
                                  </span>
                                </>
                              )}
                              {savedCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap text-emerald-400">
                                    {savedCount} análisis
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={`whitespace-nowrap ${
                                  vid.state === 'ACTIVE'
                                    ? 'text-emerald-400'
                                    : vid.state === 'PROCESSING'
                                      ? 'text-amber-400'
                                      : 'text-red-400'
                                }`}
                              >
                                {vid.state}
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteVideo(vid)}
                            aria-label={`Eliminar ${vid.displayName}`}
                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsUploadModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-slate-700 bg-slate-950 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span>Subir Nuevo Vídeo a File API</span>
              </button>
            </div>

            {/* Technical Guide Card for Gemini 4 Argon Video Understanding */}
            <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-4 space-y-2.5 text-xs text-slate-400">
              <h3 className="font-display font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Arquitectura File API + Argon</span>
              </h3>
              <p className="leading-relaxed">
                Los archivos subidos mediante{' '}
                <code className="font-mono text-slate-200">ai.files.upload</code>{' '}
                se almacenan hasta 48h en la infraestructura de Gemini y admiten
                recortes dinámicos sin re-subir el vídeo usando{' '}
                <code className="font-mono text-slate-200">videoMetadata</code> (
                <code className="font-mono text-amber-300">startOffset</code>,{' '}
                <code className="font-mono text-amber-300">endOffset</code>,{' '}
                <code className="font-mono text-amber-300">fps</code>) y control
                de razonamiento{' '}
                <code className="font-mono text-amber-300">thinkingLevel</code>.
              </p>
            </div>
          </section>

          {/* Center Column (5 cols on lg): Cinema Monitor & Scene Breakdown */}
          <div id="monitor-section" className="lg:col-span-5 space-y-6">
            <CinemaMonitor
              video={activeVideo}
              scenes={scenes}
              currentTimeSec={currentTimeSec}
              onTimeChange={setCurrentTimeSec}
              scope={scope}
              onScopeChange={setScope}
              startSec={startSec}
              endSec={endSec}
              onRangeChange={handleRangeChange}
              onSetStartFromPlayhead={handleSetStartFromPlayhead}
              onSetEndFromPlayhead={handleSetEndFromPlayhead}
              onSelectSceneRange={handleSelectSceneRange}
              onDurationDetected={handleDurationDetected}
              onAttachLocalVideoFile={handleAttachLocalVideoFile}
              onOpenUpload={() => setIsUploadModalOpen(true)}
            />

            <SceneBreakdownTable
              scenes={scenes}
              isGenerating={isGeneratingBreakdown}
              onGenerateBreakdown={handleGenerateBreakdown}
              onSeekToScene={(sec) => setCurrentTimeSec(sec)}
              onScopeToScene={handleSelectSceneRange}
            />
          </div>

          {/* Right Column (4 cols on lg): Gemini 4 Argon Query Inspector */}
          <div className="lg:col-span-4">
            <AnalysisInspector
              activeVideoId={activeVideo?.id}
              activeVideoTitle={activeVideo?.displayName}
              scope={scope}
              onScopeChange={setScope}
              startTimecode={normalizedRange.startTimecode}
              endTimecode={normalizedRange.endTimecode}
              onStartTimecodeChange={setStartTimecode}
              onEndTimecodeChange={setEndTimecode}
              fps={fps}
              onFpsChange={setFps}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={setThinkingLevel}
              maxDurationSec={activeDurationSec}
              isAnalyzing={isAnalyzing}
              errorBanner={errorBanner}
              onSubmitQuery={handleSubmitQuery}
              analyses={analyses}
              onDeleteAnalysis={handleDeleteAnalysis}
              onSeekToTimestamp={(sec) => setCurrentTimeSec(sec)}
              onExportMarkdown={handleExportMarkdown}
              userEmail={currentUser?.email}
              isAuthReady={isAuthReady}
              onSignInGoogle={handleSignInGoogle}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </main>

      {/* Upload Modal */}
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
          const dur = newVideo.durationSeconds || 60;
          setStartTimecode('00:00');
          setEndTimecode(formatSecondsToTimecode(dur));
          setStatusNotice(
            `Vídeo "${newVideo.displayName}" registrado en Gemini File API (${newVideo.state}).`
          );
        }}
      />
    </div>
  );
}
