/**
 * Hexa — campagne « ultra intuitif » (S7).
 *
 * On vérifie dans la VRAIE application Electron ce qu'un utilisateur qui n'est
 * pas développeur doit trouver tout seul :
 *
 *   tour     · la découverte du premier lancement, étape par étape, chacune
 *              validée par le geste réellement fait
 *   aide     · le panneau d'aide de la touche ?, ses quatre onglets, ses
 *              raccourcis lus dans le clavier ACTIF, sa fermeture par Échap
 *   roue     · le menu radial : clic droit maintenu dans le vide = la roue,
 *              clic droit sur une annotation = déplacement. Jamais l'inverse.
 *   etats    · à tout instant on voit l'outil, la couleur, le fondu (∞) et le
 *              mode dessin / mode jeu
 *   impasses · aucun état dont on ne sait pas sortir
 *
 * Usage :
 *   node test/e2e/s7-intuitivite.mjs [tour|aide|roue|etats|impasses]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPTURES,
  KO,
  OK,
  Rapport,
  encre,
  etat,
  etatDeDepart,
  lancerHexa,
  preparerCaptures,
  segment,
  tracer,
} from './harness.mjs'

const seulement = process.argv.slice(2).find((a) => !a.startsWith('-'))
const veut = (nom) => !seulement || seulement === nom

/* ------------------------------------------------------------------ *
 * Lecture de l'interface — on lit ce que l'utilisateur lit, du texte
 * ------------------------------------------------------------------ */

/** Étape courante de la découverte : { numero, total, titre, consigne } */
const etapeTour = (win) =>
  win.evaluate(() => {
    const carte = document.querySelector('.onb-card')
    if (!carte) return null
    const eyebrow = carte.querySelector('.onb-eyebrow')?.textContent ?? ''
    const m = /(\d+)\s+sur\s+(\d+)/.exec(eyebrow)
    return {
      numero: m ? Number(m[1]) : -1,
      total: m ? Number(m[2]) : -1,
      titre: carte.querySelector('.onb-title')?.textContent ?? '',
      consigne: carte.querySelector('.onb-cue')?.textContent ?? '',
      touches: [...carte.querySelectorAll('.onb-key kbd')].map((k) => k.textContent),
    }
  })

/** Attend que la découverte affiche l'étape n (elle avance après une fanfare). */
async function attendreEtape(win, n, msMax = 4000) {
  const t0 = Date.now()
  for (;;) {
    const e = await etapeTour(win)
    if (e && e.numero === n) return e
    if (Date.now() - t0 > msMax) return e
    await win.waitForTimeout(120)
  }
}

const infoAide = (win) =>
  win.evaluate(() => {
    const p = document.querySelector('.hlp')
    if (!p) return null
    return {
      onglets: [...p.querySelectorAll('.hlp-tab')].map((b) => b.textContent),
      actif: p.querySelector('.hlp-tab.is-on')?.textContent ?? '',
      touches: [...p.querySelectorAll('.hlp-kbd')].map((k) => k.textContent),
      titres: [...p.querySelectorAll('h4')].map((h) => h.textContent),
      texte: p.innerText,
      anglais: /\b(Settings|Close|Undo|Redo|Clear all|Toolbar|Shortcuts|Help)\b/.test(p.innerText),
    }
  })

const etatHud = (win) =>
  win.evaluate(() => {
    const pastille = document.querySelector('.hx-status')
    const toast = document.querySelector('.hx-toast')
    return {
      pastille: pastille ? pastille.innerText.replace(/\n/g, ' ') : null,
      toast: toast ? toast.innerText.replace(/\n/g, ' ') : null,
      liseré: !!document.querySelector('.edge-glow'),
      barre: !!document.querySelector('.toolbar'),
      traversant: document.body.classList.contains('passthrough'),
    }
  })

/* ------------------------------------------------------------------ *
 * Campagne
 * ------------------------------------------------------------------ */

preparerCaptures()
const rapport = new Rapport()
const { app, win, journal } = await lancerHexa({ profil: 's7' })

