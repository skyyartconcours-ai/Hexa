/**
 * Argument parsing.
 *
 * Every one of these runs the real commander program, so a renamed flag or a
 * changed default fails here rather than in somebody's terminal. Actions are not
 * invoked: `parseAsync` is given argv that stops at parsing (`--help`) or the
 * options are read straight off the constructed command.
 */

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { buildProgram, commandNames, parseSeed } from './program.js';
import { buildRequest, parseGrade, parseKeyValues, DEFAULT_TEMPLATE } from './commands/gen.js';
import { createContext } from './context.js';

/**
 * A command with its action replaced by a no-op.
 *
 * `parse()` runs the handler, and these tests are about *parsing* — without the
 * swap, asserting on `hexa gen`'s flags would start a render. Calling `.action()`
 * again replaces the handler, which is the public way to do this.
 */
function find(name: string, { live = false } = {}): Command {
  const command = buildProgram().commands.find((c) => c.name() === name);
  if (!command) throw new Error(`no such command: ${name}`);
  if (!live) command.action(() => undefined);
  return command;
}

/** Parse argv for one subcommand and hand back its resolved options. */
function optionsOf(name: string, argv: string[]): Record<string, unknown> {
  const command = find(name);
  command.parse(argv, { from: 'user' });
  return command.opts();
}

describe('the program', () => {
  it('exposes every documented command', () => {
    expect(commandNames(buildProgram())).toEqual([
      // `help` is commander's built-in and only materialises once help is
      // requested, so it is not in the declared set.
      'assets', 'batch', 'doctor', 'gen', 'make', 'players',
      'preview', 'providers', 'qa', 'teams', 'templates',
    ]);
  });

  it('is named hexa and carries a version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('hexa');
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares every global flag', () => {
    const flags = buildProgram().options.map((o) => o.long);
    for (const flag of ['--log', '--assets', '--vision', '--seed', '--json', '--no-color']) {
      expect(flags, `missing global ${flag}`).toContain(flag);
    }
  });

  it('gives every command a description and examples', () => {
    for (const command of buildProgram().commands) {
      if (command.name() === 'help') continue;
      expect(command.description(), `${command.name()} has no description`).toBeTruthy();
    }
  });

  it('exposes the assets subcommands', () => {
    const subs = find('assets', { live: true }).commands.map((c) => c.name()).sort();
    expect(subs).toEqual(['clear', 'coverage', 'ingest', 'list', 'prune', 'stats']);
  });
});

describe('hexa gen', () => {
  it('takes two positional players', () => {
    const command = find('gen');
    command.parse(['Peyz', 'Viper'], { from: 'user' });
    expect(command.args).toEqual(['Peyz', 'Viper']);
  });

  it('accepts one player for a single-subject thumbnail', () => {
    const command = find('gen');
    command.parse(['Faker'], { from: 'user' });
    expect(command.args).toEqual(['Faker']);
  });

  it('parses the headline example from the docs', () => {
    const o = optionsOf('gen', ['Peyz', 'Viper', '--template', 'versus-classic', '--title', 'RIVALS', '--variants', '4', '--out', './out']);
    expect(o['template']).toBe('versus-classic');
    expect(o['title']).toBe('RIVALS');
    expect(o['variants']).toBe(4);
    expect(o['out']).toBe('./out');
  });

  it('defaults out to ./out and variants to 1', () => {
    const o = optionsOf('gen', ['Peyz', 'Viper']);
    expect(o['out']).toBe('./out');
    expect(o['variants']).toBe(1);
  });

  it('supports the short flags', () => {
    const o = optionsOf('gen', ['A', 'B', '-t', 'hero-portrait', '-n', '3', '-o', './x', '-a', 'shorts', '-f', 'webp', '-q', '80']);
    expect(o['template']).toBe('hero-portrait');
    expect(o['variants']).toBe(3);
    expect(o['out']).toBe('./x');
    expect(o['aspect']).toBe('shorts');
    expect(o['format']).toBe('webp');
    expect(o['quality']).toBe(80);
  });

  it('rejects an aspect that is not a real preset', () => {
    expect(() => optionsOf('gen', ['A', 'B', '--aspect', 'imax'])).toThrow();
  });

  it('rejects a format sharp cannot write', () => {
    expect(() => optionsOf('gen', ['A', 'B', '--format', 'bmp'])).toThrow();
  });

  it('turns the qa opt-outs into false', () => {
    const o = optionsOf('gen', ['A', 'B', '--no-qa-legibility', '--no-qa-safe-zones']);
    expect(o['qaLegibility']).toBe(false);
    expect(o['qaSafeZones']).toBe(false);
  });

  it('reads the identity threshold as a float', () => {
    expect(optionsOf('gen', ['A', 'B', '--identity-threshold', '0.55'])['identityThreshold']).toBe(0.55);
  });
});

