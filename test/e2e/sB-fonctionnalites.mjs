#!/usr/bin/env node
/**
 * Hexa — §SB : FONCTIONNALITÉS ET FINITIONS POUR UN COACH EN DIRECT.
 *
 * Chaque fonctionnalité née de la session jouée dans sB-session-coach.mjs est
 * vérifiée ici sur la VRAIE application Electron, avec la preuve de la maison
 * (des pixels, l'état du moteur, l'état persisté) — et, pour chacune, la
 * mesure qui compte le plus dans ce projet : ZÉRO image demandée au repos.
 *
 *   1. Pages d'annotation : suivante / précédente / nouvelle / dupliquer,
 *      « tout effacer » ne vide que la page courante, le fondu est suspendu
 *      sur une page qu'on ne regarde pas, le miroir OBS suit la page.
 *   2. Export PNG transparent de la page en un geste.
 *   3. Plaque de lisibilité du texte, par texte, avec un défaut qui suit.
 *   4. Barre d'outils qui s'estompe, et revient à l'approche de la souris.
 *   5. Épingler : survit à « tout effacer », au fondu, au changement de page.
 *   6. Au repos, avec tout ça à l'écran : 0 image.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/sB-fonctionnalites.mjs
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPTURES,
  KO,
  NON_TESTE,
  OK,
  Rapport,
  encre,
  etatDeDepart,
  lancerHexa,
  preparerCaptures,
  segment,
  toutEffacer,
  tracer,
} from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win, journal } = await lancerHexa({ profil: 'sB-fonctions' })
await etatDeDepart(win)

/* ------------------------------------------------------------------ *
 * Outils de lecture
 * ------------------------------------------------------------------ */

const etatUi = () => win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state)
/** traits vivants du moteur (page courante, épinglées comprises) */
const traits = () =>
  win.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({
      id: s.id,
      tool: s.tool,
      pinned: s.pinned === true,
      plate: s.plate,
      text: s.text ?? null,
      dieAt: s.dieAt ?? null,
    })),
  )
const page = () => win.evaluate(() => ({ index: window.hexaEngine.pageIndex, count: window.hexaEngine.pageCount }))
const temoin = () =>
  win.evaluate(() => document.querySelector('.toolbar .tb-page-num')?.textContent ?? '')
const indicateur = () =>
  win.evaluate(() => document.querySelector('.tool-indicator')?.textContent ?? '')
const clic = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(120)
}
const clicDroitCtrl = async (x, y) => {
  await win.mouse.move(x, y)
  await win.keyboard.down('Control')
  await win.mouse.down({ button: 'right' })
  await win.mouse.up({ button: 'right' })
  await win.keyboard.up('Control')
  await win.waitForTimeout(150)
}

/** compteur d'images rAF : la mesure de la règle §2.5 */
await win.evaluate(() => {
  window.__hexaFrames = 0
  const orig = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => {
    window.__hexaFrames++
    return orig(cb)
  }
})
const images = async (ms) => {
  await win.evaluate(() => (window.__hexaFrames = 0))
  await win.waitForTimeout(ms)
  return win.evaluate(() => window.__hexaFrames)
}

/* ================================================================== *
 * 1. PAGES
 * ================================================================== */

