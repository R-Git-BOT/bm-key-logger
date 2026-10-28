import { eventIndex } from './chart-events.ts';
import type { HitEvent } from './chart-events';
import { soundEvents, SOUND_OPTIONS } from './sound-events.ts';
import type { SoundEvent, SoundSettings, SoundType } from './sound-events';
import { soundSamples } from './sound-samples.ts';

// One clock drives canvas time and sample scheduling. Hi-Speed is deliberately
// absent. Only transport rate changes time. Sources are cancelled on any seek.
export class ChartAudio {
  private context: AudioContext | null = null;
  private buffers = new Map<SoundType, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private hits: HitEvent[] = [];
  private events: SoundEvent[] = [];
  private index = 0;
  private anchor = 0;
  private origin = 0;
  private end = 0;
  private rate = 1;
  private sound: SoundSettings = { lanes:Array(8).fill(true), keySound:'beep', scratchSound:'clap', keyVolume:1, scratchVolume:1 };
  async unlock() {
    this.context ??= new AudioContext({ latencyHint:'interactive' });
    if (!this.buffers.size) {
      for (const {value} of SOUND_OPTIONS) {
        const samples = soundSamples(value,this.context.sampleRate);
        const buffer = this.context.createBuffer(1,samples.length,this.context.sampleRate);
        buffer.getChannelData(0).set(samples); this.buffers.set(value,buffer);
      }
    }
    if (this.context.state !== 'running') await this.context.resume();
  }
  get position() { return Math.min(this.end, this.origin + Math.max(0,(this.context?.currentTime ?? this.anchor) - this.anchor) * this.rate); }
  start(events: HitEvent[], position: number, end: number, rate: number) {
    this.stop();
    if (!this.context) return;
    this.hits = events; this.events = soundEvents(events,this.sound);
    this.origin = position; this.end = end; this.rate = rate;
    this.anchor = this.context.currentTime + .025; this.index = eventIndex(this.events,position);
    this.schedule(); this.timer = setInterval(() => this.schedule(),25);
  }
  configure(sound: SoundSettings) {
    this.sound = sound;
    this.events = soundEvents(this.hits,sound);
    if (this.timer !== null) {
      const position = this.position;
      this.cancelVoices(); this.index = eventIndex(this.events,position + .005 * this.rate); this.schedule();
    }
  }
  private schedule() {
    const ctx = this.context;
    if (!ctx) return;
    const horizon = this.position + .12 * this.rate;
    while (this.index < this.events.length && this.events[this.index].time <= horizon) {
      const event = this.events[this.index++];
      const when = this.anchor + (event.time - this.origin) / this.rate;
      if (event.time >= this.end || when < ctx.currentTime - .015) continue;
      const voice = ctx.createBufferSource(), gain = ctx.createGain();
      voice.buffer = this.buffers.get(event.sound)!; gain.gain.value = event.volume;
      voice.connect(gain); gain.connect(ctx.destination); this.voices.add(voice);
      voice.onended = () => { this.voices.delete(voice); voice.disconnect(); gain.disconnect(); };
      voice.start(Math.max(ctx.currentTime,when));
    }
  }
  private cancelVoices() { for (const voice of this.voices) { try { voice.stop(); } catch { /* already stopped */ } } this.voices.clear(); }
  stop() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; this.cancelVoices(); }
  dispose() { this.stop(); void this.context?.close(); this.context = null; this.buffers.clear(); }
}
