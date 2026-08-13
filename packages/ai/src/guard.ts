/**
 * The prompt guard: why this file exists.
 *
 * Hexa's whole reason to exist is that text-to-image models cannot reproduce a
 * specific real person. Ask any of them for "Peyz" and you get a plausible
 * stranger — a generic Korean man with the wrong jaw, the wrong hair and none
 * of the recognition value the thumbnail is being made for. So Hexa gets
 * identity from licensed photographs and asks generative models for one thing
 * only: the world *behind* the person.
 *
 * That split is worth nothing if it lives only in documentation, so it lives
 * here instead. `assertNoPersonGeneration` runs inside `generateBackplate` for
 * every provider — local, stub and hosted alike — and refuses prompts that ask
 * for a person, a face, or a likeness. Two harms are being prevented:
 *
 *   1. Quality. A synthesised face next to a photographed one is the exact
 *      "AI slop" tell the product refuses to ship, and a synthesised face
 *      *instead of* a photographed one silently defeats the identity gate.
 *   2. Misleading likeness. A thumbnail is a claim about who is in a video.
 *      Generating something that reads as a real, named individual — a player,
 *      a caster, a celebrity — makes that claim falsely. Refusing at the
 *      boundary means no downstream stage has to detect it after the fact.
 *
 * The matcher deliberately tolerates the shapes evasion actually takes:
 * letter-spacing ("p o r t r a i t"), punctuation-splitting ("p.e.r.s.o.n"),
 * leetspeak ("f4ce"), oblique reference ("someone who looks like ..."), and
 * possessives ("in the style of <name>'s face"). It is equally deliberate
 * about *not* firing on negated mentions, because Hexa's own generated prompts
 * are full of them: every backplate prompt this package writes ends with
 * "no people, no faces, no characters, empty scene". Negation is parsed per
 * clause, and cancelled by "except"/"but"/"apart from" so that
 * "no people except one man" is still a refusal.
 */

import { HexaError } from '@hexa/core';
import type { IdentityEditRequest } from './types.js';

/** Maximum edit strength allowed on an image whose face must survive. */
export const MAX_IDENTITY_EDIT_STRENGTH = 0.65;

/**
 * Humanoid subject nouns. A backplate prompt has no legitimate reason to name
 * one: the subject is composited in from a photograph afterwards.
 *
 * Note what is *absent*: "crowd", "silhouette", "audience", "figure" and
 * "shadow" are all allowed, because a bokeh crowd behind a stage is a
 * background, not a likeness — and `stadium-crowd` is a shipped style.
 */
const PERSON_TERMS: readonly string[] = [
  // Generic humans
  'person', 'persons', 'people', 'human', 'humans', 'humanoid', 'someone', 'somebody',
  'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'guy', 'guys',
  'lady', 'ladies', 'gentleman', 'gentlemen', 'child', 'children', 'kid', 'kids',
  'teenager', 'teenagers', 'dude', 'bloke', 'folks',
  // Roles that imply a depicted individual
  'player', 'players', 'gamer', 'gamers', 'pro player', 'esports player', 'athlete',
  'athletes', 'streamer', 'streamers', 'caster', 'casters', 'celebrity', 'celebrities',
  'influencer', 'influencers', 'idol', 'actor', 'actress', 'singer', 'rapper',
  'supermodel', 'fashion model', 'spokesperson', 'coach', 'referee',
  // Depicted characters
  'character', 'characters', 'avatar', 'avatars', 'mascot', 'protagonist',
  'cosplay', 'cosplayer', 'warrior', 'soldier', 'knight', 'samurai', 'ninja',
  'assassin', 'wizard', 'sorcerer', 'hero', 'heroine', 'villain', 'human figure',
  // Face and likeness
  'face', 'faces', 'facial', 'facial features', 'portrait', 'portraits', 'headshot',
  'head shot', 'selfie', 'likeness', 'visage', 'countenance', 'mugshot',
  'profile picture', 'bust', 'lookalike', 'look alike', 'doppelganger',
];

