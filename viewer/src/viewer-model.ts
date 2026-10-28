export type PlaySide = "1P" | "2P";

// Match the reference viewer's geometry: 4.5 visible beats at HS 1.00.
// IIDX green number = visible seconds * 600 (300 = 500 ms).
export const BASE_VISIBLE_BEATS = 4.5;
export const DEFAULT_GREEN = 300;
export const greenFor = (bpm: number, hiSpeed: number) => 600 * 60 * BASE_VISIBLE_BEATS / (bpm * hiSpeed);
export const hiSpeedFor = (bpm: number, green: number) => 600 * 60 * BASE_VISIBLE_BEATS / (bpm * green);
export const pixelsPerBeat = (height: number, hiSpeed: number) => height * hiSpeed / BASE_VISIBLE_BEATS;

// Playside moves only the scratch. It must not mirror keys 1–7.
export function laneGeometry(side: PlaySide, width: number) {
  const keyWidth = width / 9.5;
  const scratchWidth = keyWidth * 2.5;
  return Array.from({ length: 8 }, (_, lane) => lane === 0
    ? { x: side === "1P" ? 0 : keyWidth * 7, width: scratchWidth }
    : { x: (side === "1P" ? scratchWidth : 0) + (lane - 1) * keyWidth, width: keyWidth });
}

export function replayLane(rawLane: number, sourceSide: PlaySide) {
  if (sourceSide === "1P") {
    if (rawLane === 0 || rawLane === 1) return 0;
    return rawLane >= 2 && rawLane <= 8 ? rawLane - 1 : null;
  }
  if (rawLane === 16 || rawLane === 17) return 0;
  return rawLane >= 9 && rawLane <= 15 ? rawLane - 8 : null;
}

export function bpmAt(points: { beat: number; bpm: number }[], initial: number, beat: number) {
  let bpm = initial;
  for (const point of points) {
    if (point.beat > beat) break;
    bpm = point.bpm;
  }
  return bpm;
}

export const formatTime = (time: number) => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, "0")}`;
