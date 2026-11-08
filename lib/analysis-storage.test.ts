import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getChatAnalyses,
  loadChatStateFromLocalStorage,
  saveChatStateToLocalStorage,
} from './analysis-storage.ts';
import type { AnalysisQueryRecord, VideoChat } from './video-utils.ts';

const storage = new Map<string, string>();
const legacyKey = 'kinoscope_saved_analyses_v1';
const chatsKey = 'kinoscope_saved_chats_v2';

test.beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  } });
});

test.afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

function message(id: string, videoId = 'video-1', chatId = 'chat-1'): AnalysisQueryRecord {
  return {
    id, videoId, chatId, videoTitle: 'mismo-nombre.mp4', scope: 'full',
    fps: 1, thinkingLevel: 'MEDIUM', prompt: `Pregunta ${id}`, answer: `Respuesta ${id}`,
    model: 'test', createdAt: '2026-11-08T18:00:00.000Z', citations: [],
  };
}

function chat(id: string, videoId = 'video-1'): VideoChat {
  return { id, videoId, title: id, createdAt: '2026-11-08T18:00:00.000Z' };
}

test('legacy history becomes one stable chat per video without merging identical titles', () => {
  const legacy = [message('newest'), message('other', 'video-2'), message('oldest')]
    .map((item) => ({ ...item, chatId: undefined }));
  storage.set(legacyKey, JSON.stringify(legacy));

  const migrated = loadChatStateFromLocalStorage();
  assert.equal(migrated.chats.length, 2);
  const firstChat = migrated.chats.find((item) => item.videoId === 'video-1')!;
  assert.equal(firstChat.title, 'Pregunta oldest');
  assert.deepEqual(getChatAnalyses(migrated.analyses, firstChat).map((item) => item.id), ['newest', 'oldest']);
  assert.deepEqual(loadChatStateFromLocalStorage(), migrated);
  assert.equal(storage.has(chatsKey), false, 'reading migration has no persistence side effects');
});

test('messages and AI context are isolated by both chat and video', () => {
  const analyses = [message('a'), message('b', 'video-1', 'chat-2'), message('c', 'video-2'), message('d')];
  assert.deepEqual(getChatAnalyses(analyses, chat('chat-1')).map((item) => item.id), ['a', 'd']);
  assert.deepEqual(getChatAnalyses(analyses, chat('empty')), []);
});

test('multiple chats, including empty chats, survive saving and reloading', () => {
  const state = { chats: [chat('chat-2'), chat('chat-1')], analyses: [message('a')] };
  saveChatStateToLocalStorage(state);
  assert.deepEqual(loadChatStateFromLocalStorage(), state);
});

test('deleting one chat preserves the others and deleting all never restores the legacy history', () => {
  storage.set(legacyKey, JSON.stringify([message('legacy')]));
  const state = { chats: [chat('chat-1'), chat('chat-2')], analyses: [message('a'), message('b', 'video-1', 'chat-2')] };
  saveChatStateToLocalStorage({
    chats: state.chats.filter((item) => item.id !== 'chat-1'),
    analyses: state.analyses.filter((item) => item.chatId !== 'chat-1'),
  });
  assert.deepEqual(loadChatStateFromLocalStorage().analyses.map((item) => item.id), ['b']);
  saveChatStateToLocalStorage({ chats: [], analyses: [] });
  assert.deepEqual(loadChatStateFromLocalStorage(), { chats: [], analyses: [] });
});

test('malformed local data does not crash chat loading', () => {
  storage.set(chatsKey, JSON.stringify({ chats: [null, {}], analyses: [null, {}, { id: 'bad' }] }));
  assert.deepEqual(loadChatStateFromLocalStorage(), { chats: [], analyses: [] });
});