await rapport.test(win, 'sB-1-pages-va-et-vient', 'Page 1 → nouvelle page 2 → retour : chaque page garde ses annotations', async (capturer) => {
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 800, 520, 10))
  await win.waitForTimeout(500)
  const p1 = await encre(win)
  const t1 = await traits()
  await win.keyboard.press('Control+Shift+n')
  await win.waitForTimeout(500)
  const p2 = await encre(win)
  const pg2 = await page()
  const tem2 = await temoin()
  const ind = await indicateur()
  await capturer('page2-vide')
  await win.keyboard.press('p')
  await tracer(win, segment(400, 300, 700, 380, 8))
  await win.waitForTimeout(400)
  const t2 = await traits()
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(500)
  const p1b = await encre(win)
  const t1b = await traits()
  const pg1 = await page()
  await capturer('retour-page1')
  await win.keyboard.press('PageDown')
  await win.waitForTimeout(400)
  const t2b = await traits()
  const ok =
    p1.statique > 1000 &&
    t1.length === 1 &&
    p2.statique === 0 &&
    pg2.index === 1 &&
    pg2.count === 2 &&
    tem2 === '2/2' &&
    t2.length === 1 &&
    // un segment droit au pinceau est redressé en ligne par les formes intelligentes
    (t2[0].tool === 'pen' || t2[0].tool === 'line') &&
    pg1.index === 0 &&
    t1b.length === 1 &&
    t1b[0].tool === 'rect' &&
    Math.abs(p1b.statique - p1.statique) < p1.statique * 0.05 &&
    t2b.length === 1 &&
    (t2b[0].tool === 'pen' || t2b[0].tool === 'line')
  return {
    statut: ok ? OK : KO,
    detail:
      `page 1 : ${p1.statique} px (${t1.map((s) => s.tool)}) · Ctrl+Maj+N → page ${pg2.index + 1}/${pg2.count}, ${p2.statique} px, témoin « ${tem2} », indicateur « ${ind} » · ` +
      `trait posé page 2 : ${t2.map((s) => s.tool)} · Page↑ → page ${pg1.index + 1} : ${p1b.statique} px (${t1b.map((s) => s.tool)}) · Page↓ : ${t2b.map((s) => s.tool)}`,
  }
})

await rapport.test(win, 'sB-1b-pages-bornees', 'Page ↓ sur la dernière page et Page ↑ sur la première ne font rien', async () => {
  await win.keyboard.press('PageDown')
  await win.waitForTimeout(250)
  const fin = await page()
  await win.keyboard.press('PageUp')
  await win.keyboard.press('PageUp')
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(250)
  const debut = await page()
  return {
    statut: fin.index === 1 && fin.count === 2 && debut.index === 0 && debut.count === 2 ? OK : KO,
    detail: `dernière page + Page↓ : ${fin.index + 1}/${fin.count} · trois Page↑ : ${debut.index + 1}/${debut.count}`,
  }
})

await rapport.test(win, 'sB-1c-effacer-page-courante', '« Tout effacer » ne vide que la page affichée', async () => {
  // on est sur la page 1 (rectangle) ; la page 2 porte un trait
  await win.keyboard.press('PageDown')
  await win.waitForTimeout(300)
  await toutEffacer(win)
  const p2 = await traits()
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(400)
  const p1 = await traits()
  return {
    statut: p2.length === 0 && p1.length === 1 && p1[0].tool === 'rect' ? OK : KO,
    detail: `page 2 après « tout effacer » : ${p2.length} trait · page 1 intacte : ${p1.length} (${p1.map((s) => s.tool)})`,
  }
})

await rapport.test(win, 'sB-1d-fondu-suspendu', 'Le fondu est suspendu sur une page qu’on ne regarde pas', async () => {
  // fondu ∞ → « d » → 2 s
  await win.keyboard.press('d')
  await win.waitForTimeout(150)
  const fade = (await etatUi()).fadeDelay
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracer(win, segment(350, 300, 650, 360, 8))
  await win.waitForTimeout(200)
  // on quitte la page AVANT l'échéance, on y revient bien APRÈS
  await win.keyboard.press('PageDown')
  await win.waitForTimeout(3200)
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(350)
  const revenu = await traits()
  const encreRevenue = (await encre(win)).statique
  // …et là, le compte à rebours repart de zéro : il doit s'effacer maintenant
  await win.waitForTimeout(3600)
  const ensuite = await traits()
  // retour à ∞ pour la suite
  await win.keyboard.press('d')
  await win.keyboard.press('d')
  await win.keyboard.press('d')
  await win.waitForTimeout(150)
  const fadeApres = (await etatUi()).fadeDelay
  return {
    statut:
      fade === 2000 && revenu.length === 1 && encreRevenue > 500 && ensuite.length === 0 && fadeApres === null
        ? OK
        : KO,
    detail: `fondu ${fade} ms · parti 3,2 s sur la page 2 → au retour : ${revenu.length} trait, ${encreRevenue} px (le fondu n'a pas couru) · 3,6 s plus tard : ${ensuite.length} trait (compte à rebours reparti) · fondu remis à ${fadeApres}`,
  }
})

