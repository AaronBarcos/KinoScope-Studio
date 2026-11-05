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
  parseGeminiVideoDuration,
  normalizeSceneRange,
  MAX_FILE_API_BYTES,
} from './video-utils';

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
