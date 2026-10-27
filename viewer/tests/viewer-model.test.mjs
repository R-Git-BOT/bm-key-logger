import { test } from "node:test";
import assert from "node:assert/strict";
import { greenFor, hiSpeedFor, pixelsPerBeat, laneGeometry, replayLane } from "../src/viewer-model.ts";

test("reference viewer: BPM 200, HS 1 = green 810; green 300 = HS 2.7", () => {
  assert.equal(greenFor(200, 1), 810);
  assert.equal(hiSpeedFor(200, 300), 2.7);
});

test("green 300 actually traverses the visible field in 500ms at any canvas size", () => {
  for (const bpm of [100, 150, 200]) {
    for (const height of [378, 540, 720]) {
      const hs = hiSpeedFor(bpm, 300);
      const pixelsPerSecond = pixelsPerBeat(height, hs) * bpm / 60;
      assert.ok(Math.abs(height / pixelsPerSecond - .5) < 1e-9);
      assert.equal(greenFor(bpm, hs * 2), 150);
    }
  }
});

test("fixed Hi-Speed preserves BPM changes instead of fixing green number", () => {
  assert.equal(greenFor(100, 2), 810);
  assert.equal(greenFor(200, 2), 405);
});

test("Playside swaps scratch side and preserves ascending key order", () => {
  const left = laneGeometry("1P", 380), right = laneGeometry("2P", 380);
  assert.equal(left[0].x, 0);
  assert.equal(left[1].x, 100);
  assert.equal(right[0].x, 280);
  assert.equal(right[1].x, 0);
  for (let lane = 2; lane <= 7; lane++) assert.ok(right[lane].x > right[lane - 1].x);
  assert.equal(right[0].x + right[0].width, 380);
});

test("1P and 2P input logs map to the same logical chart keys without mixing them", () => {
  assert.equal(replayLane(0, "1P"), 0);
  assert.equal(replayLane(1, "1P"), 0);
  assert.equal(replayLane(2, "1P"), 1);
  assert.equal(replayLane(8, "1P"), 7);
  assert.equal(replayLane(9, "2P"), 1);
  assert.equal(replayLane(15, "2P"), 7);
  assert.equal(replayLane(16, "2P"), 0);
  assert.equal(replayLane(17, "2P"), 0);
  assert.equal(replayLane(9, "1P"), null);
  assert.equal(replayLane(2, "2P"), null);
});
