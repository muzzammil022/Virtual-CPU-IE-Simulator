import React from "react";
import { SimulationState, PatmosResponse } from "@/lib/types";

interface TimingPanelProps {
  state: SimulationState;
}

export default function TimingPanel({ state }: TimingPanelProps) {
  const { patmosResult, patmosHistory, status, car, triggerDistance } = state;

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      {/* Status Badge */}
      <div className="flex items-center gap-2">
        <div
          className={`w-3 h-3 rounded-full ${
            status === "idle"
              ? "bg-zinc-500"
              : status === "running"
              ? "bg-green-500 animate-pulse"
              : status === "patmos-triggered"
              ? "bg-yellow-500 animate-pulse"
              : status === "avoiding"
              ? "bg-blue-500 animate-pulse"
              : status === "completed"
              ? "bg-green-400"
              : "bg-red-500"
          }`}
        />
        <span className="text-sm font-mono text-zinc-300 uppercase tracking-wider">
          {status}
        </span>
      </div>

      {/* Live Telemetry */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Live Telemetry
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm font-mono">
          <TelemetryItem label="Speed" value={`${Math.round(car.speed)} px/s`} />
          <TelemetryItem label="Position" value={`${Math.round(car.y)}`} />
          <TelemetryItem label="Lane" value={car.lane === 0 ? "Left" : "Right"} />
          <TelemetryItem label="Braking" value={car.braking ? "YES" : "NO"} warn={car.braking} />
          {triggerDistance !== null && (
            <TelemetryItem label="Trigger Dist" value={`${Math.round(triggerDistance)} px`} />
          )}
          <TelemetryItem label="Time" value={`${state.elapsedTime.toFixed(1)}s`} />
        </div>
      </div>

      {/* Patmos Decision Result */}
      {patmosResult && (
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Patmos Decision
          </h3>
          <PatmosResultDisplay result={patmosResult} />
        </div>
      )}

      {/* Cycle Timing Visualization */}
      {patmosResult && (
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Cycle Timing
          </h3>
          <CycleBar result={patmosResult} />
        </div>
      )}

      {/* Execution History */}
      {patmosHistory.length > 0 && (
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Execution Log
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {patmosHistory.map((entry, i) => (
              <div
                key={i}
                className="text-xs font-mono text-zinc-400 flex justify-between"
              >
                <span>#{i + 1} {entry.action.toUpperCase()}</span>
                <span
                  className={entry.deadline_met ? "text-green-400" : "text-red-400"}
                >
                  {entry.cycles_used} cyc
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TelemetryItem({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-zinc-500 text-xs">{label}</div>
      <div className={`text-sm ${warn ? "text-red-400" : "text-zinc-200"}`}>
        {value}
      </div>
    </div>
  );
}

function PatmosResultDisplay({ result }: { result: PatmosResponse }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-mono">
        <span className="text-zinc-400">Action</span>
        <span
          className={`font-bold ${
            result.action === "steer"
              ? "text-blue-400"
              : result.action === "brake"
              ? "text-red-400"
              : "text-zinc-400"
          }`}
        >
          {result.action.toUpperCase()}
        </span>
      </div>
      {result.action === "steer" && (
        <div className="flex justify-between text-sm font-mono">
          <span className="text-zinc-400">Target Lane</span>
          <span className="text-blue-300">{result.target_lane === 0 ? "Left" : "Right"}</span>
        </div>
      )}
      {result.action === "brake" && (
        <div className="flex justify-between text-sm font-mono">
          <span className="text-zinc-400">Brake Force</span>
          <span className="text-red-300">{(result.brake_force * 100).toFixed(0)}%</span>
        </div>
      )}
      <div className="flex justify-between text-sm font-mono">
        <span className="text-zinc-400">Deadline</span>
        <span className={result.deadline_met ? "text-green-400" : "text-red-400"}>
          {result.deadline_met ? "MET" : "MISSED"}
        </span>
      </div>
      <div className="mt-2 text-xs font-mono text-zinc-500 bg-zinc-950 rounded p-2">
        {result.execution_path}
      </div>
    </div>
  );
}

function CycleBar({ result }: { result: PatmosResponse }) {
  const pct = Math.min(100, (result.cycles_used / result.deadline_cycles) * 100);
  const color = result.deadline_met
    ? pct > 80
      ? "bg-yellow-500"
      : "bg-green-500"
    : "bg-red-500";

  return (
    <div>
      <div className="flex justify-between text-xs font-mono text-zinc-500 mb-1">
        <span>0</span>
        <span>{result.deadline_cycles} cycles (deadline)</span>
      </div>
      <div className="w-full h-6 bg-zinc-800 rounded-full overflow-hidden relative">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-white font-bold">
          {result.cycles_used} / {result.deadline_cycles}
        </div>
      </div>
      <p className="text-xs font-mono text-zinc-500 mt-2">
        {result.deadline_met
          ? `Obstacle avoidance executed in ${result.cycles_used} cycles (deadline: ${result.deadline_cycles}). No jitter detected.`
          : `WARNING: Deadline missed! ${result.cycles_used} cycles exceeds ${result.deadline_cycles} budget.`}
      </p>
    </div>
  );
}
