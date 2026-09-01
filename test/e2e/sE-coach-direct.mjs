#!/usr/bin/env node
/**
 * Hexa — §SE : LES FINITIONS « COACH EN DIRECT », ÉPROUVÉES EN MODE DEUX FENÊTRES.
 *
 * POURQUOI CE FICHIER EXISTE. Les pages d'annotation, l'épinglage, l'export PNG
 * en un geste, la plaque du texte et la barre discrète (sB-fonctionnalites.mjs)
 * ont été vérifiés en mode FUSIONNÉ — une seule fenêtre, la barre et l'encre
 * dans la même page. L'utilisateur, lui, vit en mode DEUX FENÊTRES : la barre
 * dans la fenêtre d'interface (exclue des captures), le moteur dans la fenêtre
 * d'encre (capturée par OBS), et un store par fenêtre synchronisé par IPC.
 * Tout ce qui traverse cette frontière — le numéro de page, le message
 * « PNG exporté », le défaut de la plaque, l'estompage de la barre — n'était
 * prouvé nulle part dans ce mode. Et c'est là que vit la règle §2.5 : une
 * fenêtre d'encre VIDE doit être RETIRÉE ; une page vide doit donc la retirer,
 * une page qui revient doit la ramener.
 *
 * On enchaîne les gestes comme un coach en direct : plusieurs pages, une
 * légende épinglée, un Ctrl+Z de trop, un export au clavier, un texte sans
 * plaque, la barre qui s'efface pendant qu'on parle — et on mesure à chaque
 * étape ce que ça coûte au repos dans les DEUX fenêtres.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/sE-coach-direct.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, KO, OK, RACINE, Rapport, chargerPilote, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const electron = await chargerPilote()

const USER = join(CAPTURES, '.user-data-sE')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
const DL = join(CAPTURES, 'sE-telechargements')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// PAS de HEXA_FUSION : deux fenêtres par écran, comme chez l'utilisateur.
const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})
await app.firstWindow({ timeout: 30000 })
await pause(3200)

/* ------------------------------------------------------------------ *
 * Qui est qui
 * ------------------------------------------------------------------ */
const trouverPages = async () => {
  let encre = null
  let inter = null
  for (const w of app.windows()) {
    if (w.url().startsWith('data:')) continue
    const d = await w
      .evaluate(() => ({
        couche: [...document.body.classList].find((c) => c.startsWith('hexa-')) ?? '',
        actif: window.hexaEngine ? window.hexaEngine.actif === true : false,
        barre: !!document.querySelector('.toolbar'),
      }))
      .catch(() => null)
    if (!d) continue
    if (d.couche === 'hexa-encre' && d.actif) encre = w
    if (d.couche === 'hexa-interface' && d.barre) inter = w
  }
  return { encre, inter }
}
let { encre, inter } = await trouverPages()
if (!encre || !inter) {
  process.stdout.write('Impossible de distinguer les deux fenêtres — campagne inutilisable.\n')
  await app.close()
  process.exit(1)
}
const erreurs = { encre: [], inter: [] }
encre.on('pageerror', (e) => erreurs.encre.push(String(e.message)))
inter.on('pageerror', (e) => erreurs.inter.push(String(e.message)))

/* ------------------------------------------------------------------ *
 * Espion du processus principal : téléchargements et fenêtres
 * ------------------------------------------------------------------ */
await app.evaluate(({ session }, dossier) => {
  globalThis.__dl = []
  session.defaultSession.on('will-download', (_e, item) => {
    const entree = { nom: item.getFilename(), mime: item.getMimeType(), etat: 'en cours', octets: 0 }
    globalThis.__dl.push(entree)
    // On fixe le chemin nous-mêmes : sans ça, Electron ouvrirait la boîte
    // « Enregistrer sous » du système — c'est justement ce qu'on veut savoir.
    item.setSavePath(`${dossier}/${item.getFilename()}`)
    item.once('done', (_ev, etat) => {
      entree.etat = etat
      entree.octets = item.getReceivedBytes()
    })
  })
}, DL)
const telechargements = () => app.evaluate(() => globalThis.__dl)

const fenetres = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const ecran = screen.getPrimaryDisplay().bounds
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith('data:'))
      .map((w) => {
        const b = w.getBounds()
        return {
          url: w.webContents.getURL().split('/').pop(),
          visible: w.isVisible(),
          bounds: `${b.width}×${b.height}`,
          part: w.isVisible() ? (b.width * b.height) / (ecran.width * ecran.height) : 0,
        }
      })
  })
const encreVisible = async () => (await fenetres()).find((f) => /index\.html/.test(f.url ?? ''))
const interFenetre = async () => (await fenetres()).find((f) => /ui\.html/.test(f.url ?? ''))

