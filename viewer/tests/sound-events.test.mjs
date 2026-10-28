import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundEvents } from '../src/sound-events.ts';
import { soundSamples } from '../src/sound-samples.ts';

const settings = {lanes:Array(8).fill(true),keySound:'beep',scratchSound:'clap',keyVolume:.4,scratchVolume:.8};
const hit = (time,lane,tail=false) => ({time,lane,tail});

test('seven-key chord is one voice; original hit events and visual tails remain unchanged', () => {
  const hits = [1,2,3,4,5,6,7].map(lane=>hit(1,lane));
  const original = structuredClone(hits);
  assert.deepEqual(soundEvents(hits,settings),[{time:1,sound:'beep',volume:.4}]);
  assert.deepEqual(hits,original);
  assert.equal(soundEvents([hit(1,1),hit(2,1,true)],settings).length,2);
});
test('different key/scratch sounds stay separate; matching timbres use max active gain once', () => {
  const hits = [hit(1,0),hit(1,1),hit(1,2)];
  assert.deepEqual(soundEvents(hits,settings),[{time:1,sound:'clap',volume:.8},{time:1,sound:'beep',volume:.4}]);
  assert.deepEqual(soundEvents(hits,{...settings,keySound:'clap'}),[{time:1,sound:'clap',volume:.8}]);
  assert.deepEqual(soundEvents(hits,{...settings,keySound:'clap',scratchVolume:0}),[{time:1,sound:'clap',volume:.4}]);
});
test('same-sound suppression matches 34ms chart-time boundary, not lane or playback rate', () => {
  const hits = [hit(1,1),hit(1.01,2),hit(1.033,1),hit(1.034,7),hit(1.04,0),hit(1.068,1)];
  assert.deepEqual(soundEvents(hits,settings).map(e=>e.time),[1,1.034,1.04,1.068]);
});
test('muted lanes and zero-volume parts never consume the duplicate window', () => {
  const lanes = [...settings.lanes]; lanes[0]=false; lanes[1]=false;
  assert.deepEqual(soundEvents([hit(1,0),hit(1,1),hit(1.01,2)],{...settings,lanes,keySound:'clap'}),[{time:1.01,sound:'clap',volume:.4}]);
  assert.deepEqual(soundEvents([hit(1,1)],{...settings,keyVolume:0}),[]);
});
test('floating point same-time chords use the loudest gain without creating extra voices', () => {
  assert.deepEqual(soundEvents([hit(.3,1),hit(.1+.2,0)],{...settings,keySound:'clap'}),[{time:.3,sound:'clap',volume:.8}]);
});
test('volume clamps to 250%, rejecting invalid/negative volumes', () => {
  assert.equal(soundEvents([hit(1,1)],{...settings,keyVolume:20})[0].volume,2.5);
  for (const keyVolume of [NaN,Infinity,-1]) assert.deepEqual(soundEvents([hit(1,1)],{...settings,keyVolume}),[]);
});
test('local clap, hi-hat and beep samples are deterministic, distinct, finite and have safe peaks', () => {
  for (const sampleRate of [44100,48000]) {
    const sounds = ['clap','hihat','beep'].map(sound=>soundSamples(sound,sampleRate));
    for (const [index,samples] of sounds.entries()) {
      assert.deepEqual(samples,soundSamples(['clap','hihat','beep'][index],sampleRate));
      assert.ok(samples.every(Number.isFinite));
      const peak = samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
      assert.ok(peak >= .179 && peak <= .181);
      assert.equal(samples[0],0); assert.ok(Math.abs(samples.at(-1)) < .001);
    }
    assert.ok(sounds[0].length > sounds[1].length && sounds[1].length > sounds[2].length);
  }
});