/**
 * Cues that a prompt is reaching for a specific individual. These only refuse
 * when followed by something name-shaped or person-shaped, so "looks like a
 * thunderstorm" stays legal while "looks like Peyz" does not.
 */
const REFERENCE_CUES =
  /\b(?:looks?\s+like|looking\s+like|resembl(?:e|es|ing)|likeness\s+of|modell?ed\s+after|based\s+on\s+the\s+(?:real\s+)?(?:person|player|face)|spitting\s+image\s+of|impersonat\w+|cosplay(?:ing)?\s+(?:as|of)|dressed\s+as|deepfake|face\s*swap)\b/;

/** "<something>'s face" — the classic oblique route to a likeness. */
const POSSESSIVE_LIKENESS =
  /\b[\p{L}][\p{L}\-]*'s\s+(?:face|likeness|portrait|features|head|eyes|jaw|smile)\b/u;

/** Clause-level negation cues: terms after these are being excluded, not requested. */
const NEGATION_CUES =
  /\b(?:no|not|non|none|never|without|avoid|avoiding|exclude|excluding|excluded|omit|omitting|free\s+of|devoid\s+of|absent|absent\s+of|zero|minus|lacking|sans|empty\s+of)\b/;

/** Words that cancel a preceding negation: "no people except one man". */
const NEGATION_CANCELLERS =
  /\b(?:except|excepting|but|besides|apart\s+from|aside\s+from|other\s+than|save\s+for|unless|however)\b/;

/** Roster-supplied names that must never appear in a generative prompt. */
const protectedNames = new Set<string>();

/**
 * Register real individuals (player handles, legal names, aliases) whose mere
 * mention in a backplate prompt is a refusal. The roster package calls this at
 * startup so the guard knows who the product is actually about.
 */
export function registerProtectedNames(names: Iterable<string>): void {
  for (const raw of names) {
    const n = String(raw).trim().toLowerCase();
    if (n.length >= 2) protectedNames.add(n);
  }
}

/** Names currently protected — for diagnostics and tests. */
export function listProtectedNames(): string[] {
  return [...protectedNames].sort();
}

/** Drop every registered name. Tests and long-lived processes use this. */
export function clearProtectedNames(): void {
  protectedNames.clear();
}

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

