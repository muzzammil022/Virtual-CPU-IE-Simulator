import React from "react";
import { ObstacleTimingEvent } from "@/hooks/useDualSimulation";

interface DualTimingPanelProps {
  patmosEvents: ObstacleTimingEvent[];
  normalEvents: ObstacleTimingEvent[];
  patmosElapsed: number;
  normalElapsed: number;
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${color}`}
    >
      {label}
    </span>
  );
}

function EventRow({
  event,
  processorLabel,
  color,
}: {
  event: ObstacleTimingEvent;
  processorLabel: string;
  color: string;
}) {
  const avoided = event.avoidedAt !== null;

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/60 border ${color}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-500">
            Obstacle #{event.obstacleIndex + 1}
          </span>
          {avoided ? (
            <StatusBadge label="CLEARED" color="bg-green-500/20 text-green-400" />
          ) : (
            <StatusBadge label="IN PROGRESS" color="bg-yellow-500/20 text-yellow-400" />
          )}
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs font-mono">
          <span className="text-zinc-500">
            Reaction: <span className="text-zinc-200">{event.reactionMs}ms</span>
          </span>
          <span className="text-zinc-500">
            Cycles: <span className="text-zinc-200">{event.cycles}</span>
          </span>
          <span className="text-zinc-500">
            Action: <span className="text-zinc-200">{event.action}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ReactionBar({
  patmosMs,
  normalMs,
  maxMs,
}: {
  patmosMs: number;
  normalMs: number;
  maxMs: number;
}) {
  const patmosWidth = Math.max(4, (patmosMs / maxMs) * 100);
  const normalWidth = Math.max(4, (normalMs / maxMs) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-cyan-400 w-14">Patmos</span>
        <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-cyan-500 rounded transition-all duration-300 flex items-center justify-end pr-1"
            style={{ width: `${patmosWidth}%` }}
          >
            <span className="text-[9px] font-mono text-white font-bold">
              {patmosMs}ms
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-orange-400 w-14">Normal</span>
        <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-orange-500 rounded transition-all duration-300 flex items-center justify-end pr-1"
            style={{ width: `${normalWidth}%` }}
          >
            <span className="text-[9px] font-mono text-white font-bold">
              {normalMs}ms
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DualTimingPanel({
  patmosEvents,
  normalEvents,
  patmosElapsed,
  normalElapsed,
}: DualTimingPanelProps) {
  // Match events by obstacle index
  const maxObstacles = Math.max(
    ...patmosEvents.map((e) => e.obstacleIndex + 1),
    ...normalEvents.map((e) => e.obstacleIndex + 1),
    0
  );

  const paired: {
    index: number;
    patmos: ObstacleTimingEvent | null;
    normal: ObstacleTimingEvent | null;
  }[] = [];

  for (let i = 0; i < maxObstacles; i++) {
    paired.push({
      index: i,
      patmos: patmosEvents.find((e) => e.obstacleIndex === i) ?? null,
      normal: normalEvents.find((e) => e.obstacleIndex === i) ?? null,
    });
  }

  // Summary stats
  const patmosAvgReaction =
    patmosEvents.length > 0
      ? patmosEvents.reduce((s, e) => s + e.reactionMs, 0) / patmosEvents.length
      : 0;
  const normalAvgReaction =
    normalEvents.length > 0
      ? normalEvents.reduce((s, e) => s + e.reactionMs, 0) / normalEvents.length
      : 0;

  const patmosAvgCycles =
    patmosEvents.length > 0
      ? patmosEvents.reduce((s, e) => s + e.cycles, 0) / patmosEvents.length
      : 0;
  const normalAvgCycles =
    normalEvents.length > 0
      ? normalEvents.reduce((s, e) => s + e.cycles, 0) / normalEvents.length
      : 0;

  const patmosJitter =
    patmosEvents.length > 1
      ? Math.max(...patmosEvents.map((e) => e.reactionMs)) -
        Math.min(...patmosEvents.map((e) => e.reactionMs))
      : 0;
  const normalJitter =
    normalEvents.length > 1
      ? Math.max(...normalEvents.map((e) => e.reactionMs)) -
        Math.min(...normalEvents.map((e) => e.reactionMs))
      : 0;

  if (paired.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
          Obstacle Timing Comparison
        </h3>
        <p className="text-xs font-mono text-zinc-600">
          Start the simulation to see real-time timing data...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 space-y-4">
      <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
        Per-Obstacle Reaction Time
      </h3>

      {/* Per-obstacle comparison bars */}
      {paired.map((pair) => {
        const patmosMs = pair.patmos?.reactionMs ?? 0;
        const normalMs = pair.normal?.reactionMs ?? 0;
        const maxMs = Math.max(patmosMs, normalMs, 10);
        const hasData = pair.patmos || pair.normal;

        return (
          <div key={pair.index} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-400">
                Obstacle #{pair.index + 1}
              </span>
              {pair.patmos?.avoidedAt !== null && pair.patmos?.avoidedAt !== undefined && (
                <span className="text-[9px] font-mono text-green-400">✓ Patmos cleared</span>
              )}
              {pair.normal?.avoidedAt !== null && pair.normal?.avoidedAt !== undefined && (
                <span className="text-[9px] font-mono text-green-400">✓ Normal cleared</span>
              )}
            </div>
            {hasData ? (
              <ReactionBar patmosMs={patmosMs} normalMs={normalMs} maxMs={maxMs} />
            ) : (
              <div className="text-[10px] font-mono text-zinc-600">Waiting...</div>
            )}
          </div>
        );
      })}

      {/* Summary Stats */}
      {(patmosEvents.length > 0 || normalEvents.length > 0) && (
        <div className="border-t border-zinc-800 pt-3 mt-3">
          <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Summary
          </h4>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[9px] font-mono text-zinc-500">Avg Reaction</div>
              <div className="text-xs font-mono text-cyan-400">{patmosAvgReaction.toFixed(0)}ms</div>
              <div className="text-xs font-mono text-orange-400">{normalAvgReaction.toFixed(0)}ms</div>
            </div>
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[9px] font-mono text-zinc-500">Avg Cycles</div>
              <div className="text-xs font-mono text-cyan-400">{patmosAvgCycles.toFixed(0)}</div>
              <div className="text-xs font-mono text-orange-400">{normalAvgCycles.toFixed(0)}</div>
            </div>
            <div className="bg-zinc-800/50 rounded p-2">
              <div className="text-[9px] font-mono text-zinc-500">Jitter</div>
              <div className="text-xs font-mono text-cyan-400">{patmosJitter.toFixed(0)}ms</div>
              <div className="text-xs font-mono text-orange-400">{normalJitter.toFixed(0)}ms</div>
            </div>
          </div>
          <div className="flex gap-4 justify-center mt-2 text-[10px] font-mono">
            <span className="text-cyan-400">■ Patmos (deterministic)</span>
            <span className="text-orange-400">■ Normal CPU (jittery)</span>
          </div>
        </div>
      )}
    </div>
  );
}
