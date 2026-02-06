import type { NextApiRequest, NextApiResponse } from "next";
import { PatmosRequest, PatmosResponse, TimingComparison } from "@/lib/types";

/**
 * Patmos obstacle avoidance endpoint (mock).
 *
 * Uses a deterministic mock that mirrors what Patmos would compute.
 * All timing values simulate real Patmos behavior.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PatmosResponse & { timingComparison: TimingComparison }>
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }
  const { distance, speed, lane, deadline_cycles } = req.body as PatmosRequest;

  // === Deterministic control logic (mirrors control.c) ===
  // This is exactly what the Patmos-compiled binary would compute.
  // All branches are statically bounded. No loops. No dynamic memory.

  let action: PatmosResponse["action"] = "none";
  let target_lane = lane;
  let brake_force = 0;
  let cycles_used = 0;
  let execution_path = "";

  if (distance < 200) {
    if (lane === 0) {
      // Branch A: lane change right
      action = "steer";
      target_lane = 1;
      brake_force = 0;
      cycles_used = deterministic_cycles("steer", distance, speed);
      execution_path = "branch_A: distance < threshold → lane 0 → steer right";
    } else {
      // Branch B: emergency brake
      action = "brake";
      target_lane = lane;
      brake_force = Math.min(1.0, speed / 200);
      cycles_used = deterministic_cycles("brake", distance, speed);
      execution_path = "branch_B: distance < threshold → lane 1 → brake";
    }
  } else {
    // Branch C: no action needed
    cycles_used = deterministic_cycles("none", distance, speed);
    execution_path = "branch_C: distance >= threshold → no action";
  }

  const deadline_met = cycles_used <= deadline_cycles;

  // Simulate Patmos execution latency (50-150ms for realism of pasim call)
  const latency = 80 + Math.floor(distance * 0.1);

  // Compute timing comparison: Patmos (deterministic) vs Normal CPU (jittery)
  const normalBase = Math.floor(cycles_used * 0.85);
  const normalJitter = Math.floor(cycles_used * 0.35);
  const normalCycles = normalBase + Math.floor(Math.random() * normalJitter);

  const timingComparison: TimingComparison = {
    patmos: {
      cycles: cycles_used,
      wcet: cycles_used,
      bcet: cycles_used,
      jitter: 0,
      executionTimeMs: cycles_used * 0.01,
    },
    normal: {
      cycles: normalCycles,
      wcet: normalBase + normalJitter,
      bcet: normalBase,
      jitter: normalJitter,
      executionTimeMs: normalCycles * 0.004,
    },
    speedup: normalCycles / cycles_used,
    predictabilityGain: normalJitter > 0 ? normalJitter : 1,
  };

  // Simulate pasim execution latency
  await new Promise((resolve) => setTimeout(resolve, Math.min(latency, 200)));

  return res.status(200).json({
    action,
    target_lane,
    brake_force,
    cycles_used,
    deadline_cycles,
    deadline_met,
    execution_path,
    timestamp: Date.now(),
    timingComparison,
  });
}

/**
 * Simulate deterministic cycle counts.
 * On real Patmos hardware, these are exact and repeatable.
 * We model them as fixed per-branch values (no jitter).
 */
function deterministic_cycles(
  action: string,
  distance: number,
  speed: number
): number {
  // Base cycles per branch (would come from pasim trace)
  const base: Record<string, number> = {
    steer: 542,
    brake: 618,
    none: 124,
  };

  // On real Patmos, cycle count is fixed for a given execution path.
  // The input values don't change cycle count — only the branch taken matters.
  // This is the whole point of time-predictable architectures.
  return base[action] ?? 200;
}
