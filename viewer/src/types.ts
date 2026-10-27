export type Difficulty = "N" | "H" | "A" | "L";
export type ChartSource = { provider: "textage"; id: string; version: string; difficulty: Difficulty; mode: "SP"; url: string };
export type Note = { beat: number; lane: number; endBeat?: number; kind?: "CN" | "HCN" | "BSS" | "HBSS" };
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
  noteCount?: number;
  genre?: string;
  source?: ChartSource;
};

export type ReplayEvent = {
  tUs: number;
  lane: number;
  pressed: boolean;
  source?: string;
};

export type Replay = {
  game?: string;
  title: string;
  chart: string;
  events: ReplayEvent[];
  syncMarkersUs: number[];
  durationUs: number;
  chartSource?: ChartSource;
};

export type CatalogSong = { id: string; version: string; title: string; artist: string; genre: string; bpm: string; difficulties: { difficulty: Difficulty; level: number; noteCount: number; infinitas: boolean }[] };