/* ------------------------------------------------------------------ *
 * Mesures : images demandées, minuteries armées, encre peinte
 * ------------------------------------------------------------------ */
/** rAF ET minuteries réellement demandés pendant `ms`, dans une page. */
const activite = (page, ms) =>
  page.evaluate((duree) => {
    const vraiRaf = window.requestAnimationFrame
    const vraiTo = window.setTimeout
    const vraiIv = window.setInterval
    let raf = 0
    let to = 0
    let iv = 0
    window.requestAnimationFrame = function (cb) {
      raf++
      return vraiRaf.call(window, cb)
    }
    window.setTimeout = function (...a) {
      to++
      return vraiTo.apply(window, a)
    }
    window.setInterval = function (...a) {
      iv++
      return vraiIv.apply(window, a)
    }
    return new Promise((res) => {
      vraiTo.call(
        window,
        () => {
          window.requestAnimationFrame = vraiRaf
          window.setTimeout = vraiTo
          window.setInterval = vraiIv
          res({ raf, to, iv })
        },
        duree,
      )
    })
  }, ms)
const activiteDesDeux = async (ms) => {
  const [e, i] = await Promise.all([activite(encre, ms), activite(inter, ms)])
  return { encre: e, inter: i, txt: `encre rAF ${e.raf}/to ${e.to}/iv ${e.iv} · interface rAF ${i.raf}/to ${i.to}/iv ${i.iv}` }
}
const peints = () =>
  encre.evaluate(() => {
    let n = 0
    const cv = document.querySelectorAll('.stage canvas')[1]
    if (!cv || !cv.width) return 0
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    return n
  })
const traits = () =>
  encre.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({
      id: s.id,
      tool: s.tool,
      pinned: s.pinned === true,
      plate: s.plate,
      text: s.text ?? null,
      linkFrom: s.linkFrom ?? null,
    })),
  )
const pageMoteur = () =>
  encre.evaluate(() => ({ index: window.hexaEngine.pageIndex, count: window.hexaEngine.pageCount }))
const temoin = () => inter.evaluate(() => document.querySelector('.toolbar .tb-page-num')?.textContent ?? '')
const indicateurInter = () => inter.evaluate(() => document.querySelector('.tool-indicator')?.textContent ?? '')
const indicateurEncre = () => encre.evaluate(() => document.querySelector('.tool-indicator')?.textContent ?? '')
const etatInter = () => inter.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui') ?? '{}').state ?? {})

const assurerDessin = async () => {
  await encre.keyboard.press('Escape').catch(() => {})
  await pause(150)
  const traversant = await encre.evaluate(() => document.body.classList.contains('passthrough')).catch(() => false)
  if (traversant) {
    await encre.keyboard.press('F8')
    await pause(500)
  }
}
const tracer = async (x0, y0, x1, y1) => {
  await encre.mouse.move(x0, y0)
  await encre.mouse.down()
  await encre.mouse.move(x1, y1, { steps: 12 })
  await encre.mouse.up()
  await pause(350)
}
const clic = async (x, y) => {
  await encre.mouse.move(x, y)
  await encre.mouse.down()
  await encre.mouse.up()
  await pause(120)
}
const clicDroitCtrl = async (x, y) => {
  await encre.mouse.move(x, y)
  await encre.keyboard.down('Control')
  await encre.mouse.down({ button: 'right' })
  await encre.mouse.up({ button: 'right' })
  await encre.keyboard.up('Control')
  await pause(150)
}
const attendre = async (fn, ms = 2500, pas = 100) => {
  const fin = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < fin) {
    await pause(pas)
    v = await fn()
  }
  return v
}

// État de départ, sur les DEUX pages, par le vrai mécanisme de persistance.
const ETAT = {
  onboarded: true,
  fadeDelay: null,
  tool: 'pen',
  color: '#00e5ff',
  size: 6,
  theme: 'neon-nuit',
  sound: false,
  sparkles: true,
  smartShapes: true,
  toolbarVisible: true,
  keymapPreset: 'epicpen',
  keymapPresetChosen: true,
  keymapOverrides: {},
  globalShortcutsOn: false,
  globalShortcutsChosen: true,
  annotationsHidden: false,
  toolbarFade: 0,
}
const poserEtat = async (patch = {}) => {
  for (const p of [encre, inter]) {
    await p.evaluate((e) => {
      localStorage.setItem('hexa-ui', JSON.stringify({ state: e, version: 2 }))
      // les pages survivent au rechargement d'une fenêtre (sessionStorage) :
      // un état de départ, c'est aussi la page 1
      sessionStorage.clear()
    }, { ...ETAT, ...patch })
  }
  await inter.reload()
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  await inter.waitForSelector('.toolbar', { timeout: 20000 })
  await pause(1500)
  ;({ encre, inter } = await trouverPages())
  encre.on('pageerror', (e) => erreurs.encre.push(String(e.message)))
  inter.on('pageerror', (e) => erreurs.inter.push(String(e.message)))
  await assurerDessin()
}
await poserEtat()

