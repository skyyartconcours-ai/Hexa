import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { buildProfile, isOptedOut, lastRoastAt, pastRoastsFor, saveRoast } from '../db.js';
import { log } from '../log.js';
import { deleteAudio, synthesise } from '../tts/index.js';
import { RefusedError, generateRoast } from './generator.js';
import { checkRoast } from './safety.js';
import type { QueuedRoast, RoastTrigger, SessionState } from '../types.js';

const GIFT_WINDOW_MS = 60_000;
/** Filet de securite si l'overlay ne renvoie jamais la fin de lecture. */
const PLAYBACK_TIMEOUT_MS = 25_000;

export class RoastQueue extends EventEmitter {
  private readonly items = new Map<string, QueuedRoast>();
  private session: SessionState = {
    active: false,
    startedAt: null,
    endsAt: null,
    autoPlay: config.session.autoPlay,
    roastsPlayed: 0,
  };

  private sessionTimer: NodeJS.Timeout | null = null;
  private playbackTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private nowPlaying: string | null = null;
  private lastPlayedAt = 0;

  private giftBudget = { remaining: config.gifts.recipientsMax, resetAt: 0 };

  // ── Session ──────────────────────────────────────────────────────────────

  start(minutes = config.session.defaultMinutes): SessionState {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);

    const durationMs = Math.max(1, minutes) * 60_000;
    this.session = {
      active: true,
      startedAt: Date.now(),
      endsAt: Date.now() + durationMs,
      autoPlay: this.session.autoPlay,
      roastsPlayed: 0,
    };
    this.sessionTimer = setTimeout(() => this.stop('minuteur'), durationMs);

