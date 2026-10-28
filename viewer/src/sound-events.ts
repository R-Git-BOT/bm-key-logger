import type { HitEvent } from './chart-events';

export type SoundType = 'clap' | 'hihat' | 'beep';
export type SoundSettings = { lanes: boolean[]; keySound: SoundType; scratchSound: SoundType; keyVolume: number; scratchVolume: number };
export type SoundEvent = { time: number; sound: SoundType; volume: number };
export const SOUND_OPTIONS: { value: SoundType; label: string }[] = [
  { value:'clap', label:'Clap' }, { value:'hihat', label:'Hi-hat' }, { value:'beep', label:'Beep' },
];
const SAME_TIME = 1e-7; // Seconds; tolerate BPM conversion rounding, not actual flams.
const DUPLICATE_WINDOW = .034; // Reference viewer: 34 ms of chart time per sound type.

// Derive audio events only when chart/settings change. Visual hits stay untouched.
export function soundEvents(hits: HitEvent[], settings: SoundSettings): SoundEvent[] {
  const result: SoundEvent[] = [];
  const previous = new Map<SoundType, number>();
  for (let index = 0; index < hits.length;) {
    const time = hits[index].time;
    const chord = new Map<SoundType, number>();
    do {
      const hit = hits[index++];
      if (!settings.lanes[hit.lane]) continue;
      const scratch = hit.lane === 0;
      const sound = scratch ? settings.scratchSound : settings.keySound;
      const volume = scratch ? settings.scratchVolume : settings.keyVolume;
      if (!Number.isFinite(volume) || volume <= 0) continue;
      // Same timbre on keys + scratch: one voice at the louder active setting.
      // Muting one part must not suppress the other part.
      chord.set(sound,Math.max(chord.get(sound) ?? 0,Math.min(2.5,volume)));
    } while (index < hits.length && hits[index].time - time <= SAME_TIME);
    for (const [sound,volume] of chord) {
      if (time - (previous.get(sound) ?? -Infinity) < DUPLICATE_WINDOW - 1e-9) continue;
      result.push({time,sound,volume}); previous.set(sound,time);
    }
  }
  return result;
}
