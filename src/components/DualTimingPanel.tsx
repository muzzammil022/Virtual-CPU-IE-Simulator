import React from "react";
import { ObstacleTimingEvent } from "@/hooks/useDualSimulation";
import { PATMOS, NORMAL_CPU, AVOIDANCE_TASK } from "@/lib/timing-model";

interface DualTimingPanelProps {
  patmosEvents: ObstacleTimingEvent[];
  normalEvents: ObstacleTimingEvent[];
  patmosElapsed: number;
  normalElapsed: number;
}

/* ── Small bar comparing patmos vs normal reaction time ── */
function ReactionBar({ patmosMs, normalMs, maxMs }: { patmosMs: number; normalMs: number; maxMs: number }) {
  return (
    <div className="space-y-1">
      {[
        { label: "Patmos", ms: patmosMs, color: "bg-cyan-500", text: "text-cyan-400" },
        { label: "Normal", ms: normalMs, color: "bg-red-500", text: "text-red-400" },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <span className={`text-[10px] font-mono ${row.text} w-14`}>{row.label}</span>
          <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
            <div
              className={`h-full ${row.color} rounded transition-all duration-300 flex items-center justify-end pr-1`}
              style={{ width: `${Math.max(4, (row.ms / maxMs) * 100)}%` }}
            >
              <span className="text-[9px] font-mono text-white font-bold">{row.ms}ms</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Stacked bar showing where Normal CPU's cycles go ── */
function CycleBreakdown({ event }: { event: ObstacleTimingEvent }) {
  const b = event.timing.breakdown;
  const total = event.timing.cycles;
  const segments = [
    { key: "base", cyc: b.base, color: "bg-zinc-500", label: "Base compute" },
    { key: "cache", cyc: b.cachePenalty, color: "bg-red-500", label: "Cache misses" },
    { key: "branch", cyc: b.branchPenalty, color: "bg-yellow-500", label: "Branch mispredicts" },
    { key: "os", cyc: b.osPenalty, color: "bg-purple-500", label: "OS jitter" },
  ];
  return (
    <div className="flex gap-0.5 h-3 rounded overflow-hidden mt-1">
      {segments.filter((s) => s.cyc > 0).map((s) => (
        <div key={s.key} className={s.color} style={{ width: `${(s.cyc / total) * 100}%` }} title={`${s.label}: ${s.cyc} cyc`} />
      ))}
    </div>
  );
}

export default function DualTimingPanel({
  patmosEvents,
  normalEvents,
}: DualTimingPanelProps) {
  /* ── pair up per-obstacle events ── */
  const maxObstacles = Math.max(
    ...patmosEvents.map((e) => e.obstacleIndex + 1),
    ...normalEvents.map((e) => e.obstacleIndex + 1),
    0
  );
  const paired = Array.from({ length: maxObstacles }, (_, i) => ({
    index: i,
    patmos: patmosEvents.find((e) => e.obstacleIndex === i) ?? null,
    normal: normalEvents.find((e) => e.obstacleIndex === i) ?? null,
  }));

  /* ── live aggregate stats ── */
  const avg = (arr: ObstacleTimingEvent[]) =>
    arr.length > 0 ? arr.reduce((s, e) => s + e.cycles, 0) / arr.length : 0;
  const pAvg = avg(patmosEvents);
  const nAvg = avg(normalEvents);
  const hasData = patmosEvents.length > 0 || normalEvents.length > 0;

  /* breakdown averages from Normal CPU runs */
  const nLen = normalEvents.length || 1;
  const avgCache = normalEvents.reduce((s, e) => s + e.timing.breakdown.cachePenalty, 0) / nLen;
  const avgBranch = normalEvents.reduce((s, e) => s + e.timing.breakdown.branchPenalty, 0) / nLen;
  const avgOs = normalEvents.reduce((s, e) => s + e.timing.breakdown.osPenalty, 0) / nLen;
  const totalOverhead = avgCache + avgBranch + avgOs;

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 space-y-5">

      {/* ━━━ SECTION 1: What & Why ━━━ */}
      <div className="border border-amber-800/40 rounded-lg p-3 bg-amber-950/20">
        <h3 className="text-xs font-semibold text-amber-400 mb-2">
          Why is this a Mathematical Mock?
        </h3>
        <p className="text-[11px] text-zinc-300 leading-relaxed">
          We do <span className="text-amber-300 font-semibold">not</span> have a physical Patmos FPGA
          board connected. Instead, we use a <span className="text-amber-300 font-semibold">timing model</span> based
          on published Patmos architecture specs to <em>calculate</em> what the Patmos processor would
          do — and compare it against a simulated Normal CPU running the same task. Both cars
          you see are driven by math, not real hardware.
        </p>
      </div>

      {/* ━━━ SECTION 2: The Model — step by step ━━━ */}
      <div className="border border-cyan-900/50 rounded-lg p-3 bg-zinc-950 space-y-3">
        <h3 className="text-xs font-semibold text-cyan-400">
          How the Math Model Works
        </h3>

        {/* Step 1 */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded">Step 1</span>
            <span className="text-[11px] text-zinc-300 font-medium">Simulate the Normal CPU (with all its problems)</span>
          </div>
          <div className="ml-[72px] text-[11px] font-mono text-zinc-400 leading-relaxed bg-zinc-900 rounded p-2">
            <div>
              T<sub>normal</sub> = <span className="text-zinc-300">(N<sub>instr</sub> × CPI)</span>
              {" + "}<span className="text-red-400">cache misses</span>
              {" + "}<span className="text-yellow-400">branch mispredicts</span>
              {" + "}<span className="text-purple-400">OS jitter</span>
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">
              Each run gives a <em>different</em> result because misses/mispredicts are random
            </div>
          </div>
          <div className="ml-[72px] mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono text-zinc-500">
            <span>CPI = {NORMAL_CPU.CPI} (superscalar)</span>
            <span>Clock = {NORMAL_CPU.clockMHz} MHz</span>
            <span>Cache miss rate = {(NORMAL_CPU.cacheMissRate * 100).toFixed(0)}%</span>
            <span>Miss penalty = {NORMAL_CPU.cacheMissPenalty} cycles</span>
            <span>Branch mispredict = {(NORMAL_CPU.branchMispredRate * 100).toFixed(0)}%</span>
            <span>Flush penalty = {NORMAL_CPU.branchFlushPenalty} cycles</span>
            <span>OS jitter = {NORMAL_CPU.osJitterRange[0]}–{NORMAL_CPU.osJitterRange[1]} cycles</span>
          </div>
        </div>

        {/* Step 2 */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-bold px-1.5 py-0.5 rounded">Step 2</span>
            <span className="text-[11px] text-zinc-300 font-medium">Calculate Patmos (remove what its architecture eliminates)</span>
          </div>
          <div className="ml-[72px] text-[11px] font-mono text-zinc-400 leading-relaxed bg-zinc-900 rounded p-2">
            <div>
              T<sub>patmos</sub> = N<sub>instr</sub> × CPI<sub>patmos</sub>
              <span className="text-cyan-400 font-bold"> = {AVOIDANCE_TASK.N_instr} × {PATMOS.CPI} = {Math.ceil(AVOIDANCE_TASK.N_instr * PATMOS.CPI)} cycles</span>
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">
              Same result every time — no cache misses, no mispredicts, no OS noise
            </div>
          </div>
          <div className="ml-[72px] mt-1.5 text-[10px] font-mono text-zinc-500 space-y-0.5">
            <div><span className="text-cyan-400">Why no cache misses?</span> → Method cache loads whole functions, not cache lines</div>
            <div><span className="text-cyan-400">Why no branch penalty?</span> → No speculative execution; pipeline is deterministic</div>
            <div><span className="text-cyan-400">Why no OS jitter?</span> → Scratchpad memory, no interrupts during critical section</div>
          </div>
        </div>

        {/* Step 3 */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-1.5 py-0.5 rounded">Step 3</span>
            <span className="text-[11px] text-zinc-300 font-medium">Compare — Patmos saves all the overhead</span>
          </div>
          <div className="ml-[72px] text-[11px] font-mono text-zinc-400 leading-relaxed bg-zinc-900 rounded p-2">
            <div>
              Cycles saved = T<sub>normal</sub> − T<sub>patmos</sub>
              {" = "}<span className="text-red-400">cache penalty</span>
              {" + "}<span className="text-yellow-400">branch penalty</span>
              {" + "}<span className="text-purple-400">OS jitter</span>
            </div>
          </div>
        </div>

        {/* Task being simulated */}
        <div className="border-t border-zinc-800 pt-2">
          <div className="text-[10px] text-zinc-500 font-mono">
            Task: <span className="text-zinc-300">{AVOIDANCE_TASK.name}</span>
            {" · "}{AVOIDANCE_TASK.N_instr} instructions
            {" · "}{AVOIDANCE_TASK.N_mem} memory accesses
            {" · "}{AVOIDANCE_TASK.N_branch} branches
            {" · deadline "}{AVOIDANCE_TASK.deadline_cycles} cycles
          </div>
        </div>
      </div>

      {/* ━━━ SECTION 3: Live overhead breakdown from runs ━━━ */}
      {normalEvents.length > 0 && (
        <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-950 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300">
            Live Overhead Breakdown <span className="text-zinc-600 font-normal">(avg from {normalEvents.length} Normal CPU run{normalEvents.length > 1 ? "s" : ""})</span>
          </h3>
          <p className="text-[10px] text-zinc-500">
            These are the extra cycles the Normal CPU spends that Patmos doesn&apos;t:
          </p>
          {[
            { label: "Cache miss penalty", cyc: avgCache, color: "bg-red-500/70", text: "text-red-400" },
            { label: "Branch mispredict penalty", cyc: avgBranch, color: "bg-yellow-500/70", text: "text-yellow-400" },
            { label: "OS scheduling jitter", cyc: avgOs, color: "bg-purple-500/70", text: "text-purple-400" },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className={`${row.text} text-[10px] w-40`}>{row.label}</span>
              <div className="flex-1 h-3 bg-zinc-800 rounded overflow-hidden">
                <div className={`h-full ${row.color} rounded`} style={{ width: `${nAvg > 0 ? (row.cyc / nAvg) * 100 : 0}%` }} />
              </div>
              <span className={`${row.text} text-[10px] font-bold w-14 text-right`}>{row.cyc.toFixed(0)} cyc</span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-zinc-800 pt-1.5">
            <span className="text-cyan-400 text-[10px] font-bold w-40">Total overhead Patmos saves</span>
            <div className="flex-1" />
            <span className="text-cyan-400 text-[10px] font-bold w-14 text-right">{totalOverhead.toFixed(0)} cyc</span>
          </div>
        </div>
      )}

      {/* ━━━ SECTION 4: Per-obstacle comparison ━━━ */}
      {paired.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Per-Obstacle Reaction Time
          </h3>
          {paired.map((pair) => {
            const pMs = pair.patmos?.reactionMs ?? 0;
            const nMs = pair.normal?.reactionMs ?? 0;
            const maxMs = Math.max(pMs, nMs, 10);
            return (
              <div key={pair.index} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-zinc-400">Obstacle #{pair.index + 1}</span>
                  <div className="flex gap-3">
                    {pair.patmos && (
                      <span className="text-[9px] font-mono text-cyan-400">
                        {pair.patmos.cycles} cyc {pair.patmos.avoidedAt != null ? "✓" : "…"}
                      </span>
                    )}
                    {pair.normal && (
                      <span className="text-[9px] font-mono text-red-400">
                        {pair.normal.cycles} cyc {pair.normal.avoidedAt != null ? "✓" : "…"}
                      </span>
                    )}
                  </div>
                </div>
                {(pair.patmos || pair.normal) ? (
                  <>
                    <ReactionBar patmosMs={pMs} normalMs={nMs} maxMs={maxMs} />
                    {pair.normal && (
                      <div className="mt-1">
                        <div className="flex gap-2 text-[9px] font-mono text-zinc-500">
                          <span>■ <span className="text-zinc-400">base</span></span>
                          <span className="text-red-400">■ cache</span>
                          <span className="text-yellow-400">■ branch</span>
                          <span className="text-purple-400">■ OS</span>
                        </div>
                        <CycleBreakdown event={pair.normal} />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[10px] font-mono text-zinc-600">Approaching…</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {paired.length === 0 && (
        <p className="text-xs font-mono text-zinc-600">
          Press START to run both simulations and see the timing comparison…
        </p>
      )}

      {/* ━━━ SECTION 5: Summary numbers ━━━ */}
      {hasData && (
        <div className="border-t border-zinc-800 pt-3">
          <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Results
          </h4>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[10px] text-zinc-500">Patmos (mock)</div>
              <div className="text-lg font-mono text-cyan-400 font-bold">{pAvg.toFixed(0)}</div>
              <div className="text-[9px] text-zinc-600">cycles (constant)</div>
            </div>
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[10px] text-zinc-500">Normal CPU</div>
              <div className="text-lg font-mono text-red-400 font-bold">{nAvg.toFixed(0)}</div>
              <div className="text-[9px] text-zinc-600">cycles (avg, varies)</div>
            </div>
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[10px] text-zinc-500">Patmos Advantage</div>
              <div className="text-lg font-mono text-green-400 font-bold">
                {nAvg > 0 ? (((nAvg - pAvg) / nAvg) * 100).toFixed(1) : "—"}%
              </div>
              <div className="text-[9px] text-zinc-600">fewer cycles</div>
            </div>
          </div>
          <div className="flex gap-4 justify-center mt-2 text-[10px] font-mono">
            <span className="text-cyan-400">■ Patmos (derived via math model)</span>
            <span className="text-red-400">■ Normal CPU (simulated)</span>
          </div>
        </div>
      )}
    </div>
  );
}