    log.ok(`Session de roast lancee pour ${minutes} minutes.`);
    this.broadcast();
    return this.session;
  }

  stop(reason = 'manuel'): SessionState {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    this.session = { ...this.session, active: false, endsAt: null };
    log.info(`Session de roast terminee (${reason}).`);
    this.broadcast();
    return this.session;
  }

  setAutoPlay(value: boolean): void {
    this.session.autoPlay = value;
    log.info(`Lecture automatique : ${value ? 'ON' : 'OFF'}.`);
    this.broadcast();
  }

  getState(): SessionState {
    return { ...this.session };
  }

  getQueue(): QueuedRoast[] {
    return [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  // ── Entree ───────────────────────────────────────────────────────────────

  /** Point d'entree unique pour tout evenement d'abonnement. */
  submit(trigger: RoastTrigger, opts: { force?: boolean } = {}): string | null {
    if (!opts.force) {
      const rejection = this.shouldSkip(trigger);
      if (rejection) {
        log.info(`Ignore ${trigger.userName} (${trigger.type}) : ${rejection}`);
        return null;
      }
    }

    const id = randomUUID();
    const item: QueuedRoast = {
      id,
      status: 'pending',
      trigger,
      text: '',
      angle: '',
      severity: 0,
      audioPath: null,
      createdAt: Date.now(),
      playedAt: null,
    };
    this.items.set(id, item);
    this.broadcast();

    void this.prepare(item);
    return id;
  }

  private shouldSkip(trigger: RoastTrigger): string | null {
    if (!this.session.active) return 'session inactive';
    if (this.items.size >= config.session.maxQueue) return 'file pleine';

    if (trigger.type === 'gift_recipient') {
      if (config.gifts.recipients === 'none') return 'receveurs de gift desactives';
      const now = Date.now();
      if (now > this.giftBudget.resetAt) {
        this.giftBudget = { remaining: config.gifts.recipientsMax, resetAt: now + GIFT_WINDOW_MS };
      }
      if (this.giftBudget.remaining <= 0) return 'quota de receveurs de gift atteint';
      this.giftBudget.remaining -= 1;
    }

    // Un donateur anonyme n'a ni pseudo ni historique : rien a roaster.
    if (trigger.anonymous) return 'donateur anonyme';

    if (isOptedOut(trigger.userId)) return 'viewer opt-out (!noroast)';

    const previous = lastRoastAt(trigger.userId);
    if (previous && Date.now() - previous < config.session.userCooldownMs) {
      return 'deja roast recemment';
    }

    // Deja dans la file pour le meme evenement.
    for (const item of this.items.values()) {
      if (
        item.trigger.userId === trigger.userId &&
        item.status !== 'played' &&
        item.status !== 'rejected'
      ) {
        return 'deja dans la file';
      }
    }

    return null;
  }

  // ── Preparation (LLM + TTS) ──────────────────────────────────────────────

  private async prepare(item: QueuedRoast): Promise<void> {
    try {
      const profile = buildProfile(
        item.trigger.userId,
        item.trigger.userLogin,
        item.trigger.userName,
      );
      const history = pastRoastsFor(item.trigger.userId);

      const draft = await generateRoast(item.trigger, profile, history);
      const verdict = checkRoast(draft);

      if (!verdict.ok) {
        this.fail(item, `filtre : ${verdict.reason}`);
        log.warn(`Vanne rejetee pour ${item.trigger.userName} — ${verdict.reason}`);
        log.warn(`  texte jete : ${draft.roast}`);
        return;
      }

      item.text = draft.roast;
      item.angle = draft.angle;
      item.severity = draft.severity;

      item.audioPath = await synthesise(item.id, draft.roast);

      // La session a pu se terminer pendant la generation.
      if (!this.session.active) {
        this.drop(item, 'session terminee pendant la generation');
        return;
      }

      item.status = this.session.autoPlay ? 'approved' : 'pending';
      saveRoast({
        id: item.id,
        userId: item.trigger.userId,
        userName: item.trigger.userName,
        eventType: item.trigger.type,
        text: item.text,
        severity: item.severity,
        status: item.status,
        createdAt: item.createdAt,
      });

      this.broadcast();
      this.pump();
    } catch (error) {
      const message =
        error instanceof RefusedError
          ? 'refus du modele'
          : error instanceof Error
            ? error.message
            : String(error);
      this.fail(item, message);
      log.error(`Generation impossible pour ${item.trigger.userName} :`, message);
    }
  }

  private fail(item: QueuedRoast, reason: string): void {
    item.status = 'failed';
    item.error = reason;
    deleteAudio(item.audioPath);
    item.audioPath = null;
    this.broadcast();
    // On garde la ligne 20 s pour que le streamer voie ce qui a ete filtre.
    setTimeout(() => {
      this.items.delete(item.id);
      this.broadcast();
    }, 20_000);
  }

  private drop(item: QueuedRoast, reason: string): void {
    log.info(`Vanne abandonnee (${reason}).`);
    deleteAudio(item.audioPath);
    this.items.delete(item.id);
    this.broadcast();
  }

  // ── Validation manuelle ──────────────────────────────────────────────────

  approve(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.status !== 'pending' || !item.text) return false;
    item.status = 'approved';
    this.broadcast();
    this.pump();
    return true;
  }

  reject(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = 'rejected';
    saveRoast({
      id: item.id,
      userId: item.trigger.userId,
      userName: item.trigger.userName,
      eventType: item.trigger.type,
      text: item.text,
      severity: item.severity,
      status: 'rejected',
      createdAt: item.createdAt,
    });
    this.drop(item, 'rejetee par le streamer');
    return true;
  }

  /** Le viewer a demande a passer : on jette tout ce qui le concerne. */
  purgeUser(userId: string): number {
    let removed = 0;
    for (const item of [...this.items.values()]) {
      if (item.trigger.userId !== userId) continue;
      if (item.id === this.nowPlaying) continue;
      deleteAudio(item.audioPath);
      this.items.delete(item.id);
      removed += 1;
    }
    if (removed) this.broadcast();
    return removed;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** Demarre la boucle de lecture. Appele une fois au demarrage du serveur. */
  run(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.pump(), 1000);
  }

  private pump(): void {
    if (this.nowPlaying) return;
    if (Date.now() - this.lastPlayedAt < config.session.minIntervalMs) return;

    const next = this.getQueue().find((item) => item.status === 'approved' && item.text);
    if (!next) return;

    next.status = 'playing';
    this.nowPlaying = next.id;
    this.lastPlayedAt = Date.now();
    this.session.roastsPlayed += 1;

    log.roast(`▶ ${next.trigger.userName} : ${next.text}`);

    this.emit('play', {
      id: next.id,
      user: next.trigger.userName,
      eventType: next.trigger.type,
      text: next.text,
      // L'extension depend du fournisseur de voix : on la derive du fichier
      // reellement ecrit plutot que de la supposer.
      audioUrl: next.audioPath ? `/audio/${path.basename(next.audioPath)}` : null,
    });
    this.emit('spoken', next);
    this.broadcast();

    this.playbackTimer = setTimeout(() => this.finishPlayback(next.id), PLAYBACK_TIMEOUT_MS);
  }

  /** Appele par l'overlay quand l'audio est termine. */
  finishPlayback(id: string): void {
    if (this.nowPlaying !== id) return;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    this.nowPlaying = null;
    this.lastPlayedAt = Date.now();

    const item = this.items.get(id);
    if (item) {
      item.status = 'played';
      item.playedAt = Date.now();
      saveRoast({
        id: item.id,
        userId: item.trigger.userId,
        userName: item.trigger.userName,
        eventType: item.trigger.type,
        text: item.text,
        severity: item.severity,
        status: 'played',
        createdAt: item.createdAt,
      });
      deleteAudio(item.audioPath);
      item.audioPath = null;
      // On laisse la vanne visible un moment dans le panneau, puis on nettoie.
      setTimeout(() => {
        this.items.delete(id);
        this.broadcast();
      }, 120_000);
    }

    this.broadcast();
    this.pump();
  }

  private broadcast(): void {
    this.emit('state', { session: this.getState(), queue: this.getQueue() });
  }
}

export interface RoastQueue {
  on(
    event: 'play',
    listener: (payload: {
      id: string;
      user: string;
      eventType: string;
      text: string;
      audioUrl: string | null;
    }) => void,
  ): this;
  on(event: 'state', listener: (payload: { session: SessionState; queue: QueuedRoast[] }) => void): this;
  on(event: 'spoken', listener: (item: QueuedRoast) => void): this;
}