/* ================================================================== *
 * 1. LE NUMÉRO DE PAGE TRAVERSE LA FRONTIÈRE, DANS LES DEUX SENS
 * ================================================================== */

await rapport.test(inter, 'sE-1-page-clavier-vers-barre', 'Ctrl+Maj+N frappé dans l’encre : la barre (autre fenêtre) affiche 2/2, l’indicateur aussi — et rien dans l’encre', async () => {
  await encre.keyboard.press('r')
  await tracer(300, 200, 800, 520)
  const px1 = await peints()
  await encre.keyboard.press('Control+Shift+n')
  const tem = await attendre(async () => ((await temoin()) === '2/2' ? await temoin() : null))
  const ind = await indicateurInter()
  const indEncre = await indicateurEncre()
  const pg = await pageMoteur()
  const px2 = await peints()
  const ok = px1 > 1000 && tem === '2/2' && /Page 2 \/ 2/.test(ind) && indEncre === '' && pg.index === 1 && pg.count === 2 && px2 === 0
  return {
    statut: ok ? OK : KO,
    detail: `rectangle page 1 : ${px1} px · Ctrl+Maj+N → témoin « ${tem} », indicateur interface « ${ind} », indicateur encre « ${indEncre} » (vide exigé : l’encre part à l’antenne) · moteur page ${pg.index + 1}/${pg.count}, ${px2} px`,
  }
})

await rapport.test(inter, 'sE-2-page-barre-vers-moteur', 'Le témoin de la barre pilote le moteur de l’autre fenêtre : clic, Alt, Maj, Ctrl', async () => {
  const bouton = inter.locator('.toolbar .tb-page')
  // page 2/2 → clic : boucle sur la page 1
  await bouton.click({ timeout: 5000 })
  const p1 = await attendre(async () => ((await pageMoteur()).index === 0 ? await pageMoteur() : null))
  // Maj + clic : nouvelle page (3), vierge
  await bouton.click({ modifiers: ['Shift'], timeout: 5000 })
  const p3 = await attendre(async () => ((await pageMoteur()).count === 3 ? await pageMoteur() : null))
  // Alt + clic : page précédente (2)
  await bouton.click({ modifiers: ['Alt'], timeout: 5000 })
  const p2 = await attendre(async () => ((await pageMoteur()).index === 1 ? await pageMoteur() : null))
  // retour page 1, puis Ctrl + clic : duplication → page 4 avec le rectangle
  await encre.keyboard.press('PageUp')
  await pause(300)
  await bouton.click({ modifiers: ['Control'], timeout: 5000 })
  const p4 = await attendre(async () => ((await pageMoteur()).count === 4 ? await pageMoteur() : null))
  await pause(400)
  const copie = await traits()
  const pxCopie = await peints()
  const tem = await temoin()
  const ok =
    p1?.index === 0 && p3?.index === 2 && p3?.count === 3 && p2?.index === 1 && p4?.index === 3 && p4?.count === 4 && copie.length === 1 && copie[0].tool === 'rect' && pxCopie > 1000 && tem === '4/4'
  return {
    statut: ok ? OK : KO,
    detail: `clic → ${p1 ? p1.index + 1 : '?'} · Maj+clic → ${p3 ? `${p3.index + 1}/${p3.count}` : '?'} · Alt+clic → ${p2 ? p2.index + 1 : '?'} · Ctrl+clic depuis la 1 → ${p4 ? `${p4.index + 1}/${p4.count}` : '?'} avec ${copie.length} copie (${copie.map((s) => s.tool)}), ${pxCopie} px · témoin « ${tem} »`,
  }
})

/* ================================================================== *
 * 2. §2.5 : UNE PAGE VIDE RETIRE LA FENÊTRE D'ENCRE, UNE PAGE PLEINE LA RAMÈNE
 * ================================================================== */

