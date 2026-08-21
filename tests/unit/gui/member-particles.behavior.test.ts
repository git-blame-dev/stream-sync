import { describe, expect, it } from "bun:test";

import {
  evaluateMemberParticle,
  generateMemberParticleSet,
  memberParticleHorizontalPosition,
} from "../../../gui/src/shared/member-particles";

describe("member particle behavior", () => {
  it("creates the fixed burst and continuous visual budget", () => {
    const particles = generateMemberParticleSet("fixture-member-42");

    expect(particles.burst).toHaveLength(132);
    expect(particles.continuous).toHaveLength(54);
    expect(particles.burst.every(({ startMs }) => startMs >= 0 && startMs <= 5700)).toBe(true);
    expect(particles.burst.every(({ durationMs }) => Math.abs(durationMs - 3700) <= 150)).toBe(true);
    expect(particles.burst.every(({ y, size, drift }) =>
      y >= 10 && y <= 88 && size >= 1 && size <= 4 && drift >= -11 && drift <= 11,
    )).toBe(true);
    expect(particles.continuous.every(({ y, size, drift, durationMs }) =>
      y >= 10 && y <= 88 && size >= 1 && size <= 3 && drift >= -9 && drift <= 9 &&
      durationMs >= 7500 && durationMs <= 10500,
    )).toBe(true);
  });

  it("is deterministic for a seed while allowing stable event variation", () => {
    expect(generateMemberParticleSet("fixture-member-42")).toEqual(
      generateMemberParticleSet("fixture-member-42"),
    );
    expect(generateMemberParticleSet("fixture-member-42")).not.toEqual(
      generateMemberParticleSet("fixture-member-43"),
    );
  });

  it("randomizes burst entry timing across the complete spawn window", () => {
    const startTimes = generateMemberParticleSet("fixture-member-random-entry").burst
      .map(({ startMs }) => startMs)
      .sort((left, right) => left - right);
    const gaps = startTimes.slice(1).map((startMs, index) => startMs - (startTimes[index] ?? 0));

    expect(startTimes[0]).toBe(0);
    expect(startTimes.at(-1)).toBe(5700);
    expect(new Set(gaps.map((gap) => gap.toFixed(3))).size).toBeGreaterThan(10);
  });

  it("uses a 15.7 second cycle with a 6.3 second post-burst exit window", () => {
    const particles = generateMemberParticleSet("fixture-member-cycle");
    expect(particles.cycleMs).toBe(15700);
    expect(Math.max(...particles.burst.map(({ startMs, durationMs }) => startMs + durationMs))).toBeCloseTo(9400, -2);
    expect(particles.cycleMs - 9400).toBeCloseTo(6300, -2);
  });

  it("evaluates right-to-left motion only during a particle crossing", () => {
    const particle = { startMs: 1000, durationMs: 3700, y: 40, size: 2, drift: 6 };
    expect(evaluateMemberParticle(particle, 999)).toBeNull();
    expect(evaluateMemberParticle(particle, 1000)).toMatchObject({ x: 100, y: 40, size: 2 });
    expect(evaluateMemberParticle(particle, 2850)?.x).toBeCloseTo(50, 5);
    expect(evaluateMemberParticle(particle, 4700)).toBeNull();
  });

  it("mirrors left-to-right travel across the canvas while keeping the sprite in bounds at exit", () => {
    expect(memberParticleHorizontalPosition("left-to-right", 0, 120, 8)).toBe(-8);
    expect(memberParticleHorizontalPosition("left-to-right", 0.5, 120, 8)).toBe(52);
    expect(memberParticleHorizontalPosition("left-to-right", 1, 120, 8)).toBe(112);
    expect(memberParticleHorizontalPosition("right-to-left", 0, 120, 8)).toBe(120);
    expect(memberParticleHorizontalPosition("right-to-left", 0.5, 120, 8)).toBe(60);
    expect(memberParticleHorizontalPosition("right-to-left", 1, 120, 8)).toBe(0);
  });
});
