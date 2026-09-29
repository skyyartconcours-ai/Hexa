import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import {
  buildProfile,
  findUserByLogin,
  isOptedOut,
  lastRoastAt,
  pastRoastsFor,
  saveRoast,
  subscriberFacts,
} from '../db.js';
import { log } from '../log.js';
import { reloadChannelContext } from './channel.js';
import { deleteAudio, spokenPseudo, synthesise, toSpeech } from '../tts/index.js';
import { RefusedError, generateRoast } from './generator.js';
import { judgeRoast } from './judge.js';
import { ANGLES } from './prompt.js';
import { checkName, checkRoast } from './safety.js';
import type { QueuedRoast, RoastTrigger, SessionState } from '../types.js';

const GIFT_WINDOW_MS = 60_000;
/** Filet de securite si l'overlay ne renvoie jamais la fin de lecture. */
const PLAYBACK_TIMEOUT_MS = 25_000;
/**
 * Combien d'angles de vanne on garde en memoire pendant une session.
 * Assez pour couvrir une quinzaine de minutes de diffusion, assez peu pour ne
 * pas finir par interdire au modele tous les angles possibles.
 */
const SESSION_ANGLE_MEMORY = 12;

/**
 * Qui d'autre le texte du viewer cite-t-il ? Les @mentions, et dans le message
 * de l'evenement les pseudos deja vus dans le chat. La vanne ne doit viser
 * aucun d'eux : "roast plutot mon pote @Kevin" ne doit pas marcher.
 */
