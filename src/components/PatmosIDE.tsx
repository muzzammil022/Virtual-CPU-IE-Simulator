import React, { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  CodeRunnerResponse,
  ExecutionResult,
  ExecutionMode,
} from "@/lib/types";
import { SAMPLE_CODES } from "@/lib/sample-code";

// Client-only loads
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#0d1117] text-[#8b949e] text-sm font-mono">
      Loading editor…
    </div>
  ),
});

const CarDemo = dynamic(() => import("@/components/CarDemo"), { ssr: false });
const RadarDashboard = dynamic(() => import("@/components/RadarDashboard"), { ssr: false });

// ── GitHub Dark Theme for Monaco ──────────────────────────────────

function registerGitHubTheme(monaco: any) {
  monaco.editor.defineTheme("github-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b949e", fontStyle: "italic" },
      { token: "keyword", foreground: "ff7b72" },
      { token: "string", foreground: "a5d6ff" },
      { token: "number", foreground: "79c0ff" },
      { token: "type", foreground: "ffa657" },
      { token: "identifier", foreground: "c9d1d9" },
      { token: "delimiter", foreground: "c9d1d9" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#c9d1d9",
      "editor.lineHighlightBackground": "#161b2280",
      "editor.selectionBackground": "#264f78",
      "editorCursor.foreground": "#58a6ff",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#e6edf3",
      "editorIndentGuide.background": "#21262d",
      "editorIndentGuide.activeBackground": "#30363d",
      "editorGutter.background": "#0d1117",
      "editorWidget.background": "#161b22",
    },
  });
}

// ── Types ─────────────────────────────────────────────────────────

interface VFile {
  id: string;
  name: string;
  content: string;
  isSample: boolean;
}

type BottomTab = "output" | "pasim" | "patemu" | "gcc" | "problems";

let _fid = 0;

// ══════════════════════════════════════════════════════════════════
// ── Main IDE Component ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

