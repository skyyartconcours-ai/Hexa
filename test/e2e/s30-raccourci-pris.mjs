#!/usr/bin/env node
/**
 * Hexa — §S30 : UNE COMBINAISON TENUE PAR UN AUTRE LOGICIEL.
 *
 * Retour utilisateur : « Ctrl+Maj+3 sort le pinceau, Ctrl+Maj+1 ne sort jamais
 * le numéroteur » — même touche physique, même Maj, même Ctrl. Une réservation
 * Windows (RegisterHotKey) est exclusive : un autre logiciel tenait Ctrl+Maj+1
 * avant Hexa et avalait la touche, même Hexa au premier plan. Hexa notait le
 * refus dans son journal… et c'est tout : rien à l'écran, aucun plan B.
 *
 * Ici, on SIMULE ce logiciel (HEXA_E2E_REFUSER) et on exige quatre choses :
 * le repli (Ctrl+Alt+1) est pris et l'état le dit ; la fenêtre d'interface —
 * où vit l'éditeur — le sait aussi ; l'éditeur l'écrit en clair ; et quand
 * l'autre logiciel lâche la combinaison, Hexa la reprend tout seul.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KO, OK, Rapport, chargerPilote, preparerCaptures } from './harness.mjs'

const RACINE = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
preparerCaptures()
const rapport = new Rapport()
const _electron = await chargerPilote()
const userData = join(RACINE, 'test/e2e/captures/.user-data-s30')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

// Deux fenêtres, comme chez l'utilisateur. « Un autre logiciel » tient
// Ctrl+Maj+1 ; les nouvelles tentatives sont rapprochées pour le test.
const app = await _electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
  env: { ...process.env, HEXA_E2E_REFUSER: 'Control+Shift+1', HEXA_E2E_REPRISE_MS: '1500' },
})
await app.firstWindow({ timeout: 30000 })
const attendre = (ms = 500) => new Promise((r) => setTimeout(r, ms))
await attendre(9000) // séquence d'accueil

const pageEncre = () => app.windows().find((w) => w.url().includes('index.html'))
const pageUi = () => app.windows().find((w) => w.url().includes('ui.html'))
const win = pageEncre()
const statut = (p) => p.evaluate(() => window.__hexaRaccourcis ?? null)
const journal = () => readFileSync(join(userData, 'hexa.log'), 'utf8')

await rapport.test(win, 's30-1-repli-pris', 'Ctrl+Maj+1 refusée : le numéroteur répond à Ctrl+Alt+1, et l’état le dit', async () => {
  const s = await statut(win)
  const j = journal()
  const ok =
    s?.registered?.['tool.badge'] === 'Control+Alt+1' &&
    s?.failed?.['tool.badge'] === 'Control+Shift+1' &&
    /tool\.badge: Control\+Shift\+1 → Control\+Alt\+1/.test(j) &&
    /tenues par un autre logiciel/.test(j)
  return {
    statut: ok ? OK : KO,
    detail: `réservé : ${s?.registered?.['tool.badge'] ?? '—'} (Control+Alt+1 attendu) · voulu et refusé : ${s?.failed?.['tool.badge'] ?? '—'} (Control+Shift+1 attendu) · journal : ${/tenues par un autre logiciel/.test(j) ? 'refus signalé' : 'RIEN'}`,
  }
})

await rapport.test(win, 's30-2-interface-sait', 'La fenêtre d’interface (où vit l’éditeur) connaît l’état réel des réservations', async () => {
  const s = await statut(pageUi())
  const ok = s?.registered?.['tool.badge'] === 'Control+Alt+1' && s?.failed?.['tool.badge'] === 'Control+Shift+1'
  return {
    statut: ok ? OK : KO,
    detail: `interface : réservé ${s?.registered?.['tool.badge'] ?? '—'} · refusé ${s?.failed?.['tool.badge'] ?? '—'} — avant, cette fenêtre n’en savait jamais rien`,
  }
})

await rapport.test(win, 's30-3-editeur-explique', 'L’éditeur de raccourcis écrit qui répond à la place, en clair', async () => {
  const ui = pageUi()
  const ouvert = await ui.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) => /^Réglages/.test(x.getAttribute('title') ?? ''))
    if (!b) return false
    b.click()
    return true
  })
  await attendre(900)
  const texte = await ui.evaluate(() =>
    [...document.querySelectorAll('.kme-conflict')].map((n) => n.textContent ?? '').join(' | '),
  )
  // l'éditeur écrit « Ctrl + Maj + 1 », avec des espaces
  const ok = ouvert && /Ctrl \+ Maj \+ 1/.test(texte) && /Ctrl \+ Alt \+ 1/.test(texte) && /autre logiciel/.test(texte)
  await ui.keyboard.press('Escape').catch(() => {})
  return {
    statut: ok ? OK : KO,
    detail: ouvert ? `note de l’éditeur : « ${texte.slice(0, 160)} »` : 'bouton Réglages introuvable dans la barre',
  }
})

await rapport.test(win, 's30-4-reprise', 'L’autre logiciel lâche Ctrl+Maj+1 : Hexa la reprend tout seul', async () => {
  await app.evaluate(() => globalThis.__hexaRefus.clear())
  await attendre(3800) // deux tentatives possibles à 1,5 s
  const s = await statut(win)
  const j = journal()
  const ok =
    s?.registered?.['tool.badge'] === 'Control+Shift+1' &&
    !s?.failed?.['tool.badge'] &&
    /Control\+Shift\+1 est libre de nouveau/.test(j)
  return {
    statut: ok ? OK : KO,
    detail: `réservé : ${s?.registered?.['tool.badge'] ?? '—'} (Control+Shift+1 attendu) · refusé : ${s?.failed?.['tool.badge'] ?? 'aucun'} · journal : ${/libre de nouveau/.test(j) ? 'reprise notée' : 'RIEN'}`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
