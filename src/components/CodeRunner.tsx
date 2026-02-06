import React, { useState, useCallback } from "react";
import { CodeRunnerResponse, TimingComparison as TimingComparisonType } from "@/lib/types";
import { SAMPLE_CODES } from "@/lib/sample-code";
import TimingComparison from "./TimingComparison";

export default function CodeRunner() {
  const [code, setCode] = useState(SAMPLE_CODES[0].code);
  const [selectedSample, setSelectedSample] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CodeRunnerResponse | null>(null);
  const [runHistory, setRunHistory] = useState<
    { code: string; result: CodeRunnerResponse; timestamp: number }[]
  >([]);

  const handleSampleChange = useCallback((idx: number) => {
    setSelectedSample(idx);
    setCode(SAMPLE_CODES[idx].code);
    setResult(null);
  }, []);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: "c" }),
      });
      const data: CodeRunnerResponse = await res.json();
      setResult(data);
      setRunHistory((prev) => [
        { code, result: data, timestamp: Date.now() },
        ...prev.slice(0, 9),
      ]);
    } catch (err) {
      console.error("Execute error:", err);
    } finally {
      setIsRunning(false);
    }
  }, [code]);

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Left: Code editor area */}
      <div className="flex flex-col gap-4 flex-1 min-w-0">
        {/* Sample selector */}
        <div className="flex gap-2 flex-wrap">
          {SAMPLE_CODES.map((sample, idx) => (
            <button
              key={idx}
              onClick={() => handleSampleChange(idx)}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors ${
                selectedSample === idx
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {sample.name}
            </button>
          ))}
        </div>

        <p className="text-xs font-mono text-zinc-500">
          {SAMPLE_CODES[selectedSample].description}
        </p>

        {/* Code editor */}
        <div className="relative">
          <div className="absolute top-2 right-2 flex gap-2 z-10">
            <button
              onClick={handleRun}
              disabled={isRunning || !code.trim()}
              className={`px-4 py-2 text-xs font-mono rounded-lg transition-all ${
                isRunning
                  ? "bg-zinc-700 text-zinc-400 cursor-wait"
                  : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20"
              }`}
            >
              {isRunning ? "⏳ Running..." : "▶ Run on Patmos"}
            </button>
          </div>
          <textarea
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setResult(null);
            }}
            spellCheck={false}
            className="w-full h-[460px] bg-zinc-950 text-green-400 font-mono text-sm p-4 
                       rounded-lg border border-zinc-800 resize-none focus:outline-none 
                       focus:border-blue-600 transition-colors leading-relaxed"
            placeholder="Write time-predictable C code here..."
          />
          {/* Line numbers overlay hint */}
          <div className="absolute bottom-2 left-3 text-[10px] font-mono text-zinc-700">
            {code.split("\n").length} lines • C
          </div>
        </div>

        {/* Output */}
        {result && (
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-4">
            <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
              Output
            </h3>
            <pre
              className={`text-sm font-mono whitespace-pre-wrap ${
                result.success ? "text-zinc-300" : "text-red-400"
              }`}
            >
              {result.error || result.output}
            </pre>
          </div>
        )}

        {/* Execution traces */}
        {result && (
          <div className="grid grid-cols-2 gap-4">
            <TracePanel
              title="Patmos Trace"
              color="blue"
              data={[
                ["Branch", result.patmos_trace.branch_taken],
                ["Instructions", `${result.patmos_trace.instructions_executed}`],
                ["Cache Hits", `${result.patmos_trace.cache_hits}`],
                ["Cache Misses", `${result.patmos_trace.cache_misses}`],
                ["Scratchpad", "Enabled"],
                ["Pipeline", "Deterministic"],
              ]}
            />
            <TracePanel
              title="Normal CPU Trace"
              color="orange"
              data={[
                ["Branch", result.normal_trace.branch_taken],
                ["Instructions", `${result.normal_trace.instructions_executed}`],
                ["Cache Hits", `${result.normal_trace.cache_hits}`],
                ["Cache Misses", `${result.normal_trace.cache_misses}`],
                ["Pipeline Stalls", `${result.normal_trace.pipeline_stalls}`],
                ["Branch Mispredicts", `${result.normal_trace.branch_mispredictions}`],
              ]}
            />
          </div>
        )}
      </div>

      {/* Right: Results panel */}
      <div className="flex flex-col gap-4 w-full lg:w-[380px] lg:min-w-[380px]">
        {result ? (
          <TimingComparison
            comparison={result.timing}
            title="Execution Comparison"
          />
        ) : (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <div className="text-center space-y-3">
              <div className="text-4xl">⚡</div>
              <h3 className="text-sm font-mono text-zinc-300">
                Run Code to Compare
              </h3>
              <p className="text-xs font-mono text-zinc-500 leading-relaxed">
                Write or pick a C code sample, then hit Run.
                The code will execute on both a simulated Patmos
                processor and a normal CPU to compare timing
                predictability.
              </p>
            </div>
          </div>
        )}

        {/* Rules card */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Time-Predictable Rules
          </h3>
          <div className="space-y-2 text-xs font-mono text-zinc-400">
            <Rule ok label="Bounded loops (fixed iteration count)" />
            <Rule ok label="Static branching (if/else)" />
            <Rule ok label="Fixed-size arrays" />
            <Rule ok label="Integer & fixed-point arithmetic" />
            <Rule bad label="Dynamic memory (malloc/calloc)" />
            <Rule bad label="Unbounded loops (while true)" />
            <Rule bad label="Recursion" />
            <Rule bad label="Virtual dispatch / function pointers" />
          </div>
        </div>

        {/* Run history */}
        {runHistory.length > 0 && (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
            <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
              Run History
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {runHistory.map((entry, i) => (
                <div
                  key={entry.timestamp}
                  className="flex justify-between items-center text-xs font-mono py-1 border-b border-zinc-800 last:border-b-0"
                >
                  <span className="text-zinc-400">
                    #{runHistory.length - i}
                  </span>
                  <span className="text-blue-400">
                    P: {entry.result.timing.patmos.cycles}
                  </span>
                  <span className="text-orange-400">
                    N: {entry.result.timing.normal.cycles}
                  </span>
                  <span
                    className={
                      entry.result.timing.patmos.jitter === 0
                        ? "text-green-400"
                        : "text-red-400"
                    }
                  >
                    J: {entry.result.timing.patmos.jitter}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] font-mono text-zinc-600 mt-2">
              P=Patmos cycles, N=Normal cycles, J=Patmos jitter
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Rule({ ok, bad, label }: { ok?: boolean; bad?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? "text-green-500" : "text-red-500"}>
        {ok ? "✓" : "✗"}
      </span>
      <span>{label}</span>
    </div>
  );
}

function TracePanel({
  title,
  color,
  data,
}: {
  title: string;
  color: "blue" | "orange";
  data: [string, string][];
}) {
  const headerColor = color === "blue" ? "text-blue-400" : "text-orange-400";
  const borderColor = color === "blue" ? "border-blue-900/50" : "border-orange-900/50";

  return (
    <div className={`bg-zinc-900 rounded-lg border ${borderColor} p-3`}>
      <h4 className={`text-[10px] font-mono ${headerColor} uppercase tracking-wider mb-2 font-bold`}>
        {title}
      </h4>
      <div className="space-y-1">
        {data.map(([key, value]) => (
          <div key={key} className="flex justify-between text-[11px] font-mono">
            <span className="text-zinc-500">{key}</span>
            <span className="text-zinc-300">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
