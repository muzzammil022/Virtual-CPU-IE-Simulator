import React from "react";
import { TimingComparison as TimingComparisonType } from "@/lib/types";

interface TimingComparisonProps {
  comparison: TimingComparisonType;
  title?: string;
}

export default function TimingComparison({
  comparison,
  title = "Processor Comparison",
}: TimingComparisonProps) {
  const { patmos, normal } = comparison;

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>

      <div className="p-4 space-y-5">
        {/* Side-by-side cycle bars */}
        <div className="space-y-3">
          {/* Patmos */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-blue-400 font-bold">
                PATMOS (Time-Predictable)
              </span>
              <span className="text-xs font-mono text-zinc-400">
                {patmos.cycles} cycles
              </span>
            </div>
            <div className="relative h-8 bg-zinc-800 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500/80 rounded transition-all duration-700"
                style={{
                  width: `${Math.min(100, (patmos.cycles / Math.max(normal.wcet, patmos.wcet)) * 100)}%`,
                }}
              />
              {/* WCET marker — same as actual for Patmos */}
              <div className="absolute inset-0 flex items-center px-3">
                <span className="text-xs font-mono text-white font-bold drop-shadow">
                  {patmos.cycles} cyc
                </span>
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] font-mono text-zinc-600">
                BCET: {patmos.bcet}
              </span>
              <span className="text-[10px] font-mono text-zinc-600">
                WCET: {patmos.wcet}
              </span>
              <span className="text-[10px] font-mono text-green-500">
                Jitter: {patmos.jitter}
              </span>
            </div>
          </div>

          {/* Normal Processor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-orange-400 font-bold">
                NORMAL PROCESSOR
              </span>
              <span className="text-xs font-mono text-zinc-400">
                {normal.cycles} cycles
              </span>
            </div>
            <div className="relative h-8 bg-zinc-800 rounded overflow-hidden">
              {/* BCET to WCET range (jitter band) */}
              <div
                className="absolute h-full bg-red-500/20 rounded"
                style={{
                  left: `${(normal.bcet / Math.max(normal.wcet, patmos.wcet)) * 100}%`,
                  width: `${((normal.wcet - normal.bcet) / Math.max(normal.wcet, patmos.wcet)) * 100}%`,
                }}
              />
              {/* Actual execution */}
              <div
                className="h-full bg-orange-500/80 rounded transition-all duration-700"
                style={{
                  width: `${Math.min(100, (normal.cycles / Math.max(normal.wcet, patmos.wcet)) * 100)}%`,
                }}
              />
              <div className="absolute inset-0 flex items-center px-3">
                <span className="text-xs font-mono text-white font-bold drop-shadow">
                  {normal.cycles} cyc
                </span>
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] font-mono text-zinc-600">
                BCET: {normal.bcet}
              </span>
              <span className="text-[10px] font-mono text-zinc-600">
                WCET: {normal.wcet}
              </span>
              <span className="text-[10px] font-mono text-red-400">
                Jitter: {normal.jitter}
              </span>
            </div>
          </div>
        </div>

        {/* Key insight */}
        <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Patmos WCET"
              value={`${patmos.wcet} cyc`}
              sub="Tight bound (actual = WCET)"
              color="text-blue-400"
            />
            <Stat
              label="Normal WCET"
              value={`${normal.wcet} cyc`}
              sub={`Actual varies: ${normal.bcet}–${normal.wcet}`}
              color="text-orange-400"
            />
            <Stat
              label="Patmos Jitter"
              value="0 cycles"
              sub="Fully deterministic"
              color="text-green-400"
            />
            <Stat
              label="Normal Jitter"
              value={`${normal.jitter} cycles`}
              sub="Cache/pipeline effects"
              color="text-red-400"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="text-xs font-mono text-zinc-500 leading-relaxed space-y-1">
          <p>
            <span className="text-blue-400">Patmos</span> guarantees the same
            cycle count every execution. The normal processor may be faster on
            average but its <span className="text-red-400">worst-case is {
              Math.round((normal.wcet / patmos.wcet - 1) * 100)
            }% worse</span> than Patmos.
          </p>
          <p>
            For safety-critical systems, <span className="text-green-400">
            predictability matters more than average speed</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono text-zinc-500 uppercase">
        {label}
      </div>
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
      <div className="text-[10px] font-mono text-zinc-600">{sub}</div>
    </div>
  );
}