await rapport.test(win, 'sB-1e-dupliquer', 'Dupliquer la page : la copie part du même dessin, l’original reste intact', async () => {
  await toutEffacer(win)
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 700, 500, 10))
  await win.keyboard.press('n')
  await clic(400, 300)
  await clic(600, 400)
  await win.waitForTimeout(300)
  const avant = await traits()
  const pgAvant = await page()
  await win.keyboard.press('Control+Shift+d')
  await win.waitForTimeout(500)
  const copie = await traits()
  const pgCopie = await page()
  const encreCopie = (await encre(win)).statique
  // la copie se retouche sans toucher l'original
  await win.keyboard.press('p')
  await tracer(win, segment(300, 600, 700, 640, 8))
  await win.waitForTimeout(300)
  const copieRetouchee = await traits()
  await win.keyboard.press('PageUp')
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(400)
  const original = await traits()
  const idsAvant = new Set(avant.map((s) => s.id))
  const idsNeufs = copie.every((s) => !idsAvant.has(s.id))
  return {
    statut:
      avant.length === 3 &&
      pgCopie.index === pgAvant.count &&
      pgCopie.count === pgAvant.count + 1 &&
      copie.length === 3 &&
      idsNeufs &&
      encreCopie > 1000 &&
      copieRetouchee.length === 4 &&
      original.length === 3
        ? OK
        : KO,
    detail: `page ${pgAvant.index + 1} : ${avant.length} annotations → Ctrl+Maj+D → page ${pgCopie.index + 1}/${pgCopie.count} : ${copie.length} copies (identifiants neufs : ${idsNeufs ? 'oui' : 'NON'}), ${encreCopie} px · retouche : ${copieRetouchee.length} · original : ${original.length}`,
  }
})

await rapport.test(win, 'sB-1f-miroir-obs-suit-la-page', 'La vue OBS (source navigateur) suit la page affichée', async () => {
  const st = await win.evaluate(() => window.hexa?.obsStatus?.())
  if (!st?.url) return { statut: NON_TESTE, detail: 'serveur local absent dans ce mode' }
  // une VRAIE page OBS, dans un vrai Chromium, gardée ouverte le temps du test
  const ouvrir = await app.evaluate(async ({ BrowserWindow }, url) => {
    const w = new BrowserWindow({ width: 960, height: 540, show: false, webPreferences: { backgroundThrottling: false } })
    await w.loadURL(url)
    globalThis.__obsWin = w
    await new Promise((r) => setTimeout(r, 1500))
    return true
  }, st.url)
  const compter = () =>
    app.evaluate(async () => {
      const w = globalThis.__obsWin
      return w.webContents.executeJavaScript(`(() => {
        const c = document.querySelector('canvas')
        if (!c || c.width === 0) return 0
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
        return n
      })()`)
    })
  // Chaque lecture attend 2,5 s : la vue OBS anime les arrivées (allumage)
  // et les départs (pop de 200 ms), et une fenêtre Electron CACHÉE — la seule
  // possible ici sans voler le focus à Hexa — n'obtient ses images qu'au
  // compte-gouttes de Chromium. Ce qu'on mesure est l'état STABLE de la vue.
  const POSE = 2500
  // page 1 : le rectangle + deux pastilles doivent être dans la vue
  await win.waitForTimeout(POSE)
  const p1 = await compter()
  await win.keyboard.press('PageDown')
  await win.keyboard.press('PageDown')
  await win.waitForTimeout(POSE)
  const p3 = await compter()
  const local3 = (await encre(win)).statique
  // page 2 (vide depuis « tout effacer ») : la vue OBS doit se vider aussi
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(POSE)
  const p2 = await compter()
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(POSE)
  const p1b = await compter()
  await app.evaluate(() => {
    globalThis.__obsWin?.destroy()
    globalThis.__obsWin = null
  })
  return {
    statut: ouvrir && p1 > 500 && p3 > 500 && local3 > 500 && p2 === 0 && Math.abs(p1b - p1) < p1 * 0.1 ? OK : KO,
    detail: `vue OBS — page 1 : ${p1} px · page 3 : ${p3} px (local ${local3}) · page 2 (vide) : ${p2} px · retour page 1 : ${p1b} px`,
  }
})

