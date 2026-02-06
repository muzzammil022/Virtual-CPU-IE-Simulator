import React, { useMemo } from "react";
import RoadCanvas from "@/components/RoadCanvas";
import DualTimingPanel from "@/components/DualTimingPanel";
import ControlPanel from "@/components/ControlPanel";
import { useDualSimulation } from "@/hooks/useDualSimulation";
import { DEFAULT_CONFIG, DIFFICULTY_PRESETS } from "@/lib/types";

const NUM_OBSTACLES = 3;
const DIFFICULTY = "hard" as const;

function StatusText({ status }: { status: string }) {
  return (
    <div className="text-[10px] font-mono text-zinc-500 text-center h-4">
      {status === "idle" && "Waiting to start..."}
      {status === "running" && "Driving..."}
      {status === "patmos-triggered" && "⚡ Decision pending..."}
      {status === "avoiding" && "Avoiding obstacle..."}
      {status === "completed" && `✓ ${NUM_OBSTACLES} obstacles avoided`}
      {status === "collision" && "✗ Collision!"}
    </div>
  );
}

function ProcessorLabel({
  name,
  color,
  subtitle,
}: {
  name: string;
  color: string;
  subtitle: string;
}) {
  return (
    <div className="text-center mb-2">
      <div className={`text-sm font-mono font-bold ${color}`}>{name}</div>
      <div className="text-[10px] font-mono text-zinc-500">{subtitle}</div>
    </div>
  );
}

export default function CarDemo() {
  const config = useMemo(() => {
    const preset = DIFFICULTY_PRESETS[DIFFICULTY];
    return {
      ...DEFAULT_CONFIG,
      numObstacles: NUM_OBSTACLES,
      difficulty: DIFFICULTY,
      initialSpeed: preset.speed,
      detectionThreshold: preset.detectionThreshold,
      brakeDeceleration: preset.brakeDeceleration,
    };
  }, []);

  const { dualState, combinedStatus, start, reset, pause } =
    useDualSimulation(config);

  return (
    <div className="flex flex-col gap-6">
      {/* Top row: Controls + Dual Canvases */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <ControlPanel
          status={combinedStatus}
          onStart={start}
          onReset={reset}
          onPause={pause}
        />

        {/* Dual Canvases */}
        <div className="flex gap-6 flex-1 justify-center">
          {/* Normal CPU — left */}
          <div className="flex flex-col items-center gap-2">
            <ProcessorLabel
              name="Normal CPU"
              color="text-orange-400"
              subtitle="Non-deterministic, cache-dependent"
            />
            <RoadCanvas state={dualState.normal} config={config} width={260} height={500} carColor="#dc2626" />
            <StatusText status={dualState.normal.status} />
          </div>

          {/* VS divider */}
          <div className="flex flex-col items-center justify-center">
            <div className="text-zinc-600 font-mono text-xs font-bold">VS</div>
          </div>

          {/* Patmos — right */}
          <div className="flex flex-col items-center gap-2">
            <ProcessorLabel
              name="Patmos"
              color="text-cyan-400"
              subtitle="Deterministic, time-predictable"
            />
            <RoadCanvas state={dualState.patmos} config={config} width={260} height={500} carColor="#219ebc" />
            <StatusText status={dualState.patmos.status} />
          </div>
        </div>
      </div>

      {/* Bottom: Live timing comparison */}
      <DualTimingPanel
        patmosEvents={dualState.patmosEvents}
        normalEvents={dualState.normalEvents}
        patmosElapsed={dualState.patmos.elapsedTime}
        normalElapsed={dualState.normal.elapsedTime}
      />
    </div>
  );
}
