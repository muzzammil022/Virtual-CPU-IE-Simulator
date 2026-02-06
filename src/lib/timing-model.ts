/**
 * ══════════════════════════════════════════════════════════════════════
 *  Patmos Timing Advantage Model
 * ──────────────────────────────────────────────────────────────────────
 *  Based on the Patmos time-predictable processor architecture.
 *  References:
 *    - M. Schoeberl et al., "t-CREST: Time-predictable Multi-Core
 *      Architecture for Embedded Systems," JSA 2015
 *    - Patmos handbook (method cache, scratchpad, split-phase pipeline)
 *
 *  ── Core Insight ─────────────────────────────────────────────────────
 *
 *  A normal CPU executes task T in:
 *
 *    T_normal = N × CPI + C_miss + C_branch + C_os
 *
 *  where C_miss, C_branch, C_os are non-deterministic overhead.
 *
 *  Patmos's architecture ELIMINATES these overheads:
 *
 *    T_patmos = T_normal − ΔC_cache − ΔC_branch − ΔC_os
 *             = N × CPI_patmos                              (simplified)
 *
 *  The savings Patmos provides over a normal CPU:
 *
 *    ΔC_cache  = P_miss × N_mem    × L_miss     (method cache eliminates)
 *    ΔC_branch = P_bp   × N_branch × L_flush    (no speculation needed)
 *    ΔC_os     = δ(t)                            (no OS jitter in SPM)
 *
 *  Deadline Safety Margin (Patmos advantage):
 *
 *              D − T_patmos
 *    S  =  ─────────────────  × 100%
 *                  D
 *
 *  Patmos guarantees S > 0 for all runs (WCET = BCET).
 *  Normal CPU: S varies per run → risk of S < 0 (deadline miss).
 *
 *  Predictability Metric:
 *
 *                J_normal         WCET_normal − BCET_normal
 *    P  =  ──────────────  =  ──────────────────────────────
 *             J_patmos + ε                  0 + ε
 *
 *    P → ∞  (Patmos has zero jitter by architecture)
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Architecture Parameters ──────────────────────────────────────────

/** Patmos architecture constants */
export const PATMOS = {
  CPI: 1.0,           // Cycles per instruction (single-issue, in-order)
  clockMHz: 80,       // 80 MHz (Patmos on Altera DE2-115)
  cacheMissRate: 0,   // Method cache → predictable, modeled as 0 variance
  branchPenalty: 0,   // No speculation → no misprediction penalty
  jitterCycles: 0,    // Deterministic by design
  scratchpadLatency: 1, // Single-cycle scratchpad access
} as const;

/** Typical out-of-order CPU constants */
export const NORMAL_CPU = {
  CPI: 0.8,            // Superscalar → can be < 1 (IPC > 1)
  clockMHz: 1000,      // 1 GHz (representative embedded)
  cacheMissRate: 0.08, // 8% L1 miss rate (typical embedded workload)
  cacheMissPenalty: 100,// 100 cycles to go to L2/main memory
  branchMispredRate: 0.12, // 12% misprediction rate
  branchFlushPenalty: 15,  // 15-cycle pipeline flush
  osJitterRange: [5, 50] as readonly [number, number], // OS scheduling noise in cycles
} as const;

// ── Task Profile ─────────────────────────────────────────────────────

export interface TaskProfile {
  name: string;
  N_instr: number;    // total instructions
  N_mem: number;       // memory access instructions
  N_branch: number;    // branch instructions
  deadline_cycles: number; // hard deadline in cycles (at Patmos clock)
}

/** Obstacle avoidance decision task (the one our sim uses) */
export const AVOIDANCE_TASK: TaskProfile = {
  name: "obstacle_avoid",
  N_instr: 542,       // instructions in avoidance path
  N_mem: 87,          // ~16% are memory accesses
  N_branch: 34,       // ~6% are branches (if/switch on sensor data)
  deadline_cycles: 800,
};

/** No-action path (obstacle not in lane) */
export const NOOP_TASK: TaskProfile = {
  name: "obstacle_noop",
  N_instr: 124,
  N_mem: 18,
  N_branch: 8,
  deadline_cycles: 800,
};

// ── Timing Computation ───────────────────────────────────────────────

export interface TimingResult {
  cycles: number;
  wcet: number;
  bcet: number;
  jitter: number;           // wcet - bcet
  executionTimeUs: number;  // in microseconds
  deadlineMet: boolean;
  marginCycles: number;     // deadline - cycles (negative = missed)
  breakdown: {
    base: number;
    cachePenalty: number;
    branchPenalty: number;
    osPenalty: number;
  };
}