/* ================================================================== *
 * 2. EXPORT PNG EN UN GESTE
 * ================================================================== */

await rapport.test(win, 'sB-2-export-png', 'Ctrl+Maj+E exporte la page en PNG transparent, sans la barre', async () => {
  const bouton = await win.evaluate(() =>
    [...document.querySelectorAll('.toolbar .tbtn')].some((b) => /Image PNG/.test(b.getAttribute('title') ?? '')),
  )
  // Le fichier part par un <a download> : on intercepte ce clic DANS la page
  // pour relire l'octet près ce qui serait écrit sur le disque (le
  // téléchargement lui-même est du ressort de Chromium, pas d'Hexa).
  await win.evaluate(() => {
    window.__hexaPng = null
    const orig = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith('blob:')) {
        window.__hexaPng = { nom: this.download, promesse: fetch(this.href).then((r) => r.arrayBuffer()) }
        return
      }
      return orig.call(this)
    }
  })
  await win.keyboard.press('Control+Shift+e')
  await win.waitForTimeout(600)
  const ind = await indicateur()
  const dl = await win.evaluate(async () => {
    if (!window.__hexaPng) return null
    const buf = await window.__hexaPng.promesse
    const b = new Uint8Array(buf)
    let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return { nom: window.__hexaPng.nom, b64: btoa(s) }
  })
  let taille = 0
  let signature = ''
  let alpha = null
  if (dl) {
    const chemin = join(CAPTURES, 'sB-2-export.png')
    const buf = Buffer.from(dl.b64, 'base64')
    writeFileSync(chemin, buf)
    taille = buf.length
    signature = buf.subarray(1, 4).toString('ascii')
    // le PNG est-il transparent ? On le relit dans la page, pixel par pixel :
    // des pixels entièrement transparents ET des pixels peints
    alpha = await win.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const ctx = cv.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data
      let transparents = 0
      let peints = 0
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] === 0) transparents++
        else if (d[i] > 8) peints++
      }
      return { w: img.width, h: img.height, transparents, peints }
    }, buf.toString('base64'))
  }
  const okFichier =
    dl && /^hexa-page-.*\.png$/.test(dl.nom) && signature === 'PNG' && alpha && alpha.peints > 500 && alpha.transparents > alpha.peints * 5
  return {
    statut: bouton && okFichier && /PNG transparent prêt/.test(ind) ? OK : KO,
    detail: `bouton dans la barre : ${bouton ? 'oui' : 'NON'} · fichier ${dl ? `${dl.nom}, ${taille} octets, signature ${signature}, ${alpha?.w}×${alpha?.h} (2×), ${alpha?.peints} px peints / ${alpha?.transparents} px transparents` : 'aucun téléchargement capté'} · indicateur « ${ind} »`,
  }
})

/* ================================================================== *
 * 3. PLAQUE DE LISIBILITÉ DU TEXTE
 * ================================================================== */

