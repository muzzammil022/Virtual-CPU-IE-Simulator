import React from "react";
import { SimStatus } from "@/lib/types";

interface ControlPanelProps {
  status: SimStatus;
  onStart: () => void;
  onReset: () => void;
  onPause: () => void;
}

export default function ControlPanel({
  status,
  onStart,
  onReset,
  onPause,
}: ControlPanelProps) {
  const isRunning = status === "running" || status === "patmos-triggered" || status === "avoiding";
  const isFinished = status === "collision" || status === "completed";

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      {/* Play Controls */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4">
          Simulation Controls
        </h3>

        <div className="flex gap-2">
          {!isRunning && !isFinished && (
            <button
              onClick={onStart}
              className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white font-mono text-sm rounded-lg transition-colors"
            >
              ▶ START
            </button>
          )}

          {isRunning && (
            <button
              onClick={onPause}
              className="flex-1 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-white font-mono text-sm rounded-lg transition-colors"
            >
              ⏸ PAUSE
            </button>
          )}

          <button
            onClick={onReset}
            className="flex-1 px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white font-mono text-sm rounded-lg transition-colors"
          >
            ↺ RESET
          </button>
        </div>
      </div>

      {/* Architecture Info */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
          How It Works
        </h3>
        <div className="space-y-2 text-xs font-mono text-zinc-400 leading-relaxed">
          <p>
            <span className="text-blue-400">1.</span> Car moves forward at fixed timestep (browser)
          </p>
          <p>
            <span className="text-yellow-400">2.</span> Obstacle enters detection zone
          </p>
          <p>
            <span className="text-orange-400">3.</span> State vector sent to Patmos controller
          </p>
          <p>
            <span className="text-green-400">4.</span> Deterministic decision returned with cycle count
          </p>
          <p>
            <span className="text-purple-400">5.</span> Car executes avoidance, then resumes for next
          </p>
        </div>
      </div>

      {/* Patmos Info */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Patmos Properties
        </h3>
        <div className="space-y-1 text-xs font-mono text-zinc-400">
          <div className="flex justify-between">
            <span>Execution model</span>
            <span className="text-zinc-200">Deterministic</span>
          </div>
          <div className="flex justify-between">
            <span>Same input →</span>
            <span className="text-zinc-200">Same cycles</span>
          </div>
          <div className="flex justify-between">
            <span>Deadline budget</span>
            <span className="text-zinc-200">800 cycles</span>
          </div>
          <div className="flex justify-between">
            <span>Backend</span>
            <span className="text-yellow-400">Mock (pasim planned)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
