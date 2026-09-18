/* YIN-tonhöjdsdetektering.
   Samma algoritm används av psalmspelaren och Mic → MIDI, men med
   olika trösklar och frekvensfönster – därför en fabrik. */

export const BUF_SIZE = 2048;

const TAU_MIN_HZ = 1200;   // kortaste period som testas
const TAU_MAX_HZ = 65;     // längsta period som testas

/**
 * @param {{threshold?:number, rmsGate?:number, minHz?:number, maxHz?:number}} opts
 * @returns {(buffer: Float32Array, sampleRate: number) => number} frekvens i Hz, eller -1
 */
export function createPitchDetector({
  threshold = 0.15, rmsGate = 0.01, minHz = 70, maxHz = 1100,
} = {}){
  return function detectPitch(buffer, sampleRate){
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < rmsGate) return -1;

    const minTau = Math.max(2, Math.floor(sampleRate / TAU_MIN_HZ));
    const tauMax = Math.min(Math.floor(SIZE / 2), Math.floor(sampleRate / TAU_MAX_HZ));
    if (tauMax <= minTau) return -1;

    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++){
      let sum = 0;
      for (let j = 0; j + tau < SIZE; j++){ const df = buffer[j] - buffer[j + tau]; sum += df * df; }
      d[tau] = sum;
    }

    const cmnd = new Float32Array(tauMax + 1); cmnd[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++){ run += d[tau]; cmnd[tau] = run === 0 ? 1 : (d[tau] * tau) / run; }

    let tauEst = -1;
    for (let tau = minTau; tau <= tauMax; tau++){
      if (cmnd[tau] < threshold){
        let t2 = tau;
        while (t2 + 1 <= tauMax && cmnd[t2 + 1] < cmnd[t2]) t2++;
        tauEst = t2; break;
      }
    }
    if (tauEst === -1){
      let mn = Infinity, pos = -1;
      for (let tau = minTau; tau <= tauMax; tau++) if (cmnd[tau] < mn){ mn = cmnd[tau]; pos = tau; }
      if (mn > 0.4) return -1;
      tauEst = pos;
    }

    let refined = tauEst;
    if (tauEst > 1 && tauEst + 1 <= tauMax){
      const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
      const den = 2 * (2 * s1 - s2 - s0);
      if (den !== 0) refined = tauEst + (s2 - s0) / den;
    }

    const f = sampleRate / refined;
    if (!isFinite(f) || f < minHz || f > maxHz) return -1;
    return f;
  };
}
