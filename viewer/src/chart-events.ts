import { beatToSeconds } from './bms.ts';
import type { Chart } from './types';

export type HitEvent = { time: number; lane: number; tail: boolean };
export function chartEvents(chart: Chart): HitEvent[] {
  return chart.notes.flatMap(note => [
    { time:beatToSeconds(chart,note.beat), lane:note.lane, tail:false },
    ...(note.endBeat === undefined ? [] : [{ time:beatToSeconds(chart,note.endBeat), lane:note.lane, tail:true }]),
  ]).sort((a,b) => a.time - b.time || a.lane - b.lane);
}
export function eventIndex(events: readonly { time: number }[], time: number) {
  let low = 0, high = events.length;
  while (low < high) { const mid = (low + high) >>> 1; if (events[mid].time < time - 1e-7) low = mid + 1; else high = mid; }
  return low;
}
