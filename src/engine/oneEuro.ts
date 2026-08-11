/**
 * Filtre One Euro (Casiez et al.) — lisse le tremblement sans retarder les gestes rapides.
 * C'est le lissage demandé par le brief (§3.2) : à vitesse lente il filtre fort,
 * à vitesse rapide il laisse passer, donc zéro latence perceptible sur les gestes vifs.
 */
class LowPass {
  private y = 0
  private init = false

  filter(x: number, a: number): number {
    if (!this.init) {
      this.init = true
      this.y = x
    } else {
      this.y = a * x + (1 - a) * this.y
    }
    return this.y
  }

  get last(): number {
    return this.y
  }
}

export class OneEuro {
  private x = new LowPass()
  private dx = new LowPass()
  private lastT = -1

  constructor(
    private minCutoff = 1.2,
    private beta = 0.012,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(v: number, tMs: number): number {
    if (this.lastT < 0) {
      this.lastT = tMs
      this.dx.filter(0, 1)
      return this.x.filter(v, 1)
    }
    const dt = Math.max(0.001, (tMs - this.lastT) / 1000)
    this.lastT = tMs
    const dv = (v - this.x.last) / dt
    const edv = this.dx.filter(dv, this.alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edv)
    return this.x.filter(v, this.alpha(cutoff, dt))
  }
}
