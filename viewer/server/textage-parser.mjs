import { readDataScript } from './data-script.mjs';
import { decodeHTML } from 'entities';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const plain = value => decodeHTML(String(value ?? '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '')).trim();
const DIFFICULTIES = ['N', 'H', 'A', 'L'];

export function parseCatalog(titlesSource, levelsSource, countsSource) {
  const titles = readDataScript(titlesSource, {}, false, 'titletbl').titletbl;
  const levels = readDataScript(levelsSource, {}, false, 'actbl').actbl;
  const counts = readDataScript(countsSource, {}, false, 'datatbl').datatbl;
  return Object.entries(titles).flatMap(([id, row]) => {
    const lv = levels[id], info = counts[id];
    if (!lv || !info) return [];
    const difficulties = DIFFICULTIES.flatMap((difficulty, i) => {
      const type = i + 2, level = lv[type * 2 + 1], flags = lv[type * 2 + 2];
      return level > 0 && (flags & 1) ? [{ difficulty, level, noteCount: info[type], infinitas: Boolean(lv[0] & 2) && Boolean((flags & 4) || (lv[0] & 8)) }] : [];
    });
    if (!difficulties.length) return [];
    return [{ id, version: row[0] === 35 ? 's' : String(row[0]), title: plain(row[5] + (row[6] ? ' ' + row[6] : '')), artist: plain(row[4]), genre: plain(row[3]), bpm: plain(info[11]), difficulties }];
  });
}

// Both published encodings: hex chord masks with zero runs, and # base64
// lane/rhythm streams. Positions are TexTage ticks (96 ticks per beat).
export function decodeNotes(data, length = 384) {
  if (!data) return [];
  if (typeof data !== 'string' || !Number.isFinite(length) || length <= 0 || length > 24576) throw new Error('不正なノーツ・小節長');
  const result = [];
  const add = (lane, tick) => { if (lane >= 0 && lane <= 7 && Number.isFinite(tick) && tick >= 0 && tick < length) result.push({ lane, tick }); };
  const b64 = char => { const n = typeof char === 'string' && char.length === 1 ? B64.indexOf(char) : -1; if (n < 0) throw new Error('不正な圧縮ノーツ'); return n; };
  if (data[0] !== '#') {
    let index = data[0] === 'x' ? 4 : 0, position = 0;
    const divisions = data[0] === 'x' ? parseInt(data.slice(1, 4), 16) : data.length;
    if (!divisions) return result;
    while (index < data.length) {
      if (data[index] === '@') { position += parseInt(data.slice(index + 1, index + 3), 16) * 2; index += 3; continue; }
      const mask = parseInt(data.slice(index, index + 2), 16);
      if (!Number.isFinite(mask)) throw new Error('不正なノーツ');
      for (let lane = 0; lane < 8; lane++) if (mask & (1 << lane)) add(lane, position / divisions * length);
      position += 2; index += 2;
    }
    return result;
  }
  const streams = { C:[0,192,true], c:[96,192,true], R:[0,96,true], r:[48,96,true], P:[0,48,true], p:[24,48,true], B:[0,192], b:[96,192], Q:[0,96], q:[48,96], O:[0,48], o:[24,48], X:[0,24], x:[12,24], Z:[0,12], S:[0,64], s:[32,64], T:[0,32], t:[16,32], U:[0,16] };
  let index = 1, scratch = false;
  while (index < data.length) {
    const command = data[index++];
    if (command === '-') { scratch = true; continue; }
    if (command === '_') {
      const tail = data.slice(index) || 'AA';
      if (tail.length % 2) throw new Error('不正なスクラッチ時刻');
      for (let n = 0; n < tail.length; n += 2) add(0, b64(tail[n]) * 64 + b64(tail[n + 1]));
      break;
    }
    if (/[1-9]/.test(command)) {
      let lanes = [Number(command)];
      if (command === '8' || command === '9') {
        const mask = b64(data[index++]); lanes = command === '9' ? [1] : [];
        for (let bit = 0; bit < 6; bit++) if (mask & (1 << bit)) lanes.push(bit + 2);
      }
      const tick = b64(data[index++]) * 64 + b64(data[index++]);
      for (const lane of lanes) add(scratch ? 0 : lane, tick);
      continue;
    }
    const rule = streams[command];
    if (!rule) throw new Error(`未対応のノーツ形式: ${command}`);
    const [start, step, repeat] = rule;
    let laneValues = [];
    if (repeat) {
      const lane = scratch ? 1 : Number(data[index++]);
      for (let tick = start; tick < length; tick += step) laneValues.push(lane);
    } else {
      const count = Math.ceil((scratch ? 1 : 3) * length / 6 / step);
      for (let n = 0; n < count; n++) {
        const code = b64(data[index++]);
        if (scratch) for (let bit = 5; bit >= 0; bit--) laneValues.push(code >> bit & 1);
        else laneValues.push(Math.floor(code / 8), code % 8);
      }
    }
    laneValues.forEach((lane, n) => { if (lane) add(scratch ? 0 : lane, start + n * step); });
  }
  return result;
}

export function parseTextageChart(html, song, difficulty) {
  const selected = song.difficulties.find(item => item.difficulty === difficulty);
  if (!selected) throw new Error('指定難易度の譜面がありません');
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc\s*=/i.test(match[1])).map(match => match[2]);
  const source = blocks.find(block => /\b(?:sp|c1)\s*(?:\[|=)/.test(block));
  if (!source) throw new Error('譜面データが見つかりません');
  const state = readDataScript(source, { sp:[], dp:[], c1:[], c2:[], ln:[], tc:[], sc32:[], sc32base:[], sc32loop:[], k:1, key:7, a:+(['A','L'].includes(difficulty)), l:+(difficulty === 'N'), kuro:+(difficulty === 'L'), hps:1, g:0, pty:0, gap:1, hcn:0 }, true);
  const first = 1 - state.gap, last = Number(state.measure);
  if (!Number.isInteger(first) || first < 0 || !Number.isInteger(last) || last < first || last > 5000) throw new Error('不正な小節数');
  const measureStarts = [], starts = new Map();
  let beat = 0;
  for (let bar = first; bar <= last; bar++) {
    const length = state.ln[bar] || 384;
    if (!Number.isFinite(length) || length <= 0 || length > 24576) throw new Error('不正な小節長');
    starts.set(bar, beat); measureStarts.push(beat); beat += length / 96;
  }
  measureStarts.push(beat);
  const notes = [], bpmPoints = [], holds = new Map();
  for (let bar = first; bar <= last; bar++) {
    const start = starts.get(bar), length = state.ln[bar] || 384;
    for (const note of decodeNotes(state.sp[bar], length)) notes.push({ lane:note.lane, beat:start + note.tick / 96 });
    for (const point of state.tc[bar] ?? []) {
      const bpm = Number(point.slice(0,3)), position = Number(point.slice(3));
      if (!(bpm > 0) || !Number.isFinite(position)) throw new Error('不正なBPM変化');
      bpmPoints.push({ beat:start + position / 32, bpm });
    }
    for (const [lanes, position, height = 30, flags = 3] of state.c1[bar] ?? []) {
      for (const lane of lanes < 10 ? [lanes] : [lanes % 10, Math.floor(lanes / 10)]) {
        const head = start + position / 32;
        // CN bodies leave a 2px cap gap; BSS bodies already specify full length.
        const tail = start + (position + height + (lane > 0 && (flags & 2) ? 2 : 0)) / 32;
        if (flags & 1) {
          if (holds.has(lane)) throw new Error('長押しの開始が重複しています');
          holds.set(lane, { lane, beat:head, kind:lane === 0 ? (state.hcn ? 'HBSS' : 'BSS') : (state.hcn ? 'HCN' : 'CN') });
        }
        if (flags & 2) {
          const hold = holds.get(lane);
          if (!hold) throw new Error('長押しの開始が見つかりません');
          notes.push({ ...hold, endBeat:tail }); holds.delete(lane);
        }
      }
    }
  }
  if (holds.size) throw new Error('長押しの終端が見つかりません');
  bpmPoints.sort((a,b) => a.beat - b.beat);
  const initialBpm = bpmPoints[0]?.bpm ?? Number(String(state.bpm).match(/\d+(?:\.\d+)?/)?.[0]);
  if (!(initialBpm > 0)) throw new Error('BPMが取得できません');
  if (!bpmPoints.length || bpmPoints[0].beat > 0) bpmPoints.unshift({ beat:0, bpm:initialBpm });
  notes.sort((a,b) => a.beat - b.beat || a.lane - b.lane);
  if (notes.length > 100000 || notes.some(note => !Number.isInteger(note.lane) || note.lane < 0 || note.lane > 7 || !Number.isFinite(note.beat) || note.beat < 0 || (note.endBeat !== undefined && (!Number.isFinite(note.endBeat) || note.endBeat <= note.beat)))) throw new Error('不正なノーツ位置');
  const noteCount = notes.reduce((count,note) => count + (note.endBeat === undefined ? 1 : 2), 0);
  if (noteCount !== Number(state.notes)) throw new Error(`譜面の検証に失敗しました（取得 ${noteCount} / 公開ノーツ数 ${state.notes}）。誤った譜面は読み込みません。`);
  return { title:plain(state.title), subtitle:difficulty, artist:plain(state.artist), genre:plain(state.genre), level:String(selected.level), initialBpm, notes, noteCount, bpmPoints, measureStarts, durationBeat:Math.max(beat, ...notes.map(n => n.endBeat ?? n.beat)), source:{ provider:'textage', id:song.id, version:song.version, difficulty, mode:'SP', url:`https://textage.cc/score/${song.version}/${song.id}.html?1${difficulty === 'L' ? 'X' : difficulty}${selected.level.toString(16).toUpperCase()}00` } };
}