await rapport.test(win, 'sB-3-plaque-texte', 'Plaque de lisibilité : par texte, et le choix devient le défaut', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('t')
  await clic(400, 300)
  await win.keyboard.type('AVEC PLAQUE')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(450)
  const avec = (await encre(win)).statique
  const t1 = await traits()
  // deuxième texte : on retire la plaque DANS le champ, avant de valider
  await clic(400, 500)
  await win.waitForTimeout(200)
  const boutonPresent = await win.evaluate(() => !!document.querySelector('.hexa-text-plate-btn'))
  await win.evaluate(() => {
    const b = document.querySelector('.hexa-text-plate-btn')
    b?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
  await win.waitForTimeout(100)
  const apercu = await win.evaluate(() => document.querySelector('.hexa-text')?.classList.contains('no-plate'))
  await win.keyboard.type('SANS PLAQUE')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(450)
  await capturer('deux-textes')
  const t2 = await traits()
  // LA MESURE : les pixels SOMBRES et OPAQUES autour de chaque texte. La
  // plaque en met des milliers (tout le pavé), le contour du texte nu n'en
  // met que quelques centaines (le liseré des lettres). Le simple comptage
  // d'encre ne distingue rien : le halo couvre la même surface dans les deux cas.
  const sombres = (y) =>
    win.evaluate((yc) => {
      const cv = document.querySelectorAll('.stage canvas')[1]
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const ctx = cv.getContext('2d')
      const x0 = Math.round(380 * dpr)
      const y0 = Math.round((yc - 40) * dpr)
      const d = ctx.getImageData(x0, y0, Math.round(420 * dpr), Math.round(80 * dpr)).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 150 && Math.max(d[i], d[i + 1], d[i + 2]) < 60) n++
      }
      return n
    }, y)
  const sombresAvec = await sombres(300)
  const sombresSans = await sombres(500)
  const sans = sombresSans
  const defaut = (await etatUi()).textPlate
  // troisième texte : le défaut a suivi, sans rien toucher
  await clic(400, 650)
  await win.keyboard.type('SUIVANT')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(450)
  const t3 = await traits()
  // on remet le défaut à « plaque » pour la suite (dans le champ, comme l'utilisateur)
  await clic(900, 650)
  await win.evaluate(() =>
    document
      .querySelector('.hexa-text-plate-btn')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
  )
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  const defautApres = (await etatUi()).textPlate
  const sansTexte = t2.find((s) => s.text === 'SANS PLAQUE')
  const suivant = t3.find((s) => s.text === 'SUIVANT')
  return {
    statut:
      t1.length === 1 &&
      t1[0].plate !== false &&
      boutonPresent &&
      apercu === true &&
      sansTexte?.plate === false &&
      sombresAvec > 2000 &&
      sombresSans > 0 &&
      sombresSans < sombresAvec * 0.35 &&
      defaut === false &&
      suivant?.plate === false &&
      defautApres === true
        ? OK
        : KO,
    detail: `texte 1 (plaque) : ${avec} px d'encre, ${sombresAvec} px sombres opaques · bouton dans le champ : ${boutonPresent ? 'oui' : 'NON'}, aperçu sans plaque : ${apercu} · texte 2 sans plaque : ${sans} px sombres (plate=${String(sansTexte?.plate)}) · défaut persisté : ${defaut} → texte 3 plate=${String(suivant?.plate)} · défaut remis : ${defautApres}`,
  }
})

/* ================================================================== *
 * 5. ÉPINGLER
 * ================================================================== */