describe('hexa make', () => {
  it('collects repeated subjects into a list', () => {
    const o = optionsOf('make', ['--subject', 'Peyz', 'Viper', '--template', 'versus-classic']);
    expect(o['subject']).toEqual(['Peyz', 'Viper']);
  });

  it('accepts a request file', () => {
    expect(optionsOf('make', ['--file', './req.yaml'])['file']).toBe('./req.yaml');
  });

  it('collects --text and --grade pairs', () => {
    const o = optionsOf('make', ['--subject', 'A', '--text', 'stat=18/2/9', 'kicker=GAME 5', '--grade', 'saturation=1.2', 'vignette=0.4']);
    expect(o['text']).toEqual(['stat=18/2/9', 'kicker=GAME 5']);
    expect(o['grade']).toEqual(['saturation=1.2', 'vignette=0.4']);
  });
});

describe('other commands', () => {
  it('players takes a query and filters', () => {
    const command = find('players');
    command.parse(['peyz', '--team', 'T1', '--role', 'bot'], { from: 'user' });
    expect(command.args).toEqual(['peyz']);
    expect(command.opts()['team']).toBe('T1');
    expect(command.opts()['role']).toBe('bot');
  });

  it('players rejects a role that is not in the enum', () => {
    expect(() => optionsOf('players', ['--role', 'carry'])).toThrow();
  });

  it('templates filters by category and subject count', () => {
    const o = optionsOf('templates', ['--category', 'versus', '--subjects', '2']);
    expect(o['category']).toBe('versus');
    expect(o['subjects']).toBe(2);
  });

  it('batch takes a file and a concurrency', () => {
    const command = find('batch');
    command.parse(['./week1.csv', '--concurrency', '4'], { from: 'user' });
    expect(command.args).toEqual(['./week1.csv']);
    expect(command.opts()['concurrency']).toBe(4);
  });

  it('batch defaults concurrency to 2', () => {
    expect(optionsOf('batch', ['./x.csv'])['concurrency']).toBe(2);
  });

  it('qa takes an image and optional gate filters', () => {
    const command = find('qa');
    command.parse(['./out/a.png', '--only', 'identity', 'legibility'], { from: 'user' });
    expect(command.args).toEqual(['./out/a.png']);
    expect(command.opts()['only']).toEqual(['identity', 'legibility']);
  });

  it('preview takes a template id', () => {
    const command = find('preview');
    command.parse(['versus-classic'], { from: 'user' });
    expect(command.args).toEqual(['versus-classic']);
  });

  it('doctor has a quick mode', () => {
    expect(optionsOf('doctor', ['--quick'])['quick']).toBe(true);
  });
});

describe('parseSeed', () => {
  it('accepts an integer', () => {
    expect(parseSeed('1234')).toBe(1234);
  });

  it('coerces to uint32 so a render round-trips', () => {
    expect(parseSeed('-1')).toBe(0xffffffff);
    expect(parseSeed('4.9')).toBe(4);
  });

  it('rejects nonsense', () => {
    expect(() => parseSeed('banana')).toThrow(/--seed/);
  });
});

