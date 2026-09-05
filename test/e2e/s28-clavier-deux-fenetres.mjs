#!/usr/bin/env node
/**
 * Hexa — §S28 : LE CLAVIER DANS LE VRAI MODE À DEUX FENÊTRES.
 *
 * §S27 éprouve le relais en mode fusionné (une seule fenêtre). Or c'est le
 * mode à DEUX fenêtres que l'utilisateur fait tourner — encre capturée par
 * OBS, interface privée — et c'est là que les raccourcis LOCAUX se sont
 * révélés fragiles : « en appuyant sur Tab ça devait être la couleur opposée,
 * ça marche plus ».
 *
 * Deux chemins cohabitent, et on les distingue ici :
 *  · GLOBAL — réservé auprès de Windows (Ctrl+Maj+…), il répond même pendant
 *    une partie, sans que Hexa ait le clavier ;
 *  · LOCAL — Tab, les lettres nues : il passe par la fenêtre clavier, qui doit
 *    donc tenir le focus et relayer chaque touche à la page d'encre.
 *
 * On frappe la fenêtre clavier elle-même (sendInputEvent suit le chemin d'une
 * vraie touche, jusqu'à `before-input-event`), et on vérifie l'effet dans
 * l'état persisté — celui que la barre d'outils lit.
 */
import { KO, OK, Rapport, chargerPilote, preparerCaptures } from './harness.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync, mkdirSync } from 'node:fs'

const RACINE = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
preparerCaptures()
const rapport = new Rapport()
const _electron = await chargerPilote()
const userData = join(RACINE, 'test/e2e/captures/.user-data-s28')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

// PAS de HEXA_FUSION : deux fenêtres par écran, exactement comme chez l'utilisateur.
const app = await _electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
await app.firstWindow({ timeout: 30000 })
await new Promise((r) => setTimeout(r, 9000)) // séquence d'accueil

const pageEncre = () => app.windows().find((w) => w.url().includes('index.html'))
const pageUi = () => app.windows().find((w) => w.url().includes('ui.html'))
const win = pageEncre()

/** l'état que la barre d'outils lit : c'est lui qui prouve qu'une touche a agi */
const etat = () =>
  pageEncre().evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}').state ?? {}
    return { tool: s.tool ?? null, color: s.color ?? null, prev: s.prevColor ?? null }
  })
/**
 * Frappe DANS la fenêtre clavier. `sendInputEvent` emprunte le chemin d'une
 * touche réelle (jusqu'à `before-input-event`), là où le protocole DevTools de
 * Playwright le contourne — c'est pourquoi on ne tape pas ici avec Playwright.
 * ⚠️ On la retrouve par son TITRE : la bulle d'accueil est elle aussi servie
 * par une adresse `data:`, et une recherche par adresse tombait sur elle.
 */
const frapper = (input) =>
  app.evaluate(({ BrowserWindow }, input) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Hexa Clavier')
    if (!w) return 'AUCUNE FENÊTRE CLAVIER'
    w.webContents.sendInputEvent({ type: 'keyDown', ...input })
    w.webContents.sendInputEvent({ type: 'keyUp', ...input })
    return 'ok'
  }, input)
const attendre = (ms = 500) => new Promise((r) => setTimeout(r, ms))

await rapport.test(win, 's28-1-fenetres', 'Deux fenêtres transparentes non focusables, une fenêtre clavier opaque de 2 px', async () => {
  const f = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => {
        const u = w.webContents.getURL()
        return u.includes('index.html') || u.includes('ui.html') || w.getTitle() === 'Hexa Clavier'
      })
      .map((w) => ({ titre: w.getTitle(), focusable: w.isFocusable(), t: `${w.getBounds().width}×${w.getBounds().height}` })),
  )
  const clavier = f.find((w) => w.titre === 'Hexa Clavier')
  const transparentes = f.filter((w) => w.titre !== 'Hexa Clavier')
  const ok = !!clavier && clavier.focusable && clavier.t === '2×2' && transparentes.length === 2 && transparentes.every((w) => !w.focusable)
  return {
    statut: ok ? OK : KO,
    detail: `${transparentes.map((w) => `« ${w.titre} » focusable ${w.focusable}`).join(' · ')} · clavier ${clavier ? `${clavier.t} focusable ${clavier.focusable}` : 'ABSENT'}`,
  }
})

await rapport.test(win, 's28-2-lettre-locale', 'Une lettre nue (« o ») relayée jusqu’à la page d’encre', async () => {
  const envoi = await frapper({ keyCode: 'O' })
  await attendre()
  const a = await etat()
  return {
    statut: envoi === 'ok' && a.tool === 'ellipse' ? OK : KO,
    detail: `envoi : ${envoi} · outil après « o » : ${a.tool} (ellipse attendu)`,
  }
})

await rapport.test(win, 's28-3-tab-couleur-opposee', 'Tab échange la couleur courante et la précédente', async () => {
  const avant = await etat()
  await frapper({ keyCode: 'Tab' })
  await attendre()
  const apres = await etat()
  await frapper({ keyCode: 'Tab' })
  await attendre()
  const retour = await etat()
  const ok =
    avant.color && avant.prev && avant.color !== avant.prev &&
    apres.color === avant.prev && apres.prev === avant.color &&
    retour.color === avant.color
  return {
    statut: ok ? OK : KO,
    detail: `${avant.color}/${avant.prev} → Tab → ${apres.color}/${apres.prev} → Tab → ${retour.color}/${retour.prev}`,
  }
})

await rapport.test(win, 's28-4-ctrl-maj-1-numeroteur', 'Ctrl+Maj+1 sort le numéroteur (réservé auprès du système)', async () => {
  await frapper({ keyCode: 'P' })
  await attendre(400)
  const avant = await etat()
  await frapper({ keyCode: '1', modifiers: ['control', 'shift'] })
  await attendre(600)
  const apres = await etat()
  return {
    statut: avant.tool === 'pen' && apres.tool === 'badge' ? OK : KO,
    detail: `pinceau → Ctrl+Maj+1 → ${apres.tool} (badge attendu)`,
  }
})

await rapport.test(win, 's28-5-apres-rechargement', 'Les touches passent encore après un rechargement de la page d’encre', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.webContents.reload()
  })
  await attendre(5000)
  await frapper({ keyCode: 'R' })
  await attendre(700)
  const apres = await etat()
  return {
    statut: apres.tool === 'rect' ? OK : KO,
    detail: `après rechargement, « r » → ${apres.tool} (rect attendu) — le focus émulé doit être réarmé à chaque chargement`,
  }
})

await rapport.test(win, 's28-6-interface-inerte', 'La page d’interface ne joue pas les mêmes touches (aucune action en double)', async () => {
  const recues = await pageUi().evaluate(() => {
    window.__k = []
    window.addEventListener('keydown', (e) => window.__k.push(e.key), true)
    return true
  })
  await frapper({ keyCode: 'O' })
  await attendre(600)
  const k = await pageUi().evaluate(() => window.__k ?? [])
  const a = await etat()
  return {
    statut: recues && k.length === 0 && a.tool === 'ellipse' ? OK : KO,
    detail: `touches reçues par l’interface : ${k.length} (0 attendu) · outil : ${a.tool}`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
