import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChartAudio } from '../src/chart-audio.ts';

function fakeAudio() {
  const voices = [];
  const context = { currentTime:0, destination:{}, createBufferSource() { const voice = { connect(){}, disconnect(){}, start(time){ this.when=time; }, stop(){ this.stopped=true; this.onended?.(); } }; voices.push(voice); return voice; }, createGain() { return {gain:{value:0},connect(){},disconnect(){}}; } };
  const audio = new ChartAudio();
  // Inject the WebAudio boundary; production always uses the browser AudioContext.
  audio.context = context; audio.buffers = [{},{}];
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
test('seek/restart cancels future voices and schedules only hits at the new position', () => {
  const {audio,voices} = fakeAudio();
  const events = [{time:0,lane:1,tail:false},{time:3,lane:2,tail:false}];
  try { audio.start(events,0,5,1); audio.start(events,3,5,1); assert.equal(voices[0].stopped,true); assert.equal(voices.length,2); assert.equal(voices[1].when,.025); }
  finally { audio.stop(); }
});
test('lane mute, volume zero, pause and selected end boundary never leak notes', () => {
  const {audio,voices} = fakeAudio();
  const events = [{time:0,lane:0,tail:false},{time:0,lane:1,tail:false},{time:.1,lane:2,tail:false}];
  audio.configure({lanes:[true,false,true,true,true,true,true,true],volume:.5});
  audio.start(events,0,.05,1); assert.equal(voices.length,1);
  audio.configure({lanes:Array(8).fill(true),volume:0}); assert.equal(voices[0].stopped,true);
  audio.stop(); assert.equal(audio.timer,null);
});