try {
  /* ---------------- 1. La découverte du premier lancement ---------------- */
  if (veut('tour')) {
    await etatDeDepart(win, { onboarded: false })

    await rapport.test(win, 's7-tour-01-etape1', 'Découverte : 5 étapes, la 1re s’affiche', async () => {
      const e = await etapeTour(win)
      if (!e) return { statut: KO, detail: 'aucune carte de découverte au premier lancement' }
      return {
        statut: e.numero === 1 && e.total === 5 ? OK : KO,
        detail: `étape ${e.numero}/${e.total} · « ${e.titre} » · consigne « ${e.consigne} »`,
      }
    })

    await rapport.test(win, 's7-tour-02-trait', 'Étape 1 validée par un vrai trait', async () => {
      await tracer(win, segment(420, 620, 900, 500, 22))
      const e = await attendreEtape(win, 2)
      const i = await encre(win)
      return {
        statut: e?.numero === 2 ? OK : KO,
        detail: `${i.total} px d’encre posés → étape ${e?.numero} « ${e?.titre} »`,
      }
    })

    await rapport.test(win, 's7-tour-03-couleur', 'Étape 2 validée par un changement de couleur', async () => {
      const avant = await etapeTour(win)
      await win.keyboard.press('4')
      const e = await attendreEtape(win, 3)
      const st = await etat(win)
      return {
        statut: e?.numero === 3 ? OK : KO,
        detail: `touches montrées ${JSON.stringify(avant?.touches)} · couleur ${st.color} → étape ${e?.numero}`,
      }
    })

    await rapport.test(win, 's7-tour-04-effacer', 'Étape 3 validée par un effacement réel', async () => {
      const avant = await etapeTour(win)
      await win.keyboard.press('Control+e')
      const e = await attendreEtape(win, 4)
      const i = await encre(win)
      return {
        statut: e?.numero === 4 && i.total === 0 ? OK : KO,
        detail: `touches montrées ${JSON.stringify(avant?.touches)} · encre restante ${i.total} → étape ${e?.numero}`,
      }
    })

    await rapport.test(win, 's7-tour-05-roue', 'Étape 4 validée par l’ouverture réelle de la roue', async (capturer) => {
      await win.mouse.move(760, 420)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(420)
      const roue = await win.evaluate(() => !!document.querySelector('.radial'))
      await capturer('roue-ouverte')
      // on glisse comme un vrai utilisateur : la validation ne doit PAS être
      // annulée par le mouvement qui suit l'ouverture
      await win.mouse.move(760, 330, { steps: 6 })
      await win.waitForTimeout(120)
      await win.mouse.up({ button: 'right' })
      const e = await attendreEtape(win, 5)
      return {
        statut: roue && e?.numero === 5 ? OK : KO,
        detail: `roue ouverte ${roue} → étape ${e?.numero} « ${e?.titre} »`,
      }
    })

    await rapport.test(win, 's7-tour-06-stream', 'Étape 5 : le stream, puis la sortie propre', async (capturer) => {
      const e = await etapeTour(win)
      const parleStream = /OBS|Capture d’écran/i.test(
        await win.evaluate(() => document.querySelector('.onb-card')?.innerText ?? ''),
      )
      await capturer('carte-stream')
      await win.keyboard.press('F8') // rendre la souris au jeu
      await win.waitForTimeout(1800)
      const fini = await win.evaluate(() => !document.querySelector('.onb-card'))
      const st = await etat(win)
      // on revient en mode dessin pour la suite de la campagne
      await win.keyboard.press('F8')
      await win.waitForTimeout(300)
      return {
        statut: parleStream && fini && st.onboarded === true ? OK : KO,
        detail: `étape ${e?.numero} parle du stream ${parleStream} · découverte terminée ${fini} · mémorisée ${st.onboarded}`,
      }
    })

    await rapport.test(win, 's7-tour-07-echap', 'Échap saute la découverte', async () => {
      await etatDeDepart(win, { onboarded: false })
      const avant = await win.evaluate(() => !!document.querySelector('.onb-card'))
      await win.keyboard.press('Escape')
      await win.waitForTimeout(700)
      const apres = await win.evaluate(() => !!document.querySelector('.onb-card'))
      return {
        statut: avant && !apres ? OK : KO,
        detail: `carte avant ${avant} · après Échap ${apres}`,
      }
    })
  }

  /* ---------------------------- 2. Le panneau d'aide ---------------------------- */
  if (veut('aide')) {
    await etatDeDepart(win)

    await rapport.test(win, 's7-aide-01-ouvre', 'La touche ? ouvre l’aide', async () => {
      await win.keyboard.press('Shift+,')
      await win.waitForTimeout(500)
      const a = await infoAide(win)
      return {
        statut: a && a.onglets.length === 4 ? OK : KO,
        detail: a ? `onglets ${JSON.stringify(a.onglets)} · actif « ${a.actif} »` : 'panneau absent',
      }
    })

    await rapport.test(win, 's7-aide-02-gestes', 'Onglet « Les gestes » : les 6 gestes vitaux', async () => {
      const a = await infoAide(win)
      const attendus = ['Dessiner', 'Effacer', 'Déplacer', 'couleur', 'Épaissir', 'Rendre la souris']
      const manque = attendus.filter((m) => !a.texte.includes(m))
      return {
        statut: manque.length === 0 ? OK : KO,
        detail: `manquants ${JSON.stringify(manque)} · touches lues ${JSON.stringify(a.touches.slice(0, 6))}`,
      }
    })

    await rapport.test(win, 's7-aide-03-clavier', 'Onglet « Raccourcis » : le clavier ACTIF', async () => {
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Raccourcis')?.click(),
      )
      await win.waitForTimeout(320)
      const a = await infoAide(win)
      // preset Epic Pen : ces combinaisons doivent apparaître telles quelles
      const attendus = ['Ctrl + Maj + 3', 'Ctrl + E', 'Ctrl + H', 'Ctrl + Maj + 2']
      const manque = attendus.filter((k) => !a.touches.includes(k))
      return {
        statut: manque.length === 0 ? OK : KO,
        detail: `${a.touches.length} touches affichées · manquantes ${JSON.stringify(manque)}`,
      }
    })

    await rapport.test(win, 's7-aide-04-remap', 'Un remap se voit immédiatement dans l’aide', async () => {
      // l'utilisateur remappe « Rectangle » sur Y : l'aide doit le dire
      await win.evaluate(() => {
        const brut = JSON.parse(localStorage.getItem('hexa-ui'))
        brut.state.keymapOverrides = { 'tool.rect': 'y' }
        localStorage.setItem('hexa-ui', JSON.stringify(brut))
      })
      await win.reload()
      await win.waitForSelector('.toolbar')
      await win.waitForTimeout(600)
      await win.keyboard.press('Shift+,')
      await win.waitForTimeout(400)
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Raccourcis')?.click(),
      )
      await win.waitForTimeout(300)
      const ligne = await win.evaluate(() => {
        const l = [...document.querySelectorAll('.hlp-line')].find((d) =>
          (d.querySelector('dt')?.textContent ?? '').startsWith('Rectangle'),
        )
        return l ? l.innerText.replace(/\n/g, ' ') : null
      })
      // on rend son clavier à l'utilisateur
      await win.evaluate(() => {
        const brut = JSON.parse(localStorage.getItem('hexa-ui'))
        brut.state.keymapOverrides = {}
        localStorage.setItem('hexa-ui', JSON.stringify(brut))
      })
      return {
        statut: ligne && ligne.includes('Y') ? OK : KO,
        detail: `ligne Rectangle : « ${ligne} »`,
      }
    })

    await rapport.test(win, 's7-aide-05-stream', 'Onglet « Sur mon stream » : le vrai piège est dit', async () => {
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Sur mon stream')?.click(),
      )
      await win.waitForTimeout(320)
      const t = await win.evaluate(() => document.querySelector('.hlp')?.innerText ?? '')
      const ok = /Capture d’écran/.test(t) && /Capture de jeu/.test(t)
      return { statut: ok ? OK : KO, detail: ok ? 'écran ✔ / jeu ✘ expliqués' : 'explication OBS incomplète' }
    })

    await rapport.test(win, 's7-aide-06-secours', 'Onglet « Au secours » : les symptômes réels', async () => {
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Au secours')?.click(),
      )
      await win.waitForTimeout(320)
      const a = await infoAide(win)
      const attendus = ['barre d’outils a disparu', 'plus cliquer dans mon jeu', 's’effacent tout seuls']
      const manque = attendus.filter((m) => !a.texte.includes(m))
      return {
        statut: manque.length === 0 && !a.anglais ? OK : KO,
        detail: `manquants ${JSON.stringify(manque)} · reste d’anglais ${a.anglais}`,
      }
    })

    await rapport.test(win, 's7-aide-07-fiche', 'Fiche imprimable, puis Échap rend l’aide', async (capturer) => {
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Raccourcis')?.click(),
      )
      await win.waitForTimeout(250)
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-btn')].find((b) => b.textContent === 'Fiche imprimable')?.click(),
      )
      await win.waitForTimeout(400)
      const fiche = await win.evaluate(() => !!document.querySelector('.shs'))
      await capturer('fiche')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(350)
      const apres = await win.evaluate(() => ({
        fiche: !!document.querySelector('.shs'),
        aide: !!document.querySelector('.hlp'),
      }))
      return {
        statut: fiche && !apres.fiche && apres.aide ? OK : KO,
        detail: `fiche ouverte ${fiche} · après Échap fiche ${apres.fiche} / aide ${apres.aide}`,
      }
    })

    await rapport.test(win, 's7-aide-08-echap', 'Échap ferme l’aide et rend l’écran', async () => {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(350)
      const reste = await win.evaluate(() => ({
        aide: !!document.querySelector('.hlp'),
        scrim: !!document.querySelector('.hlp-scrim'),
      }))
      return {
        statut: !reste.aide && !reste.scrim ? OK : KO,
        detail: `aide ${reste.aide} · voile ${reste.scrim}`,
      }
    })
  }

  /* ---------------------------- 3. Le menu radial ---------------------------- */
  if (veut('roue')) {
    await etatDeDepart(win)

    await rapport.test(win, 's7-roue-01-vide', 'Clic droit maintenu dans le vide : la roue', async (capturer) => {
      await win.mouse.move(820, 430)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(300)
      const ouverte = await win.evaluate(() => !!document.querySelector('.radial'))
      await capturer('roue')
      await win.mouse.up({ button: 'right' })
      await win.waitForTimeout(400)
      const refermee = await win.evaluate(() => !document.querySelector('.radial'))
      return {
        statut: ouverte && refermee ? OK : KO,
        detail: `ouverte ${ouverte} · refermée au relâché ${refermee}`,
      }
    })

    await rapport.test(win, 's7-roue-02-choix', 'On glisse vers un secteur, on relâche : c’est choisi', async (capturer) => {
      await win.mouse.move(820, 430)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(300)
      // secteur du haut = premier outil de la roue (Pinceau) ; on vise le
      // secteur situé deux crans plus loin pour changer réellement d'outil
      await win.mouse.move(820 + 92, 430 - 38, { steps: 8 })
      await win.waitForTimeout(160)
      const survol = await win.evaluate(
        () => document.querySelector('.radial-label')?.textContent ?? '',
      )
      await capturer('survol')
      await win.mouse.up({ button: 'right' })
      await win.waitForTimeout(500)
      const st = await etat(win)
      return {
        statut: survol.length > 0 && st.tool !== 'pen' ? OK : KO,
        detail: `secteur survolé « ${survol} » · outil après relâché ${st.tool}`,
      }
    })

    await rapport.test(win, 's7-roue-03-annotation', 'Clic droit SUR une annotation : déplacement, pas de roue', async (capturer) => {
      await etatDeDepart(win)
      await tracer(win, segment(500, 500, 900, 500, 20))
      await win.waitForTimeout(500)
      const avant = (await encre(win)).boite
      // on attrape le trait et on le maintient bien plus longtemps que les
      // 220 ms d'ouverture de la roue : elle ne doit PAS apparaître
      await win.mouse.move(700, 500)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(520)
      const roue = await win.evaluate(() => !!document.querySelector('.radial'))
      await win.mouse.move(700, 680, { steps: 10 })
      await win.waitForTimeout(160)
      await capturer('deplacement')
      await win.mouse.up({ button: 'right' })
      await win.waitForTimeout(450)
      const apres = (await encre(win)).boite
      const dy = apres && avant ? apres.y - avant.y : 0
      return {
        statut: !roue && dy > 140 ? OK : KO,
        detail: `roue ouverte ${roue} (doit être false) · annotation déplacée de ${dy} px`,
      }
    })

    await rapport.test(win, 's7-roue-04-clic-sec', 'Clic droit bref dans le vide : rien du tout', async () => {
      await etatDeDepart(win)
      await win.mouse.move(600, 380)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(60)
      await win.mouse.up({ button: 'right' })
      await win.waitForTimeout(400)
      const r = await win.evaluate(() => ({
        roue: !!document.querySelector('.radial'),
        menu: !!document.querySelector('menu'),
      }))
      const i = await encre(win)
      return {
        statut: !r.roue && i.total === 0 ? OK : KO,
        detail: `roue ${r.roue} · encre ${i.total}`,
      }
    })

    await rapport.test(win, 's7-roue-05-echap', 'Échap referme la roue', async () => {
      await win.mouse.move(700, 400)
      await win.mouse.down({ button: 'right' })
      await win.waitForTimeout(300)
      const ouverte = await win.evaluate(() => !!document.querySelector('.radial'))
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
      const apres = await win.evaluate(() => !!document.querySelector('.radial'))
      await win.mouse.up({ button: 'right' })
      await win.waitForTimeout(200)
      return {
        statut: ouverte && !apres ? OK : KO,
        detail: `ouverte ${ouverte} · après Échap ${apres}`,
      }
    })
  }

  /* ---------------------------- 4. Lisibilité des états ---------------------------- */
  if (veut('etats')) {
    await etatDeDepart(win)

    await rapport.test(win, 's7-etat-01-barre', 'Barre visible : outil, couleur et fondu lisibles', async () => {
      const lu = await win.evaluate(() => {
        const actif = document.querySelector('.toolbar .tbtn.active')
        const pastille = document.querySelector('.toolbar .chip .chip-label')
        const couleur = document.querySelector('.toolbar .swatch.active')
        return {
          outil: (actif?.getAttribute('title') ?? '').split('—')[0].trim(),
          fondu: pastille?.textContent ?? null,
          couleur: couleur ? getComputedStyle(couleur).getPropertyValue('--c').trim() : null,
        }
      })
      return {
        statut: lu.outil && lu.fondu && lu.couleur ? OK : KO,
        detail: `outil « ${lu.outil} » · fondu « ${lu.fondu} » · couleur ${lu.couleur}`,
      }
    })

    await rapport.test(win, 's7-etat-02-pastille', 'Barre masquée : la pastille d’état prend le relais', async (capturer) => {
      await win.keyboard.press('Control+h')
      await win.waitForTimeout(500)
      const h = await etatHud(win)
      await capturer('pastille')
      return {
        statut: !h.barre && h.pastille && /∞/.test(h.pastille) ? OK : KO,
        detail: `barre ${h.barre} · pastille « ${h.pastille} »`,
      }
    })

    await rapport.test(win, 's7-etat-03-message', 'Masquer la barre annonce la touche du retour', async () => {
      await win.keyboard.press('Control+h') // on la rend
      await win.waitForTimeout(300)
      await win.keyboard.press('Control+h') // on la remasque : message frais
      await win.waitForTimeout(300)
      const h = await etatHud(win)
      const ok = h.toast && /Ctrl \+ H/.test(h.toast)
      await win.keyboard.press('Control+h')
      await win.waitForTimeout(400)
      return { statut: ok ? OK : KO, detail: `message « ${h.toast} »` }
    })

    await rapport.test(win, 's7-etat-04-jeu', 'Mode jeu : message explicite et écran net', async (capturer) => {
      await win.keyboard.press('F8')
      await win.waitForTimeout(400)
      const h = await etatHud(win)
      await capturer('mode-jeu')
      const ok = h.traversant && !h.liseré && h.toast && /F8/.test(h.toast)
      // 3 s plus tard, l'écran doit être redevenu parfaitement net
      await win.waitForTimeout(2800)
      const apres = await etatHud(win)
      await capturer('mode-jeu-apres')
      await win.keyboard.press('F8')
      await win.waitForTimeout(400)
      const retour = await etatHud(win)
      return {
        statut: ok && !apres.toast && retour.liseré ? OK : KO,
        detail: `message « ${h.toast} » · liseré ${h.liseré}→${retour.liseré} · message effacé après 3 s ${!apres.toast}`,
      }
    })

    await rapport.test(win, 's7-etat-05-fondu', 'Changer le fondu se voit et s’explique', async () => {
      await win.keyboard.press('d')
      await win.waitForTimeout(400)
      const h = await etatHud(win)
      const chip = await win.evaluate(
        () => document.querySelector('.toolbar .chip .chip-label')?.textContent ?? '',
      )
      const st = await etat(win)
      return {
        statut: h.toast && chip ? OK : KO,
        detail: `fondu ${st.fadeDelay} · pastille barre « ${chip} » · message « ${h.toast} »`,
      }
    })
  }

  /* ---------------------------- 5. Les culs-de-sac ---------------------------- */
  if (veut('impasses')) {
    await etatDeDepart(win)

    await rapport.test(win, 's7-impasse-01-echap', 'Échap ramène à l’état neutre', async () => {
      await win.keyboard.press('Control+,') // réglages
      await win.waitForTimeout(500)
      await win.keyboard.press('Shift+,') // aide par-dessus
      await win.waitForTimeout(400)
      const ouverts = await win.evaluate(() => ({
        reglages: !!document.querySelector('.hx-panel, .settings, .hx-settings'),
        aide: !!document.querySelector('.hlp'),
      }))
      await win.keyboard.press('Escape')
      await win.waitForTimeout(350)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(500)
      const reste = await win.evaluate(() =>
        [...document.querySelectorAll('.hlp, .shs, .hx-panel, .settings, .hx-settings')].map(
          (n) => n.className,
        ),
      )
      return {
        statut: ouverts.aide && reste.length === 0 ? OK : KO,
        detail: `ouverts ${JSON.stringify(ouverts)} · panneaux restants après 2× Échap ${JSON.stringify(reste)}`,
      }
    })

    await rapport.test(win, 's7-impasse-02-momentane', 'Outil momentané coincé : la perte de focus le rend', async () => {
      await win.evaluate(() => {
        // on simule exactement le scénario réel : la touche part, le
        // relâchement n'arrive jamais parce que le focus a changé
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ' }))
      })
      await win.waitForTimeout(300)
      const pendant = (await etat(win)).tool
      await win.evaluate(() => window.dispatchEvent(new Event('blur')))
      await win.waitForTimeout(400)
      const apres = (await etat(win)).tool
      return {
        statut: pendant === 'laser' && apres === 'pen' ? OK : KO,
        detail: `outil pendant le maintien ${pendant} · après perte de focus ${apres}`,
      }
    })

    await rapport.test(win, 's7-impasse-03-panneau-en-jeu', 'Ouvrir l’aide en mode jeu reprend la main', async () => {
      await win.keyboard.press('F8')
      await win.waitForTimeout(400)
      const avant = await win.evaluate(() => document.body.classList.contains('passthrough'))
      await win.keyboard.press('Shift+,')
      await win.waitForTimeout(500)
      const apres = await win.evaluate(() => ({
        traversant: document.body.classList.contains('passthrough'),
        aide: !!document.querySelector('.hlp'),
      }))
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
      return {
        statut: avant && apres.aide && !apres.traversant ? OK : KO,
        detail: `mode jeu avant ${avant} · aide ouverte ${apres.aide} · encore traversant ${apres.traversant}`,
      }
    })

    await rapport.test(win, 's7-impasse-04-tour-rejouable', 'La découverte se rejoue depuis l’aide', async (capturer) => {
      await win.keyboard.press('Shift+,')
      await win.waitForTimeout(400)
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')].find((b) => b.textContent === 'Au secours')?.click(),
      )
      await win.waitForTimeout(300)
      const clic = await win.evaluate(() => {
        const b = [...document.querySelectorAll('.hlp-btn')].find(
          (x) => x.textContent === 'Rejouer la découverte guidée',
        )
        if (!b) return false
        b.click()
        return true
      })
      await win.waitForTimeout(700)
      const e = await etapeTour(win)
      await capturer('tour-rejoue')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(600)
      return {
        statut: clic && e?.numero === 1 ? OK : KO,
        detail: `bouton présent ${clic} · découverte relancée à l’étape ${e?.numero}`,
      }
    })

    await rapport.test(win, 's7-impasse-05-spotlight', 'Échap sort du spotlight et du gel d’image', async (capturer) => {
      await etatDeDepart(win)
      // spotlight posé depuis la BARRE (donc permanent, pas momentané) :
      // l'écran s'assombrit et rien ne dit comment revenir
      await win.evaluate(() =>
        [...document.querySelectorAll('.toolbar .tbtn')]
          .find((b) => (b.getAttribute('title') ?? '').startsWith('Spotlight'))
          ?.click(),
      )
      await win.mouse.move(700, 400)
      await win.waitForTimeout(400)
      const pendant = (await etat(win)).tool
      await capturer('spotlight')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(500)
      const apres = (await etat(win)).tool
      return {
        statut: pendant === 'spotlight' && apres === 'pen' ? OK : KO,
        detail: `outil ${pendant} → après Échap ${apres}`,
      }
    })

    await rapport.test(win, 's7-impasse-06-zero-erreur', 'Aucune erreur de page pendant toute la campagne', async () => {
      return {
        statut: journal.erreurs.length === 0 ? OK : KO,
        detail: `${journal.erreurs.length} erreur(s) : ${journal.erreurs.slice(0, 3).join(' | ')}`,
      }
    })
  }
} finally {
  const texte = rapport.tableau()
  console.log(texte)
  writeFileSync(join(CAPTURES, 's7-resultats.txt'), texte, 'utf8')
  await app.close()
  process.exit(rapport.codeSortie)
}
