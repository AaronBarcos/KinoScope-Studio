'use client';

import React, { useRef, useState } from 'react';
import { Upload, X, FileVideo, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import {
  calculateChunkPlan,
  DEFAULT_CHUNK_SIZE_BYTES,
  formatByteSize,
  formatSecondsToTimecode,
  UploadedGeminiVideo,
  validateVideoFile,
} from '@/lib/video-utils';
import {
  cacheVideoBlobInBrowser,
  probeLocalVideoMetadata,
} from '@/lib/client-video-cache';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (video: UploadedGeminiVideo) => void;
}

export function FileUploadModal({
  isOpen,
  onClose,
  onUploadComplete,
}: FileUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [probedMeta, setProbedMeta] = useState<{
    durationSeconds?: number;
    aspectRatio?: string;
  }>({});
  const [customTitle, setCustomTitle] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<
    'idle' | 'transferring' | 'processing' | 'error'
  >('idle');
  const [progressPct, setProgressPct] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileSelect = async (file: File | null) => {
    setValidationError(null);
    setUploadStage('idle');
    setProgressPct(0);
    setUploadedBytes(0);
    setProbedMeta({});

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const check = validateVideoFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!check.valid) {
      setSelectedFile(null);
      setValidationError(check.error || 'Archivo de vídeo no válido.');
      return;
    }

    setSelectedFile(file);
    if (!customTitle) {
      setCustomTitle(file.name);
    }

    const meta = await probeLocalVideoMetadata(file);
    setProbedMeta(meta);
  };

  const pollUntilActive = async (fileName: string): Promise<{
    state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
    uri?: string;
    durationSeconds?: number;
  }> => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await fetch(`/api/files/status?name=${encodeURIComponent(fileName)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al verificar el estado en la File API.');
      }
      const st = data.file?.state as 'PROCESSING' | 'ACTIVE' | 'FAILED';
      if (st === 'ACTIVE') {
        return {
          state: 'ACTIVE',
          uri: data.file?.uri,
          durationSeconds: data.file?.durationSeconds,
        };
      }
      if (st === 'FAILED') {
        throw new Error('La File API de Gemini reportó un fallo al procesar el contenedor de vídeo.');
      }
      setStatusMessage(
        `Gemini File API indexando fotogramas y pista de audio (${attempt + 1}/40)...`
      );
      await new Promise((r) => setTimeout(r, 2500));
    }
    return { state: 'PROCESSING' };
  };

  const handleStartUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setValidationError('Por favor selecciona un archivo de vídeo antes de iniciar la subida.');
      return;
    }

    const check = validateVideoFile({
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
    });

    if (!check.valid) {
      setValidationError(check.error || 'Archivo no válido.');
      return;
    }

    try {
      setValidationError(null);
      setUploadStage('transferring');
      setProgressPct(2);

      const uploadId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const chunks = calculateChunkPlan(selectedFile.size, DEFAULT_CHUNK_SIZE_BYTES);

      for (const chunk of chunks) {
        const blobSlice = selectedFile.slice(chunk.start, chunk.end);
        setStatusMessage(
          `Transfiriendo bloque ${chunk.index + 1} de ${chunks.length} (${formatByteSize(chunk.end)} / ${formatByteSize(selectedFile.size)})...`
        );

        const chunkRes = await fetch(
          `/api/files/upload?action=chunk&uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunk.index}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blobSlice,
          }
        );

        const chunkData = await chunkRes.json();
        if (!chunkRes.ok) {
          throw new Error(chunkData.error || 'Fallo al transferir bloque de vídeo.');
        }

        setUploadedBytes(chunk.end);
        setProgressPct(Math.round((chunk.end / selectedFile.size) * 75));
      }

      setStatusMessage('Registrando vídeo en Gemini File API (ai.files.upload)...');
      setProgressPct(82);

      const finalDisplayName = customTitle.trim() || selectedFile.name;
      const finalMimeType = check.normalizedMimeType || selectedFile.type || 'video/mp4';

      const finalizeRes = await fetch('/api/files/upload?action=finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          mimeType: finalMimeType,
          displayName: finalDisplayName,
          durationSeconds: probedMeta.durationSeconds,
          aspectRatio: probedMeta.aspectRatio,
        }),
      });

      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) {
        throw new Error(finalizeData.error || 'Error al registrar el archivo en Gemini File API.');
      }

      const geminiFile = finalizeData.file;
      setUploadStage('processing');
      setProgressPct(90);

      let finalState: 'PROCESSING' | 'ACTIVE' | 'FAILED' = geminiFile.state || 'PROCESSING';
      let remoteDurationSec: number | undefined = geminiFile.durationSeconds;

      if (finalState === 'PROCESSING' && geminiFile.name) {
        const polled = await pollUntilActive(geminiFile.name);
        finalState = polled.state;
        if (polled.durationSeconds) {
          remoteDurationSec = polled.durationSeconds;
        }
      }

      setProgressPct(100);
      const localUrl = URL.createObjectURL(selectedFile);
      const resolvedDuration = probedMeta.durationSeconds || remoteDurationSec;

      await cacheVideoBlobInBrowser({
        fileName: geminiFile.name || '',
        displayName: finalDisplayName,
        uri: geminiFile.uri,
        sizeBytes: selectedFile.size,
        mimeType: geminiFile.mimeType || finalMimeType,
        durationSeconds: resolvedDuration,
        aspectRatio: probedMeta.aspectRatio,
        blob: selectedFile,
      });

      const newVideo: UploadedGeminiVideo = {
        id: geminiFile.name || `local-${Date.now()}`,
        name: geminiFile.name,
        displayName: finalDisplayName,
        uri: geminiFile.uri,
        mimeType: geminiFile.mimeType || finalMimeType,
        sizeBytes: selectedFile.size,
        state: finalState,
        durationSeconds: resolvedDuration,
        localObjectUrl: localUrl,
        streamUrl: geminiFile.streamUrl,
        hasServerCache: true,
        isPermanentVault: true,
        expirationTime: geminiFile.expirationTime,
        aspectRatio: probedMeta.aspectRatio || '16:9 / Nativo',
        createdAt: new Date().toISOString(),
      };

      onUploadComplete(newVideo);
      onClose();
    } catch (err: unknown) {
      setUploadStage('error');
      setValidationError(
        err instanceof Error ? err.message : 'Error inesperado durante la subida a la File API.'
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2
              id="upload-modal-title"
              className="text-lg font-display font-semibold text-white"
            >
              Subir Vídeo a Gemini File API (Hasta 2.00 GB)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Transmisión segmentada compatible con contenedores MP4, MOV, WebM, MPEG y AVI para gemini-4-argon
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de subida"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleStartUpload} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="video-title-input"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Título de la Bobina o Película
            </label>
            <input
              id="video-title-input"
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Ej. Secuencia_Climax_Montaje_v3.mp4"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="video-file-input"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Archivo de Vídeo Local (Máximo 2 GB)
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileSelect(e.dataTransfer.files[0]);
                }
              }}
              className="cursor-pointer rounded-xl border border-dashed border-slate-700 bg-slate-950/70 p-6 text-center hover:border-amber-500/60 transition-colors"
            >
              <input
                ref={fileInputRef}
                id="video-file-input"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/mpeg,video/x-msvideo,video/*"
                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                className="sr-only"
              />
              <Upload className="w-7 h-7 text-amber-400 mx-auto mb-2" />
              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-100 flex items-center justify-center gap-2">
                    <FileVideo className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{selectedFile.name}</span>
                  </p>
                  <p className="text-xs font-mono tabular-nums text-slate-400">
                    {formatByteSize(selectedFile.size)} · {selectedFile.type || 'video/mp4'}
                    {probedMeta.durationSeconds
                      ? ` · Duración: ${formatSecondsToTimecode(probedMeta.durationSeconds)}`
                      : ''}
                    {probedMeta.aspectRatio ? ` · ${probedMeta.aspectRatio}` : ''}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-200">
                    Haz clic para seleccionar un vídeo o arrástralo aquí
                  </p>
                  <p className="text-xs text-slate-400 font-mono tabular-nums">
                    Límite File API: 2.00 GB · Bloques de subida automática de 8 MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {validationError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-200"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {(uploadStage === 'transferring' || uploadStage === 'processing') && (
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-200 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  {statusMessage}
                </span>
                <span className="font-mono tabular-nums text-amber-400">{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  style={{ width: `${progressPct}%` }}
                  className="h-full bg-amber-400 transition-all duration-200"
                />
              </div>
              {selectedFile && (
                <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
                  <span>Transferido: {formatByteSize(uploadedBytes)}</span>
                  <span>Total: {formatByteSize(selectedFile.size)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-800 bg-slate-950 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={uploadStage === 'transferring' || uploadStage === 'processing'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Subir a File API e Indexar</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
