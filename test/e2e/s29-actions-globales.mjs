#!/usr/bin/env node
/**
 * Hexa — §S29 : LES RACCOURCIS GLOBAUX FONT VRAIMENT QUELQUE CHOSE.
 *
 * Retour utilisateur : « Ctrl+Maj+1 est affiché comme numéroteur, mais quand
 * je tape ça, ça n'affiche pas le numéroteur ». Le raccourci était pourtant
 * réservé auprès de Windows, et le processus principal routait bien l'action
 * vers la page — qui n'en faisait RIEN : la table des actions exécutables
 * hors focus était tenue à la main, et 'tool.badge' n'y avait jamais été
 * ajouté. C'est le pire des cas : la touche est affichée, elle est CONFISQUÉE
 * à tous les autres logiciels, et elle est morte. 'ui.hideInk' souffrait
 * exactement du même trou.
 *
 * Ce test ferme la classe entière du défaut, en deux temps :
 *   1. il relit `global: true` dans src/keymap.ts — la seule source de
 *      vérité — et exige que CHAQUE action globale soit couverte ici. Une
 *      nouvelle action globale ajoutée sans effet fera échouer ce test.
 *   2. il livre chaque action par le VRAI canal du processus principal
 *      (celui qu'emprunte un raccourci système) et mesure l'effet.
 */
import { readFileSync } from 'node:fs'
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's29' })

const etat = () => win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state)
const nbTraits = () => win.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
/** Pixels réellement peints sur les calques de la scène (le voile du spotlight est à 0×0 au repos). */
const pixelsPeints = () =>
  win.evaluate(() => {
    let n = 0
    for (const cv of document.querySelectorAll('.stage canvas')) {
      if (!cv.width || !cv.height) continue
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++
    }
    return n
  })
/** Un trait franc, pour avoir quelque chose à masquer. */
const unTrait = async () => {
  await toutEffacer(win)
  await win.mouse.move(300, 300)
  await win.mouse.down()
  await win.mouse.move(700, 340, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(450)
}

/** Livre l'action comme le fait un raccourci système : canal 'action' vers la couche encre. */
const livrer = (action) =>
  app.evaluate(({ BrowserWindow }, action) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))
    if (!w) throw new Error('couche encre introuvable')
    w.webContents.send('hexa:action', action)
  }, action)

/** Trois traits, pour que « annuler » et « tout effacer » aient de quoi mordre. */
const troisTraits = async () => {
  await toutEffacer(win)
  for (const y of [300, 380, 460]) {
    await win.mouse.move(300, y)
    await win.mouse.down()
    await win.mouse.move(600, y, { steps: 6 })
    await win.mouse.up()
    await win.waitForTimeout(120)
  }
}

/**
 * Ce que chaque action globale doit PROVOQUER. `main` = l'effet appartient au
 * processus principal (la fenêtre, pas la page) et a sa propre campagne.
 */
const ATTENDUS = {
  'tool.pen': { avant: () => livrer('tool.eraser'), effet: async () => (await etat()).tool === 'pen' },
  'tool.highlight': { effet: async () => (await etat()).tool === 'highlight' },
  'tool.badge': { effet: async () => (await etat()).tool === 'badge' },
  'tool.marker': { effet: async () => (await etat()).tool === 'marker' },
  'tool.eraser': { avant: () => livrer('tool.pen'), effet: async () => (await etat()).tool === 'eraser' },
  'edit.undo': {
    avant: troisTraits,
    effet: async () => (await nbTraits()) === 2,
  },
  'edit.clear': { avant: troisTraits, effet: async () => (await nbTraits()) === 0 },
  // L'épaisseur de départ vient de l'état semé : 10 px, pour mesurer les deux sens.
  'size.dec': { depart: { size: 10 }, effet: async () => (await etat()).size === 8 },
  'size.inc': { depart: { size: 10 }, effet: async () => (await etat()).size === 12 },
  /*
   * « Masquer les annotations » ne s'ENREGISTRE pas (on ne veut pas relancer
   * Hexa avec un écran muet sans savoir pourquoi) : l'état du disque ne dit
   * donc rien. On mesure l'effet VISIBLE — le trait disparaît de l'écran alors
   * qu'il est toujours dans la session, ce qui est exactement la promesse.
   */
  'ui.hideInk': {
    avant: unTrait,
    effet: async () => (await pixelsPeints()) === 0 && (await nbTraits()) === 1,
  },
  'ui.toolbar': { effet: async () => (await etat()).toolbarVisible === false },
  'mode.draw': { main: 'bascule du mode dessin — campagne s17' },
  'mode.cursor': { main: 'sortie du mode dessin — campagne s17' },
  'app.panic': { main: 'touche panique — campagne hexa-e2e' },
}

/** Les actions marquées `global: true` dans la table des raccourcis. */
function actionsGlobales() {
  const src = readFileSync(new URL('../../src/keymap.ts', import.meta.url), 'utf8')
  const debut = src.indexOf('KEYMAP_ENTRIES')
  const bloc = src.slice(debut, src.indexOf('/* ---', debut))
  const out = []
  for (const m of bloc.matchAll(/\{[^{}]*action:\s*'([\w.]+)'[^{}]*\}/gs)) {
    if (m[0].includes('global: true')) out.push(m[1])
  }
  return out
}

const globales = actionsGlobales()
await etatDeDepart(win)

await rapport.test(win, 's29-1-couverture', 'Chaque action globale est couverte par ce test', async () => {
  const nues = globales.filter((a) => !ATTENDUS[a])
  return {
    statut: globales.length > 0 && nues.length === 0 ? OK : KO,
    detail:
      `${globales.length} actions globales lues dans keymap.ts · ` +
      (nues.length === 0
        ? 'toutes couvertes'
        : `NON COUVERTES : ${nues.join(', ')} — ajoute-les à ATTENDUS, avec leur effet`),
  }
})

for (const action of globales) {
  const attendu = ATTENDUS[action]
  if (!attendu) continue
  if (attendu.main) {
    await rapport.test(win, `s29-${action}`, `« ${action} » appartient au processus principal`, async () => ({
      statut: OK,
      detail: attendu.main,
    }))
    continue
  }
  await rapport.test(win, `s29-${action}`, `« ${action} » reçue du système : la page agit`, async () => {
    await etatDeDepart(win, attendu.depart ?? {})
    if (attendu.avant) await attendu.avant()
    await win.waitForTimeout(220)
    await livrer(action)
    await win.waitForTimeout(420)
    const ok = await attendu.effet()
    const s = await etat()
    return {
      statut: ok ? OK : KO,
      detail: ok
        ? 'effet mesuré dans la page'
        : `AUCUN EFFET — outil ${s.tool}, taille ${s.size}, barre ${s.toolbarVisible}, ` +
          `${await pixelsPeints()} px peints pour ${await nbTraits()} trait(s)`,
    }
  })
}

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