await rapport.test(encre, 'sE-3-page-vide-fenetre-retiree', 'Sur une page vide, la fenêtre d’encre se retire ou se réduit à 8×8 (§2.5 + capture OBS) et rien ne tourne ; elle revient avec la page pleine', async () => {
  // page 4 (copie) → page 3 (vide)
  await encre.keyboard.press('PageUp')
  await pause(300)
  const pg = await pageMoteur()
  const contenu = await encre.evaluate(() => window.hexaEngine.hasContent)
  // le mode dessin garde la fenêtre affichée (elle reçoit le stylo) : on rend
  // la souris au jeu, comme le coach qui a fini de parler
  await encre.keyboard.press('F8')
  await pause(1200)
  const fen = await encreVisible()
  const act = await activiteDesDeux(5000)
  const interF = await interFenetre()
  // retour sur la page 4 (le rectangle) : la fenêtre doit revenir, plein écran
  await encre.keyboard.press('F8')
  await pause(500)
  await encre.keyboard.press('PageDown')
  await pause(300)
  await encre.keyboard.press('F8')
  await pause(1200)
  const fenPleine = await encreVisible()
  const px = await peints()
  const actPleine = await activiteDesDeux(4000)
  await encre.keyboard.press('F8')
  await pause(500)
  const ok =
    pg.index === 2 && contenu === false && (fen?.visible === false || fen?.bounds === '8×8') && act.encre.raf === 0 && act.inter.raf === 0 && act.encre.iv === 0 && act.inter.iv === 0 && act.encre.to === 0 && act.inter.to === 0 && fenPleine?.visible === true && px > 1000 && actPleine.encre.raf === 0 && actPleine.inter.raf === 0
  return {
    statut: ok ? OK : KO,
    detail: `page ${pg.index + 1} vide : hasContent=${contenu}, fenêtre d’encre visible=${fen?.visible} (${fen?.bounds}), interface ${interF?.bounds} (${(100 * (interF?.part ?? 0)).toFixed(1)} % de l’écran) · 5 s de repos : ${act.txt} (0 partout exigé) · page 4 pleine : visible=${fenPleine?.visible} ${fenPleine?.bounds}, ${px} px · 4 s : ${actPleine.txt}`,
  }
})

/* ================================================================== *
 * 3. ÉPINGLER, EN DIRECT : LÉGENDE + CTRL+Z DE TROP
 * ================================================================== */

await rapport.test(encre, 'sE-4-epingle-survit-ctrl-z', 'La légende épinglée survit à un Ctrl+Z de trop sur une page vide', async () => {
  // page 4 : le rectangle. On le pose comme légende : épinglé.
  await clicDroitCtrl(550, 200)
  const apresPin = await traits()
  const nb = await encre.evaluate(() => window.hexaEngine.nbEpingles)
  const annonce = await attendre(async () => (/pinglé/.test(await indicateurInter()) ? await indicateurInter() : null), 1500)
  process.stdout.write(`      annonce dans l’interface : « ${annonce} »\n`)
  // nouvelle page (5) : la légende y est. Le coach trace deux traits, se
  // trompe, et martèle Ctrl+Z trois fois — comme on le fait en direct.
  await encre.keyboard.press('Control+Shift+n')
  await pause(300)
  await encre.keyboard.press('p')
  await tracer(300, 600, 700, 640)
  await tracer(300, 700, 700, 740)
  const avantUndo = await traits()
  // six appuis : un trait redressé coûte deux Ctrl+Z (tracé brut, puis
  // retrait), et c'est le CINQUIÈME qui emportait la légende avant correction
  for (let i = 0; i < 6; i++) {
    await encre.keyboard.press('Control+z')
    await pause(150)
  }
  await pause(300)
  const apresUndo = await traits()
  const legende = apresUndo.find((s) => s.tool === 'rect')
  const px = await peints()
  const indPin = await indicateurInter()
  return {
    statut: apresPin.some((s) => s.pinned) && nb === 1 && avantUndo.length === 3 && apresUndo.length === 1 && legende?.pinned === true && px > 1000 ? OK : KO,
    detail: `épinglée : ${nb} · page 5 : ${avantUndo.length} annotations (légende + 2 traits) · 6 × Ctrl+Z → ${apresUndo.length} restante(s), légende ${legende ? 'PRÉSENTE' : 'PERDUE'} (épinglée : ${legende?.pinned}), ${px} px · indicateur interface au moment du geste : « ${indPin} »`,
  }
})

await rapport.test(encre, 'sE-5-epingle-panique-et-retour', '« Tout effacer » puis Ctrl+Z : les traits reviennent, la légende n’a jamais bougé', async () => {
  await encre.keyboard.press('p')
  await tracer(300, 600, 700, 640)
  await tracer(300, 700, 700, 740)
  const avant = await traits()
  // la couche vive ne garde rien du signal d'épinglage (onde de 0,45 s) —
  // on laisse d'abord finir les étincelles du dernier trait (mesuré : 43 px
  // d'étincelles encore en vol à 350 ms)
  await pause(900)
  const vif = await encre.evaluate(() => {
    const cv = document.querySelectorAll('.stage canvas')[2]
    if (!cv || !cv.width) return 0
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    return n
  })
  await encre.keyboard.press('c')
  await pause(900)
  const apresClear = await traits()
  await encre.keyboard.press('Control+z')
  await pause(500)
  const apresUndo = await traits()
  const nb = await encre.evaluate(() => window.hexaEngine.nbEpingles)
  const ok = avant.length === 3 && vif === 0 && apresClear.length === 1 && apresClear[0].pinned && apresUndo.length === avant.length && apresUndo.filter((s) => s.pinned).length === 1 && nb === 1
  return {
    statut: ok ? OK : KO,
    detail: `${avant.length} annotations, couche vive ${vif} px · tout effacer → ${apresClear.length} (épinglée : ${apresClear[0]?.pinned}) · Ctrl+Z → ${apresUndo.length} annotations, ${nb} épinglée`,
  }
})