await rapport.test(win, 'sB-5-epingler', 'Ctrl + clic droit épingle : survit à « tout effacer », au fondu et au changement de page', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 600, 400, 10))
  await win.keyboard.press('p')
  await tracer(win, segment(300, 600, 700, 640, 8))
  await win.waitForTimeout(300)
  const avant = await traits()
  await clicDroitCtrl(450, 200) // le bord haut du rectangle
  await win.waitForTimeout(150)
  const vif = (await encre(win)).vif
  await capturer('epingle')
  const apresPin = await traits()
  const epingle = apresPin.find((s) => s.tool === 'rect')
  const nb = await win.evaluate(() => window.hexaEngine.nbEpingles)
  // 1. tout effacer
  await toutEffacer(win)
  const apresClear = await traits()
  // 2. fondu 2 s
  await win.keyboard.press('d')
  await win.waitForTimeout(2800)
  const apresFondu = await traits()
  await win.keyboard.press('d')
  await win.keyboard.press('d')
  await win.keyboard.press('d')
  // 3. changement de page
  await win.keyboard.press('Control+Shift+n')
  await win.waitForTimeout(400)
  const surPage2 = await traits()
  const pg = await page()
  // le signal du geste ne laisse rien sur la couche vive
  await win.waitForTimeout(900)
  const vifApres = (await encre(win)).vif
  // 4. détacher au clavier, sous le curseur
  await win.mouse.move(450, 200)
  await win.keyboard.press('Control+Shift+p')
  await win.waitForTimeout(200)
  const detache = await traits()
  await win.keyboard.press('PageUp')
  await win.waitForTimeout(300)
  return {
    statut:
      avant.length === 2 &&
      !avant.some((s) => s.pinned) &&
      epingle?.pinned === true &&
      nb === 1 &&
      vif > 0 &&
      apresClear.length === 1 &&
      apresClear[0].pinned &&
      apresFondu.length === 1 &&
      surPage2.length === 1 &&
      surPage2[0].pinned &&
      pg.index === 3 &&
      vifApres === 0 &&
      detache.length === 1 &&
      detache[0].pinned === false
        ? OK
        : KO,
    detail: `2 annotations, Ctrl+clic droit sur le rectangle → pinned=${epingle?.pinned}, ${nb} épinglée, signal vif ${vif} px · tout effacer : ${apresClear.length} reste (épinglée : ${apresClear[0]?.pinned}) · fondu 2 s puis 2,8 s : ${apresFondu.length} · nouvelle page ${pg.index + 1} : ${surPage2.length} (épinglée : ${surPage2[0]?.pinned}) · couche vive après le signal : ${vifApres} px · Ctrl+Maj+P : pinned=${detache[0]?.pinned}`,
  }
})

/* ================================================================== *
 * 4. BARRE QUI S'EFFACE
 * ================================================================== */

await rapport.test(win, 'sB-4-barre-discrete', 'La barre s’estompe après le délai et revient à l’approche de la souris', async (capturer) => {
  await etatDeDepart(win, { toolbarFade: 1 })
  await win.mouse.move(900, 500)
  await win.keyboard.press('p')
  const opaciteAvant = await win.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  await win.waitForTimeout(2200)
  const dim = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  const opaciteDim = await win.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  await capturer('estompee')
  // un mouvement LOIN de la barre ne la rallume pas
  await win.mouse.move(1100, 600)
  await win.waitForTimeout(250)
  const toujoursDim = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  // on s'approche : elle revient avant même d'être touchée
  const r = await win.evaluate(() => {
    const b = document.querySelector('.toolbar').getBoundingClientRect()
    return { x: b.right + 40, y: b.top + b.height / 2 }
  })
  await win.mouse.move(r.x, r.y)
  await win.waitForTimeout(300)
  const revenue = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  const opaciteRevenue = await win.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity)
  // une frappe (changement d'outil) la rallume aussi
  await win.mouse.move(1100, 600)
  await win.waitForTimeout(1800)
  const dim2 = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  await win.keyboard.press('r')
  await win.waitForTimeout(200)
  const apresFrappe = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  // réglage coupé : elle ne s'estompe plus jamais
  const chip = await win.evaluate(() =>
    [...document.querySelectorAll('.toolbar .tbtn')].some((b) => /Barre discrète/.test(b.getAttribute('title') ?? '')),
  )
  await etatDeDepart(win, { toolbarFade: 0 })
  await win.mouse.move(1100, 600)
  await win.waitForTimeout(1800)
  const jamais = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  return {
    statut:
      Number(opaciteAvant) === 1 &&
      dim &&
      Number(opaciteDim) < 0.4 &&
      toujoursDim &&
      !revenue &&
      Number(opaciteRevenue) > 0.9 &&
      dim2 &&
      !apresFrappe &&
      chip &&
      !jamais
        ? OK
        : KO,
    detail: `réglage 1 s : opacité ${opaciteAvant} → après 2,2 s : is-dim=${dim}, opacité ${opaciteDim} · souris loin : reste estompée ${toujoursDim} · souris à 40 px : is-dim=${revenue}, opacité ${opaciteRevenue} · estompée à nouveau ${dim2}, touche R → is-dim=${apresFrappe} · bouton de réglage : ${chip ? 'oui' : 'NON'} · réglage 0 : is-dim=${jamais}`,
  }
})