/**
 * Patmos execution time — DETERMINISTIC
 *
 *   T_patmos = N_instr × CPI_patmos
 *            = T_normal − ΔC_cache − ΔC_branch − ΔC_os
 *
 * WCET = BCET = T  →  jitter = 0  (by architecture guarantee)
 */
export function computePatmosTiming(task: TaskProfile): TimingResult {
  const base = Math.ceil(task.N_instr * PATMOS.CPI);
  const cycles = base;

  return {
    cycles,
    wcet: cycles,   // always the same
    bcet: cycles,   // always the same
    jitter: 0,
    executionTimeUs: (cycles / PATMOS.clockMHz),
    deadlineMet: cycles <= task.deadline_cycles,
    marginCycles: task.deadline_cycles - cycles,
    breakdown: {
      base,
      cachePenalty: 0,
      branchPenalty: 0,
      osPenalty: 0,
    },
  };
}

/**
 * Normal CPU execution time — NON-DETERMINISTIC
 *
 *   T_normal = N_instr × CPI_base
 *     + P_miss  × N_mem    × L_miss        ← Patmos eliminates (method cache)
 *     + P_bp    × N_branch × L_flush       ← Patmos eliminates (no speculation)
 *     + δ(t)                               ← Patmos eliminates (scratchpad, no OS jitter)
 *
 * Each call produces a DIFFERENT result (simulating runtime variance).
 * The difference T_normal − T_patmos = Patmos's cycle savings.
 */
export function computeNormalTiming(task: TaskProfile): TimingResult {
  const C = NORMAL_CPU;
  const base = Math.ceil(task.N_instr * C.CPI);

  // Actual cache misses this run (binomial sample approximation)
  const actualMisses = sampleBinomial(task.N_mem, C.cacheMissRate);
  const cachePenalty = actualMisses * C.cacheMissPenalty;

  // Actual branch mispredictions this run
  const actualMispreds = sampleBinomial(task.N_branch, C.branchMispredRate);
  const branchPenalty = actualMispreds * C.branchFlushPenalty;

  // OS/interrupt jitter
  const osPenalty = randInt(C.osJitterRange[0], C.osJitterRange[1]);

  const cycles = base + cachePenalty + branchPenalty + osPenalty;

  // Analytical WCET: worst case for all sources
  const wcet = base
    + Math.ceil(task.N_mem * C.cacheMissRate * 1.5) * C.cacheMissPenalty  // pessimistic miss rate
    + Math.ceil(task.N_branch * C.branchMispredRate * 1.5) * C.branchFlushPenalty
    + C.osJitterRange[1];

  // Analytical BCET: best case
  const bcet = base + C.osJitterRange[0]; // ~zero misses, minimal OS jitter

  return {
    cycles,
    wcet,
    bcet,
    jitter: wcet - bcet,
    executionTimeUs: (cycles / C.clockMHz),
    deadlineMet: cycles <= task.deadline_cycles,
    marginCycles: task.deadline_cycles - cycles,
    breakdown: {
      base,
      cachePenalty,
      branchPenalty,
      osPenalty,
    },
  };
}

/**
 * Convert cycle count to wall-clock delay (ms) for the simulation.
 * Patmos: deterministic mapping.
 * Normal: adds jitter to simulate real-world scheduling variance.
 */
export function cyclesToSimDelayMs(
  timing: TimingResult,
  mode: "patmos" | "normal"
): number {
  if (mode === "patmos") {
    // Patmos @ 80 MHz → ~6.78 µs for 542 cycles → scale up for visual effect
    // We use a fixed 5ms to keep it visually snappy but consistent
    return 5;
  }
  // Normal CPU: base delay from cycles + random scheduling latency
  // Scale: 1 cycle ≈ 0.15ms sim-time for visual clarity
  const baseMs = Math.round(timing.cycles * 0.15);
  const schedJitter = randInt(20, 80);
  return Math.max(40, baseMs + schedJitter);
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Sample from Binomial(n, p) using normal approximation for n > 20 */
function sampleBinomial(n: number, p: number): number {
  const mean = n * p;
  const std = Math.sqrt(n * p * (1 - p));
  // Box-Muller transform for normal sample
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const sample = Math.round(mean + std * z);
  return Math.max(0, Math.min(n, sample));
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
