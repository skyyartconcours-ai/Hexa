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

  /** Plafond de generations simultanees (voir acquireSlot). */
  private running = 0;
  private waiting: Array<() => void> = [];

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

  /**
   * Arret reel : coupe la vanne en cours ET vide la file.
   * Avant, `stop()` ne faisait que baisser un drapeau que la boucle de lecture
   * ne regardait pas — la regie affichait "hors session" pendant que la voix
   * continuait de chambrer les viewers. C'est le seul coupe-circuit du produit,
   * il doit couper.
   */
  stop(reason = 'manuel'): SessionState {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    this.session = { ...this.session, active: false, endsAt: null };

    if (this.nowPlaying) {
      this.emitSafely('cut', { id: this.nowPlaying });
      this.finishPlayback(this.nowPlaying);
    }

    let dropped = 0;
    for (const item of [...this.items.values()]) {
      if (item.status === 'played' || item.status === 'rejected') continue;
      deleteAudio(item.audioPath);
      this.items.delete(item.id);
      dropped += 1;
    }

    log.info(
      `Session de roast terminee (${reason})` +
        (dropped ? ` — ${dropped} vanne(s) en attente jetee(s).` : '.'),
    );
    this.broadcast();
    return this.session;
  }

  /** Un auditeur qui leve ne doit jamais figer la machine. */
  private emitSafely(event: string, payload: unknown): void {
    try {
      this.emit(event, payload);
    } catch (error) {
      log.error(
        `Auditeur "${event}" en erreur :`,
        error instanceof Error ? error.message : error,
      );
    }
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
    // L'opt-out n'est jamais contournable, meme par le bouton de test : un
    // droit d'opposition qu'un chemin de code peut ignorer n'est pas un droit.
    if (isOptedOut(trigger.userId)) {
      log.info(`Ignore ${trigger.userName} : viewer opt-out (!noroast)`);
      return null;
    }

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
      delivery: null,
      audioPath: null,
      createdAt: Date.now(),
      playedAt: null,
    };
    this.items.set(id, item);
    this.broadcast();

    void this.prepare(item);
    return id;
  }

  /** Elements qui occupent reellement une place : les termines ne comptent pas. */
  private pendingCount(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status !== 'played' && item.status !== 'rejected' && item.status !== 'failed') {
        count += 1;
      }
    }
    return count;
  }

  private shouldSkip(trigger: RoastTrigger): string | null {
    if (!this.session.active) return 'session inactive';
    if (this.pendingCount() >= config.session.maxQueue) return 'file pleine';

    // Un donateur anonyme n'a ni pseudo ni historique : rien a roaster.
    if (trigger.anonymous) return 'donateur anonyme';

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

    // Le quota de gift est decremente EN DERNIER : sinon un receveur opt-out ou
    // en cooldown brule un slot sans produire de vanne, et on se retrouve avec
    // zero receveur roaste sur une vague de cent.
    if (trigger.type === 'gift_recipient') {
      if (config.gifts.recipients === 'none') return 'receveurs de gift desactives';
      const now = Date.now();
      if (now > this.giftBudget.resetAt) {
        this.giftBudget = { remaining: config.gifts.recipientsMax, resetAt: now + GIFT_WINDOW_MS };
      }
      if (this.giftBudget.remaining <= 0) return 'quota de receveurs de gift atteint';
      this.giftBudget.remaining -= 1;
    }

    return null;
  }

  // ── Preparation (LLM + TTS) ──────────────────────────────────────────────

  /** Semaphore simple : borne le nombre de generations simultanees. */
  private async acquireSlot(): Promise<void> {
    if (this.running < config.session.maxConcurrent) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
  }

  private releaseSlot(): void {
    this.running -= 1;
    this.waiting.shift()?.();
  }

  private async prepare(item: QueuedRoast): Promise<void> {
    await this.acquireSlot();
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
      item.delivery = draft.delivery ?? null;

      // Le texte affiche a l'overlay reste propre : la didascalie ne part
      // qu'au TTS, et seulement s'il sait l'interpreter.
      item.audioPath = await synthesise(item.id, draft.roast, draft.delivery);

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
    } finally {
      this.releaseSlot();
    }
  }

  private fail(item: QueuedRoast, reason: string): void {
    item.status = 'failed';
    item.error = reason;
    deleteAudio(item.audioPath);
    item.audioPath = null;
    // On trace meme les echecs : sinon le cooldown ne voit rien et le viewer
    // peut etre reciblé dans la seconde qui suit.
    saveRoast({
      id: item.id,
      userId: item.trigger.userId,
      userName: item.trigger.userName,
      eventType: item.trigger.type,
      text: item.text || `(rejetee : ${reason})`,
      severity: item.severity,
      status: 'failed',
      createdAt: item.createdAt,
    });
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
    // Sans ce test, arreter la session ne faisait rien : la file continuait de
    // partir a l'antenne.
    if (!this.session.active) return;
    if (this.nowPlaying) return;
    if (Date.now() - this.lastPlayedAt < config.session.minIntervalMs) return;

    this.expirePending();

    const next = this.getQueue().find((item) => item.status === 'approved' && item.text);
    if (!next) return;

    next.status = 'playing';
    this.nowPlaying = next.id;
    this.lastPlayedAt = Date.now();
    this.session.roastsPlayed += 1;

    log.roast(`▶ ${next.trigger.userName} : ${next.text}`);

    // Le filet de securite est arme AVANT les emissions : si un auditeur leve,
    // la vanne doit quand meme finir par se debloquer.
    this.playbackTimer = setTimeout(() => this.finishPlayback(next.id), PLAYBACK_TIMEOUT_MS);

    this.emitSafely('play', {
      id: next.id,
      user: next.trigger.userName,
      eventType: next.trigger.type,
      text: next.text,
      // L'extension depend du fournisseur de voix : on la derive du fichier
      // reellement ecrit plutot que de la supposer.
      audioUrl: next.audioPath ? `/audio/${path.basename(next.audioPath)}` : null,
    });
    this.emitSafely('spoken', next);
    this.broadcast();
  }

  /**
   * Une vanne validee mais jamais diffusee perime : passe un certain delai,
   * elle n'est de toute facon plus reliee au sub qui l'a declenchee, et elle
   * occupe une place dans la file jusqu'a la saturer.
   */
  private expirePending(): void {
    const cutoff = Date.now() - config.session.pendingTtlMs;
    let expired = 0;
    for (const item of [...this.items.values()]) {
      if (item.status !== 'pending' && item.status !== 'approved') continue;
      if (item.createdAt > cutoff) continue;
      deleteAudio(item.audioPath);
      this.items.delete(item.id);
      expired += 1;
    }
    if (expired) {
      log.info(`${expired} vanne(s) perimee(s) retiree(s) de la file.`);
      this.broadcast();
    }
  }

  /** Debloque manuellement une vanne coincee (bouton de la regie). */
  skipCurrent(): boolean {
    if (!this.nowPlaying) return false;
    log.warn('Deblocage manuel de la vanne en cours.');
    this.emitSafely('cut', { id: this.nowPlaying });
    this.finishPlayback(this.nowPlaying);
    return true;
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
  /** Coupe immediatement la vanne en cours cote overlay. */
  on(event: 'cut', listener: (payload: { id: string }) => void): this;
}
