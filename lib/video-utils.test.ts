import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimecodeToSeconds,
  formatSecondsToTimecode,
  toGeminiOffsetString,
  validateSceneRange,
  validateVideoFile,
  buildVideoPart,
  extractTimestampCitations,
  calculateChunkPlan,
  validateThinkingLevelForArgon,
  validateAnalysisSettings,
  parseGeminiVideoDuration,
  normalizeSceneRange,
  safeParseJsonResponse,
  formatAnalysisErrorMessage,
  MAX_FILE_API_BYTES,
  isVideoExpired,
  formatTimeRemaining,
  formatFriendlyDuration,
} from './video-utils.ts';

test('analysis settings preserve fractional and maximum FPS and all supported thinking levels', () => {
  assert.deepEqual(validateAnalysisSettings({}), { valid: true, settings: { fps: 1, thinkingLevel: 'MEDIUM' } });
  for (const fps of [0.25, 0.5, 1, 5, 24]) {
    for (const thinkingLevel of ['LOW', 'MEDIUM', 'HIGH']) {
      assert.deepEqual(validateAnalysisSettings({ fps, thinkingLevel }), {
        valid: true, settings: { fps, thinkingLevel },
      });
      assert.deepEqual(buildVideoPart({ fileUri: 'test-uri', mimeType: 'video/mp4', fps, startOffset: '12s', endOffset: '18s' }).videoMetadata,
        { startOffset: '12s', endOffset: '18s', fps });
    }
  }
});

test('analysis settings reject malformed client payloads rather than silently using defaults', () => {
  for (const fps of [0, -1, 24.01, Infinity, NaN, '2', null, {}, []]) {
    assert.equal(validateAnalysisSettings({ fps }).valid, false, `invalid FPS: ${String(fps)}`);
  }
  for (const thinkingLevel of ['MINIMAL', 'unknown', 1, null, {}, []]) {
    assert.equal(validateAnalysisSettings({ thinkingLevel }).valid, false);
  }
});

test('validateThinkingLevelForArgon accepts LOW, MEDIUM, HIGH and rejects MINIMAL', () => {
  assert.deepEqual(validateThinkingLevelForArgon(undefined), {
    valid: true,
    level: 'MEDIUM',
  });
  assert.deepEqual(validateThinkingLevelForArgon('low'), {
    valid: true,
    level: 'LOW',
  });
  assert.deepEqual(validateThinkingLevelForArgon('HIGH'), {
    valid: true,
    level: 'HIGH',
  });
  const minimalCheck = validateThinkingLevelForArgon('MINIMAL');
  assert.equal(minimalCheck.valid, false);
  assert.equal(minimalCheck.level, 'MEDIUM');
});

test('parseTimecodeToSeconds parses MM:SS, HH:MM:SS, and seconds strings accurately', () => {
  assert.equal(parseTimecodeToSeconds('00:00'), 0);
  assert.equal(parseTimecodeToSeconds('01:25'), 85);
  assert.equal(parseTimecodeToSeconds('01:02:03'), 3723);
  assert.equal(parseTimecodeToSeconds('42s'), 42);
  assert.equal(parseTimecodeToSeconds('00:75'), null);
  assert.equal(parseTimecodeToSeconds('invalid'), null);
});

test('formatSecondsToTimecode formats seconds with tabular zero padding', () => {
  assert.equal(formatSecondsToTimecode(0), '00:00');
  assert.equal(formatSecondsToTimecode(85), '01:25');
  assert.equal(formatSecondsToTimecode(3723), '01:02:03');
  assert.equal(formatSecondsToTimecode(85, true), '00:01:25');
});

test('toGeminiOffsetString produces valid Protobuf duration strings', () => {
  assert.equal(toGeminiOffsetString('01:30'), '90s');
  assert.equal(toGeminiOffsetString(45), '45s');
  assert.equal(toGeminiOffsetString(''), undefined);
  assert.equal(toGeminiOffsetString('bad'), undefined);
});

test('validateSceneRange checks ordering and duration bounds', () => {
  const valid = validateSceneRange('00:15', '01:05', 180);
  assert.equal(valid.valid, true);
  assert.equal(valid.startOffset, '15s');
  assert.equal(valid.endOffset, '65s');

  const reversed = validateSceneRange('01:10', '00:30', 180);
  assert.equal(reversed.valid, false);

  const outOfBounds = validateSceneRange('00:10', '03:30', 180);
  assert.equal(outOfBounds.valid, false);
});

test('parseGeminiVideoDuration extracts seconds from File API videoMetadata', () => {
  assert.equal(parseGeminiVideoDuration({ videoDuration: '45s' }), 45);
  assert.equal(parseGeminiVideoDuration({ videoDuration: '32.600000s' }), 33);
  assert.equal(parseGeminiVideoDuration({ duration: 94 }), 94);
  assert.equal(parseGeminiVideoDuration({ videoDuration: '01:15' }), 75);
  assert.equal(parseGeminiVideoDuration(undefined), undefined);
  assert.equal(parseGeminiVideoDuration({}), undefined);
});

test('normalizeSceneRange clamps and maintains valid start < end invariant', () => {
  // Dragging start past end pushes end forward within maxDuration
  const pushedEnd = normalizeSceneRange(40, 30, 50, 'start');
  assert.equal(pushedEnd.startSec, 40);
  assert.equal(pushedEnd.endSec, 41);
  assert.equal(pushedEnd.startTimecode, '00:40');
  assert.equal(pushedEnd.endTimecode, '00:41');

  // Dragging end before start pulls start backward
  const pulledStart = normalizeSceneRange(25, 15, 50, 'end');
  assert.equal(pulledStart.startSec, 14);
  assert.equal(pulledStart.endSec, 15);

  // Out-of-bounds default range (e.g. 01:00 on a 28s video) clamps cleanly to 28s
  const clamped = normalizeSceneRange(0, 60, 28);
  assert.equal(clamped.startSec, 0);
  assert.equal(clamped.endSec, 28);
  assert.equal(clamped.endTimecode, '00:28');
});