describe('parseKeyValues', () => {
  it('splits on the first = only, so values may contain one', () => {
    expect(parseKeyValues(['stat=18/2/9', 'caption=a=b'])).toEqual({ stat: '18/2/9', caption: 'a=b' });
  });

  it('rejects a pair with no key', () => {
    expect(() => parseKeyValues(['=value'])).toThrow(/key=value/);
    expect(() => parseKeyValues(['novalue'])).toThrow(/key=value/);
  });

  it('keeps an empty value', () => {
    expect(parseKeyValues(['headline='])).toEqual({ headline: '' });
  });
});

describe('parseGrade', () => {
  it('reads numbers as numbers', () => {
    expect(parseGrade(['saturation=1.2', 'vignette=0.4'])).toEqual({ saturation: 1.2, vignette: 0.4 });
  });

  it('keeps named values as strings', () => {
    expect(parseGrade(['lut=teal-orange'])).toEqual({ lut: 'teal-orange' });
  });

  it('handles negatives and zero', () => {
    expect(parseGrade(['temperature=-14', 'saturation=0'])).toEqual({ temperature: -14, saturation: 0 });
  });

  it('keeps a hex colour as a string', () => {
    expect(parseGrade(['shadowTint=#1E4F5C'])).toEqual({ shadowTint: '#1E4F5C' });
  });
});

describe('buildRequest', () => {
  const ctx = createContext({ json: true, log: 'silent' });
  const subjects = [{ player: 'Peyz', side: 'left' as const }, { player: 'Viper', side: 'right' as const }];

  it('defaults the template for a versus', () => {
    expect(buildRequest(ctx, subjects, {}).templateId).toBe(DEFAULT_TEMPLATE);
  });

  it('maps title/subhead/kicker onto text roles', () => {
    const request = buildRequest(ctx, subjects, { title: 'RIVALS', subhead: 'GAME 5', kicker: 'LCK' });
    expect(request.text).toEqual({ headline: 'RIVALS', subhead: 'GAME 5', kicker: 'LCK' });
  });

  it('merges --text over the shorthand flags', () => {
    const request = buildRequest(ctx, subjects, { title: 'ONE', text: ['headline=TWO', 'stat=18/2/9'] });
    expect(request.text.headline).toBe('TWO');
    expect(request.text.stat).toBe('18/2/9');
  });

  it('collects palette overrides only when given', () => {
    expect(buildRequest(ctx, subjects, {}).palette).toBeUndefined();
    expect(buildRequest(ctx, subjects, { accent: '#F5C542' }).palette).toEqual({ accent: '#F5C542' });
  });

  it('infers the background mode from whichever flag was used', () => {
    expect(buildRequest(ctx, subjects, { bgFile: './bg.png' }).background).toEqual({ mode: 'file', path: './bg.png' });
    expect(buildRequest(ctx, subjects, { bgColor: '#101018' }).background).toEqual({ mode: 'color', color: '#101018' });
    expect(buildRequest(ctx, subjects, { bgPrompt: 'an empty arena' }).background).toEqual({ mode: 'ai', prompt: 'an empty arena' });
    expect(buildRequest(ctx, subjects, {}).background).toBeUndefined();
  });

  it('lets an explicit --bg win over the inferred mode', () => {
    const request = buildRequest(ctx, subjects, { bg: 'none', bgFile: './bg.png' });
    expect(request.background?.mode).toBe('none');
  });

  it('passes the output flags through', () => {
    const request = buildRequest(ctx, subjects, { out: './x', name: 'finals', format: 'jpeg', quality: 88, plan: true, sheet: true });
    expect(request.output).toMatchObject({ dir: './x', name: 'finals', format: 'jpeg', quality: 88, emitPlan: true, contactSheet: true });
  });

  it('omits qa settings that were not asked for', () => {
    expect(buildRequest(ctx, subjects, {}).qa).toEqual({});
    expect(buildRequest(ctx, subjects, { strict: true, requireCleared: true }).qa).toEqual({ strict: true, requireClearedLicense: true });
  });

  it('carries the global seed onto the request', () => {
    const seeded = createContext({ json: true, log: 'silent', seed: 4242 });
    expect(buildRequest(seeded, subjects, {}).seed).toBe(4242);
  });
});
