#!/usr/bin/env node
/**
 * Hexa — §S27 : LA FENÊTRE CLAVIER.
 *
 * Retour utilisateur (build 39) : « quand j'ai voulu écrire, ça cache YouTube »
 * — l'écran entier devenait un aplat gris opaque. Cause : activer une fenêtre
 * transparente (focus pour le clavier) fait repeindre son cadre DWM, étendu à
 * toute la fenêtre, sur certains matériels (voir electron/clavier.ts).
 *
 * Depuis, aucune fenêtre transparente n'est focusable : une fenêtre OPAQUE de
 * 2 pixels tient le clavier et rejoue les touches dans la page qui les attend.
 * Ici on tape DANS CETTE FENÊTRE-LÀ, jamais dans la page d'encre, et on
 * vérifie que tout arrive : choix d'outil, texte complet avec accent, et
 * relâchement des touches maintenues quand le clavier est perdu.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's27' })

const etatStore = () => win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state)
const traits = () =>
  win.evaluate(() => (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({ tool: s.tool, text: s.text ?? '' })))

/** la page de la fenêtre clavier : la seule servie par une adresse `data:` */
async function pageClavier() {
  for (let i = 0; i < 50; i++) {
    const p = app.windows().find((w) => w.url().startsWith('data:'))
    if (p) return p
    await win.waitForTimeout(100)
  }
  return null
}
const clavier = await pageClavier()

await etatDeDepart(win)

await rapport.test(win, 's27-1-fenetres', 'Les fenêtres transparentes ne sont pas focusables ; la fenêtre clavier existe et l’est', async () => {
  const f = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      titre: w.getTitle(),
      focusable: w.isFocusable(),
      taille: `${w.getBounds().width}×${w.getBounds().height}`,
    })),
  )
  const clav = f.find((w) => w.titre === 'Hexa Clavier')
  const transparentes = f.filter((w) => w.titre !== 'Hexa Clavier')
  const focusEmule = await win.evaluate(() => document.hasFocus())
  const ok = !!clav && clav.focusable && clav.taille === '2×2' && transparentes.length >= 1 && transparentes.every((w) => !w.focusable) && focusEmule
  return {
    statut: ok ? OK : KO,
    detail: `clavier : ${clav ? `${clav.taille}, focusable ${clav.focusable}` : 'ABSENTE'} · ${transparentes.map((w) => `« ${w.titre} » focusable ${w.focusable}`).join(', ')} · focus émulé dans la page d’encre : ${focusEmule}`,
  }
})

/**
 * Les touches injectées par le protocole DevTools (Playwright) portent
 * `skip_in_browser` : elles ne passent jamais par `before-input-event`, là où
 * la fenêtre clavier écoute — c'est d'ailleurs pourquoi Ctrl+T sous Playwright
 * n'ouvre jamais d'onglet. Les vraies touches, elles, y passent. On frappe donc
 * la fenêtre clavier par `webContents.sendInputEvent`, qui suit le chemin d'une
 * touche système, et pour le texte accentué on livre l'événement lui-même, tel
 * que Windows le décrit (key = « é »).
 */
const frapper = (keyCode, type = 'keyDown') =>
  app.evaluate(
    ({ BrowserWindow }, { keyCode, type }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Hexa Clavier')
      if (!w) throw new Error('fenêtre clavier introuvable')
      w.webContents.sendInputEvent({ type, keyCode })
    },
    { keyCode, type },
  )
const appuyer = async (keyCode) => {
  await frapper(keyCode, 'keyDown')
  await frapper(keyCode, 'keyUp')
}
const livrer = (input) =>
  app.evaluate(
    ({ BrowserWindow }, input) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Hexa Clavier')
      if (!w) throw new Error('fenêtre clavier introuvable')
      const base = { isAutoRepeat: false, shift: false, control: false, alt: false, meta: false, location: 0, modifiers: [] }
      w.webContents.emit('before-input-event', { preventDefault() {} }, { ...base, ...input, type: 'keyDown' })
      w.webContents.emit('before-input-event', { preventDefault() {} }, { ...base, ...input, type: 'keyUp' })
    },
    input,
  )
const taper = async (texte) => {
  for (const ch of texte) {
    const code = /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : ch === ' ' ? 'Space' : 'Unidentified'
    await livrer({ key: ch, code, shift: ch !== ch.toLowerCase() })
    await win.waitForTimeout(15)
  }
}

await rapport.test(win, 's27-2-relais-outil', 'Une touche reçue par la fenêtre clavier choisit l’outil dans la page d’encre', async () => {
  await win.keyboard.press('e') // gomme, directement dans la page : point de départ connu
  await win.waitForTimeout(150)
  const avant = (await etatStore()).tool
  await appuyer('P') // pinceau, frappé dans la FENÊTRE CLAVIER
  await win.waitForTimeout(250)
  const apres = (await etatStore()).tool
  await appuyer('R')
  await win.waitForTimeout(250)
  const encore = (await etatStore()).tool
  return {
    statut: avant === 'eraser' && apres === 'pen' && encore === 'rect' ? OK : KO,
    detail: `gomme (page) → « P » (clavier) → ${apres} → « R » (clavier) → ${encore}`,
  }
})

await rapport.test(win, 's27-3-relais-texte', 'Un texte frappé sur la fenêtre clavier, accent compris, se pose dans la page d’encre', async (capturer) => {
  await toutEffacer(win)
  await appuyer('T') // outil texte, via le relais
  await win.waitForTimeout(200)
  await win.mouse.click(600, 420)
  await win.waitForTimeout(250)
  await taper('Déjà vu')
  await win.waitForTimeout(200)
  const saisie = await win.evaluate(() => document.querySelector('.hexa-text-field')?.value ?? null)
  await livrer({ key: 'Enter', code: 'Enter' })
  await win.waitForTimeout(400)
  await capturer('texte')
  const t = await traits()
  const pose = t.find((s) => s.tool === 'text')
  return {
    statut: saisie === 'Déjà vu' && pose?.text === 'Déjà vu' ? OK : KO,
    detail: `champ pendant la frappe : « ${saisie} » · texte posé : « ${pose?.text ?? '—'} » (Déjà vu attendu)`,
  }
})

await rapport.test(win, 's27-4-perte-du-clavier', 'Le clavier perdu relâche les touches maintenues', async () => {
  await appuyer('P')
  await win.waitForTimeout(150)
  await frapper('Z', 'keyDown') // laser, maintenu
  await win.waitForTimeout(250)
  const pendant = (await etatStore()).tool
  // la fenêtre clavier perd le focus (Alt+Tab, clic dans le jeu) : sans keyup
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Hexa Clavier')
    w?.emit('blur')
  })
  await win.waitForTimeout(300)
  const apres = (await etatStore()).tool
  await frapper('Z', 'keyUp')
  return {
    statut: pendant === 'laser' && apres === 'pen' ? OK : KO,
    detail: `« Z » maintenu : ${pendant} (laser attendu) · après perte du clavier : ${apres} (pen attendu)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