test('validateVideoFile enforces 2GB File API limit and video MIME types', () => {
  const ok = validateVideoFile({
    name: 'pelicula_master.mp4',
    size: 500 * 1024 * 1024,
    type: 'video/mp4',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.normalizedMimeType, 'video/mp4');

  const tooLarge = validateVideoFile({
    name: 'raw_8k.mov',
    size: MAX_FILE_API_BYTES + 1024,
    type: 'video/quicktime',
  });
  assert.equal(tooLarge.valid, false);

  const wrongType = validateVideoFile({
    name: 'guion.pdf',
    size: 1024 * 50,
    type: 'application/pdf',
  });
  assert.equal(wrongType.valid, false);
});

test('buildVideoPart constructs fileData and videoMetadata for gemini-4-argon', () => {
  const fullPart = buildVideoPart({
    fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
    mimeType: 'video/mp4',
  });
  assert.deepEqual(fullPart, {
    fileData: {
      fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
      mimeType: 'video/mp4',
    },
  });

  const clippedPart = buildVideoPart({
    fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
    mimeType: 'video/mp4',
    startOffset: '12s',
    endOffset: '48s',
    fps: 2,
  });
  assert.deepEqual(clippedPart, {
    fileData: {
      fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
      mimeType: 'video/mp4',
    },
    videoMetadata: {
      startOffset: '12s',
      endOffset: '48s',
      fps: 2,
    },
  });
});

test('extractTimestampCitations parses unique sorted timestamps from markdown', () => {
  const md = 'En [01:15] vemos un contrapicado, tras el plano de [00:20] y el corte en [01:15].';
  const citations = extractTimestampCitations(md);
  assert.deepEqual(citations, [
    { label: '00:20', seconds: 20 },
    { label: '01:15', seconds: 75 },
  ]);
});

test('calculateChunkPlan slices large files into sequential chunks', () => {
  const plan = calculateChunkPlan(20 * 1024 * 1024, 8 * 1024 * 1024);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].start, 0);
  assert.equal(plan[2].end, 20 * 1024 * 1024);
});

test('isVideoExpired and formatTimeRemaining follow the 48h File API expiration', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const in47h = new Date(now + 47 * 3_600_000 + 60_000).toISOString();
  const past = new Date(now - 1000).toISOString();

  assert.equal(isVideoExpired({ state: 'ACTIVE', expirationTime: in47h }, now), false);
  assert.equal(isVideoExpired({ state: 'ACTIVE', expirationTime: past }, now), true);
  assert.equal(isVideoExpired({ state: 'EXPIRED' }, now), true);
  assert.equal(isVideoExpired({ state: 'ACTIVE' }, now), false);

  assert.equal(formatTimeRemaining(in47h, now), '47 h');
  assert.equal(formatTimeRemaining(new Date(now + 10 * 60_000).toISOString(), now), '10 min');
  assert.equal(formatTimeRemaining(past, now), null);
  assert.equal(formatTimeRemaining(undefined, now), null);
});

test('formatFriendlyDuration renders human readable durations', () => {
  assert.equal(formatFriendlyDuration(45), '45 s');
  assert.equal(formatFriendlyDuration(85), '1 min 25 s');
  assert.equal(formatFriendlyDuration(120), '2 min');
  assert.equal(formatFriendlyDuration(3720), '1 h 02 min');
  assert.equal(formatFriendlyDuration(undefined), '');
});

test('safeParseJsonResponse handles <!DOCTYPE html> responses and 403 errors gracefully without throwing SyntaxError', async () => {
  const html403Res = new Response('<!DOCTYPE html><html><body>403 Forbidden</body></html>', {
    status: 403,
    headers: { 'Content-Type': 'text/html' },
  });
  const parsed403 = await safeParseJsonResponse<{ error?: string }>(
    html403Res,
    'Analizar secuencia'
  );
  assert.ok(parsed403.error);
  assert.ok(parsed403.error.includes('403'));

  const html500Res = new Response('<!DOCTYPE html><html><body>Internal Error</body></html>', {
    status: 500,
    headers: { 'Content-Type': 'text/html' },
  });
  const parsed500 = await safeParseJsonResponse<{ error?: string }>(
    html500Res,
    'Analizar secuencia'
  );
  assert.ok(parsed500.error);
  assert.ok(parsed500.error.includes('HTML'));

  const validJsonRes = new Response(JSON.stringify({ answer: 'Plano secuencia en [00:12]' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsedOk = await safeParseJsonResponse<{ answer?: string }>(
    validJsonRes,
    'Analizar secuencia'
  );
  assert.equal(parsedOk.data?.answer, 'Plano secuencia en [00:12]');
});

test('formatAnalysisErrorMessage translates expired, 403 and <!DOCTYPE errors into friendly Spanish guidance', () => {
  const htmlErr = formatAnalysisErrorMessage(
    new Error('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON')
  );
  assert.ok(htmlErr.includes('servidor'));

  const expiredErr = formatAnalysisErrorMessage(new Error('VIDEO_EXPIRED: files/abc'));
  assert.ok(expiredErr.includes('48 horas'));

  const filePermErr = formatAnalysisErrorMessage(
    new Error('403 PERMISSION_DENIED: You do not have permission to access the File files/abc123')
  );
  assert.ok(filePermErr.includes('Vuelve a subirlo'));
});


