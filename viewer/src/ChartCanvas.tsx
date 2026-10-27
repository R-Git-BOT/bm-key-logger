import { useEffect, useMemo, useRef } from "react";
import { secondsToBeat } from "./bms";
import { bpmAt, laneGeometry, pixelsPerBeat, replayLane } from "./viewer-model";
import type { PlaySide } from "./viewer-model";
import type { Chart, Replay } from "./types";
import { eventIndex } from './chart-events';
import type { HitEvent } from './chart-events';

const NOTE_COLORS = ["#cc3333", "#dddddd", "#3366cc", "#dddddd", "#3366cc", "#dddddd", "#3366cc", "#dddddd"];
type Props = { chart: Chart | null; replay: Replay | null; time: number; hiSpeed: number; offsetMs: number; side: PlaySide; sourceSide: PlaySide; showInputs: boolean; hidePassed: boolean; explosions: boolean; isPlaying: boolean; playbackRate: number; hits: HitEvent[] };

export default function ChartCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const inputs = useMemo(() => {
    if (!props.chart || !props.replay) return [];
    const held = new Map<number, {lane: number; beat: number; endBeat?: number}>();
    const result: {lane: number; beat: number; endBeat?: number; release?: boolean}[] = [];
    for (const event of props.replay.events) {
      const lane = replayLane(event.lane, props.sourceSide);
      if (lane === null) continue;
      const beat = secondsToBeat(props.chart,event.tUs / 1e6 + props.offsetMs / 1000);
      if (event.pressed) { const press = {lane,beat}; held.set(event.lane,press); result.push(press); }
      else { const press = held.get(event.lane); if (press) press.endBeat = beat; held.delete(event.lane); result.push({lane,beat,release:true}); }
    }
    return result;
  }, [props.chart, props.replay, props.sourceSide, props.offsetMs]);
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => { latest.current = props; drawRef.current(); }, [props, inputs]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const draw = () => {
      const { chart, time, hiSpeed, side, hidePassed, showInputs, explosions, isPlaying, playbackRate, hits } = latest.current;
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
      const drawNote = (laneId: number, noteBeat: number, input: boolean, color?: string, release = false) => {
        const lane = lanes[laneId];
        if (!lane) return;
        const y = judgementY - (noteBeat - beat) * ppb;
        if (y < -10 || y > height + 10 || (hidePassed && y > judgementY + .01)) return;
        const gap = Math.min(4, lane.width * .1);
        if (input) {
          context.strokeStyle = "#ffcc00"; context.lineWidth = 2;
          if (release) { context.fillStyle = '#ffcc00'; context.fillRect(left + lane.x + gap, y - 1, lane.width - gap * 2, 1); }
          else context.strokeRect(left + lane.x + gap, y - 10, lane.width - gap * 2, 10);
        } else {
          context.fillStyle = color ?? NOTE_COLORS[laneId];
          context.fillRect(left + lane.x + gap, y - 10, lane.width - gap * 2, 10);
        }
      };
      const drawBody = (laneId: number, start: number, end: number, color: string, input = false) => {
        const lane = lanes[laneId];
        if (!lane) return;
        const top = Math.max(-12,judgementY - (end - beat) * ppb);
        const bottom = Math.min(hidePassed ? judgementY : height + 12,judgementY - (start - beat) * ppb);
        if (bottom <= top) return;
        context.fillStyle = color;
        const inset = input ? lane.width * .44 : Math.min(7,lane.width * .2);
        context.fillRect(left + lane.x + inset, top, lane.width - inset * 2, bottom - top);
      };
      for (const note of chart?.notes ?? []) {
        if (note.endBeat === undefined) { drawNote(note.lane,note.beat,false); continue; }
        const hell = note.kind === 'HCN' || note.kind === 'HBSS';
        const scratch = note.lane === 0;
        const color = hell ? (scratch ? '#ff7547' : '#ffb347') : (scratch ? '#ff5577' : '#65d6ff');
        drawBody(note.lane,note.beat,note.endBeat,hell ? '#a65d23' : scratch ? '#872840' : '#27627c');
        drawNote(note.lane,note.beat,false,color); drawNote(note.lane,note.endBeat,false,color);
        if (scratch) {
          const lane = lanes[0], y = judgementY - (note.endBeat - beat) * ppb;
          if (y >= 12 && y < judgementY) { context.fillStyle = color; context.font = 'bold 15px Arial'; context.textAlign = 'center'; context.fillText('↶',left + lane.x + lane.width / 2,y - 14); }
        }
      }
      if (showInputs) for (const input of inputs) {
        if (input.endBeat !== undefined) drawBody(input.lane,input.beat,input.endBeat,'#ffcc0066',true);
        drawNote(input.lane,input.beat,true,undefined,input.release);
      }
      const glow = context.createLinearGradient(0, judgementY - 24, 0, judgementY);
      glow.addColorStop(0, "#ffffff00"); glow.addColorStop(1, "#ffffff60");
      context.fillStyle = glow; context.fillRect(left, judgementY - 24, fieldWidth, 24);
      context.fillStyle = "#ff3333"; context.fillRect(left, judgementY, fieldWidth, 2);
      context.fillStyle = "#ffff66"; context.fillRect(left, judgementY - 1, fieldWidth, 1);
      if (explosions && isPlaying) {
        const intensity = Array(8).fill(0);
        const lifespan = .18 * playbackRate;
        for (let index = eventIndex(hits,time - lifespan); index < hits.length && hits[index].time <= time; index++) {
          const hit = hits[index]; intensity[hit.lane] = Math.max(intensity[hit.lane],1 - (time - hit.time) / lifespan);
        }
        for (const note of chart?.notes ?? []) if (note.endBeat !== undefined && note.beat <= beat && beat < note.endBeat) intensity[note.lane] = Math.max(intensity[note.lane],.65 + .15 * Math.sin(time * 40));
        intensity.forEach((strength,laneId) => {
          if (strength <= 0) return;
          const lane = lanes[laneId], x = left + lane.x + lane.width / 2;
          context.save(); context.globalCompositeOperation = 'lighter';
          const burst = context.createRadialGradient(x,judgementY,0,x,judgementY,40);
          burst.addColorStop(0,`rgba(255,255,255,${strength})`); burst.addColorStop(.25,`rgba(${laneId === 0 ? '255,90,100' : '80,160,255'},${strength * .8})`); burst.addColorStop(1,'rgba(0,0,0,0)');
          context.fillStyle = burst; context.fillRect(x - 40,judgementY - 40,80,65);
          context.strokeStyle = `rgba(180,220,255,${strength})`; context.lineWidth = 1.5;
          for (let spark = 0; spark < 6; spark++) { const angle = Math.PI + spark * Math.PI / 5, distance = 12 + (1 - strength) * 24; context.beginPath(); context.moveTo(x + Math.cos(angle) * distance,judgementY + Math.sin(angle) * distance); context.lineTo(x + Math.cos(angle) * (distance + 9),judgementY + Math.sin(angle) * (distance + 9)); context.stroke(); }
          context.restore();
        });
      }
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
