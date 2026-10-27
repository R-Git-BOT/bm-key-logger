// Opt-in integration check. Fetches only these explicit charts, never crawls.
import assert from 'node:assert/strict';
import { getCatalog, getChart } from '../server/textage-api.mjs';

const catalog = await getCatalog();
assert.ok(catalog.length > 1000);
for (const [id, difficulties] of [['tpeerles',['N','H','A']],['_mei',['N','H','A']],['almagest',['A']],['almag_h',['A']],['backspin',['A']],['titans',['L']]]) {
  for (const difficulty of difficulties) {
    const chart = await getChart(id,difficulty);
    const source = catalog.find(song => song.id === id).difficulties.find(d => d.difficulty === difficulty);
    assert.equal(chart.noteCount,source.noteCount);
    assert.ok(chart.notes.every(note => note.lane >= 0 && note.lane <= 7 && (note.endBeat === undefined || note.endBeat > note.beat)));
    if (id === '_mei') assert.ok(chart.bpmPoints.length > 10);
    if (id === 'almagest') assert.ok(chart.notes.some(n => n.kind === 'CN') && chart.notes.some(n => n.kind === 'BSS'));
    if (id === 'almag_h') assert.ok(chart.notes.some(n => n.kind === 'HCN') && chart.notes.some(n => n.kind === 'HBSS'));
    console.log(`${chart.title} [${difficulty}]: ${chart.noteCount} notes OK`);
  }
}
