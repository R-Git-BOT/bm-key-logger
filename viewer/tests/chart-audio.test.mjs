import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChartAudio } from '../src/chart-audio.ts';

function fakeAudio() {
  const voices = [];
  const context = { currentTime:0, destination:{}, createBufferSource() { const voice = { connect(gain){ this.gain= gain.gain; }, disconnect(){}, start(time){ this.when=time; }, stop(){ this.stopped=true; this.onended?.(); } }; voices.push(voice); return voice; }, createGain() { return {gain:{value:0},connect(){},disconnect(){}}; } };
  const audio = new ChartAudio();
  // Inject the WebAudio boundary; production always uses the browser AudioContext.
  audio.context = context; audio.buffers = new Map(['clap','hihat','beep'].map(sound => [sound,{sound}]));
  return {audio,context,voices};
}
test('audio and playhead share one clock, including a 2x time rate', () => {
  const {audio,context,voices} = fakeAudio();
  try {
    audio.start([{time:1,lane:1,tail:false},{time:1.2,lane:0,tail:true}],1,5,2);
    assert.equal(voices.length,2); assert.ok(Math.abs(voices[1].when-.125)<1e-9);
    context.currentTime=.525; assert.equal(audio.position,2);
  } finally { audio.stop(); }
});
const settings = {lanes:Array(8).fill(true), keySound:'beep', scratchSound:'clap', keyVolume:.5, scratchVolume:.5};
test('seek/restart cancels future voices and schedules only hits at the new position', () => {
  const {audio,voices} = fakeAudio();
  const events = [{time:0,lane:1,tail:false},{time:3,lane:2,tail:false}];
  try { audio.start(events,0,5,1); audio.start(events,3,5,1); assert.equal(voices[0].stopped,true); assert.equal(voices.length,2); assert.equal(voices[1].when,.025); }
  finally { audio.stop(); }
});
test('lane mute, volume zero, pause and selected end boundary never leak notes', () => {
  const {audio,voices} = fakeAudio();
  const events = [{time:0,lane:0,tail:false},{time:0,lane:1,tail:false},{time:.1,lane:2,tail:false}];
  audio.configure({...settings,lanes:[true,false,true,true,true,true,true,true]});
  audio.start(events,0,.05,1); assert.equal(voices.length,1);
  audio.configure({...settings,keyVolume:0,scratchVolume:0}); assert.equal(voices[0].stopped,true);
  audio.stop(); assert.equal(audio.timer,null);
});

test('chords schedule one key voice and a separate clap with independent gains', () => {
  const {audio,voices} = fakeAudio();
  try {
    audio.configure({...settings,keyVolume:.2,scratchVolume:.8});
    audio.start([0,1,3,5,7].map(lane => ({time:0,lane,tail:false})),0,5,1);
    assert.equal(voices.length,2);
    assert.deepEqual(voices.map(v => [v.buffer.sound,v.gain.value]),[['clap',.8],['beep',.2]]);
  } finally { audio.stop(); }
});

test('changing scratch timbre/volume during playback replaces queued voices without moving the clock', () => {
  const {audio,context,voices} = fakeAudio();
  try {
    audio.configure(settings);
    const events = [{time:0,lane:1,tail:false},{time:.1,lane:0,tail:false},{time:.1,lane:3,tail:false}];
    audio.start(events,0,5,1);
    context.currentTime=.06; const position = audio.position;
    audio.configure({...settings,scratchSound:'hihat',scratchVolume:.9});
    assert.equal(audio.position,position);
    assert.ok(voices.slice(0,3).every(v=>v.stopped));
    assert.deepEqual(voices.slice(3).map(v=>[v.buffer.sound,v.gain.value,v.when]),[['hihat',.9,.125],['beep',.5,.125]]);
  } finally { audio.stop(); }
});

test('independent volume zero mutes only that part, including matching timbres', () => {
  const {audio,voices} = fakeAudio();
  const events = [0,1,2].map(lane=>({time:0,lane,tail:false}));
  try {
    audio.configure({...settings,keySound:'clap',scratchVolume:0});
    audio.start(events,0,1,1);
    assert.equal(voices.length,1); assert.equal(voices[0].gain.value,.5);
    audio.configure({...settings,keyVolume:0,scratchVolume:.9});
    audio.start(events,0,1,1);
    assert.equal(voices.length,2); assert.equal(voices[1].buffer.sound,'clap'); assert.equal(voices[1].gain.value,.9);
  } finally { audio.stop(); }
});

test('seeking back does not retain a duplicate-suppression state from later chart time', () => {
  const {audio,voices} = fakeAudio();
  const events = [{time:0,lane:1,tail:false},{time:3,lane:1,tail:false}];
  try {
    audio.start(events,3,5,1); audio.start(events,0,5,1);
    assert.equal(voices.length,2); assert.equal(voices[0].stopped,true);
  } finally { audio.stop(); }
});

test('unlock builds all three samples once and dispose releases them for a fresh context', async () => {
  const original = globalThis.AudioContext;
  const contexts = [];
  globalThis.AudioContext = class {
    sampleRate = 48000;
    state = 'suspended';
    buffers = [];
    constructor() { contexts.push(this); }
    createBuffer(channels,length,rate) {
      assert.equal(channels,1); assert.equal(rate,this.sampleRate);
      const samples = new Float32Array(length);
      const buffer = {getChannelData:()=>samples}; this.buffers.push(buffer); return buffer;
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  const audio = new ChartAudio();
  try {
    await audio.unlock(); await audio.unlock();
    assert.equal(contexts.length,1); assert.equal(contexts[0].buffers.length,3);
    assert.equal(contexts[0].state,'running');
    assert.ok(contexts[0].buffers.every(buffer=>buffer.getChannelData(0).some(value=>value !== 0)));
    audio.dispose(); assert.equal(contexts[0].state,'closed'); assert.equal(audio.buffers.size,0);
    await audio.unlock(); assert.equal(contexts.length,2); assert.equal(contexts[1].buffers.length,3);
  } finally {
    audio.dispose();
    if (original === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = original;
  }
});
