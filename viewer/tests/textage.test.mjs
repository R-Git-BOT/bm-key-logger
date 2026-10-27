import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDataScript } from '../server/data-script.mjs';
import { decodeNotes, parseCatalog, parseTextageChart } from '../server/textage-parser.mjs';
import { chartUrlQuery, matchReplay, searchSongs } from '../src/textage.ts';
import { parseReplay, beatToSeconds } from '../src/bms.ts';
import { chartEvents, eventIndex } from '../src/chart-events.ts';

test('data interpreter supports assignments, aliases, holes, difficulty branches and bounded loops', () => {
  const value = readDataScript('sp=[,"02"]; if(a){sp[2]=sp[1];for(i=3;i<5;i++)sp[i]="04";}else sp[1]="08"; gap--;hd();alert("not data");', {a:1,gap:1}, true);
  assert.equal(value.gap,0); assert.equal(value.sp[2],'02'); assert.equal(value.sp[4],'04'); assert.equal(value.sp[0],undefined);
});
test('data interpreter rejects executable code, prototype access and unbounded loops', () => {
  for (const source of ['fetch("https://example.com")','a={};a["__proto__"]={polluted:1}','a={};a.constructor.constructor("return process")()','for(;;){}']) assert.throws(() => readDataScript(source));
  assert.equal({}.polluted,undefined);
});
test('hex masks and zero-run encoding preserve chords and timing', () => {
  assert.deepEqual(decodeNotes('03000400'),[{lane:0,tick:0},{lane:1,tick:0},{lane:2,tick:192}]);
  assert.deepEqual(decodeNotes('x00802@010400'),[{lane:1,tick:0},{lane:2,tick:192}]);
});
test('base64 repeats, packed keys, packed scratches and explicit positions', () => {
  assert.deepEqual(decodeNotes('#R2'),[0,96,192,288].map(tick => ({lane:2,tick})));
  assert.deepEqual(decodeNotes('#QKS'),[{lane:1,tick:0},{lane:2,tick:96},{lane:2,tick:192},{lane:2,tick:288}]);
  assert.deepEqual(decodeNotes('#-Qw'),[{lane:0,tick:0},{lane:0,tick:96}]);
  assert.deepEqual(decodeNotes('#3Bg_'),[{lane:3,tick:96},{lane:0,tick:0}]);
  assert.deepEqual(decodeNotes('#9DAA'),[{lane:1,tick:0},{lane:2,tick:0},{lane:3,tick:0}]);
  assert.throws(() => decodeNotes('#!'));
});
const songs = parseCatalog('titletbl={demo:[28,1,0,"Genre","Artist","T&amp;est"],other:[28,2,0,"G","A","Other"]};', 'A=10;C=12;actbl={demo:[3,0,0,0,0,5,7,A,7,C,7,C,7],other:[1,0,0,0,0,5,7,0,0,C,7,0,0]}; ignored();', 'datatbl={demo:[0,0,1,2,3,4,0,0,0,0,0,"120"],other:[0,0,1,0,3,0,0,0,0,0,0,"120"]};function unused(){}');
test('catalogue decodes titles and distinguishes difficulty/INFINITAS availability', () => {
  assert.equal(songs[0].title,'T&est'); assert.deepEqual(songs[0].difficulties.map(d => d.difficulty),['N','H','A','L']);
  assert.equal(searchSongs(songs,'Other',true).length,0); assert.equal(searchSongs(songs,'Other',false).length,1);
});
const html = body => `<script src="../bms2jsh.js"></script><script>${body}hd();document.write("ignored");</script>`;
const header = 'title="Test";artist="Artist";genre="G";bpm="120";measure=2;gap--;';
test('CN cap correction, multi-lane holds, HCN and cross-measure BSS are represented as continuous holds', () => {
  const chart = parseTextageChart(html(header+'hcn=1;notes=8;c1[1]=[[12,0,30],[0,64,64,1],[4,64,62]];c1[2]=[[0,0,32,2]];'),songs[0],'A');
  assert.equal(chart.noteCount,8); assert.equal(chart.notes.length,4);
  assert.deepEqual(chart.notes.filter(n => n.kind === 'HCN').map(n => n.endBeat - n.beat),[1,1,2]);
  const bss = chart.notes.find(n => n.kind === 'HBSS'); assert.equal(bss.beat,2); assert.equal(bss.endBeat,5);
});
test('difficulty branches and variable measure length/BPM integrate to exact chart times', () => {
  const code = header+'notes=1;sp[1]="02";ln[1]=192;tc[1]=["1200"];tc[2]=["2400"];if(a){notes=2;sp[2]="04";}';
  const chart = parseTextageChart(html(code),songs[0],'A');
  assert.deepEqual(chart.measureStarts,[0,2,6]); assert.equal(beatToSeconds(chart,6),2);
  assert.deepEqual(chartEvents(chart).map(e => e.time),[0,1]); assert.equal(eventIndex(chartEvents(chart),.5),1);
  const normal = parseTextageChart(html(code),songs[0],'N'); assert.equal(normal.noteCount,1);
});
test('reject incomplete holds or a note-count mismatch instead of silently loading wrong chart', () => {
  assert.throws(() => parseTextageChart(html(header+'notes=2;sp[1]="02";'),songs[0],'A'),/検証/);
  assert.throws(() => parseTextageChart(html(header+'notes=2;c1[1]=[[1,0,128,1]];'),songs[0],'A'),/終端/);
});
test('both supported URL forms select the exact song/difficulty; DP and external hosts are rejected', () => {
  assert.deepEqual(chartUrlQuery('https://textage-chart-viewer.vercel.app/chart/28/tpeerles/a/sp'),{id:'tpeerles',difficulty:'A'});
  assert.deepEqual(chartUrlQuery('https://textage.cc/score/28/demo.html?1XC00'),{id:'demo',difficulty:'L'});
  assert.equal(chartUrlQuery('https://textage.cc/score/28/demo.html?DAC00'),null);
  assert.equal(chartUrlQuery('https://example.com/chart/28/demo/a/sp'),null);
});
test('replay resolves unique normalized title/difficulty, but never auto-selects ambiguous/unknown candidates', () => {
  const replay = parseReplay({game:'IIDX',song:{title:'Ｔ＆ｅｓｔ',chart:'ANOTHER'},events:[{t_us:200,lane:2,pressed:false},{t_us:100,lane:2,pressed:true}]});
  assert.equal(replay.events[0].tUs,100);
  assert.equal(matchReplay(songs,replay).automatic,true);
  assert.equal(matchReplay([...songs,{...songs[0],id:'duplicate'}],replay).automatic,false);
  assert.equal(matchReplay(songs,{...replay,title:'Not found'}).automatic,false);
  assert.equal(matchReplay(songs,{...replay,chart:'unknown-chart'}).automatic,false);
  assert.equal(matchReplay(songs,{...replay,title:'OCR wrong',chartSource:{provider:'textage',id:'demo',difficulty:'L',mode:'SP'}}).automatic,true);
  assert.throws(() => parseReplay(null));
});
test('CN/BSS heads and tails both produce hit events across BPM changes', () => {
  const chart = parseTextageChart(html(header+'notes=2;c1[1]=[[0,64,64,1]];c1[2]=[[0,0,32,2]];tc[1]=["1200"];tc[2]=["2400"];'),songs[0],'A');
  assert.deepEqual(chartEvents(chart),[{time:1,lane:0,tail:false},{time:2.25,lane:0,tail:true}]);
});
