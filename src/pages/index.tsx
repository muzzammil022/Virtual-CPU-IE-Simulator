import { useState } from "react";
import { Geist_Mono } from "next/font/google";
import CarDemo from "@/components/CarDemo";
import CodeRunner from "@/components/CodeRunner";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

type Mode = "demo" | "code";

export default function Home() {
  const [mode, setMode] = useState<Mode>("demo");

  return (
    <div
      className={`${geistMono.className} min-h-screen bg-zinc-950 text-zinc-100`}
    >
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono tracking-tight">
              Patmos <span className="text-blue-400">Time-Predictable</span> Demo
            </h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              Deterministic execution • Normal vs Patmos comparison
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Mode Toggle */}
            <div className="flex items-center bg-zinc-900 rounded-lg p-1 border border-zinc-800">
              <button
                onClick={() => setMode("demo")}
                className={`px-4 py-2 text-xs font-mono rounded-md transition-all ${
                  mode === "demo"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🚗 Car Demo
              </button>
              <button
                onClick={() => setMode("code")}
                className={`px-4 py-2 text-xs font-mono rounded-md transition-all ${
                  mode === "code"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {"</>"} Code Runner
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-600 bg-zinc-900 px-2 py-1 rounded">
                v0.2.0
              </span>
              <a
                href="https://github.com/t-crest/patmos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                t-crest/patmos →
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Mode Description */}
      <div className="max-w-6xl mx-auto px-6 pt-6">
        <div className="bg-zinc-900/50 rounded-lg px-4 py-3 border border-zinc-800/50">
          {mode === "demo" ? (
            <p className="text-xs font-mono text-zinc-400">
              <span className="text-blue-400 font-bold">Car Demo</span> — Watch a car avoid an obstacle.
              When the detection zone triggers, the state is sent to both a Patmos (time-predictable)
              and normal processor simulation. Compare execution cycles and jitter in real-time.
            </p>
          ) : (
            <p className="text-xs font-mono text-zinc-400">
              <span className="text-blue-400 font-bold">Code Runner</span> — Write C code and execute
              it on a simulated Patmos processor vs a normal CPU. See how deterministic architectures
              eliminate jitter and guarantee worst-case execution time bounds.
            </p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {mode === "demo" ? <CarDemo /> : <CodeRunner />}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-4 mt-12">
        <div className="max-w-6xl mx-auto text-xs font-mono text-zinc-600 flex justify-between">
          <span>SDTime — Predictable Computing Demo</span>
          <span>
            Backend: <span className="text-yellow-500">Mock</span> • Next phase: pasim integration
          </span>
        </div>
      </footer>
    </div>
  );
}
