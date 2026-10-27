export type Note = { beat: number; lane: number; endBeat?: number };
export type BpmPoint = { beat: number; bpm: number };

export type Chart = {
  title: string;
  subtitle: string;
  artist: string;
  level: string;
  initialBpm: number;
  notes: Note[];
  bpmPoints: BpmPoint[];
  measureStarts: number[];
  durationBeat: number;
};

export type ReplayEvent = {
  tUs: number;
  lane: number;
  pressed: boolean;
  source?: string;
};

export type Replay = {
  title: string;
  chart: string;
  events: ReplayEvent[];
  syncMarkersUs: number[];
  durationUs: number;
};
