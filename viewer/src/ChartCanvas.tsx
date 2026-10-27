import { useEffect, useMemo, useRef } from "react";
import { secondsToBeat } from "./bms";
import { bpmAt, laneGeometry, pixelsPerBeat, replayLane } from "./viewer-model";
import type { PlaySide } from "./viewer-model";
import type { Chart, Replay } from "./types";

const NOTE_COLORS = ["#cc3333", "#dddddd", "#3366cc", "#dddddd", "#3366cc", "#dddddd", "#3366cc", "#dddddd"];
type Props = { chart: Chart | null; replay: Replay | null; time: number; hiSpeed: number; offsetMs: number; side: PlaySide; sourceSide: PlaySide; showInputs: boolean; hidePassed: boolean };

export default function ChartCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const inputs = useMemo(() => props.chart && props.replay ? props.replay.events.flatMap(event => {
    const lane = replayLane(event.lane, props.sourceSide);
    if (!event.pressed || lane === null) return [];
    return [{ lane, beat: secondsToBeat(props.chart!, event.tUs / 1e6 + props.offsetMs / 1000) }];
  }) : [], [props.chart, props.replay, props.sourceSide, props.offsetMs]);
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => { latest.current = props; drawRef.current(); }, [props, inputs]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const draw = () => {
      const { chart, time, hiSpeed, side, hidePassed, showInputs } = latest.current;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#0a0a0a"; context.fillRect(0, 0, width, height);
      const fieldWidth = Math.min(380, width * .70);
      const left = (width - fieldWidth) / 2;
      const judgementY = height * .9;
      const ppb = pixelsPerBeat(judgementY, hiSpeed);
      const beat = chart ? secondsToBeat(chart, time) : 0;
      const lanes = laneGeometry(side, fieldWidth);
      context.fillStyle = "#1a1a1a"; context.fillRect(left, 0, fieldWidth, height);
      context.strokeStyle = "#333333"; context.lineWidth = 1;
      for (const lane of lanes) {
        context.strokeRect(Math.round(left + lane.x) + .5, -.5, Math.round(lane.width), height + 1);
      }
      context.font = "20px Arial, sans-serif"; context.textAlign = "right";
      (chart?.measureStarts ?? [0, 4, 8]).forEach((measure, index) => {
        const y = judgementY - (measure - beat) * ppb;
        if (y < -20 || y > height + 20) return;
        context.fillStyle = "#444444"; context.fillRect(left, Math.round(y), fieldWidth, 1);
        context.fillStyle = "#888888"; context.fillText(String(index + 1), left - 8, y + 5);
      });
      const drawNote = (laneId: number, noteBeat: number, input: boolean) => {
        const lane = lanes[laneId];
        if (!lane) return;
        const y = judgementY - (noteBeat - beat) * ppb;
        if (y < -10 || y > height + 10 || (hidePassed && y > judgementY + 1)) return;
        const gap = Math.min(4, lane.width * .1);
        if (input) {
          context.strokeStyle = "#ffcc00"; context.lineWidth = 2;
          context.strokeRect(left + lane.x + gap, y - 6, lane.width - gap * 2, 10);
        } else {
          context.fillStyle = NOTE_COLORS[laneId];
          context.fillRect(left + lane.x + gap, y - 8, lane.width - gap * 2, 10);
        }
      };
      for (const note of chart?.notes ?? []) drawNote(note.lane, note.beat, false);
      if (showInputs) for (const input of inputs) drawNote(input.lane, input.beat, true);
      const glow = context.createLinearGradient(0, judgementY - 24, 0, judgementY);
      glow.addColorStop(0, "#ffffff00"); glow.addColorStop(1, "#ffffff60");
      context.fillStyle = glow; context.fillRect(left, judgementY - 24, fieldWidth, 24);
      context.fillStyle = "#ff3333"; context.fillRect(left, judgementY, fieldWidth, 2);
      context.fillStyle = "#ffff66"; context.fillRect(left, judgementY - 1, fieldWidth, 1);
      context.textAlign = "left"; context.fillStyle = "#00ff00";
      context.font = "bold 20px Arial, sans-serif";
      context.fillText(chart ? String(Math.round(bpmAt(chart.bpmPoints, chart.initialBpm, beat))) : "—", left + fieldWidth + 5, judgementY + 3);
      context.font = "10px Arial, sans-serif"; context.fillText("BPM", left + fieldWidth + 5, judgementY + 15);
    };
    drawRef.current = draw;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas); draw();
    return () => observer.disconnect();
  }, [inputs]);
  return <canvas ref={ref} className="chart-canvas" aria-label={`譜面表示 ${props.side}（スクラッチ${props.side === "1P" ? "左" : "右"}）`} />;
}