export default function PatmosIDE() {
  // ── Files & tabs ──
  const [files, setFiles] = useState<VFile[]>(() =>
    SAMPLE_CODES.map((s, i) => ({
      id: `s${i}`,
      name: s.name.replace(/\s+/g, "_") + ".c",
      content: s.code,
      isSample: true,
    }))
  );
  const [openIds, setOpenIds] = useState(["s0"]);
  const [activeId, setActiveId] = useState("s0");
  const [modified, setModified] = useState<Set<string>>(new Set());

  // ── UI ──
  const [sideOpen, setSideOpen] = useState(true);
  const [sideW, setSideW] = useState(240);
  const [btmOpen, setBtmOpen] = useState(true);
  const [btmTab, setBtmTab] = useState<BottomTab>("output");
  const [btmH, setBtmH] = useState(200);
  const [carDemo, setCarDemo] = useState(false);
  const [radarView, setRadarView] = useState(false);

  // ── Execution ──
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<ExecutionMode | null>(null);
  const [result, setResult] = useState<CodeRunnerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Rename ──
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // ── Derived ──
  const activeFile = files.find((f) => f.id === activeId);
  const code = activeFile?.content ?? "";
  const output = result?.pasim?.output || result?.patemu?.output || "";

  // ── File operations ──────────────────────────────────────────

  const createFile = useCallback(() => {
    _fid++;
    const f: VFile = {
      id: `u${_fid}`,
      name: `untitled-${_fid}.c`,
      content:
        '#include <stdio.h>\n\nint main() {\n    printf("Hello, Patmos!\\n");\n    return 0;\n}\n',
      isSample: false,
    };
    setFiles((p) => [...p, f]);
    setOpenIds((p) => [...p, f.id]);
    setActiveId(f.id);
    setCarDemo(false);
  }, []);

  const openFile = useCallback((id: string) => {
    setOpenIds((p) => (p.includes(id) ? p : [...p, id]));
    setActiveId(id);
    setCarDemo(false);
    setRadarView(false);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setOpenIds((p) => {
        const next = p.filter((x) => x !== id);
        if (activeId === id && next.length > 0)
          setActiveId(next[next.length - 1]);
        return next;
      });
    },
    [activeId]
  );

  const deleteFile = useCallback(
    (id: string) => {
      setFiles((p) => p.filter((f) => f.id !== id));
      closeTab(id);
    },
    [closeTab]
  );

  const updateCode = useCallback(
    (v: string | undefined) => {
      if (!v) return;
      setFiles((p) =>
        p.map((f) => (f.id === activeId ? { ...f, content: v } : f))
      );
      setModified((p) => new Set(p).add(activeId));
    },
    [activeId]
  );

  // ── Run code ─────────────────────────────────────────────────

  const handleRun = useCallback(
    async (mode: ExecutionMode) => {
      setRunning(true);
      setRunMode(mode);
      setResult(null);
      setError(null);
      setBtmOpen(true);
      setBtmTab("output");
      try {
        const r = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            mode,
            timeout: mode === "emulate" ? 60 : 30,
            run_gcc: true,
          }),
        });
        if (!r.ok) {
          const e = await r
            .json()
            .catch(() => ({ error: r.statusText }));
          setError(e.error || `HTTP ${r.status}`);
          setBtmTab("problems");
          return;
        }
        const data: CodeRunnerResponse = await r.json();
        setResult(data);
        if (data.pasim && !data.pasim.success) setBtmTab("problems");
        else if (data.pasim) setBtmTab("pasim");
        else if (data.patemu) setBtmTab("patemu");
      } catch (e: any) {
        setError(e.message || "Network error");
        setBtmTab("problems");
      } finally {
        setRunning(false);
        setRunMode(null);
      }
    },
    [code]
  );

  // ── Resize handlers ──────────────────────────────────────────

  const sRef = useRef(false);
  const onSideResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      sRef.current = true;
      const x0 = e.clientX,
        w0 = sideW;
      const move = (ev: MouseEvent) => {
        if (sRef.current)
          setSideW(Math.max(180, Math.min(400, w0 + ev.clientX - x0)));
      };
      const up = () => {
        sRef.current = false;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [sideW]
  );

  const bRef = useRef(false);
  const onBtmResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      bRef.current = true;
      const y0 = e.clientY,
        h0 = btmH;
      const move = (ev: MouseEvent) => {
        if (bRef.current)
          setBtmH(Math.max(100, Math.min(500, h0 - (ev.clientY - y0))));
      };
      const up = () => {
        bRef.current = false;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [btmH]
  );

  // ═══════════════════════════════════════════════════════════════
  // ── Render ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#e6edf3] overflow-hidden font-mono text-sm">
      {/* ═══ Title Bar ═══ */}
      <div className="flex items-center h-10 bg-[#161b22] border-b border-[#30363d] px-4 select-none shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#58a6ff] font-bold text-base">⬡</span>
          <span className="text-sm font-semibold">Patmos IDE</span>
          <span className="text-[#484f58]">—</span>
          <span className="text-xs text-[#8b949e]">
            {activeFile?.name ?? "untitled.c"}
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-xs text-[#8b949e]">
          <span>patmos-clang</span>
          <span className="text-[#484f58]">•</span>
          <span>pasim + patemu</span>
          <span className="text-[#484f58]">•</span>
          <a
            href="https://github.com/t-crest/patmos"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#58a6ff] transition-colors"
          >
            t-crest/patmos ↗
          </a>
        </div>
      </div>

      {/* ═══ Toolbar ═══ */}
      <div className="flex items-center h-10 bg-[#161b22] border-b border-[#30363d] px-3 gap-1 shrink-0">
        <TB
          icon="☰"
          tip="Toggle Sidebar"
          on={sideOpen}
          click={() => setSideOpen((v) => !v)}
        />
        <Sep />
        <TB icon="+" label="New File" tip="Create new C file" click={createFile} />
        <Sep />
        <TB
          icon="▶"
          label="Run"
          tip="Run on pasim (Simulator)"
          clr="green"
          off={running || !code.trim()}
          spin={running && runMode === "simulate"}
          click={() => handleRun("simulate")}
        />
        <TB
          icon="⚡"
          label="Analyze"
          tip="Run on patemu (Cycle-accurate)"
          clr="purple"
          off={running || !code.trim()}
          spin={running && runMode === "emulate"}
          click={() => handleRun("emulate")}
        />
        <TB
          icon="⇄"
          label="Both"
          tip="Run on pasim + patemu"
          clr="blue"
          off={running || !code.trim()}
          spin={running && runMode === "both"}
          click={() => handleRun("both")}
        />
        <Sep />
        <TB
          icon="🚗"
          label="Car Demo"
          tip="Obstacle avoidance demo"
          on={carDemo}
          click={() => { setCarDemo((v) => !v); setRadarView(false); }}
        />
        <TB
          icon="📡"
          label="Radar"
          tip="WebSocket radar dashboard"
          on={radarView}
          click={() => { setRadarView((v) => !v); setCarDemo(false); }}
        />
        <TB
          icon="⊞"
          tip="Toggle Bottom Panel"
          on={btmOpen}
          click={() => setBtmOpen((v) => !v)}
        />
        <div className="flex-1" />
        {running && (
          <span className="text-xs text-[#d29922] animate-pulse">
            ⏳{" "}
            {runMode === "emulate"
              ? "Emulating"
              : runMode === "both"
                ? "Running both"
                : "Simulating"}
            …
          </span>
        )}
        {result && !running && (
          <span
            className={`text-xs ${result.success ? "text-[#3fb950]" : "text-[#f85149]"}`}
          >
            {result.success ? "✓ Done" : "✗ Failed"}
          </span>
        )}
      </div>

      {/* ═══ Main Area ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── Sidebar ─── */}
        {sideOpen && (
          <>
            <aside
              className="flex flex-col bg-[#010409] border-r border-[#30363d] shrink-0 overflow-hidden"
              style={{ width: sideW }}
            >
              <div className="flex items-center justify-between h-9 px-3 text-[11px] text-[#8b949e] uppercase tracking-wider border-b border-[#21262d] shrink-0">
                <span>Explorer</span>
                <button
                  onClick={createFile}
                  title="New File"
                  className="text-[#8b949e] hover:text-[#e6edf3] text-base leading-none"
                >
                  +
                </button>
              </div>
              <div className="flex-1 overflow-y-auto text-xs">
                {/* User files */}
                {files.some((f) => !f.isSample) && (
                  <Sec title="My Files">
                    {files
                      .filter((f) => !f.isSample)
                      .map((f) => (
                        <SideFile
                          key={f.id}
                          f={f}
                          active={activeId === f.id && !carDemo && !radarView}
                          mod={modified.has(f.id)}
                          renaming={renameId === f.id}
                          rnVal={renameVal}
                          click={() => openFile(f.id)}
                          startRename={() => {
                            setRenameId(f.id);
                            setRenameVal(f.name);
                          }}
                          rnChange={setRenameVal}
                          rnSubmit={() => {
                            if (renameVal.trim()) {
                              const n = renameVal.endsWith(".c")
                                ? renameVal
                                : renameVal + ".c";
                              setFiles((p) =>
                                p.map((x) =>
                                  x.id === f.id ? { ...x, name: n } : x
                                )
                              );
                            }
                            setRenameId(null);
                          }}
                          rnCancel={() => setRenameId(null)}
                          del={() => deleteFile(f.id)}
                        />
                      ))}
                  </Sec>
                )}
                {/* Samples */}
                <Sec title="Samples">
                  {files
                    .filter((f) => f.isSample)
                    .map((f) => (
                      <SideFile
                        key={f.id}
                        f={f}
                        active={activeId === f.id && !carDemo && !radarView}
                        mod={modified.has(f.id)}
                        click={() => openFile(f.id)}
                      />
                    ))}
                </Sec>
                {/* Toolchain info */}
                <Sec title="Toolchain">
                  <div className="px-3 py-1 space-y-1 text-[11px] text-[#8b949e]">
                    <div>
                      ⚙ <span className="text-[#e6edf3]">patmos-clang</span>
                    </div>
                    <div>
                      ▶ <span className="text-[#e6edf3]">pasim</span>{" "}
                      <span className="text-[#484f58]">— simulator</span>
                    </div>
                    <div>
                      ⚡ <span className="text-[#e6edf3]">patemu</span>{" "}
                      <span className="text-[#484f58]">— emulator</span>
                    </div>
                    <div>
                      📦 <span className="text-[#e6edf3]">gcc</span>{" "}
                      <span className="text-[#484f58]">— baseline</span>
                    </div>
                  </div>
                </Sec>
              </div>
            </aside>
            {/* Resize handle */}
            <div
              className="w-1 cursor-col-resize bg-transparent hover:bg-[#58a6ff]/40 transition-colors shrink-0"
              onMouseDown={onSideResize}
            />
          </>
        )}

        {/* ─── Editor + Bottom ─── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center h-9 bg-[#010409] border-b border-[#30363d] overflow-x-auto shrink-0">
            {openIds.map((id) => {
              const f = files.find((x) => x.id === id);
              if (!f) return null;
              const isActive = activeId === id && !carDemo && !radarView;
              return (
                <div
                  key={id}
                  onClick={() => {
                    setActiveId(id);
                    setCarDemo(false);
                    setRadarView(false);
                  }}
                  className={`flex items-center gap-2 h-full px-3 text-xs cursor-pointer border-r border-[#21262d] shrink-0 transition-colors ${
                    isActive
                      ? "bg-[#0d1117] text-[#e6edf3] border-t-2 border-t-[#f78166]"
                      : "bg-[#010409] text-[#8b949e] hover:text-[#e6edf3] border-t-2 border-t-transparent"
                  }`}
                >
                  <span className="text-[#58a6ff] text-[10px]">C</span>
                  <span>{f.name}</span>
                  {modified.has(id) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#d29922] shrink-0" />
                  )}
                  {openIds.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(id);
                      }}
                      className="ml-1 text-[#484f58] hover:text-[#e6edf3] text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {carDemo && (
              <div className="flex items-center gap-2 h-full px-3 text-xs cursor-default border-r border-[#21262d] shrink-0 bg-[#0d1117] text-[#e6edf3] border-t-2 border-t-[#3fb950]">
                🚗 Car Demo
                <button
                  onClick={() => setCarDemo(false)}
                  className="ml-1 text-[#484f58] hover:text-[#e6edf3] text-[10px]"
                >
                  ✕
                </button>
              </div>
            )}
            {radarView && (
              <div className="flex items-center gap-2 h-full px-3 text-xs cursor-default border-r border-[#21262d] shrink-0 bg-[#0d1117] text-[#e6edf3] border-t-2 border-t-[#58a6ff]">
                📡 Radar Dashboard
                <button
                  onClick={() => setRadarView(false)}
                  className="ml-1 text-[#484f58] hover:text-[#e6edf3] text-[10px]"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex-1 bg-[#010409]" />
          </div>

          {/* Breadcrumb (editor only) */}
          {!carDemo && !radarView && activeFile && (
            <div className="flex items-center h-6 px-3 bg-[#0d1117] border-b border-[#21262d] text-[11px] text-[#8b949e] shrink-0">
              <span className="text-[#484f58]">
                {activeFile.isSample ? "samples" : "files"}
              </span>
              <span className="mx-1 text-[#30363d]">/</span>
              <span className="text-[#c9d1d9]">{activeFile.name}</span>
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            {radarView ? (
              <RadarDashboard />
            ) : carDemo ? (
              <div className="h-full overflow-auto bg-[#0d1117] p-6">
                <div className="mb-4 p-3 rounded-lg bg-[#161b22] border border-[#30363d] text-xs text-[#8b949e]">
                  <p className="mb-1">
                    <span className="text-[#58a6ff] font-semibold">
                      Car Demo
                    </span>{" "}
                    — Obstacle avoidance using real Patmos toolchain
                  </p>
                  <p>
                    The demo runs{" "}
                    <button
                      onClick={() => {
                        const af = files.find((f) =>
                          f.name.includes("Obstacle")
                        );
                        if (af) openFile(af.id);
                        else openFile("s0");
                      }}
                      className="text-[#58a6ff] hover:underline"
                    >
                      Obstacle_Avoidance.c
                    </button>{" "}
                    on real <span className="text-[#58a6ff]">pasim</span> +{" "}
                    <span className="text-[#d2a8ff]">patemu</span> +{" "}
                    <span className="text-[#d18616]">GCC</span> before starting
                    the animation with real timing data.
                    <span className="text-[#f85149]">
                      {" "}Requires backend: docker compose up
                    </span>
                  </p>
                </div>
                <CarDemo />
              </div>
            ) : (
              <MonacoEditor
                height="100%"
                language="c"
                theme="github-dark"
                value={code}
                onChange={updateCode}
                beforeMount={registerGitHubTheme}
                options={{
                  fontSize: 13,
                  fontFamily:
                    "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                  fontLigatures: true,
                  minimap: { enabled: true, scale: 1 },
                  scrollBeyondLastLine: false,
                  renderLineHighlight: "all",
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                  smoothScrolling: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 8, bottom: 8 },
                  lineNumbers: "on",
                  glyphMargin: true,
                  folding: true,
                  renderWhitespace: "selection",
                  automaticLayout: true,
                }}
              />
            )}
          </div>

          {/* ─── Bottom Panel ─── */}
          {btmOpen && (
            <>
              <div
                className="h-1 cursor-row-resize bg-transparent hover:bg-[#58a6ff]/40 transition-colors shrink-0"
                onMouseDown={onBtmResize}
              />
              <div
                className="flex flex-col bg-[#0d1117] border-t border-[#30363d] shrink-0"
                style={{ height: btmH }}
              >
                {/* Bottom tab bar */}
                <div className="flex items-center h-8 bg-[#010409] border-b border-[#21262d] px-2 shrink-0">
                  <BT
                    label="Output"
                    on={btmTab === "output"}
                    click={() => setBtmTab("output")}
                  />
                  {result?.pasim && (
                    <BT
                      label="pasim"
                      on={btmTab === "pasim"}
                      click={() => setBtmTab("pasim")}
                      badge={result.pasim.stats?.cycles}
                    />
                  )}
                  {result?.patemu && (
                    <BT
                      label="patemu"
                      on={btmTab === "patemu"}
                      click={() => setBtmTab("patemu")}
                      badge={result.patemu.stats?.cycles}
                    />
                  )}
                  {result?.gcc && (
                    <BT
                      label="GCC"
                      on={btmTab === "gcc"}
                      click={() => setBtmTab("gcc")}
                    />
                  )}
                  <BT
                    label="Problems"
                    on={btmTab === "problems"}
                    click={() => setBtmTab("problems")}
                    err={!!error || (result !== null && !result.success)}
                  />
                  <div className="flex-1" />
                  <button
                    onClick={() => setBtmOpen(false)}
                    className="text-[#484f58] hover:text-[#e6edf3] text-[10px] px-1"
                  >
                    ✕
                  </button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-3 text-xs">
                  {btmTab === "output" && (
                    <OutputView out={output} ok={result?.success} />
                  )}
                  {btmTab === "pasim" && result?.pasim && (
                    <ToolStats r={result.pasim} />
                  )}
                  {btmTab === "patemu" && result?.patemu && (
                    <ToolStats r={result.patemu} />
                  )}
                  {btmTab === "gcc" && result?.gcc && (
                    <GccView r={result.gcc} />
                  )}
                  {btmTab === "problems" && (
                    <ProblemsView err={error} result={result} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Timing Comparison Bar (Normal CPU vs Patmos) ═══ */}
      {result && <TimingBar result={result} />}

      {/* ═══ Status Bar ═══ */}
      <div className="flex items-center h-6 bg-[#161b22] border-t border-[#30363d] px-3 text-[11px] text-[#8b949e] shrink-0 select-none">
        <span className="mr-4">
          {running
            ? "⏳ Running…"
            : result
              ? result.success
                ? "✓ Ready"
                : "✗ Error"
              : "Ready"}
        </span>
        <span className="mr-4">Ln {code.split("\n").length}</span>
        <span className="mr-4">C</span>
        <span className="mr-4">UTF-8</span>
        <div className="flex-1" />
        <span className="text-[#484f58]">Patmos T-CREST</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ── Sub-components ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function Sep() {
  return <div className="w-px h-5 bg-[#30363d] mx-0.5" />;
}

function TB({
  icon,
  label,
  tip,
  clr,
  on,
  off,
  spin,
  click,
}: {
  icon: string;
  label?: string;
  tip?: string;
  clr?: "green" | "purple" | "blue";
  on?: boolean;
  off?: boolean;
  spin?: boolean;
  click: () => void;
}) {
  const c =
    clr === "green"
      ? "text-[#3fb950]"
      : clr === "purple"
        ? "text-[#d2a8ff]"
        : clr === "blue"
          ? "text-[#58a6ff]"
          : "text-[#8b949e]";
  return (
    <button
      title={tip}
      disabled={off}
      onClick={click}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${c} ${on ? "bg-[#1c2128]" : ""} ${off ? "opacity-40 cursor-not-allowed" : "hover:bg-[#1c2128]"}`}
    >
      <span>{spin ? "⏳" : icon}</span>
      {label && <span className="text-[#c9d1d9]">{label}</span>}
    </button>
  );
}

function BT({
  label,
  on,
  click,
  badge,
  err,
}: {
  label: string;
  on: boolean;
  click: () => void;
  badge?: number;
  err?: boolean;
}) {
  return (
    <button
      onClick={click}
      className={`flex items-center gap-1.5 px-3 h-full text-[11px] transition-colors border-b-2 ${
        on
          ? "text-[#e6edf3] border-b-[#f78166]"
          : "text-[#8b949e] border-b-transparent hover:text-[#e6edf3]"
      }`}
    >
      {err && <span className="text-[#f85149] text-[10px]">●</span>}
      {label}
      {badge != null && badge > 0 && (
        <span className="text-[10px] text-[#8b949e] bg-[#21262d] px-1 rounded">
          {badge.toLocaleString()} cyc
        </span>
      )}
    </button>
  );
}

function Sec({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 py-2 border-t border-[#21262d] first:border-t-0">
      <div className="flex items-center gap-1 px-1 py-1 text-[11px] text-[#8b949e] uppercase tracking-wider">
        <span className="text-[9px]">▼</span> {title}
      </div>
      {children}
    </div>
  );
}

function SideFile({
  f,
  active,
  mod,
  renaming,
  rnVal,
  click,
  startRename,
  rnChange,
  rnSubmit,
  rnCancel,
  del,
}: {
  f: VFile;
  active: boolean;
  mod: boolean;
  renaming?: boolean;
  rnVal?: string;
  click: () => void;
  startRename?: () => void;
  rnChange?: (v: string) => void;
  rnSubmit?: () => void;
  rnCancel?: () => void;
  del?: () => void;
}) {
  if (renaming) {
    return (
      <div className="px-3 py-1.5">
        <input
          autoFocus
          className="w-full bg-[#0d1117] border border-[#58a6ff] text-[#e6edf3] text-xs px-1 py-0.5 rounded outline-none"
          value={rnVal}
          onChange={(e) => rnChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") rnSubmit?.();
            if (e.key === "Escape") rnCancel?.();
          }}
          onBlur={() => rnSubmit?.()}
        />
      </div>
    );
  }
  return (
    <div
      onClick={click}
      onDoubleClick={startRename}
      className={`group flex items-center justify-between px-3 py-1.5 rounded cursor-pointer transition-colors ${
        active
          ? "bg-[#1f6feb22] text-[#e6edf3]"
          : "text-[#8b949e] hover:bg-[#1c2128] hover:text-[#e6edf3]"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[#58a6ff] text-[10px] shrink-0">C</span>
        <span className="truncate">{f.name}</span>
        {mod && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#d29922] shrink-0" />
        )}
      </div>
      {del && !f.isSample && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            del();
          }}
          className="invisible group-hover:visible text-[#484f58] hover:text-[#f85149] text-[10px]"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Bottom Panel Views ───────────────────────────────────────────

function OutputView({ out, ok }: { out: string; ok?: boolean }) {
  if (!out && ok == null)
    return (
      <span className="text-[#8b949e] italic">Run code to see output…</span>
    );
  return (
    <pre
      className={`whitespace-pre-wrap leading-relaxed ${ok === false ? "text-[#f85149]" : "text-[#c9d1d9]"}`}
    >
      {out || "(no output)"}
    </pre>
  );
}

function ToolStats({ r }: { r: ExecutionResult }) {
  const s = r.stats;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            r.success
              ? "bg-[#238636]/30 text-[#3fb950]"
              : "bg-[#da3633]/30 text-[#f85149]"
          }`}
        >
          {r.success ? "SUCCESS" : `EXIT ${r.exit_code}`}
        </span>
        <span className="text-[#8b949e]">
          {r.tool} • {r.wall_time_ms.toFixed(0)}ms
        </span>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {s.cycles > 0 && (
            <SR l="Cycles" v={s.cycles.toLocaleString()} hi />
          )}
          {s.instructions > 0 && (
            <SR l="Instructions" v={s.instructions.toLocaleString()} />
          )}
          {s.bundles > 0 && (
            <SR l="Bundles" v={s.bundles.toLocaleString()} />
          )}
          {(s.cache_hits > 0 || s.cache_misses > 0) && (
            <>
              <SR l="Cache Hits" v={s.cache_hits.toLocaleString()} />
              <SR l="Cache Misses" v={s.cache_misses.toLocaleString()} />
            </>
          )}
          {(s.method_cache_hits > 0 || s.method_cache_misses > 0) && (
            <>
              <SR l="Method $ Hits" v={s.method_cache_hits.toLocaleString()} />
              <SR
                l="Method $ Misses"
                v={s.method_cache_misses.toLocaleString()}
              />
            </>
          )}
          {s.stack_cache_ops > 0 && (
            <SR l="Stack Cache" v={s.stack_cache_ops.toLocaleString()} />
          )}
        </div>
      )}
      {s?.raw_output && (
        <details className="mt-3">
          <summary className="text-[11px] text-[#484f58] hover:text-[#8b949e] cursor-pointer">
            Raw output
          </summary>
          <pre className="mt-1 text-[11px] text-[#8b949e] whitespace-pre-wrap bg-[#010409] rounded p-2 max-h-40 overflow-y-auto">
            {s.raw_output}
          </pre>
        </details>
      )}
      {r.output && (
        <div className="mt-3 border-t border-[#21262d] pt-2">
          <span className="text-[10px] text-[#484f58] uppercase tracking-wider">
            Program Output
          </span>
          <pre className="mt-1 text-[#c9d1d9] whitespace-pre-wrap">
            {r.output}
          </pre>
        </div>
      )}
    </div>
  );
}

function GccView({ r }: { r: ExecutionResult }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            r.success
              ? "bg-[#238636]/30 text-[#3fb950]"
              : "bg-[#da3633]/30 text-[#f85149]"
          }`}
        >
          {r.success ? "SUCCESS" : `EXIT ${r.exit_code}`}
        </span>
        <span className="text-[#8b949e]">
          gcc (baseline) • {r.wall_time_ms.toFixed(0)}ms
        </span>
      </div>
      {r.output && (
        <pre className="text-[#c9d1d9] whitespace-pre-wrap">{r.output}</pre>
      )}
      {r.error && (
        <pre className="text-[#f85149] whitespace-pre-wrap">{r.error}</pre>
      )}
    </div>
  );
}

function ProblemsView({
  err,
  result,
}: {
  err: string | null;
  result: CodeRunnerResponse | null;
}) {
  const problems: { lvl: "error" | "warn"; msg: string }[] = [];
  if (err) problems.push({ lvl: "error", msg: err });
  if (result && !result.success) {
    if (result.pasim && !result.pasim.success && result.pasim.error)
      problems.push({ lvl: "error", msg: `[pasim] ${result.pasim.error}` });
    if (result.patemu && !result.patemu.success && result.patemu.error)
      problems.push({ lvl: "error", msg: `[patemu] ${result.patemu.error}` });
    if (result.gcc && !result.gcc.success && result.gcc.error)
      problems.push({ lvl: "warn", msg: `[gcc] ${result.gcc.error}` });
  }
  if (!problems.length)
    return (
      <span className="text-[#8b949e] italic">No problems detected.</span>
    );
  return (
    <div className="space-y-2">
      {problems.map((p, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className={
              p.lvl === "error" ? "text-[#f85149]" : "text-[#d29922]"
            }
          >
            {p.lvl === "error" ? "✗" : "⚠"}
          </span>
          <pre className="text-[#8b949e] whitespace-pre-wrap flex-1">
            {p.msg}
          </pre>
        </div>
      ))}
    </div>
  );
}

function SR({ l, v, hi }: { l: string; v: string; hi?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#8b949e]">{l}</span>
      <span className={hi ? "text-[#58a6ff] font-bold" : "text-[#c9d1d9]"}>
        {v}
      </span>
    </div>
  );
}

// ── Timing Comparison Bar ────────────────────────────────────────

function TimingBar({ result }: { result: CodeRunnerResponse }) {
  const gMs = result.gcc?.wall_time_ms;
  const pMs = result.pasim?.wall_time_ms;
  const pCyc = result.pasim?.stats?.cycles;
  const eMs = result.patemu?.wall_time_ms;
  const eCyc = result.patemu?.stats?.cycles;
  const times = [gMs, pMs, eMs].filter((t): t is number => t != null);
  const max = Math.max(...times, 1);

  return (
    <div className="flex items-center h-9 bg-[#161b22] border-t border-[#30363d] px-4 gap-6 text-[11px] shrink-0 select-none overflow-x-auto">
      <span className="text-[#8b949e] shrink-0 font-semibold">
        Normal CPU vs Patmos:
      </span>

      {gMs != null && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[#d18616]">GCC</span>
          <div className="w-20 h-2 bg-[#21262d] rounded overflow-hidden">
            <div
              className="h-full bg-[#d18616]/60 rounded"
              style={{ width: `${(gMs / max) * 100}%` }}
            />
          </div>
          <span className="text-[#e6edf3]">{gMs.toFixed(0)}ms</span>
        </div>
      )}

      {pMs != null && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[#58a6ff]">pasim</span>
          <div className="w-20 h-2 bg-[#21262d] rounded overflow-hidden">
            <div
              className="h-full bg-[#58a6ff]/60 rounded"
              style={{ width: `${(pMs / max) * 100}%` }}
            />
          </div>
          <span className="text-[#e6edf3]">
            {pCyc ? `${pCyc.toLocaleString()} cyc · ` : ""}
            {pMs.toFixed(0)}ms
          </span>
        </div>
      )}

      {eMs != null && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[#d2a8ff]">patemu</span>
          <div className="w-20 h-2 bg-[#21262d] rounded overflow-hidden">
            <div
              className="h-full bg-[#d2a8ff]/60 rounded"
              style={{ width: `${(eMs / max) * 100}%` }}
            />
          </div>
          <span className="text-[#e6edf3]">
            {eCyc ? `${eCyc.toLocaleString()} cyc · ` : ""}
            {eMs.toFixed(0)}ms
          </span>
        </div>
      )}

      <div className="flex-1" />

      {pCyc != null && eCyc != null && (
        <span className="text-[#3fb950] shrink-0">
          Patmos: deterministic —{" "}
          {pCyc === eCyc
            ? "same cycles ✓"
            : `Δ${Math.abs(pCyc - eCyc).toLocaleString()} cycles`}
        </span>
      )}
    </div>
  );
}
