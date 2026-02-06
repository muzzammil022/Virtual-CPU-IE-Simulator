import React from "react";
import RoadCanvas from "@/components/RoadCanvas";
import TimingPanel from "@/components/TimingPanel";
import TimingComparison from "@/components/TimingComparison";
import ControlPanel from "@/components/ControlPanel";
import { useCarSimulation } from "@/hooks/useCarSimulation";

export default function CarDemo() {
  const { state, start, reset, pause } = useCarSimulation();

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Left: Canvas */}
      <div className="flex flex-col items-center gap-4">
        <RoadCanvas state={state} />
        <div className="text-xs font-mono text-zinc-600 text-center">
          {state.status === "idle" && "Press START to begin simulation"}
          {state.status === "running" && "Car approaching obstacle..."}
          {state.status === "patmos-triggered" &&
            "⚡ Patmos controller invoked — awaiting decision..."}
          {state.status === "avoiding" && "Executing avoidance maneuver"}
          {state.status === "completed" && "✓ Obstacle successfully avoided"}
          {state.status === "collision" && "✗ Collision detected"}
        </div>
      </div>

      {/* Right: Panels */}
      <div className="flex flex-col gap-6 flex-1 min-w-[320px]">
        <ControlPanel
          status={state.status}
          onStart={start}
          onReset={reset}
          onPause={pause}
        />

        {/* Timing Comparison — shown after Patmos result */}
        {state.timingComparison && (
          <TimingComparison
            comparison={state.timingComparison}
            title="Avoidance Decision: Processor Comparison"
          />
        )}

        <TimingPanel state={state} />
      </div>
    </div>
  );
}
