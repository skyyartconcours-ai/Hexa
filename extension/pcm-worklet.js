/**
 * Convertit l'audio de l'onglet en PCM 16 bits mono, prêt à partir sur la socket.
 *
 * Le contexte audio qui héberge ce worklet tourne déjà à 16 kHz : c'est Chrome
 * qui rééchantillonne, et il le fait mieux qu'un rééchantillonneur écrit à la
 * main. Il ne reste ici que le downmix mono et la conversion float -> int16.
 */

const CHUNK_SAMPLES = 1280; // 80 ms à 16 kHz

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunk = new Int16Array(CHUNK_SAMPLES);
    this._filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      // Pas encore de données : on reste vivant en attendant le flux.
      return true;
    }

    const channels = input.length;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (let c = 0; c < channels; c++) sample += input[c][i];
      sample /= channels;

      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;

      this._chunk[this._filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this._filled === CHUNK_SAMPLES) {
        const copy = this._chunk.slice();
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this._filled = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
