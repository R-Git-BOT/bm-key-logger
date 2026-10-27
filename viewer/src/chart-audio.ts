import { eventIndex } from './chart-events.ts';
import type { HitEvent } from './chart-events';

type Sound = { lanes: boolean[]; volume: number };
// One clock drives canvas time and sample scheduling. Hi-Speed is deliberately
// absent. Only transport rate changes time. Sources are cancelled on any seek.
export class ChartAudio {
  private context: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private voices = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: HitEvent[] = [];
  private index = 0;
  private anchor = 0;
  private origin = 0;
  private end = 0;
  private rate = 1;
  private sound: Sound = { lanes:Array(8).fill(true), volume:.35 };
  async unlock() {
    this.context ??= new AudioContext({ latencyHint:'interactive' });
    if (!this.buffers.length) {
      this.buffers = [0,1].map(scratch => {
        const buffer = this.context!.createBuffer(1, Math.ceil(this.context!.sampleRate * .045), this.context!.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          const t = i / this.context!.sampleRate;
          const envelope = Math.exp(-t * 100) * Math.min(1,t * 4000);
          samples[i] = (Math.sin(t * (scratch ? 1600 : 2600) * Math.PI * 2) * .55 + (Math.random() * 2 - 1) * .45) * envelope * .12;
        }
        return buffer;
      });
    }
    if (this.context.state !== 'running') await this.context.resume();
  }
  get position() { return Math.min(this.end, this.origin + Math.max(0,(this.context?.currentTime ?? this.anchor) - this.anchor) * this.rate); }
  start(events: HitEvent[], position: number, end: number, rate: number) {
    this.stop();
    if (!this.context) return;
    this.events = events; this.origin = position; this.end = end; this.rate = rate;
    this.anchor = this.context.currentTime + .025; this.index = eventIndex(events,position);
    this.schedule(); this.timer = setInterval(() => this.schedule(),25);
  }
  configure(sound: Sound) {
    this.sound = sound;
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
      if (event.time >= this.end || when < ctx.currentTime - .015 || !this.sound.lanes[event.lane] || this.sound.volume <= 0) continue;
      const voice = ctx.createBufferSource(), gain = ctx.createGain();
      voice.buffer = this.buffers[event.lane === 0 ? 1 : 0]; gain.gain.value = this.sound.volume;
      voice.connect(gain); gain.connect(ctx.destination); this.voices.add(voice);
      voice.onended = () => { this.voices.delete(voice); voice.disconnect(); gain.disconnect(); };
      voice.start(Math.max(ctx.currentTime,when));
    }
  }
  private cancelVoices() { for (const voice of this.voices) { try { voice.stop(); } catch { /* already stopped */ } } this.voices.clear(); }
  stop() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; this.cancelVoices(); }
  dispose() { this.stop(); void this.context?.close(); this.context = null; }
}