function peopleCitedBy(trigger: RoastTrigger, chat: string[]): string[] {
  // Le streamer n'est pas un tiers : le taquiner est permis (c'est son emission).
  const self = new Set([trigger.userLogin.toLowerCase(), trigger.userName.toLowerCase(), config.twitch.channel]);
  const found = new Set<string>();
  for (const text of [trigger.message ?? '', ...chat]) {
    for (const match of text.matchAll(/@([\p{L}\p{N}_]{2,25})/gu)) found.add(match[1]!);
  }
  for (const token of (trigger.message ?? '').split(/[^\p{L}\p{N}_]+/u)) {
    if (token.length >= 4 && findUserByLogin(token)) found.add(token);
  }
  return [...found].filter((name) => !self.has(name.toLowerCase()));
}

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

  /** Angles deja servis dans la session en cours (voir SESSION_ANGLE_MEMORY). */
  private sessionAngles: string[] = [];

  /**
   * Derniere vanne par viewer, en memoire seulement : `!forgetme` efface
   * roast_history (c'est son role), il ne doit pas remettre le cooldown a zero.
   */
  private readonly recentRoasts = new Map<string, number>();

  /** Vanne en cours de lecture dont le viewer a demande l'effacement : rien a reecrire en base. */
  private readonly purgedWhilePlaying = new Set<string>();

  /** Plafond de generations simultanees (voir acquireSlot). */
  private running = 0;
  private waiting: Array<() => void> = [];

  /** Minuteur ecoule, vanne a l'antenne en train de finir (voir closeWindow). */
  private closing = false;

  /** Au moins un overlay connecte : sinon la vanne partirait dans le vide. */
  private outputReady = false;

  /** Echecs de generation consecutifs (API, reseau, TTS) : remonte en regie. */
  private generationFailures = 0;
  private lastGenerationError: string | null = null;

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
    this.closing = false;
    this.sessionTimer = setTimeout(() => this.closeWindow(), durationMs);

    this.sessionAngles = [];
    // Relu a chaque session : tu peux corriger data/channel.md entre deux
    // segments sans redemarrer l'outil.
    reloadChannelContext();

    log.ok(`Session de roast lancee pour ${minutes} minutes.`);
    // C'est ce qui declenche l'annonce en chat. Elle n'est pas cosmetique :
    // le format repose sur le fait que la personne qui s'abonne SAIT qu'elle
    // passe a l'antenne. Sans annonce visible, ce n'est plus un choix.
    this.emitSafely('session', { active: true, minutes, endsAt: this.session.endsAt });
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
    this.closing = false;
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
    this.emitSafely('session', { active: false, reason });
    this.broadcast();
    return this.session;
  }

  /**
   * Fin du minuteur. Contrairement a « Tout arreter », on ne coupe pas une
   * vanne au milieu de sa phrase : on n'accepte plus rien, la vanne a
   * l'antenne finit, et finishPlayback() ferme la session.
   */
  private closeWindow(): void {
    this.sessionTimer = null;
    if (!this.nowPlaying) {
      this.stop('minuteur');
      return;
    }
    this.closing = true;
    log.info('Minuteur ecoule : la vanne en cours se termine, puis la session se ferme.');
    this.broadcast();
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

  /** Appele par le serveur quand le nombre d'overlays connectes change. */
  setOutputReady(ready: boolean): void {
    if (this.outputReady === ready) return;
    this.outputReady = ready;
    log.info(ready ? 'Overlay connecte.' : 'Aucun overlay connecte : lecture suspendue.');
    if (ready) this.pump();
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

    // Le pseudo s'affiche en gros sur l'overlay et la voix le prononce : il
    // passe la meme blocklist que la vanne, sous sa forme ecrite ET parlee.
    const name = checkName(trigger.userName, spokenPseudo(trigger.userName));
    if (!name.ok) {
      log.warn(`Ignore ${trigger.userName} : ${name.reason}`);
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
      audioUrl: null,
      createdAt: Date.now(),
      playedAt: null,
    };
    this.items.set(id, item);
    // Une vanne de test ne met pas le vrai viewer en cooldown (voir record()).
    if (!trigger.test) {
      for (const key of [trigger.userId, ...(trigger.cooldownIds ?? [])]) this.recentRoasts.set(key, Date.now());
    }
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
    if (!this.session.active || this.closing) return 'session inactive';
    if (this.pendingCount() >= config.session.maxQueue) return 'file pleine';

    // Un donateur anonyme n'a ni pseudo ni historique : rien a roaster.
    if (trigger.anonymous) return 'donateur anonyme';

    // Planchers : voir config.cheer / config.donation. Un cheer d'un bit est un
    // vecteur de spam, pas un don.
    if (trigger.type === 'cheer' && (trigger.bits ?? 0) < config.cheer.minBits) {
      return `${trigger.bits ?? 0} bits, sous le plancher de ${config.cheer.minBits}`;
    }
    if (trigger.type === 'donation' && (trigger.amount ?? 0) < config.donation.minAmount) {
      return `don sous le plancher de ${config.donation.minAmount}`;
    }

    const previous = Math.max(
      ...[trigger.userId, ...(trigger.cooldownIds ?? [])].map((key) =>
        Math.max(lastRoastAt(key) ?? 0, this.recentRoasts.get(key) ?? 0),
      ),
    );
    if (previous && Date.now() - previous < config.session.userCooldownMs) {
      return 'deja roast recemment';
    }

    // Deja dans la file pour le meme evenement.
    for (const item of this.items.values()) {
      if (
        item.trigger.userId === trigger.userId &&
        !item.trigger.test &&
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
      // Fail-closed : seule la valeur exacte "limited" active les receveurs.
      if (config.gifts.recipients !== 'limited') return 'receveurs de gift desactives';
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
      // Plus personne n'attend cette vanne : ne pas payer LLM + TTS pour rien.
      if (this.isGone(item)) return;
      const profile = buildProfile(
        item.trigger.userId,
        item.trigger.userLogin,
        item.trigger.userName,
      );
      const history = pastRoastsFor(item.trigger.userId);

      const draft = await generateRoast(
        item.trigger,
        profile,
        history,
        subscriberFacts(item.trigger.userId),
        this.sessionAngles,
      );
      // !noroast / !forgetme / ban pendant la generation : on n'ecrit plus rien.
      if (this.isGone(item)) return;

      // Le filtre controle ce que la voix va VRAIMENT dire, pas seulement ce
      // qui s'affiche : toSpeech() reecrit le pseudo et retire les emoji.
      const viewerText = [item.trigger.message ?? '', ...profile.recentMessages];
      const verdict = checkRoast(draft, {
        spoken: toSpeech(draft.roast, item.trigger.userName),
        otherPeople: peopleCitedBy(item.trigger, profile.recentMessages),
        viewerText,
      });

      if (!verdict.ok) {
        this.fail(item, `filtre : ${verdict.reason}`);
        log.warn(`Vanne rejetee pour ${item.trigger.userName} — ${verdict.reason}`);
        log.warn(`  texte jete : ${draft.roast}`);
        return;
      }

      // Deuxieme avis, avant la synthese vocale : inutile de payer un TTS pour
      // une vanne qui va etre jetee.
      const judged = await judgeRoast(item.trigger.userName, draft.roast);
      if (this.isGone(item)) return;
      if (!judged.ok) {
        this.fail(item, `juge : ${judged.verdict} (${judged.reason})`);
        log.warn(`Vanne rejetee par le juge pour ${item.trigger.userName} — ${judged.reason}`);
        log.warn(`  texte jete : ${draft.roast}`);
        return;
      }

      // Rien n'empechait jusqu'ici la dixieme vanne de la session d'etre le
      // dixieme jeu de mots sur le pseudo. Chaque vanne est drole seule, et
      // l'ensemble sonne comme une machine. On garde les angles deja servis
      // pour que le modele parte ailleurs.
      // L'angle repart dans le prompt des vannes des AUTRES viewers : seule une
      // categorie de la liste fermee passe, jamais du texte libre.
      const angle = typeof draft.angle === 'string' ? draft.angle.trim().toLowerCase() : '';
      if ((ANGLES as readonly string[]).includes(angle)) {
        this.sessionAngles.push(angle);
        if (this.sessionAngles.length > SESSION_ANGLE_MEMORY) this.sessionAngles.shift();
      }

      // Le texte affiche a l'overlay reste propre : la didascalie ne part
      // qu'au TTS, et seulement s'il sait l'interpreter.
      const audioPath = await synthesise(item.id, draft.roast, draft.delivery, item.trigger.userName);
      // Texte et voix publies ENSEMBLE : la regie affiche ▶ des qu'une vanne
      // « en attente » a un texte. Publie avant la synthese, un ▶ pendant le TTS
      // envoyait une carte muette a l'antenne (audioUrl null), puis la vanne
      // repassait « en attente » a la fin de la synthese.
      item.text = draft.roast;
      item.angle = draft.angle;
      item.severity = draft.severity;
      item.delivery = draft.delivery ?? null;
      item.audioPath = audioPath;
      // L'extension depend du fournisseur de voix : on la derive du fichier
      // reellement ecrit plutot que de la supposer.
      item.audioUrl = audioPath ? `/audio/${path.basename(audioPath)}` : null;
      // Toute la chaine (LLM + TTS) a repondu : l'alerte de la regie s'eteint.
      this.generationFailures = 0;
      this.lastGenerationError = null;

      // La session a pu se terminer, ou la vanne etre retiree, pendant la
      // generation. drop() efface aussi le fichier audio, sinon orphelin.
      if (!this.session.active || this.closing || this.isGone(item)) {
        this.drop(item, 'retiree pendant la generation');
        return;
      }

      // Un juge injoignable ne vaut pas un juge satisfait : la vanne repasse par
      // la regie meme en lecture automatique.
      if (judged.unavailable) {
        // `warning` et pas `error` : la vanne existe et doit rester lisible en
        // regie. `error` sert aux vannes jetees, dont le texte est masque.
        item.warning = 'juge injoignable — a relire';
        item.status = 'pending';
      } else {
        item.status = this.session.autoPlay ? 'approved' : 'pending';
        if (item.status === 'approved') item.approvedAt = Date.now();
      }
      this.record(item, item.status);

      this.broadcast();
      this.pump();
    } catch (error) {
      const message =
        error instanceof RefusedError
          ? 'refus du modele'
          : error instanceof Error
            ? error.message
            : String(error);
      log.error(`Generation impossible pour ${item.trigger.userName} :`, message);
      if (!(error instanceof RefusedError)) {
        this.generationFailures += 1;
        this.lastGenerationError = message.slice(0, 200);
      }
      // Pas d'ecriture pour une vanne retiree : apres un !forgetme, elle
      // recreerait une ligne au nom de la personne.
      if (this.isGone(item)) {
        this.broadcast();
        return;
      }
      this.fail(item, message);
    } finally {
      this.releaseSlot();
    }
  }

  /** Retiree de la file pendant sa preparation (purgeUser, stop) : plus rien a ecrire. */
  private isGone(item: QueuedRoast): boolean {
    return this.items.get(item.id) !== item;
  }

  private fail(item: QueuedRoast, reason: string): void {
    item.status = 'failed';
    item.error = reason;
    deleteAudio(item.audioPath);
    item.audioPath = null;
    item.audioUrl = null;
    // On trace meme les echecs : sinon le cooldown ne voit rien et le viewer
    // peut etre reciblé dans la seconde qui suit.
    this.record(item, 'failed', item.text || `(rejetee : ${reason})`);
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
    item.approvedAt = Date.now();
    this.broadcast();
    this.pump();
    return true;
  }

  reject(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = 'rejected';
    this.record(item, 'rejected');
    this.drop(item, 'rejetee par le streamer');
    return true;
  }

  /**
   * Une autre vanne pour la meme personne.
   *
   * Refuser une vanne voulait dire que la personne — qui venait de payer —
   * n'avait rien. Ici la vanne refusee est archivee comme telle : le modele la
   * recoit dans <deja_dit> et doit partir sur un autre angle. Marche aussi sur
   * une vanne jetee par le filtre ou le juge, tant qu'elle est encore affichee.
   *
   * `force` saute le cooldown et le dedoublonnage, qui repondraient sinon
   * "deja roast a l'instant" ; l'opt-out, lui, reste verifie dans submit().
   */
  reroll(id: string): string | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.status !== 'pending' && item.status !== 'failed') return null;
    // Hors session, la generation aboutirait puis serait jetee par prepare().
    if (!this.session.active) return null;

    if (item.text) this.record(item, 'rejected');
    deleteAudio(item.audioPath);
    this.items.delete(item.id);
    log.info(`Vanne relancee pour ${item.trigger.userName}.`);
    return this.submit(item.trigger, { force: true });
  }

  /** Le viewer a demande a passer : on jette tout ce qui le concerne. */
  purgeUser(userId: string): number {
    let removed = 0;
    // L'opposition vaut aussi pour la vanne a l'antenne : on la coupe, sans la
    // reecrire en base (purgedWhilePlaying est lu par finishPlayback).
    if (this.nowPlaying && this.items.get(this.nowPlaying)?.trigger.userId === userId) {
      this.purgedWhilePlaying.add(this.nowPlaying);
      this.skipCurrent();
    }
    for (const item of [...this.items.values()]) {
      if (item.trigger.userId !== userId) continue;
      if (item.id === this.nowPlaying) {
        // Deja a l'antenne : on ne coupe pas, mais finishPlayback ne la reecrit pas en base.
        this.purgedWhilePlaying.add(item.id);
        continue;
      }
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
    if (!this.session.active || this.closing) return;
    if (this.nowPlaying) return;
    // Sans overlay, la vanne etait marquee « passee » 25 s plus tard sans avoir
    // ete ni vue ni entendue : on la garde jusqu'au retour de l'overlay.
    if (!this.outputReady) return;
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
      audioUrl: next.audioUrl,
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
    const now = Date.now();
    const ttl = config.session.pendingTtlMs;
    for (const item of [...this.items.values()]) {
      // Une vanne que le streamer vient de valider ne perime pas dans la
      // seconde : son delai repart de la validation. Une vanne encore en
      // generation (pas de texte) n'est pas concernee.
      const since =
        item.status === 'approved'
          ? (item.approvedAt ?? item.createdAt)
          : item.status === 'pending' && item.text
            ? item.createdAt
            : null;
      if (since === null || now - since < ttl) continue;
      log.info(`Vanne perimee pour ${item.trigger.userName}.`);
      // Visible 20 s en regie avec la raison, au lieu de disparaitre sans un mot.
      this.fail(item, `perimee : ${Math.round(ttl / 1000)} s sans passer a l'antenne`);
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
  finishPlayback(id: string, failed = false): void {
    if (this.nowPlaying !== id) return;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    this.nowPlaying = null;
    this.lastPlayedAt = Date.now();

    const item = this.items.get(id);
    const purged = this.purgedWhilePlaying.delete(id);
    if (item && failed && !purged) {
      // L'overlay n'a rien pu lire : « passee » serait faux, le viewer n'a rien
      // entendu. Visible 20 s avec ↻ pour la relancer.
      this.fail(item, "overlay : l'audio n'a pas pu etre lu, rien n'est passe a l'antenne");
    } else if (item) {
      item.status = 'played';
      item.playedAt = Date.now();
      if (!purged) this.record(item, 'played');
      deleteAudio(item.audioPath);
      item.audioPath = null;
      item.audioUrl = null;
      // On laisse la vanne visible un moment dans le panneau, puis on nettoie.
      setTimeout(() => {
        this.items.delete(id);
        this.broadcast();
      }, 120_000);
    }

    // Le minuteur a expire pendant cette vanne : elle a fini, on ferme.
    if (this.closing) {
      this.stop('minuteur');
      return;
    }

    this.broadcast();
    this.pump();
  }

  /** Echecs de generation consecutifs, pour l'alerte de la regie. */
  getGenerationHealth(): { failures: number; lastError: string | null } {
    return { failures: this.generationFailures, lastError: this.lastGenerationError };
  }

  /**
   * Seul point d'ecriture de l'historique. Une vanne de test (bouton de la
   * regie) est archivee sous `test:<type>` : elle nourrit <deja_dit>, mais ne
   * met pas le vrai viewer en cooldown pour son vrai sub.
   */
  private record(item: QueuedRoast, status: string, text = item.text): void {
    saveRoast({
      id: item.id,
      userId: item.trigger.userId,
      userName: item.trigger.userName,
      eventType: item.trigger.test ? `test:${item.trigger.type}` : item.trigger.type,
      text,
      severity: item.severity,
      status,
      createdAt: item.createdAt,
    });
  }

  private broadcast(): void {
    this.emit('state', {
      session: this.getState(),
      queue: this.getQueue(),
      generation: this.getGenerationHealth(),
    });
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
  on(
    event: 'state',
    listener: (payload: {
      session: SessionState;
      queue: QueuedRoast[];
      generation: { failures: number; lastError: string | null };
    }) => void,
  ): this;
  on(event: 'spoken', listener: (item: QueuedRoast) => void): this;
  /** Coupe immediatement la vanne en cours cote overlay. */
  on(event: 'cut', listener: (payload: { id: string }) => void): this;
  /** Ouverture et fermeture de la fenetre, pour annoncer en chat. */
  on(
    event: 'session',
    listener: (payload: {
      active: boolean;
      minutes?: number;
      endsAt?: number | null;
      reason?: string;
    }) => void,
  ): this;
}
