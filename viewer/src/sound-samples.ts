import type { SoundType } from './sound-events';

// Local synthesized percussion: no external assets or fetch in the audio path.
// Clap uses multiple band-limited noise bursts plus a diffuse decay, not a tone.
export function soundSamples(sound: SoundType, sampleRate: number): Float32Array {
  const duration = sound === 'clap' ? .22 : sound === 'hihat' ? .08 : .045;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  let slow = 0, fast = 0, seed = 0x13579bdf;
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate);
  const highAlpha = 1 - Math.exp(-2 * Math.PI * 7000 / sampleRate);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    // Stable noise means the timbre does not change on every playback/unlock.
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = (seed >>> 0) / 0xffffffff * 2 - 1;
    slow += lowAlpha * (noise - slow); fast += highAlpha * (noise - fast);
    const t = i / sampleRate;
    const fade = Math.min(1,t / .001,(duration - t) / .008);
    let value: number;
    if (sound === 'clap') {
      let envelope = 0;
      for (const onset of [0,.011,.022]) {
        const age = t - onset;
        if (age >= 0 && age < .010) envelope += Math.min(1,age / .0005) * Math.exp(-age / .0035);
      }
      if (t >= .030) envelope += .65 * Math.min(1,(t - .030) / .001) * Math.exp(-(t - .030) / .035);
      value = (fast - slow) * envelope;
    } else if (sound === 'hihat') {
      value = (noise - fast) * Math.exp(-t / .013);
    } else {
      value = (Math.sin(t * 2600 * Math.PI * 2) * .55 + noise * .45) * Math.exp(-t * 100);
    }
    samples[i] = value * fade; peak = Math.max(peak,Math.abs(samples[i]));
  }
  // Leave headroom for keys + scratch and the 250% controls.
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= .18 / peak;
  return samples;
}