/* ================================================================== *
 * 4. EXPORT PNG : LE VRAI PIPELINE DE TÉLÉCHARGEMENT D'ELECTRON
 * ================================================================== */

await rapport.test(inter, 'sE-6-export-png-vrai-telechargement', 'Ctrl+Maj+E dans l’encre et le bouton de la barre : un vrai PNG arrive sur le disque, et l’interface l’annonce', async () => {
  const t0 = Date.now()
  await encre.keyboard.press('Control+Shift+e')
  const ind = await attendre(async () => (/PNG/.test(await indicateurInter()) ? await indicateurInter() : null), 3000)
  const dl1 = await attendre(async () => {
    const l = await telechargements()
    return l.length >= 1 && l[0].etat !== 'en cours' ? l : null
  }, 5000)
  const dt1 = Date.now() - t0
  // par le bouton de la barre, dans l'autre fenêtre
  await inter.locator('.toolbar .tbtn[title^="Image PNG"]').click({ timeout: 5000 })
  const dl2 = await attendre(async () => {
    const l = await telechargements()
    return l.length >= 2 && l[1].etat !== 'en cours' ? l : null
  }, 6000)
  const liste = dl2 ?? dl1 ?? (await telechargements())
  const fichiers = liste.map((d) => {
    const chemin = join(DL, d.nom)
    const taille = existsSync(chemin) ? statSync(chemin).size : 0
    const sig = taille > 4 ? readFileSync(chemin).subarray(1, 4).toString('ascii') : ''
    return { ...d, taille, sig }
  })
  const ok = fichiers.length === 2 && fichiers.every((f) => f.etat === 'completed' && f.sig === 'PNG' && f.taille > 1000 && /^hexa-page-.*\.png$/.test(f.nom)) && /PNG transparent prêt/.test(ind ?? '')
  return {
    statut: ok ? OK : KO,
    detail: `indicateur interface « ${ind} » · touche → fichier écrit en ${dt1} ms (sondé toutes les 100 ms) · téléchargements : ${fichiers.map((f) => `${f.nom} ${f.etat} ${f.taille} o ${f.sig} ${f.mime}`).join(' | ') || 'AUCUN'}`,
  }
})

/* ================================================================== *
 * 5. LA PLAQUE DU TEXTE : LE DÉFAUT VOYAGE JUSQU'À L'INTERFACE ET S'Y PERSISTE
 * ================================================================== */

await rapport.test(encre, 'sE-7-plaque-defaut-synchronise', 'Plaque retirée dans le champ (encre) : le défaut est persisté par la fenêtre d’interface', async () => {
  await encre.keyboard.press('t')
  await clic(400, 420)
  await pause(200)
  const bouton = await encre.evaluate(() => !!document.querySelector('.hexa-text-plate-btn'))
  await encre.evaluate(() =>
    document.querySelector('.hexa-text-plate-btn')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
  )
  await encre.keyboard.type('SANS PLAQUE')
  await encre.keyboard.press('Enter')
  await pause(500)
  const t = (await traits()).find((s) => s.text === 'SANS PLAQUE')
  const defautInter = await attendre(async () => ((await etatInter()).textPlate === false ? 'false' : null))
  // remise à « plaque » pour la suite, par le champ
  await clic(400, 520)
  await pause(200)
  await encre.evaluate(() =>
    document.querySelector('.hexa-text-plate-btn')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
  )
  await encre.keyboard.press('Escape')
  await pause(300)
  const remis = await attendre(async () => ((await etatInter()).textPlate === true ? 'true' : null))
  return {
    statut: bouton && t?.plate === false && defautInter === 'false' && remis === 'true' ? OK : KO,
    detail: `bouton dans le champ : ${bouton} · texte plate=${String(t?.plate)} · défaut persisté côté interface : ${defautInter} · remis : ${remis}`,
  }
})

/* ================================================================== *
 * 6. LA BARRE DISCRÈTE, DANS SA VRAIE FENÊTRE
 * ================================================================== */

