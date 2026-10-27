import type { BpmPoint, Chart, ChartSource, Note, Replay } from "./types";

const CHANNEL_TO_LANE: Record<string, number> = {
  "16": 0,
  "11": 1,
  "12": 2,
  "13": 3,
  "14": 4,
  "15": 5,
  "18": 6,
  "19": 7,
};

type RawLine = { measure: number; channel: string; data: string };

const textDecoder = (buffer: ArrayBuffer) => {
  for (const encoding of ["shift-jis", "utf-8"]) {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(buffer);
    } catch {
      // Try the next encoding. Browsers without Shift_JIS use UTF-8 below.
    }
  }
  return new TextDecoder().decode(buffer);
};

const headerValue = (text: string, key: string) => {
  const match = text.match(new RegExp(`^#${key}\\s+(.+)$`, "im"));
  return match?.[1].trim() ?? "";
};

const objectValue = (text: string, token: string) => {
  const value = parseInt(token, 36);
  return Number.isFinite(value) ? value : 0;
};

function collectLines(text: string): RawLine[] {
  const result: RawLine[] = [];
  const matcher = /^#(\d{3})([0-9A-Z]{2}):([0-9A-Z]+)\s*$/gim;
  for (const match of text.matchAll(matcher)) {
    if (match[3].length % 2 === 0) {
      result.push({ measure: Number(match[1]), channel: match[2].toUpperCase(), data: match[3].toUpperCase() });
    }
  }
  return result;
}

function buildMeasureStarts(lines: RawLine[]) {
  const lastMeasure = Math.max(0, ...lines.map((line) => line.measure));
  const lengths = new Map<number, number>();
  for (const line of lines) {
    if (line.channel === "02") {
      const length = Number(line.data);
      if (Number.isFinite(length) && length > 0) lengths.set(line.measure, length);
    }
  }
  const measureStarts: number[] = [];
  let beat = 0;
  for (let measure = 0; measure <= lastMeasure + 1; measure += 1) {
    measureStarts.push(beat);
    beat += 4 * (lengths.get(measure) ?? 1);
  }
  return measureStarts;
}

function parseBpmPoints(lines: RawLine[], starts: number[], initialBpm: number, extendedBpms: Map<string, number>) {
  const points: BpmPoint[] = [{ beat: 0, bpm: initialBpm }];
  for (const line of lines) {
    if (line.channel !== "03" && line.channel !== "08") continue;
    const count = line.data.length / 2;
    for (let index = 0; index < count; index += 1) {
      const token = line.data.slice(index * 2, index * 2 + 2);
      if (token === "00") continue;
      const bpm = line.channel === "03" ? parseInt(token, 16) : extendedBpms.get(token);
      if (bpm && bpm > 0) {
        points.push({ beat: starts[line.measure] + (index / count) * (starts[line.measure + 1] - starts[line.measure]), bpm });
      }
    }
  }
  return points.sort((left, right) => left.beat - right.beat);
}

export function parseBms(buffer: ArrayBuffer): Chart {
  const text = textDecoder(buffer).replace(/\r/g, "");
  const lines = collectLines(text);
  const initialBpm = Number(headerValue(text, "BPM")) || 120;
  const extendedBpms = new Map<string, number>();
  for (const match of text.matchAll(/^#BPM([0-9A-Z]{2})\s+(.+)$/gim)) {
    const bpm = Number(match[2]);
    if (bpm > 0) extendedBpms.set(match[1].toUpperCase(), bpm);
  }
  const measureStarts = buildMeasureStarts(lines);
  const bpmPoints = parseBpmPoints(lines, measureStarts, initialBpm, extendedBpms);
  const notes: Note[] = [];
  for (const line of lines) {
    const lane = CHANNEL_TO_LANE[line.channel];
    if (lane === undefined) continue;
    const count = line.data.length / 2;
    for (let index = 0; index < count; index += 1) {
      if (line.data.slice(index * 2, index * 2 + 2) === "00") continue;
      notes.push({ beat: measureStarts[line.measure] + (index / count) * (measureStarts[line.measure + 1] - measureStarts[line.measure]), lane });
    }
  }
  notes.sort((left, right) => left.beat - right.beat || left.lane - right.lane);
  return {
    title: headerValue(text, "TITLE") || "Untitled BMS",
    subtitle: headerValue(text, "SUBTITLE"),
    artist: headerValue(text, "ARTIST"),
    level: headerValue(text, "PLAYLEVEL"),
    initialBpm,
    notes,
    bpmPoints,
    measureStarts,
    durationBeat: Math.max(4, measureStarts.at(-1) ?? 4),
  };
}

export function beatToSeconds(chart: Chart, beat: number) {
  let seconds = 0;
  let previousBeat = 0;
  let bpm = chart.initialBpm;
  for (const point of chart.bpmPoints) {
    if (point.beat >= beat) break;
    seconds += ((point.beat - previousBeat) * 60) / bpm;
    previousBeat = point.beat;
    bpm = point.bpm;
  }
  return seconds + ((beat - previousBeat) * 60) / bpm;
}

export function secondsToBeat(chart: Chart, seconds: number) {
  let elapsed = 0;
  let previousBeat = 0;
  let bpm = chart.initialBpm;
  for (const point of chart.bpmPoints) {
    const segmentSeconds = ((point.beat - previousBeat) * 60) / bpm;
    if (elapsed + segmentSeconds >= seconds) return previousBeat + ((seconds - elapsed) * bpm) / 60;
    elapsed += segmentSeconds;
    previousBeat = point.beat;
    bpm = point.bpm;
  }
  return previousBeat + ((seconds - elapsed) * bpm) / 60;
}

export function parseReplay(value: unknown): Replay {
  if (!value || typeof value !== 'object') throw new Error('Invalid replay');
  const data = value as { game?: unknown; song?: { title?: unknown; chart?: unknown }; chart_source?: unknown; events?: unknown; sync_markers?: unknown; duration_us?: unknown };
  const events = Array.isArray(data.events) ? data.events.flatMap((event) => {
    if (typeof event !== "object" || event === null) return [];
    const item = event as { t_us?: unknown; lane?: unknown; pressed?: unknown; source?: unknown };
    return typeof item.t_us === "number" && Number.isFinite(item.t_us) && item.t_us >= 0 && typeof item.lane === "number" && Number.isInteger(item.lane) && item.lane >= 0 && item.lane <= 17 && typeof item.pressed === "boolean"
      ? [{ tUs: item.t_us, lane: item.lane, pressed: item.pressed, source: typeof item.source === "string" ? item.source : undefined }]
      : [];
  }) : [];
  const syncMarkersUs = Array.isArray(data.sync_markers) ? data.sync_markers.flatMap((marker) => {
    const time = (marker as { t_us?: unknown })?.t_us;
    return typeof time === "number" ? [time] : [];
  }) : [];
  const ref = data.chart_source as Partial<ChartSource> | undefined;
  const chartSource = ref?.provider === 'textage' && typeof ref.id === 'string' && /^[\w-]{1,60}$/.test(ref.id) && ['N','H','A','L'].includes(ref.difficulty ?? '') && ref.mode === 'SP' ? ref as ChartSource : undefined;
  return {
    game: typeof data.game === 'string' ? data.game : undefined,
    title: typeof data.song?.title === "string" ? data.song.title : "",
    chart: typeof data.song?.chart === "string" ? data.song.chart : "",
    events: events.sort((a,b) => a.tUs - b.tUs),
    syncMarkersUs,
    durationUs: typeof data.duration_us === "number" ? data.duration_us : 0,
    chartSource,
  };
}
