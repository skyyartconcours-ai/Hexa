import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `npm run doctor` — le controle de pre-vol, a lancer avec les vraies cles,
 * sur la vraie machine, avant le premier live.
 *
 * Chaque verification vise une panne qui, en live, est SILENCIEUSE : l'outil
 * tourne, affiche "en ecoute", et il ne se passe rien. Un token qui appartient
 * au compte modo plutot qu'au broadcaster ne produit aucune erreur — il ne
 * recoit simplement jamais de sub. C'est ce genre de chose qu'on attrape ici.
 *
 * Aucun appel payant : la validation Twitch et le comptage de tokens Anthropic
 * sont gratuits, le TTS n'est pas appele.
 */
interface Check {
  ok: boolean;
  /** Avertissement : ca marchera, mais degrade. */
  warn?: boolean;
  label: string;
  detail: string;
  fix?: string;
}

const results: Check[] = [];
const pass = (label: string, detail: string): void => void results.push({ ok: true, label, detail });
const warn = (label: string, detail: string, fix?: string): void =>
  void results.push({ ok: true, warn: true, label, detail, fix });
const fail = (label: string, detail: string, fix?: string): void =>
  void results.push({ ok: false, label, detail, fix });

async function main(): Promise<void> {
  // La config leve des qu'une variable obligatoire manque : c'est la premiere
  // verification, et elle doit s'afficher comme les autres au lieu de planter.
  let config: typeof import('./config.js').config;
  let dataDir: string;
  try {
    const mod = await import('./config.js');
    config = mod.config;
    dataDir = mod.DATA_DIR;
    pass('.env', `chaine ${config.twitch.channel}, client ${config.twitch.clientId.slice(0, 6)}…`);
  } catch (error) {
    fail('.env', error instanceof Error ? error.message : String(error), 'cp .env.example .env puis remplis-le');
    return report();
  }

  // ── Twitch ──────────────────────────────────────────────────────────────
  const auth = await import('./twitch/auth.js');
  if (!auth.hasStoredToken()) {
    fail('Token Twitch', 'aucun token enregistre', 'npm run login');
  } else {
    try {
      const token = await auth.getAccessToken();
      const response = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { authorization: `OAuth ${token}` },
      });
      if (!response.ok) {
        fail('Token Twitch', `Twitch repond ${response.status} a la validation`, 'npm run login');
      } else {
        const info = (await response.json()) as {
          client_id: string;
          login: string;
          user_id: string;
          scopes: string[];
          expires_in: number;
        };
        pass('Token Twitch', `valide, compte ${info.login}, expire dans ${Math.round(info.expires_in / 3600)} h`);

        if (info.login.toLowerCase() !== config.twitch.channel) {
          fail(
            'Compte du token',
            `le token appartient a ${info.login}, pas a ${config.twitch.channel}`,
            "Les evenements de sub et de bits n'arrivent qu'avec le token du BROADCASTER. " +
              'Deconnecte-toi de Twitch dans le navigateur, puis npm run login avec le compte de la chaine.',
          );
        } else {
          pass('Compte du token', 'c\'est bien celui de la chaine');
        }

        if (info.client_id !== config.twitch.clientId) {
          fail('Client-Id', 'le token a ete emis pour une autre app que TWITCH_CLIENT_ID', 'npm run login');
        }

        const missing = config.twitch.scopes.filter((scope) => !info.scopes.includes(scope));
        if (missing.length) {
          fail(
            'Scopes',
            `manquants : ${missing.join(', ')}`,
            'npm run login — le token existant a ete emis avant l\'ajout de ces scopes.',
          );
        } else {
          pass('Scopes', config.twitch.scopes.join(', '));
        }
      }
    } catch (error) {
      fail('Token Twitch', error instanceof Error ? error.message : String(error), 'npm run login');
    }
  }

  // ── Anthropic ───────────────────────────────────────────────────────────
  const anthropicKey = config.anthropic.apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!anthropicKey) {
    fail('Anthropic', 'ANTHROPIC_API_KEY absent', 'https://console.anthropic.com');
  } else {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: anthropicKey });
    // count_tokens est gratuit et valide a la fois la cle et l'identifiant du
    // modele, sans generer une seule vanne.
    const models = [config.anthropic.model, ...(config.judge.enabled ? [config.judge.model] : [])];
    for (const model of models) {
      try {
        await client.messages.countTokens({ model, messages: [{ role: 'user', content: 'ping' }] });
        pass(`Anthropic · ${model}`, 'cle acceptee, modele reconnu');
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          fail('Anthropic', 'cle refusee', 'Verifie ANTHROPIC_API_KEY');
          break;
        }
        if (error instanceof Anthropic.NotFoundError) {
          fail(`Anthropic · ${model}`, 'modele inconnu', 'Verifie ROAST_MODEL / JUDGE_MODEL');
        } else {
          fail(`Anthropic · ${model}`, error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  // ── TTS ─────────────────────────────────────────────────────────────────
  const tts = config.tts;
  if (tts.provider === 'none') {
    warn('TTS', 'TTS_PROVIDER=none : mode texte seul, aucune voix a l\'antenne', 'TTS_PROVIDER=fishaudio + cle + voix');
  } else {
    const settings: Record<string, { apiKey: string; voiceId: string }> = {
      fishaudio: tts.fishaudio,
      elevenlabs: tts.elevenlabs,
      cartesia: tts.cartesia,
    };
    const chosen = settings[tts.provider];
    if (!chosen) {
      fail('TTS', `TTS_PROVIDER inconnu : ${tts.provider}`, 'fishaudio | elevenlabs | cartesia | none');
    } else if (!chosen.apiKey) {
      fail('TTS', `${tts.provider} : cle API absente`);
    } else if (!chosen.voiceId) {
      fail('TTS', `${tts.provider} : identifiant de voix absent`, 'Choisis une voix dans ton compte et colle son id');
    } else {
      pass('TTS', `${tts.provider}, cle et voix renseignees (l\'appel reel n\'est pas teste ici)`);
    }
  }

  // ── Contexte de chaine ──────────────────────────────────────────────────
  const channelFile = path.join(dataDir, 'channel.md');
  if (fs.existsSync(channelFile) && fs.statSync(channelFile).size > 200) {
    pass('channel.md', `${fs.statSync(channelFile).size} caracteres`);
  } else {
    warn(
      'channel.md',
      'absent ou presque vide : les vannes seront generiques',
      'cp channel.example.md data/channel.md puis remplis-le — c\'est le plus gros levier de qualite',
    );
  }

  // ── Port ────────────────────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        warn('Port', `${config.server.port} deja occupe — Hexa tourne peut-etre deja`, 'Ferme l\'autre instance, ou change PORT');
      } else {
        fail('Port', error.message);
      }
      resolve();
    });
    probe.listen(config.server.port, '127.0.0.1', () => {
      pass('Port', `${config.server.port} libre`);
      probe.close(() => resolve());
    });
  });

  // ── Reglages qui meritent un regard ─────────────────────────────────────
  if (config.gifts.recipients !== 'none') {
    warn(
      'Receveurs de gifts',
      `GIFT_RECIPIENTS=${config.gifts.recipients} : les receveurs de subs offerts seront chambres`,
      'Ils n\'ont rien demande. Voir README, section "Le gift bomb".',
    );
  }
  if (config.session.autoPlay) {
    warn('Lecture automatique', 'AUTO_PLAY=true : les vannes partent sans validation', 'Garde false pour la premiere session');
  }

  report();
}

function report(): void {
  const width = Math.max(...results.map((r) => r.label.length));
  let failures = 0;
  console.log('');
  for (const r of results) {
    const mark = !r.ok ? '\x1b[31m✗\x1b[0m' : r.warn ? '\x1b[33m!\x1b[0m' : '\x1b[32m✓\x1b[0m';
    console.log(`${mark} ${r.label.padEnd(width)}  ${r.detail}`);
    if (r.fix) console.log(`  ${' '.repeat(width)}  → ${r.fix}`);
    if (!r.ok) failures += 1;
  }
  console.log('');
  if (failures) {
    console.log(`\x1b[31m${failures} probleme(s) bloquant(s).\x1b[0m Corrige-les avant de lancer une session.`);
    process.exitCode = 1;
  } else {
    console.log('\x1b[32mPret.\x1b[0m Lance npm start, ouvre la regie, demarre une session de test et genere une vanne de chaque type.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