/** Lowercase, de-accent, de-leet, and normalise whitespace. */
function normalise(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher for `term` that tolerates separators between letters, so
 * "p-o-r-t-r-a-i-t" and "p o r t r a i t" are caught alongside "portrait".
 * Short terms ("man", "kid") keep strict word matching — letting three-letter
 * terms span punctuation produces false positives on ordinary prose.
 */
function termMatcher(term: string): RegExp {
  const letters = term.replace(/\s+/g, '');
  if (letters.length < 5) {
    return new RegExp(`\\b${escapeRe(term).replace(/\\?\s+/g, '\\s+')}\\b`);
  }
  const body = term
    .split('')
    .filter((c) => c !== ' ')
    .map(escapeRe)
    .join('[\\W_]*');
  return new RegExp(`\\b${body}\\b`);
}

const TERM_MATCHERS: ReadonlyArray<{ term: string; re: RegExp }> = PERSON_TERMS.map((term) => ({
  term,
  re: termMatcher(term),
}));

/**
 * Split into clauses and drop the spans that are being negated, so a prompt can
 * say "no people, no faces" without tripping its own guard.
 */
function stripNegatedSpans(text: string): string {
  const clauses = text.split(/[,;.!?]+|\band\b|\bwith\b/);
  const kept: string[] = [];
  for (const clause of clauses) {
    const neg = NEGATION_CUES.exec(clause);
    if (!neg) {
      kept.push(clause);
      continue;
    }
    // Everything before the negation cue is still a positive request.
    kept.push(clause.slice(0, neg.index));
    const after = clause.slice(neg.index + neg[0].length);
    // ...and a canceller re-opens the request: "no people except one man".
    const cancel = NEGATION_CANCELLERS.exec(after);
    if (cancel) kept.push(after.slice(cancel.index + cancel[0].length));
  }
  return kept.join(' ');
}

/** Name-shaped token in the original casing: `Peyz`, `Jeong Ji-hoon`, `T1`. */
const CAPITALISED = /\b[A-Z][\p{L}][\p{L}'\-]*\b/u;

function refuse(reason: string, details: Record<string, unknown>): never {
  throw new HexaError('INVALID_REQUEST', reason, {
    hint:
      'Backplates describe environment, light and atmosphere only. Subjects come from licensed ' +
      'photographs and are composited in afterwards — remove the person/face wording from the prompt.',
    details,
  });
}

/**
 * Refuse any backplate prompt that asks for a person, a face or a likeness.
 * Called by `generateBackplate` for every provider, including the offline one.
 *
 * @throws HexaError('INVALID_REQUEST')
 */
export function assertNoPersonGeneration(prompt: string): void {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new HexaError('INVALID_REQUEST', 'Backplate prompt is empty.', {
      hint: 'Describe the environment: location, lighting, atmosphere and colour.',
    });
  }

  const normalised = normalise(prompt);

  // Registered real individuals are refused even in a negated clause: there is
  // no legitimate reason for a roster name to reach a generative prompt at all.
  for (const name of protectedNames) {
    if (new RegExp(`\\b${escapeRe(name)}\\b`).test(normalised)) {
      refuse(
        `Backplate prompt names a real individual ("${name}"). Hexa never generates a person's likeness.`,
        { rule: 'protected-name', matched: name },
      );
    }
  }

  const positive = stripNegatedSpans(normalised);

  for (const { term, re } of TERM_MATCHERS) {
    if (re.test(positive)) {
      refuse(
        `Backplate prompt asks for a person or a face ("${term}"). Faces are never generated — ` +
          'they come from licensed reference photography.',
        { rule: 'person-term', matched: term },
      );
    }
  }

  if (POSSESSIVE_LIKENESS.test(positive)) {
    refuse(
      "Backplate prompt asks for someone's facial likeness. Faces are never generated.",
      { rule: 'possessive-likeness' },
    );
  }

  // A reference cue only refuses when it actually points at somebody. The test
  // is a name-shaped token in the original casing, not introduced by an
  // article — names do not take articles, so "looks like a Thunderstorm" stays
  // legal while "looks like Peyz" does not.
  if (REFERENCE_CUES.test(positive)) {
    const inOriginal = new RegExp(REFERENCE_CUES.source, 'i').exec(prompt);
    if (inOriginal) {
      const after = prompt.slice(inOriginal.index + inOriginal[0].length).replace(/^[\s'"]+/, '');
      const introducedByArticle = /^(?:a|an|the|some|any)\b/i.test(after);
      if (!introducedByArticle && CAPITALISED.test(after.split(/\s+/).slice(0, 3).join(' '))) {
        refuse(
          `Backplate prompt references a specific individual ("${inOriginal[0]}"). Hexa never ` +
            'generates a likeness of a real person.',
          { rule: 'reference-cue', matched: inOriginal[0] },
        );
      }
    }
  }
}

/** Non-throwing form, for callers that want to warn rather than fail. */
export function checkPersonGeneration(prompt: string): { ok: boolean; reason?: string } {
  try {
    assertNoPersonGeneration(prompt);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Gate an identity-preserving edit.
 *
 * An identity edit is the one path where a face is legitimately present in the
 * pixels — so the caller must say where it is (`preserve`) and must keep the
 * transformation weak enough that the photograph, not the model, still decides
 * what the person looks like. The output is expected to be routed back through
 * identity verification by the caller; this guard only ensures the edit was
 * ever survivable in the first place.
 *
 * @throws HexaError('INVALID_REQUEST')
 */
export function guardIdentityEdit(req: IdentityEditRequest): void {
  if (!req || !Buffer.isBuffer(req.image) || req.image.length === 0) {
    throw new HexaError('INVALID_REQUEST', 'Identity edit requires a source image buffer.', {
      hint: 'Pass the composited subject plate as `image`.',
    });
  }

  const regions = req.preserve;
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new HexaError(
      'INVALID_REQUEST',
      'Identity edit requires at least one `preserve` region covering the face.',
      {
        hint:
          'Pass the face box(es) from the vision package as `preserve`. Without them the model is ' +
          'free to repaint the likeness, which defeats the identity guarantee.',
        details: { rule: 'preserve-required' },
      },
    );
  }

  regions.forEach((r, i) => {
    const nums = [r?.x, r?.y, r?.w, r?.h];
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new HexaError('INVALID_REQUEST', `preserve[${i}] must have numeric x, y, w, h.`, {
        details: { rule: 'preserve-shape', index: i, region: r },
      });
    }
    if (r.w <= 0 || r.h <= 0) {
      throw new HexaError('INVALID_REQUEST', `preserve[${i}] has zero or negative area.`, {
        hint: 'A degenerate preserve box protects nothing.',
        details: { rule: 'preserve-area', index: i, region: r },
      });
    }
    if (r.x < 0 || r.y < 0) {
      throw new HexaError('INVALID_REQUEST', `preserve[${i}] has a negative origin.`, {
        details: { rule: 'preserve-origin', index: i, region: r },
      });
    }
  });

  if (typeof req.strength !== 'number' || !Number.isFinite(req.strength)) {
    throw new HexaError('INVALID_REQUEST', 'Identity edit requires a numeric `strength`.', {
      hint: `Use a value in (0, ${MAX_IDENTITY_EDIT_STRENGTH}].`,
    });
  }
  if (req.strength <= 0) {
    throw new HexaError('INVALID_REQUEST', '`strength` must be greater than 0.', {
      hint: 'A zero-strength edit is a no-op; skip the provider call instead.',
      details: { rule: 'strength-range', strength: req.strength },
    });
  }
  if (req.strength > MAX_IDENTITY_EDIT_STRENGTH) {
    throw new HexaError(
      'INVALID_REQUEST',
      `Identity edit strength ${req.strength} exceeds the maximum of ${MAX_IDENTITY_EDIT_STRENGTH}; ` +
        'the photographed face would not survive the edit.',
      {
        hint:
          `Lower \`strength\` to ${MAX_IDENTITY_EDIT_STRENGTH} or below. If the shot needs a bigger ` +
          'change than that, it needs a different reference photograph, not a stronger model.',
        details: { rule: 'strength-max', strength: req.strength, max: MAX_IDENTITY_EDIT_STRENGTH },
      },
    );
  }

  // The prompt still may not ask for a *different* face.
  assertNoPersonGeneration(stripFaceContext(req.prompt));
}

/**
 * An identity-edit prompt legitimately talks about the subject ("keep the face
 * unchanged", "relight the player from the left"), so strip the protective
 * phrasing before running the person-term scan — what must not appear is a
 * request to *replace* the likeness.
 */
function stripFaceContext(prompt: string): string {
  if (typeof prompt !== 'string') return '';
  const cleaned = prompt
    .replace(
      /\b(?:keep|preserve|retain|protect|do\s+not\s+(?:change|alter|touch)|don't\s+(?:change|alter|touch)|leave|maintain|lock)\b[^,.;]*/gi,
      ' ',
    )
    .replace(/\b(?:the|his|her|their)\s+(?:face|likeness|features|head)\s+(?:unchanged|intact|as[- ]is)\b/gi, ' ')
    .replace(/\b(?:identity|face)[-\s]?(?:preserving|locked|safe)\b/gi, ' ');
  return cleaned.trim() === '' ? 'relight the existing plate' : cleaned;
}
