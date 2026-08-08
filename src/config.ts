import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const PUBLIC_DIR = path.join(ROOT, 'public');

function str(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function required(key: string): string {
  const value = str(key);
  if (!value) throw new Error(`Variable d'environnement manquante : ${key} (voir .env.example)`);
  return value;
}

function int(key: string, fallback: number): number {
  const raw = str(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'oui';
}

export const config = {
  twitch: {
    clientId: required('TWITCH_CLIENT_ID'),
    channel: required('TWITCH_CHANNEL').toLowerCase(),
    /**
     * Le token utilisateur du broadcaster couvre tout :
     * - channel:read:subscriptions : channel.subscribe / .gift / .message
     * - user:read:chat             : channel.chat.message (log de l'historique)
     * - user:write:chat            : reposter la vanne en chat (optionnel)
     */
    scopes: ['channel:read:subscriptions', 'user:read:chat', 'user:write:chat'],
  },

  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('ROAST_MODEL', 'claude-opus-5'),
    effort: str('ROAST_EFFORT', 'low'),
  },

  tts: {
    provider: str('TTS_PROVIDER', 'none') as 'elevenlabs' | 'none',
    elevenlabs: {
      apiKey: str('ELEVENLABS_API_KEY'),
      voiceId: str('ELEVENLABS_VOICE_ID'),
      modelId: str('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
    },
  },

  server: {
    port: int('PORT', 4747),
  },

  session: {
    defaultMinutes: int('SESSION_DEFAULT_MINUTES', 30),
    autoPlay: bool('AUTO_PLAY', false),
    minIntervalMs: int('MIN_INTERVAL_SECONDS', 8) * 1000,
    maxQueue: int('MAX_QUEUE', 40),
    maxSeverity: int('MAX_SEVERITY', 3),
    userCooldownMs: int('USER_COOLDOWN_MINUTES', 20) * 60_000,
  },

  gifts: {
    recipients: str('GIFT_RECIPIENTS', 'limited') as 'none' | 'limited',
    recipientsMax: int('GIFT_RECIPIENTS_MAX', 3),
  },

  chat: {
    retentionDays: int('CHAT_RETENTION_DAYS', 30),
    profileSampleSize: int('PROFILE_SAMPLE_SIZE', 25),
  },

  echoInChat: bool('ECHO_IN_CHAT', false),
};

export type Config = typeof config;
