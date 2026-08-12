/**
 * Hexa — sons génératifs (§16.7 du brief : « Ne pas mettre de son par défaut
 * sur les effets. Optionnel et coupé au départ. »).
 *
 * Tout est synthétisé à la volée avec WebAudio : AUCUN fichier, aucune
 * ressource réseau, rien à télécharger. L'application reste parfaitement
 * fonctionnelle hors ligne et le binaire ne grossit pas d'un octet.
 *
 * Règles de performance (§13) :
 *  - l'AudioContext est créé PARESSEUSEMENT, au premier son réellement joué,
 *    donc forcément à l'intérieur d'un geste utilisateur (exigence navigateur) ;
 *  - aucun oscillateur ne tourne en continu : chaque voix est créée, planifiée,
 *    puis `stop()` la détruit ;
 *  - après 1,8 s de silence, le contexte est suspendu (0 % de processeur au
 *    repos) et repris au son suivant. Un seul minuteur, jamais d'intervalle.
 */

/** durée de silence avant mise en veille du contexte audio */
const SLEEP_MS = 1800

/** gamme pentatonique (Do dièse mineur) : n'importe quelle combinaison sonne juste */
const SCALE = [554.37, 622.25, 739.99, 830.61, 932.33, 1108.73, 1244.51]

class HexaAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private sleepTimer: ReturnType<typeof setTimeout> | null = null
  private enabled = false
  private volume = 0.6
  /** index de voix, pour varier légèrement la hauteur d'un son à l'autre */
  private seq = 0

  /** activation globale — coupé au départ, comme l'exige le brief */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.sleepNow()
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume * 0.34, this.ctx.currentTime, 0.02)
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** libère tout (démontage) */
  dispose(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.noiseBuf = null
  }

  /* ------------------------------------------------------------------ *
   * Voix
   * ------------------------------------------------------------------ */

  /** sélection d'outil : une micro-cloche cristalline, très courte */
  tool(seed = 0): void {
    const c = this.ensure()
    if (!c) return
    const f = SCALE[(seed + this.seq++) % SCALE.length]
    const t = c.currentTime
    this.bell(t, f, 0.34, 0.16)
    this.bell(t + 0.012, f * 2.01, 0.1, 0.1)
  }

  /** changement de couleur : plus haut, plus discret que la sélection d'outil */
  color(seed = 0): void {
    const c = this.ensure()
    if (!c) return
    this.bell(c.currentTime, SCALE[seed % SCALE.length] * 2, 0.16, 0.1)
  }

  /** ouverture du menu radial : petit souffle montant */
  wheelOpen(): void {
    const c = this.ensure()
    if (!c) return
    const t = c.currentTime
    this.sweep(t, 320, 980, 0.16, 0.11, 'triangle')
    this.bell(t + 0.05, SCALE[4], 0.12, 0.12)
  }

  /** fermeture sans sélection : la même chose à l'envers, encore plus discrète */
  wheelCancel(): void {
    const c = this.ensure()
    if (!c) return
    this.sweep(c.currentTime, 720, 300, 0.1, 0.09, 'triangle')
  }

  /** ping (§5.4) : deux impulsions descendantes, comme un ping de jeu */
  pingSfx(): void {
    const c = this.ensure()
    if (!c) return
    const t = c.currentTime
    this.sweep(t, 1180, 560, 0.36, 0.14, 'sine')
    this.bell(t + 0.004, 1560, 0.14, 0.1)
    this.sweep(t + 0.23, 980, 460, 0.28, 0.13, 'sine')
    this.bell(t + 0.234, 1310, 0.11, 0.09)
  }

  /** effacement total : un souffle bref, filtré, qui descend */
  clearSfx(): void {
    const c = this.ensure()
    if (!c) return
    const t = c.currentTime
    const src = c.createBufferSource()
    src.buffer = this.noise(c)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(2600, t)
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.3)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.32, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    src.connect(bp).connect(g).connect(this.master!)
    src.start(t)
    src.stop(t + 0.36)
    this.keepAwake()
  }

  /** survol d'un secteur du menu radial : un grain, presque subliminal */
  tick(): void {
    const c = this.ensure()
    if (!c) return
    this.bell(c.currentTime, 1720, 0.07, 0.035)
  }

  /** pose d'un trait : optionnel, à la limite de l'audible */
  strokeSfx(): void {
    const c = this.ensure()
    if (!c) return
    this.bell(c.currentTime, 2100 + Math.random() * 260, 0.055, 0.045)
  }

  /* ------------------------------------------------------------------ *
   * Briques de synthèse
   * ------------------------------------------------------------------ */

  /** cloche : sinus + décroissance exponentielle, le son « cristal » */
  private bell(t: number, freq: number, gain: number, dur: number): void {
    const c = this.ctx!
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t)
    // très léger glissando descendant : évite le côté « bip de four »
    osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this.master!)
    osc.start(t)
    osc.stop(t + dur + 0.02)
    this.keepAwake()
  }

  /** balayage de hauteur : impulsion montante ou descendante */
  private sweep(
    t: number,
    from: number,
    to: number,
    gain: number,
    dur: number,
    wave: OscillatorType,
  ): void {
    const c = this.ctx!
    const osc = c.createOscillator()
    osc.type = wave
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this.master!)
    osc.start(t)
    osc.stop(t + dur + 0.02)
    this.keepAwake()
  }

  /** bruit blanc mis en cache (0,4 s suffit pour tous les souffles) */
  private noise(c: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf
    const len = Math.floor(c.sampleRate * 0.4)
    const buf = c.createBuffer(1, len, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    return buf
  }

  /* ------------------------------------------------------------------ *
   * Cycle de vie du contexte
   * ------------------------------------------------------------------ */

  private ensure(): AudioContext | null {
    if (!this.enabled) return null
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        typeof AudioContext !== 'undefined' ? AudioContext : undefined
      if (!Ctor) return null
      this.ctx = new Ctor({ latencyHint: 'interactive' })
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume * 0.34
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** repousse la mise en veille : un seul minuteur, jamais d'intervalle */
  private keepAwake(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null
      this.sleepNow()
    }, SLEEP_MS)
  }

  private sleepNow(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }
}

/** instance unique — l'app entière partage la même sortie audio */
export const sfx = new HexaAudio()
