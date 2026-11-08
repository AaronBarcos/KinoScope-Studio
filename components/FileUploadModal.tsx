'use client';

import React, { useRef, useState } from 'react';
import { Upload, X, FileVideo, AlertCircle, Loader2, Clock } from 'lucide-react';
import {
  calculateChunkPlan,
  DEFAULT_CHUNK_SIZE_BYTES,
  formatAnalysisErrorMessage,
  formatByteSize,
  formatFriendlyDuration,
  probeLocalVideoMetadata,
  safeParseJsonResponse,
  UploadedGeminiVideo,
  validateVideoFile,
} from '@/lib/video-utils';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (video: UploadedGeminiVideo) => void;
}

type GeminiFileResponse = {
  name?: string;
  displayName?: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
  state?: UploadedGeminiVideo['state'];
  durationSeconds?: number;
  expirationTime?: string;
};

export function FileUploadModal({ isOpen, onClose, onUploadComplete }: FileUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [probedMeta, setProbedMeta] = useState<{ durationSeconds?: number; aspectRatio?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setSelectedFile(null);
    setProbedMeta({});
    setError(null);
    setProgressPct(0);
    setStatusMessage('');
  };

  const handleClose = () => {
    if (isUploading) return;
    reset();
    onClose();
  };

  const handleFileSelect = async (file: File | null) => {
    setError(null);
    setProbedMeta({});
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const check = validateVideoFile({ name: file.name, size: file.size, type: file.type });
    if (!check.valid) {
      setSelectedFile(null);
      setError(check.error || 'Este archivo no es un vídeo válido.');
      return;
    }
    setSelectedFile(file);
    setProbedMeta(await probeLocalVideoMetadata(file));
  };

  const waitUntilReady = async (fileName: string): Promise<GeminiFileResponse> => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const res = await fetch(`/api/files/status?name=${encodeURIComponent(fileName)}`);
      const parsed = await safeParseJsonResponse<{ file?: GeminiFileResponse }>(res, 'Estado del vídeo');
      if (!parsed.ok || !parsed.data?.file) {
        throw new Error(parsed.error || 'No se pudo comprobar el estado del vídeo.');
      }
      const file = parsed.data.file;
      if (file.state === 'ACTIVE') return file;
      if (file.state === 'FAILED' || file.state === 'EXPIRED') {
        throw new Error('Gemini no ha podido procesar este vídeo. Prueba con otro archivo.');
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('El vídeo está tardando demasiado en prepararse. Inténtalo de nuevo más tarde.');
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;
    const check = validateVideoFile({
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
    });
    if (!check.valid) {
      setError(check.error || 'Este archivo no es un vídeo válido.');
      return;
    }

    try {
      setError(null);
      setIsUploading(true);
      setProgressPct(1);
      setStatusMessage('Subiendo tu vídeo…');

      const uploadId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const chunks = calculateChunkPlan(selectedFile.size, DEFAULT_CHUNK_SIZE_BYTES);

      for (const chunk of chunks) {
        const res = await fetch(
          `/api/files/upload?action=chunk&uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunk.index}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: selectedFile.slice(chunk.start, chunk.end),
          }
        );
        const parsed = await safeParseJsonResponse(res, 'Subida');
        if (!parsed.ok) throw new Error(parsed.error || 'Se ha cortado la subida.');
        setProgressPct(Math.round((chunk.end / selectedFile.size) * 80));
      }

      setStatusMessage('Enviando el vídeo a la IA…');
      setProgressPct(85);

      const displayName = selectedFile.name;
      const mimeType = check.normalizedMimeType || selectedFile.type || 'video/mp4';
      const finalizeRes = await fetch('/api/files/upload?action=finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, mimeType, displayName }),
      });
      const finalizeParsed = await safeParseJsonResponse<{ file?: GeminiFileResponse }>(
        finalizeRes,
        'Subida'
      );
      if (!finalizeParsed.ok || !finalizeParsed.data?.file?.name) {
        throw new Error(finalizeParsed.error || 'No se ha podido guardar el vídeo.');
      }

      let geminiFile = finalizeParsed.data.file;
      if (geminiFile.state !== 'ACTIVE') {
        setStatusMessage('La IA está viendo tu vídeo por primera vez…');
        setProgressPct(92);
        geminiFile = { ...geminiFile, ...(await waitUntilReady(geminiFile.name!)) };
      }

      setProgressPct(100);

      onUploadComplete({
        id: geminiFile.name!,
        name: geminiFile.name!,
        displayName: geminiFile.displayName || displayName,
        uri: geminiFile.uri || '',
        mimeType: geminiFile.mimeType || mimeType,
        sizeBytes: selectedFile.size,
        state: 'ACTIVE',
        durationSeconds: probedMeta.durationSeconds || geminiFile.durationSeconds,
        aspectRatio: probedMeta.aspectRatio,
        localObjectUrl: URL.createObjectURL(selectedFile),
        expirationTime: geminiFile.expirationTime,
        createdAt: new Date().toISOString(),
      });
      setIsUploading(false);
      reset();
      onClose();
    } catch (err: unknown) {
      setIsUploading(false);
      setError(formatAnalysisErrorMessage(err));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="kino-fade-in w-full max-w-lg rounded-3xl border border-white/10 bg-[#16181e] p-6 sm:p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="upload-modal-title" className="font-display text-2xl font-semibold text-white">
              Sube un vídeo
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Después podrás hacerle todas las preguntas que quieras.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Cerrar"
            className="p-2 -m-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isUploading) fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (!isUploading && e.dataTransfer.files?.[0]) {
              void handleFileSelect(e.dataTransfer.files[0]);
            }
          }}
          className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-amber-400 bg-amber-400/5'
              : 'border-white/10 hover:border-amber-400/50 bg-white/[0.02]'
          } ${isUploading ? 'pointer-events-none opacity-70' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(e) => void handleFileSelect(e.target.files?.[0] || null)}
            className="sr-only"
          />
          {selectedFile ? (
            <div className="space-y-2">
              <FileVideo className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-base font-medium text-zinc-100 break-all">{selectedFile.name}</p>
              <p className="text-sm text-zinc-400">
                {formatByteSize(selectedFile.size)}
                {probedMeta.durationSeconds
                  ? ` · ${formatFriendlyDuration(probedMeta.durationSeconds)}`
                  : ''}
              </p>
              {!isUploading && <p className="text-xs text-zinc-500">Haz clic para elegir otro</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-amber-400/10 flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6 text-amber-400" />
              </div>
              <p className="text-base font-medium text-zinc-100">
                Arrastra tu vídeo aquí o haz clic para elegirlo
              </p>
              <p className="text-sm text-zinc-500">MP4, MOV, WebM… hasta 2 GB</p>
            </div>
          )}
        </div>

        {isUploading && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-zinc-200">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                {statusMessage}
              </span>
              <span className="text-zinc-400">{progressPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-300"
              />
            </div>
            <p className="text-xs text-zinc-500">No cierres esta ventana hasta que termine.</p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 p-3.5 text-sm text-red-200"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>El vídeo estará disponible para preguntas durante 48 horas.</span>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="px-4 py-2.5 rounded-full text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleStartUpload()}
            disabled={!selectedFile || isUploading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-400 text-zinc-950 text-sm font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>{isUploading ? 'Subiendo…' : 'Subir vídeo'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