await rapport.test(inter, 'sE-8-barre-discrete-deux-fenetres', 'Barre discrète (1 s) : elle s’estompe dans la fenêtre d’interface, ne coûte rien estompée, et revient à l’approche', async (capturer) => {
  await poserEtat({ toolbarFade: 1 })
  // une frappe rallume la barre : c'est de là qu'on mesure la seconde (un
  // vrai changement d'outil — « p » est déjà l'outil de départ)
  await encre.keyboard.press('r')
  await pause(250)
  await encre.mouse.move(900, 500)
  const opAvant = await inter.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  const dim = await attendre(async () => inter.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim')), 3000)
  await pause(1000)
  const opDim = await inter.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  await capturer('estompee')
  // estompée : au repos, rien ne doit tourner dans aucune des deux fenêtres
  const act = await activiteDesDeux(5000)
  // un trait tracé loin de la barre ne la rallume pas (le geste du coach)
  await tracer(900, 300, 1300, 600)
  const toujoursDim = await inter.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  // l'approche : sous Windows, Electron transmet le mouvement de la souris à
  // la fenêtre d'interface (setIgnoreMouseEvents forward) ; sous Xvfb et
  // Playwright, on l'envoie nous-mêmes à cette page — c'est la même
  // frontière, mais ce n'est pas le transport réel de Windows.
  const r = await inter.evaluate(() => {
    const b = document.querySelector('.toolbar').getBoundingClientRect()
    return { x: b.right + 40, y: b.top + b.height / 2 }
  })
  await inter.mouse.move(r.x, r.y)
  const revenue = await attendre(async () => inter.evaluate(() => !document.querySelector('.toolbar').classList.contains('is-dim')), 1500)
  await pause(400) // la transition de retour dure 0,16 s
  const opRevenue = await inter.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  // un changement d'outil AU CLAVIER, dans l'encre, la rallume aussi
  await inter.mouse.move(900, 700)
  const dim2 = await attendre(async () => inter.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim')), 3000)
  await encre.keyboard.press('p')
  const apresFrappe = await attendre(async () => inter.evaluate(() => !document.querySelector('.toolbar').classList.contains('is-dim')), 1500)
  const ok = Number(opAvant) === 1 && dim && Number(opDim) < 0.4 && act.encre.raf === 0 && act.inter.raf === 0 && act.inter.iv === 0 && act.inter.to === 0 && toujoursDim && revenue && Number(opRevenue) > 0.9 && dim2 && apresFrappe
  return {
    statut: ok ? OK : KO,
    detail: `opacité ${opAvant} → estompée ${dim} (${opDim}) · 5 s estompée : ${act.txt} · un trait loin de la barre : reste estompée ${toujoursDim} · approche à 40 px : revenue ${revenue} (${opRevenue}) · ré-estompée ${dim2}, touche R dans l’encre → revenue ${apresFrappe}`,
  }
})

await rapport.test(inter, 'sE-9-barre-discrete-mode-jeu', 'Souris rendue au jeu : la barre ne s’estompe pas, et sa fenêtre reste réduite à la barre', async () => {
  await encre.keyboard.press('F8')
  await pause(2500)
  const dim = await inter.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  const f = await interFenetre()
  const act = await activiteDesDeux(3000)
  await encre.keyboard.press('F8')
  await pause(500)
  return {
    statut: !dim && f && f.part < 0.25 && act.encre.raf === 0 && act.inter.raf === 0 && act.inter.to === 0 ? OK : KO,
    detail: `mode jeu 2,5 s : is-dim=${dim} (false exigé) · fenêtre d’interface ${f?.bounds} (${(100 * (f?.part ?? 0)).toFixed(1)} % de l’écran) · 3 s : ${act.txt}`,
  }
})

/* ================================================================== *
 * 7. COMBINAISONS : MASQUAGE, RECHARGEMENT, ÉTAT ABÎMÉ
 * ================================================================== */

await rapport.test(encre, 'sE-10-masquage-et-page', 'Annotations masquées pendant un changement de page : au retour, c’est la bonne page qu’on voit', async () => {
  await poserEtat()
  await encre.keyboard.press('r')
  await tracer(300, 200, 800, 520)
  const px1 = await peints()
  await encre.keyboard.press('Control+Shift+n')
  await pause(200)
  await encre.keyboard.press('p')
  await tracer(300, 700, 700, 740)
  const px2 = await peints()
  await encre.keyboard.press('Control+Shift+m') // masquer
  await encre.keyboard.press('F8') // souris rendue au jeu : la fenêtre vide doit se retirer
  await pause(1000)
  const fenMasquee = await encreVisible()
  await encre.keyboard.press('F8')
  await pause(400)
  await encre.keyboard.press('PageUp')
  await pause(300)
  const pxMasque = await peints()
  await encre.keyboard.press('Control+Shift+m') // remontrer
  await pause(800)
  const pxRetour = await peints()
  const pg = await pageMoteur()
  const t = await traits()
  const ok = px1 > 1000 && px2 > 0 && px2 < px1 && (fenMasquee?.visible === false || fenMasquee?.bounds === '8×8') && pxMasque === 0 && Math.abs(pxRetour - px1) < px1 * 0.05 && pg.index === 0 && t.length === 1 && t[0].tool === 'rect'
  return {
    statut: ok ? OK : KO,
    detail: `page 1 : ${px1} px, page 2 : ${px2} px · masquées : fenêtre visible=${fenMasquee?.visible} (${fenMasquee?.bounds} — 8×8 = réduite pour OBS, voir t-obs-2), Page↑ → ${pxMasque} px peints · remontrées : ${pxRetour} px sur la page ${pg.index + 1} (${t.map((s) => s.tool)})`,
  }
})

await rapport.test(encre, 'sE-11-encre-rechargee', 'La couche encre rechargée (F5, plantage du rendu) retrouve la page que l’interface affiche', async () => {
  // interface : page 2/2. On recharge l'encre seule.
  await encre.keyboard.press('PageDown')
  await pause(300)
  const avant = { moteur: await pageMoteur(), temoin: await temoin() }
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  await pause(1500)
  ;({ encre } = await trouverPages())
  await assurerDessin()
  const apres = { moteur: await pageMoteur(), temoin: await temoin() }
  // le coach frappe Page ↑ : l'interface dit 1/2, le moteur doit suivre
  await encre.keyboard.press('PageUp')
  await pause(400)
  const suite = { moteur: await pageMoteur(), temoin: await temoin() }
  const coherent = apres.moteur.index + 1 === Number(apres.temoin.split('/')[0]) && suite.moteur.index + 1 === Number(suite.temoin.split('/')[0])
  return {
    statut: coherent ? OK : KO,
    detail: `avant : moteur ${avant.moteur.index + 1}/${avant.moteur.count}, témoin « ${avant.temoin} » · après rechargement : moteur ${apres.moteur.index + 1}/${apres.moteur.count}, témoin « ${apres.temoin} » · Page↑ : moteur ${suite.moteur.index + 1}/${suite.moteur.count}, témoin « ${suite.temoin} »`,
  }
})

await rapport.test(inter, 'sE-12-etat-abime', 'toolbarFade et textPlate abîmés sur le disque : la barre est là, le stylo dessine, aucune erreur', async () => {
  const avantErr = erreurs.encre.length + erreurs.inter.length
  await poserEtat({ toolbarFade: 'cinq', textPlate: 'oui' })
  const barre = await inter.evaluate(() => !!document.querySelector('.toolbar'))
  await encre.keyboard.press('p')
  await tracer(300, 300, 800, 500)
  const px = await peints()
  const st = await etatInter()
  const act = await activite(inter, 2000)
  await poserEtat({ toolbarFade: Number.NaN, textPlate: null })
  const barre2 = await inter.evaluate(() => !!document.querySelector('.toolbar'))
  const st2 = await etatInter()
  const apresErr = erreurs.encre.length + erreurs.inter.length
  return {
    statut: barre && barre2 && px > 1000 && apresErr === avantErr && typeof st.toolbarFade === 'number' && typeof st.textPlate === 'boolean' && typeof st2.toolbarFade === 'number' && typeof st2.textPlate === 'boolean' ? OK : KO,
    detail: `"cinq"/"oui" : barre ${barre}, ${px} px, relus comme toolbarFade=${JSON.stringify(st.toolbarFade)} textPlate=${JSON.stringify(st.textPlate)}, ${act.to} minuterie(s) en 2 s · NaN/null : barre ${barre2}, relus toolbarFade=${JSON.stringify(st2.toolbarFade)} textPlate=${JSON.stringify(st2.textPlate)} · erreurs de page : ${apresErr - avantErr}`,
  }
})

await rapport.test(inter, 'sE-13-barre-et-aide', 'La barre n’a pas deux séparateurs collés, et l’aide parle des pages, de l’épingle et de la barre discrète', async () => {
  await poserEtat()
  const seps = await inter.evaluate(() => document.querySelectorAll('.toolbar .sep + .sep').length)
  await inter.locator('.toolbar .tbtn[title^="Aide"]').click({ timeout: 5000 })
  await pause(600)
  const texte = await inter.evaluate(() => document.body.innerText)
  const mots = ['Plusieurs pages', 'Épingler', 'Barre discrète', 'Image PNG', 'plaque']
  const absents = mots.filter((m) => !texte.includes(m))
  await inter.keyboard.press('Escape')
  await pause(300)
  return {
    statut: seps === 0 && absents.length === 0 ? OK : KO,
    detail: `séparateurs collés : ${seps} (0 exigé) · aide : ${absents.length === 0 ? 'tout y est' : `manque ${absents.join(', ')}`}`,
  }
})

await rapport.test(encre, 'sE-16-miroir-et-archive-apres-40-pages', 'Quarante changements de page : le miroir OBS n’a rien réparé, l’archive ne grossit pas, 0 image au repos', async () => {
  await poserEtat()
  await encre.keyboard.press('r')
  await tracer(300, 200, 800, 520)
  await encre.keyboard.press('Control+Shift+n')
  await pause(200)
  await encre.keyboard.press('p')
  await tracer(300, 600, 700, 640)
  await encre.keyboard.press('Control+Shift+n')
  await pause(200)
  await encre.keyboard.press('o')
  await tracer(900, 300, 1200, 500)
  await pause(400)
  const avant = await encre.evaluate(() => ({ ...window.__hexaDbg }))
  for (let i = 0; i < 20; i++) {
    await encre.keyboard.press('PageUp')
    await encre.keyboard.press('PageUp')
    await pause(60)
    await encre.keyboard.press('PageDown')
    await encre.keyboard.press('PageDown')
    await pause(60)
  }
  await pause(800)
  const apres = await encre.evaluate(() => ({ ...window.__hexaDbg }))
  const pg = await pageMoteur()
  const px = await peints()
  const act = await activiteDesDeux(4000)
  // (`obsSent` ne compte que ce qui est parti vers une source navigateur
  // connectée : ici personne n'écoute, la vraie vue OBS est éprouvée par sB-1f)
  const ok = pg.index === 2 && px > 500 && apres.obsRepare === 0 && apres.recCount === 3 && act.encre.raf === 0 && act.inter.raf === 0
  return {
    statut: ok ? OK : KO,
    detail: `3 pages, 1 annotation chacune · 40 changements → page ${pg.index + 1}/${pg.count}, ${px} px · miroir OBS : ${apres.obsRepare} réparation(s) (0 exigé) · archive : ${apres.recCount} traits (3 attendus, pas 3 × 40) · ${apres.appels - avant.appels} images calculées pendant les 40 changements · repos 4 s : ${act.txt}`,
  }
})

await rapport.test(encre, 'sE-14-aucune-erreur', 'Aucune erreur de page dans l’une ou l’autre fenêtre pendant toute la campagne', async () => ({
  statut: erreurs.encre.length + erreurs.inter.length === 0 ? OK : KO,
  detail: erreurs.encre.length + erreurs.inter.length === 0 ? 'aucune' : [...erreurs.encre, ...erreurs.inter].slice(0, 3).join(' | '),
}))

await rapport.test(inter, 'sE-15-relancement-page-1', 'Au lancement suivant (même dossier utilisateur), Hexa repart de la page 1 — les pages ne survivent qu’au rechargement', async () => {
  await encre.keyboard.press('Control+Shift+n')
  await encre.keyboard.press('Control+Shift+n')
  await pause(400)
  const avant = await pageMoteur()
  await app.close()
  const app2 = await electron.launch({
    args: ['.', `--user-data-dir=${USER}`],
    cwd: RACINE,
    executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
    timeout: 60000,
  })
  app2.process().stderr?.on('data', () => {})
  await app2.firstWindow({ timeout: 30000 })
  await pause(3500)
  let pg = null
  let tem = ''
  for (const w of app2.windows()) {
    if (w.url().startsWith('data:')) continue
    const d = await w
      .evaluate(() => ({
        couche: [...document.body.classList].find((c) => c.startsWith('hexa-')) ?? '',
        actif: window.hexaEngine ? window.hexaEngine.actif === true : false,
        page: window.hexaEngine ? { index: window.hexaEngine.pageIndex, count: window.hexaEngine.pageCount } : null,
        temoin: document.querySelector('.toolbar .tb-page-num')?.textContent ?? '',
      }))
      .catch(() => null)
    if (!d) continue
    if (d.couche === 'hexa-encre' && d.actif) pg = d.page
    if (d.couche === 'hexa-interface' && d.temoin) tem = d.temoin
  }
  await app2.close()
  return {
    statut: avant.count >= 3 && pg?.index === 0 && pg?.count === 1 && tem === '1/1' ? OK : KO,
    detail: `avant fermeture : page ${avant.index + 1}/${avant.count} · relancé : moteur ${pg ? `${pg.index + 1}/${pg.count}` : '?'}, témoin « ${tem} »`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close().catch(() => {})
process.exit(rapport.codeSortie)