await rapport.test(win, 'sB-4b-barre-tient-a-l-ecran', 'Avec ses nouveaux boutons, la barre verticale tient dans un écran de 900 px sans défiler', async () => {
  const m = await win.evaluate(() => {
    const el = document.querySelector('.toolbar')
    const r = el.getBoundingClientRect()
    return {
      haut: Math.round(r.height),
      ecran: window.innerHeight,
      defile: el.scrollHeight > el.clientHeight + 1,
      boutons: el.querySelectorAll('.tbtn').length,
      vertical: el.classList.contains('vertical'),
    }
  })
  return {
    statut: m.vertical && !m.defile && m.haut < m.ecran ? OK : KO,
    detail: `${m.boutons} boutons, barre ${m.vertical ? 'verticale' : 'horizontale'} de ${m.haut} px sur un écran de ${m.ecran} px · défile : ${m.defile ? 'OUI (trop haute)' : 'non'}`,
  }
})

/* ================================================================== *
 * 6. AU REPOS : 0 IMAGE
 * ================================================================== */

await rapport.test(win, 'sB-6-repos', 'Deux pages, une épinglée, un texte, la barre estompée : 0 image au repos', async () => {
  await etatDeDepart(win, { toolbarFade: 1 })
  // le compteur rAF est posé sur la fenêtre rechargée
  await win.evaluate(() => {
    window.__hexaFrames = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      window.__hexaFrames++
      return orig(cb)
    }
  })
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 600, 400, 10))
  await clicDroitCtrl(450, 200)
  await win.keyboard.press('t')
  await clic(400, 600)
  await win.keyboard.type('LÉGENDE')
  await win.keyboard.press('Enter')
  await win.keyboard.press('Control+Shift+n')
  await win.keyboard.press('p')
  await tracer(win, segment(300, 300, 700, 380, 8))
  await win.mouse.move(1100, 600)
  await win.waitForTimeout(2500)
  const n = await images(4000)
  const anims = await win.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const it = a.effect?.getComputedTiming?.().iterations
        return it === Infinity || it > 500
      }).length,
  )
  const dim = await win.evaluate(() => document.querySelector('.toolbar').classList.contains('is-dim'))
  const pg = await page()
  const nb = await win.evaluate(() => window.hexaEngine.nbEpingles)
  return {
    statut: n === 0 && anims === 0 ? OK : KO,
    detail: `page ${pg.index + 1}/${pg.count}, ${nb} épinglée, barre estompée : ${dim} → ${n} image(s) rAF en 4 s, ${anims} animation perpétuelle (attendu 0 et 0)`,
  }
})

process.stdout.write(`erreurs de page : ${journal.erreurs.length} · erreurs console : ${journal.consoleErreurs.length}\n`)
if (journal.erreurs.length) process.stdout.write(journal.erreurs.join('\n') + '\n')
if (journal.consoleErreurs.length) process.stdout.write(journal.consoleErreurs.slice(0, 5).join('\n') + '\n')
process.stdout.write(rapport.tableau() + '\n')
writeFileSync(join(CAPTURES, 'sB-resultats.txt'), rapport.tableau())
await app.close()
process.exit(rapport.codeSortie)
