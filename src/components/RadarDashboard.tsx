import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  CodeRunnerResponse,
  PatmosStats,
} from "@/lib/types";
import {
  computePatmosTiming,
  computeNormalTiming,
  AVOIDANCE_TASK,
  PATMOS,
  NORMAL_CPU,
  type TimingResult,
  type TaskProfile,
} from "@/lib/timing-model";
import { SAMPLE_CODES } from "@/lib/sample-code";

// ── Types ─────────────────────────────────────────────────────────

type ObjType = "car" | "suv" | "truck" | "pedestrian" | "cyclist" | "cone" | "barrier";
type ThreatLevel = "HIGH" | "MED" | "LOW";

interface SceneObject {
  id: string;
  type: ObjType;
  lane: number;       // -2..2 (fractional for smooth drift)
  dist: number;       // 0..MAX_DIST
  speed: number;      // relative approach speed
  threatLevel: ThreatLevel;
  color: string;
  wobble: number;
  // Real timing data per object:
  detected: boolean;         // entered detection range
  patmosTiming: TimingResult | null;  // Patmos reaction timing
  patmuTiming: TimingResult | null;   // Patemu reaction timing
  cpuTiming: TimingResult | null;     // Normal CPU reaction timing
  patmosReacted: boolean;    // Patmos reacted in time
  patmuReacted: boolean;     // Patemu reacted in time
  cpuReacted: boolean;       // CPU reacted in time
  cpuMissed: boolean;        // CPU missed deadline
  detectedAtDist: number;    // distance when first detected
  radarTriggerTime: number;  // when this object triggered radar
}

interface RadarTrace {
  id: string;
  type: ObjType;
  dist: number;
  angle: number;
  patmosCycles: number;
  patmuCycles: number;
  cpuCycles: number;
  patmosDeadlineMet: boolean;
  patmuDeadlineMet: boolean;
  cpuDeadlineMet: boolean;
  timestamp: number;
  severity: ThreatLevel;
}

// ── Constants ─────────────────────────────────────────────────────

const OBJ_TYPES: ObjType[] = ["car", "suv", "truck", "pedestrian", "cyclist", "cone", "barrier"];
const TYPE_WEIGHTS = [0.28, 0.18, 0.12, 0.14, 0.1, 0.1, 0.08];
const CAR_COLORS = ["#3a7bd5", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#ecf0f1", "#34495e", "#e67e22", "#95a5a6"];
const THREAT_COLORS: Record<ThreatLevel, string> = { HIGH: "#ff4757", MED: "#ffa502", LOW: "#2ed573" };
const MAX_DIST = 350;
const MAX_OBJECTS = 10;
const MAX_EVENTS = 60;
const MAX_SPARK = 220;
const DETECTION_DIST = 180; // distance at which we trigger timing computation
const LANES = [-1.6, -0.8, 0, 0.8, 1.6];

let _oid = 0;
const rid = () => { _oid++; return _oid.toString(16).toUpperCase().padStart(4, "0"); };
const fmt = (n: number) => n.toLocaleString();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pickWeighted = <T,>(items: T[], weights: number[]): T => {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < items.length; i++) { sum += weights[i]; if (r < sum) return items[i]; }
  return items[items.length - 1];
};

function getAvoidanceCode(): string {
  const sample = SAMPLE_CODES.find((s) => s.name === "Obstacle Avoidance");
  return sample?.code ?? "";
}

// ══════════════════════════════════════════════════════════════════
// ── Component ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

export default function RadarDashboard() {
  const [running, setRunning] = useState(true);
  const [egoSpeed, setEgoSpeed] = useState(50);

  // Real benchmark state
  const [benchResult, setBenchResult] = useState<CodeRunnerResponse | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);

  // Radar state
  const [radarTraces, setRadarTraces] = useState<RadarTrace[]>([]);
  const [radarSweepAngle, setRadarSweepAngle] = useState(0);
  const [totalScans, setTotalScans] = useState(0);

  const radarRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // Mutable simulation state
  const simRef = useRef({
    objects: [] as SceneObject[],
    radarTraces: [] as RadarTrace[],
    elapsed: 0,
    lastSync: 0,
    spawnCd: 0,
    totalScans: 0,
    radarSweepAngle: 0,
  });

  const runRef = useRef(running);
  const speedRef = useRef(egoSpeed);
  useEffect(() => { runRef.current = running; }, [running]);
  useEffect(() => { speedRef.current = egoSpeed; }, [egoSpeed]);

  // Real benchmark data
  const realPasimCycles = useRef(0);
  const realPatemuCycles = useRef(0);
  const realPasimStats = useRef<PatmosStats | null>(null);

  useEffect(() => {
    if (benchResult?.pasim?.stats) {
      realPasimCycles.current = benchResult.pasim.stats.cycles;
      realPasimStats.current = benchResult.pasim.stats;
    }
    if (benchResult?.patemu?.stats) {
      realPatemuCycles.current = benchResult.patemu.stats.cycles;
    }
  }, [benchResult]);

  // ── Benchmark ──────────────────────────────────────────────

  const runBenchmark = useCallback(async () => {
    setBenchmarking(true);
    setBenchError(null);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: getAvoidanceCode(),
          mode: "both",
          timeout: 60,
          run_gcc: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setBenchError(err.error || `HTTP ${res.status}`);
        return;
      }
      const data: CodeRunnerResponse = await res.json();
      setBenchResult(data);
      if (!data.success) setBenchError("Benchmark failed — check backend");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setBenchError(msg.includes("fetch") ? "Cannot reach backend. Run: docker compose up" : msg);
    } finally {
      setBenchmarking(false);
    }
  }, []);

  useEffect(() => { runBenchmark(); }, [runBenchmark]);

  // ── Timing computation for each detected object ────────────

  const computeObjectTiming = useCallback((obj: SceneObject): { patmos: TimingResult; patmu: TimingResult; cpu: TimingResult } => {
    // ALWAYS use AVOIDANCE_TASK — Patmos is deterministic regardless of threat level
    const task: TaskProfile = AVOIDANCE_TASK;

    // Patmos (PASIM) — Use real benchmark cycles if available, otherwise use model
    let patmos: TimingResult;
    if (realPasimCycles.current > 0) {
      const cycles = realPasimCycles.current;
      patmos = {
        cycles,
        wcet: cycles,
        bcet: cycles,
        jitter: 0,
        executionTimeUs: cycles / PATMOS.clockMHz,
        deadlineMet: cycles <= task.deadline_cycles,
        marginCycles: task.deadline_cycles - cycles,
        breakdown: { base: cycles, cachePenalty: 0, branchPenalty: 0, osPenalty: 0 },
      };
    } else {
      patmos = computePatmosTiming(task);
    }

    // Patemu (hardware emulator) — Use real benchmark cycles if available
    let patmu: TimingResult;
    if (realPatemuCycles.current > 0) {
      const cycles = realPatemuCycles.current;
      patmu = {
        cycles,
        wcet: cycles,
        bcet: cycles,
        jitter: 0,
        executionTimeUs: cycles / PATMOS.clockMHz,
        deadlineMet: cycles <= task.deadline_cycles,
        marginCycles: task.deadline_cycles - cycles,
        breakdown: { base: cycles, cachePenalty: 0, branchPenalty: 0, osPenalty: 0 },
      };
    } else {
      patmu = { ...patmos }; // Use Patmos if Patemu not available
    }

    // Normal CPU — NON-DETERMINISTIC: varies based on threat level
    // Threat level affects jitter via cache misses and branch penalties
    const cpu = computeNormalTiming(task);

    return { patmos, patmu, cpu };
  }, []);

  // ── Main simulation loop ──────────────────────────────────

  const computeObjectTimingRef = useRef(computeObjectTiming);
  useEffect(() => { computeObjectTimingRef.current = computeObjectTiming; }, [computeObjectTiming]);

  useEffect(() => {
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      const s = simRef.current;

      if (runRef.current) {
        s.elapsed += dt;
        s.radarSweepAngle = (s.radarSweepAngle + dt * 120) % 360; // 3 rotations per sec

        // ── Spawn objects ──
        s.spawnCd -= dt;
        if (s.objects.length < MAX_OBJECTS && s.spawnCd <= 0) {
          s.spawnCd = 0.5 + Math.random() * 1.5;
          const type = pickWeighted(OBJ_TYPES, TYPE_WEIGHTS);
          const lane = LANES[Math.floor(Math.random() * LANES.length)];
          const threatLvl: ThreatLevel = Math.random() < 0.2 ? "HIGH" : Math.random() < 0.4 ? "MED" : "LOW";
          const spd = type === "pedestrian" ? 8 + Math.random() * 15
            : type === "cyclist" ? 15 + Math.random() * 25
            : type === "cone" || type === "barrier" ? 25 + Math.random() * 10
            : 20 + Math.random() * 50;
          s.objects.push({
            id: rid(), type, lane,
            dist: MAX_DIST + 20 + Math.random() * 30,
            speed: spd,
            threatLevel: threatLvl,
            color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
            wobble: Math.random() * Math.PI * 2,
            detected: false,
            patmosTiming: null,
            patmuTiming: null,
            cpuTiming: null,
            patmosReacted: false,
            patmuReacted: false,
            cpuReacted: false,
            cpuMissed: false,
            detectedAtDist: 0,
            radarTriggerTime: 0,
          });
        }

        // ── Update & detect objects ──
        const alive: SceneObject[] = [];
        for (const obj of s.objects) {
          obj.dist -= obj.speed * dt;
          obj.wobble += dt * 1.5;
          if (obj.type !== "cone" && obj.type !== "barrier") {
            obj.lane += Math.sin(obj.wobble) * 0.001;
          }

          // ── RADAR TRIGGER: Detection only on entry ──
          if (!obj.detected && obj.dist <= DETECTION_DIST && obj.dist > 0) {
            obj.detected = true;
            obj.detectedAtDist = obj.dist;
            obj.radarTriggerTime = s.elapsed;
            s.totalScans++;

            const { patmos, patmu, cpu } = computeObjectTimingRef.current(obj);
            obj.patmosTiming = patmos;
            obj.patmuTiming = patmu;
            obj.cpuTiming = cpu;

            obj.patmosReacted = patmos.deadlineMet;
            obj.patmuReacted = patmu.deadlineMet;
            obj.cpuReacted = cpu.deadlineMet;
            if (!cpu.deadlineMet) obj.cpuMissed = true;

            // Add radar trace
            const angle = (obj.lane / 2.5) * 60 + 90; // -60 to 60 degrees (forward cone), normalized to lane
            const trace: RadarTrace = {
              id: obj.id,
              type: obj.type,
              dist: Math.floor(obj.dist),
              angle,
              patmosCycles: patmos.cycles,
              patmuCycles: patmu.cycles,
              cpuCycles: cpu.cycles,
              patmosDeadlineMet: patmos.deadlineMet,
              patmuDeadlineMet: patmu.deadlineMet,
              cpuDeadlineMet: cpu.deadlineMet,
              timestamp: s.elapsed,
              severity: obj.threatLevel,
            };
            s.radarTraces = [trace, ...s.radarTraces].slice(0, 50);
          }

          if (obj.dist < -10) continue;
          alive.push(obj);
        }
        s.objects = alive;
      }

      drawRadarRef.current?.(s);
      drawSparkRef.current?.(s);

      // Sync to React at ~10fps
      if (now - s.lastSync > 100) {
        s.lastSync = now;
        setRadarTraces([...s.radarTraces]);
        setRadarSweepAngle(s.radarSweepAngle);
        setTotalScans(s.totalScans);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); };
  }, []);

  // ══════════════════════════════════════════════════════════════
  // ── Draw Submarine Radar ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  const drawRadarRef = useRef<(s: typeof simRef.current) => void>(() => {});
  const drawSparkRef = useRef<(s: typeof simRef.current) => void>(() => {});

  useEffect(() => {
    const canvas = radarRef.current;
    if (!canvas) return;

    // Function to update canvas dimensions
    const updateCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = rect.width;
      const H = rect.height;
      if (W > 0 && H > 0 && (canvas.width !== W * dpr || canvas.height !== H * dpr)) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
    };

    // Update on mount
    updateCanvasDimensions();

    // Set up ResizeObserver to handle canvas sizing
    const resizeObserver = new ResizeObserver(updateCanvasDimensions);
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    drawRadarRef.current = (s: typeof simRef.current) => {
    const canvas = radarRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    
    // Save context state and reset transform
    ctx.save();
    ctx.scale(dpr, dpr);

    const centerX = W / 2;
    const centerY = H / 2;
    const maxRadius = Math.min(W, H) / 2 - 10;

    // ── Background ──
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, W, H);

    // ── Radial gradient background ──
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    grad.addColorStop(0, "#1a2f4a");
    grad.addColorStop(1, "#0a0f1a");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    // ── Concentric circles (distance rings) ──
    const ringSpacing = maxRadius / 3;
    for (let i = 1; i <= 3; i++) {
      const r = ringSpacing * i;
      ctx.strokeStyle = "#2d5a8c22";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Distance labels
      ctx.fillStyle = "#5a7a9c";
      ctx.font = "8px monospace";
      ctx.textAlign = "right";
      const distKm = (i * DETECTION_DIST) / 3;
      ctx.fillText(`${Math.floor(distKm)}m`, centerX - r - 4, centerY - 2);
    }

    // ── Cross hairs (cardinal directions) ──
    ctx.strokeStyle = "#2d5a8c44";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    // Vertical
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.stroke();
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Sector markers (lanes) ──
    ctx.strokeStyle = "#2d5a8c33";
    ctx.lineWidth = 1;
    for (let angle = -60; angle <= 60; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const x = centerX + maxRadius * Math.cos(rad + Math.PI / 2);
      const y = centerY + maxRadius * Math.sin(rad + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // ── Draw detected objects on radar ──
    for (const trace of s.radarTraces) {
      const r = (trace.dist / DETECTION_DIST) * maxRadius;
      const rad = (trace.angle * Math.PI) / 180;
      const x = centerX + r * Math.cos(rad);
      const y = centerY + r * Math.sin(rad);

      // Draw point
      const blinkPhase = (s.elapsed - trace.timestamp) % 0.6;
      const alpha = blinkPhase < 0.3 ? 255 : Math.floor(255 * (1 - (blinkPhase - 0.3) / 0.3));

      // Threat color
      const threatCol = trace.severity === "HIGH" ? "#ff4757" : trace.severity === "MED" ? "#ffa502" : "#2ed573";

      // Draw radar blip
      ctx.fillStyle = threatCol + Math.floor(alpha).toString(16).padStart(2, "0");
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Glow effect
      ctx.strokeStyle = threatCol + "44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Radar sweep beam (rotation animation) ──
    const sweepRad = (s.radarSweepAngle * Math.PI) / 180;
    const sweep = ctx.createLinearGradient(
      centerX,
      centerY,
      centerX + maxRadius * Math.cos(sweepRad),
      centerY + maxRadius * Math.sin(sweepRad)
    );
    sweep.addColorStop(0, "#2ed57344");
    sweep.addColorStop(1, "transparent");

    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    const angle1 = sweepRad;
    const angle2 = sweepRad + Math.PI * 0.15;
    ctx.arc(centerX, centerY, maxRadius, angle1, angle2);
    ctx.closePath();
    ctx.fill();

    // ── Ego at center ──
    ctx.fillStyle = "#2ed573";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2ed573";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
    ctx.stroke();

    // ── HUD Info ──
    ctx.fillStyle = "#58a6ff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("PATMOS SONAR", 10, 14);
    ctx.fillStyle = "#8b949e";
    ctx.font = "8px monospace";
    ctx.fillText(`Scans: ${s.totalScans} | Range: ${DETECTION_DIST}m`, 10, 26);

    // Draw legend
    ctx.font = "8px monospace";
    ctx.fillStyle = "#2ed573";
    ctx.fillText("● Patmos", W - 80, 14);
    ctx.fillStyle = "#d2a8ff";
    ctx.fillText("● Patemu", W - 80, 26);
    ctx.fillStyle = "#ff4757";
    ctx.fillText("● CPU", W - 80, 38);
    
    // Restore context state
    ctx.restore();
    };

    // Initialize sparkline drawing
    drawSparkRef.current = drawSpark.current;
  }, []);

  // ── Derived values ──
  const hasBench = !!benchResult?.success;
  // Prefer PATEMU (hardware emulator) over PASIM (fast simulator)
  const patemuCyc = benchResult?.patemu?.stats?.cycles ?? 0;
  const pasimCyc = benchResult?.pasim?.stats?.cycles ?? 0;
  const gccMs = benchResult?.gcc?.wall_time_ms ?? 0;
  // Use PATEMU stats if available, otherwise PASIM
  const stats = benchResult?.patemu?.stats ?? benchResult?.pasim?.stats;

  // ── Sparkline Drawing ──────────────────────────────────────────

  const drawSpark = useRef<(s: typeof simRef.current) => void>((s) => {
    const canvas = sparkRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    
    // Background
    ctx.fillStyle = "#010409"; ctx.fillRect(0, 0, W, H);
    
    // Grid lines
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    
    // Draw detections as bars
    if (s.radarTraces.length > 0) {
      const maxTime = s.elapsed;
      const minTime = Math.max(0, maxTime - 8); // Show last 8 seconds
      const timeRange = maxTime - minTime || 1;
      const maxCycles = Math.max(1200, Math.max(...s.radarTraces.map(t => Math.max(t.patmuCycles, t.cpuCycles))));
      
      const barWidth = Math.max(2, W / Math.max(s.radarTraces.length + 1, 10));
      
      for (let i = 0; i < s.radarTraces.length; i++) {
        const trace = s.radarTraces[i];
        // Normalize position: newer traces on right
        const age = maxTime - trace.timestamp;
        if (age > (minTime + timeRange)) continue; // Older than window
        
        const x = W - ((age / timeRange) * W) - barWidth / 2;
        
        // Patmos bar (green)
        const patmosH = (trace.patmuCycles / maxCycles) * H * 0.45;
        ctx.fillStyle = trace.patmuDeadlineMet ? "#2ed573" : "#ff4757";
        ctx.fillRect(x - barWidth * 0.35, H - patmosH, barWidth * 0.3, patmosH);
        
        // CPU bar (red/orange, stacked)
        const cpuH = (trace.cpuCycles / maxCycles) * H * 0.45;
        ctx.fillStyle = trace.cpuDeadlineMet ? "#ff9f43" : "#ff4757";
        ctx.fillRect(x + barWidth * 0.05, H * 0.5 - cpuH, barWidth * 0.3, cpuH);
      }
      
      // Deadline line
      const deadlineH = (AVOIDANCE_TASK.deadline_cycles / maxCycles) * H * 0.45;
      ctx.strokeStyle = "#58a6ff44";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(0, H - deadlineH); ctx.lineTo(W, H - deadlineH); ctx.stroke();
      ctx.setLineDash([]);
      
      // Labels
      ctx.fillStyle = "#484f58";
      ctx.font = "9px monospace";
      ctx.fillText(`PATMOS (${AVOIDANCE_TASK.deadline_cycles}cyc deadline)`, 3, 12);
      ctx.fillStyle = "#8b949e";
      ctx.font = "8px monospace";
      ctx.fillText("CPU", 3, H - 6);
    }
  });

  // ── Derived State ──────────────────────────────────────────────

  const sparkRef = useRef<HTMLCanvasElement>(null);

  // ── Events &  Filtered State ───────────────────────────────────

  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    setEvents(radarTraces.slice(0, 20).map((t) => ({
      id: t.id, type: t.type, dist: t.dist,
      patmosCycles: t.patmosCycles, cpuCycles: t.cpuCycles,
      patmosDeadlineMet: t.patmosDeadlineMet, cpuDeadlineMet: t.cpuDeadlineMet,
      cpuBreakdown: { base: 80, cache: t.cpuCycles * 0.3, branch: t.cpuCycles * 0.2, os: t.cpuCycles * 0.1 }
    })));
  }, [radarTraces]);

  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [totalDetected, setTotalDetected] = useState(0);

  useEffect(() => {
    setObjects([...simRef.current.objects]);
    setTotalDetected(simRef.current.objects.filter(o => o.detected).length);
  }, [radarTraces]); // Update when detections change

  // ── WebSocket ──────────────────────────────────────────────────

  const [wsUrl, setWsUrl] = useState("ws://localhost:3002");
  const [wsConnected, setWsConnected] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWs = useCallback(async () => {
    try {
      wsRef.current = new WebSocket(wsUrl);
      wsRef.current.onopen = () => setWsConnected(true);
      wsRef.current.onclose = () => setWsConnected(false);
    } catch (e) {
      console.error("WebSocket error:", e);
    }
  }, [wsUrl]);

  const disconnectWs = useCallback(() => {
    wsRef.current?.close();
    setWsConnected(false);
  }, []);

  // ── Sorted objects for render ───
  const sorted = useMemo(() => [...objects].sort((a, b) => a.dist - b.dist), [objects]);

  // ══════════════════════════════════════════════════════════════
  // ── Render ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-[#010409] text-[#e6edf3] font-mono select-none overflow-hidden">
      {/* ═══ Top Bar ═══ */}
      <div className="flex items-center h-7 px-4 bg-[#0d1117] border-b border-[#30363d] shrink-0 gap-4">
        <span className="text-[10px] font-bold tracking-[0.15em] text-[#58a6ff]">
          PATMOS RT &middot; AUTONOMOUS MONITOR
        </span>
        <div className="flex-1" />
        <Pill label={hasBench ? "PASIM LIVE" : "MODEL ONLY"} on={hasBench} color={hasBench ? "#2ed573" : "#ffa502"} />
        <Pill label={`${totalDetected} DETECTED`} on={totalDetected > 0} color="#58a6ff" />
      </div>

      {/* ═══ 3 Columns ═══ */}
      <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>

        {/* ─── Left Panel ─── */}
        <div className="w-[230px] shrink-0 flex flex-col border-r border-[#21262d] overflow-y-auto">

          {/* Benchmark */}
          <PS title="REAL PASIM BENCHMARK">
            <button onClick={runBenchmark} disabled={benchmarking}
              className={`w-full py-1.5 text-[9px] font-bold uppercase tracking-wider rounded transition-colors ${
                benchmarking ? "bg-[#21262d] text-[#8b949e] cursor-wait"
                : hasBench ? "bg-[#238636]/20 border border-[#238636] text-[#3fb950] hover:bg-[#238636]/30"
                : "bg-[#238636] text-white hover:bg-[#2ea043]"
              }`}>
              {benchmarking ? "\u23F3 Running on backend\u2026" : hasBench ? "\u21BB Re-run Benchmark" : "\u26A1 Run Benchmark"}
            </button>
            {benchError && (
              <div className="text-[9px] text-[#f85149] bg-[#da3633]/10 border border-[#da3633]/30 rounded p-1.5 mt-1">
                {benchError}
              </div>
            )}
            {hasBench && stats && (
              <div className="mt-1.5 space-y-1">
                <div className="bg-[#1a3a5c]/20 border border-[#d2a8ff]/30 rounded p-1.5">
                  <div className="text-[8px] text-[#8b949e] mb-1">PATEMU (Hardware Emulator)</div>
                  <div className="text-2xl font-bold text-[#d2a8ff] tabular-nums leading-tight">{fmt(patemuCyc)} cyc</div>
                  <div className="text-[8px] text-[#484f58]">cycle-accurate emulation result</div>
                </div>
                {pasimCyc > 0 && (
                  <div className="bg-[#1a3a5c]/20 border border-[#58a6ff]/30 rounded p-1.5">
                    <div className="text-[8px] text-[#8b949e] mb-1">PASIM (Fast Simulator)</div>
                    <div className="text-xl font-bold text-[#58a6ff] tabular-nums leading-tight">{fmt(pasimCyc)} cyc</div>
                    <div className="text-[8px] text-[#484f58]">fast simulation result</div>
                  </div>
                )}
                <div className="border-t border-[#21262d] pt-1.5 space-y-1">
                  <StatRow label="Instructions" value={fmt(stats.instructions)} />
                  <StatRow label="Data Cache" value={`${stats.cache_hits}↑ / ${stats.cache_misses}↓`} />
                  <StatRow label="Instr Cache" value={fmt(stats.method_cache_hits)} />
                </div>
                {gccMs > 0 && (
                  <div className="border-t border-[#21262d] pt-1.5">
                    <StatRow label="GCC Wall Time" value={`${gccMs < 1 ? "<1" : gccMs.toFixed(1)}ms`} color="#d29922" />
                  </div>
                )}
              </div>
            )}
            {!hasBench && !benchmarking && !benchError && (
              <div className="text-[8px] text-[#484f58] mt-1">
                Uses timing model until benchmark runs. Start backend with: docker compose up
              </div>
            )}
          </PS>

          {/* Timing Guarantee */}
          <PS title="TIME-PREDICTABLE">
            <div className="text-[9px] text-[#8b949e] leading-relaxed space-y-1.5">
              <div className="bg-[#0d1117] border border-[#21262d] rounded p-1.5">
                <div className="text-[8px] text-[#484f58] uppercase tracking-wider mb-1">Patmos Guarantee</div>
                {hasBench ? (
                  <>
                    <div><span className="text-[#2ed573]">✓ Every run</span>: <span className="font-bold text-[#d2a8ff]">{fmt(patemuCyc)}</span> <span className="text-[8px]">cycles (from PATEMU)</span></div>
                    <div><span className="text-[8px] text-[#484f58]">Zero jitter, guaranteed by architecture</span></div>
                  </>
                ) : (
                  <>
                    <div><span className="text-[#2ed573]">✓ Every run</span>: {AVOIDANCE_TASK.N_instr} <span className="text-[8px]">instructions</span></div>
                    <div><span className="text-[8px] text-[#8b949e]">(real cycles pending benchmark)</span></div>
                  </>
                )}
              </div>
              <div className="text-[8px] text-[#484f58] space-y-1">
                <div>✗ <span className="text-[#d29922]">CPU varies</span>: {NORMAL_CPU.osJitterRange[0]}–{NORMAL_CPU.osJitterRange[1]}+ cycles per run</div>
                <div className="text-[7px] text-[#484f58]">Due to: cache misses, branch prediction, OS scheduler, thermal throttling</div>
              </div>
            </div>
          </PS>

          {/* Controls */}
          <PS title="CONTROLS">
            <div className="flex items-center gap-2">
              <button onClick={() => setRunning((v) => !v)}
                className={`px-2 py-0.5 text-[9px] rounded border ${running ? "border-[#ff4757] text-[#ff4757]" : "border-[#2ed573] text-[#2ed573]"}`}>
                {running ? "PAUSE" : "RUN"}
              </button>
              <span className="text-[8px] text-[#484f58] tabular-nums w-8">{egoSpeed}</span>
              <input type="range" min={10} max={120} value={egoSpeed}
                onChange={(e) => setEgoSpeed(+e.target.value)} className="flex-1 h-0.5 accent-[#58a6ff]" />
            </div>
          </PS>

          {/* WS */}
          <div className="px-3 py-1.5 border-t border-[#21262d]">
            <button onClick={() => setWsOpen((v) => !v)} className="text-[8px] text-[#484f58] hover:text-[#8b949e] uppercase tracking-wider">
              {wsOpen ? "\u25BC" : "\u25B6"} WebSocket {wsConnected && <span className="text-[#2ed573]">(live)</span>}
            </button>
            {wsOpen && (
              <div className="mt-1 flex gap-1">
                <input className="flex-1 bg-[#0d1117] border border-[#21262d] text-[#e6edf3] text-[9px] px-1 py-0.5 rounded outline-none" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} disabled={wsConnected} />
                <button onClick={wsConnected ? disconnectWs : connectWs} className={`px-1.5 py-0.5 text-[8px] rounded ${wsConnected ? "bg-[#da3633] text-white" : "bg-[#238636] text-white"}`}>
                  {wsConnected ? "\u00D7" : "Go"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Center Canvas ─── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <canvas ref={radarRef} className="flex-1" style={{ display: "block", width: "100%", minHeight: 0 }} />
        </div>

        {/* ─── Right Panel: Detection Log ─── */}
        <div className="w-[280px] shrink-0 flex flex-col border-l border-[#21262d] overflow-hidden">
          <div className="px-2.5 py-2 border-b border-[#21262d]">
            <div className="text-[8px] text-[#58a6ff] font-bold uppercase tracking-[0.12em]">⏱ REACTION TIMES</div>
            <div className="text-[6px] text-[#484f58] mt-1">How fast each system reacts when obstacles are detected (PATMOS vs CPU). Green = meets 800 cycle deadline, Red = exceeds deadline.</div>
            <div className="text-[7px] text-[#8b949e] mt-1.5 font-bold">{events.length} detections</div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 px-2.5 py-2">
            {events.length === 0 && <div className="text-[8px] text-[#484f58] italic">Waiting for detections&hellip;</div>}
            {events.map((ev, i) => (
              <div key={`${ev.id}-${i}`} className="bg-[#0d1117] border border-[#21262d] rounded p-2 hover:border-[#30363d] transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <span className="text-[8px] font-bold text-[#c9d1d9]">{ev.type.toUpperCase()}</span>
                    <span className="text-[7px] text-[#8b949e] ml-1">#{ev.id}</span>
                  </div>
                  <span className="text-[7px] font-mono text-[#484f58]">{ev.dist}m</span>
                </div>
                
                {/* Patmos timing */}
                <div className="mb-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[7px] text-[#2ed573]">PATMOS</span>
                    <div className="flex-1 h-1.5 bg-[#21262d] rounded overflow-hidden">
                      <div className="h-full bg-[#2ed573] rounded" style={{ width: `${Math.min(100, (ev.patmosCycles / AVOIDANCE_TASK.deadline_cycles) * 100)}%` }} />
                    </div>
                    <span className="text-[7px] text-[#2ed573] font-mono w-10 text-right">{ev.patmosCycles}cyc</span>
                  </div>
                  <div className="text-[6px] text-[#484f58]">{((ev.patmosCycles / AVOIDANCE_TASK.deadline_cycles) * 100).toFixed(0)}% of deadline</div>
                </div>
                
                {/* CPU timing */}
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[7px] text-[#ff4757]">CPU</span>
                    <div className="flex-1 h-1.5 bg-[#21262d] rounded overflow-hidden flex">
                      <div className="h-full bg-[#8b949e]" style={{ width: `${(ev.cpuBreakdown.base / Math.max(ev.cpuCycles, 1)) * 100}%` }} title="Base execution" />
                      <div className="h-full bg-[#ff4757]" style={{ width: `${(ev.cpuBreakdown.cache / Math.max(ev.cpuCycles, 1)) * 100}%` }} title="Cache misses" />
                      <div className="h-full bg-[#ffa502]" style={{ width: `${(ev.cpuBreakdown.branch / Math.max(ev.cpuCycles, 1)) * 100}%` }} title="Branch prediction" />
                      <div className="h-full bg-[#d2a8ff]" style={{ width: `${(ev.cpuBreakdown.os / Math.max(ev.cpuCycles, 1)) * 100}%` }} title="OS overhead" />
                    </div>
                    <span className="text-[7px] text-[#ff4757] font-mono w-10 text-right">{ev.cpuCycles}cyc</span>
                  </div>
                  <div className="text-[6px] text-[#484f58]">{((ev.cpuCycles / AVOIDANCE_TASK.deadline_cycles) * 100).toFixed(0)}% of deadline {ev.cpuCycles > AVOIDANCE_TASK.deadline_cycles ? "⚠️ EXCEEDED" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Bottom Right: Cycle Timeline + Scene Objects ─── */}
        <div className="w-[280px] shrink-0 flex flex-col border-l border-[#21262d] overflow-hidden">
          {/* Scene Objects */}
          <div className="px-2.5 py-2 border-b border-[#21262d]">
            <div className="text-[8px] text-[#58a6ff] font-bold uppercase tracking-[0.12em] mb-1.5">SCENE OBJECTS</div>
            <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
              {sorted.length === 0 && <div className="text-[8px] text-[#484f58] italic">No objects</div>}
              {sorted.slice(0, 8).map((o) => (
                <div key={o.id} className="flex items-center gap-1.5 text-[8px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                  <span className="uppercase text-[#c9d1d9] w-16 truncate">{o.type}</span>
                  <span className="text-[#8b949e] flex-1 text-right">{Math.floor(o.dist)}m</span>
                  <span className="font-bold px-1 py-px rounded text-[7px]"
                    style={{ backgroundColor: THREAT_COLORS[o.threatLevel] + "18", color: THREAT_COLORS[o.threatLevel] }}>
                    {o.threatLevel}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Cycle Timeline */}
          <div className="flex-1 px-2.5 py-2 border-b border-[#21262d] min-h-0 flex flex-col">
            <div className="text-[8px] text-[#58a6ff] font-bold uppercase tracking-[0.12em] mb-1">⌊─────────────────────────⌋</div>
            <div className="flex-1 bg-[#010409] border border-[#21262d] rounded overflow-hidden">
              <canvas ref={sparkRef} className="w-full h-full" style={{ display: "block" }} />
            </div>
            <div className="text-[6px] text-[#484f58] mt-1">⬛ PATMOS  ⬛ CPU  |  Timeline shows last 8 seconds</div>
          </div>
        </div>
      </div>

      {/* ═══ Bottom Stats ═══ */}
      <div className="flex items-end h-[48px] px-4 border-t border-[#21262d] bg-[#0d1117] shrink-0 gap-6 pb-1.5">
        <BStat v={totalDetected} l="DETECTIONS" s="" c="#58a6ff" />
        <BStat v={hasBench ? patemuCyc : AVOIDANCE_TASK.N_instr} l="PATEMU CYCLES" s="fixed" c="#d2a8ff" />
        <BStat v={events.length > 0 ? Math.round(events.reduce((a, e) => a + e.cpuCycles, 0) / events.length) : 0} l="CPU MEAN" s="cycles" c="#d29922" />
        <BStat v={events.length > 0 ? Math.max(...events.map(e => e.cpuCycles)) : 0} l="CPU WORST" s="cycles" c="#ff4757" />
        <div className="flex-1" />
        <div className="text-right pb-0.5">
          <div className="text-[8px] text-[#484f58] uppercase tracking-wider">DEADLINE</div>
          <div className="text-lg font-bold tabular-nums leading-tight" style={{ color: (hasBench ? patemuCyc : AVOIDANCE_TASK.N_instr) <= AVOIDANCE_TASK.deadline_cycles ? "#2ed573" : "#ff4757" }}>
            {fmt(AVOIDANCE_TASK.deadline_cycles)} <span className="text-[10px] text-[#484f58]">cyc</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ── Canvas Drawing Helpers ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function drawObject(ctx: CanvasRenderingContext2D, obj: SceneObject, sc: number, elapsed: number) {
  switch (obj.type) {
    case "car": case "suv": {
      const bw = (obj.type === "suv" ? 22 : 18) * sc, bh = (obj.type === "suv" ? 42 : 36) * sc, r = 3 * sc;
      ctx.fillStyle = "#00000040"; ctx.fillRect(-bw / 2 + 2, -bh / 2 + 2, bw, bh);
      ctx.fillStyle = obj.color; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, r); ctx.fill();
      ctx.fillStyle = "#00000060"; roundRect(ctx, -bw * 0.35, -bh * 0.2, bw * 0.7, bh * 0.28, r * 0.5); ctx.fill();
      ctx.fillStyle = "#00000040"; roundRect(ctx, -bw * 0.3, bh * 0.15, bw * 0.6, bh * 0.15, r * 0.5); ctx.fill();
      ctx.fillStyle = "#ff000088";
      ctx.fillRect(-bw / 2 + 1, bh / 2 - 3 * sc, 4 * sc, 2 * sc);
      ctx.fillRect(bw / 2 - 5 * sc, bh / 2 - 3 * sc, 4 * sc, 2 * sc);
      break;
    }
    case "truck": {
      const bw = 26 * sc, bh = 60 * sc, r = 2 * sc;
      ctx.fillStyle = "#00000040"; ctx.fillRect(-bw / 2 + 2, -bh / 2 + 2, bw, bh);
      ctx.fillStyle = obj.color; roundRect(ctx, -bw / 2, -bh / 2, bw, bh * 0.7, r); ctx.fill();
      ctx.fillStyle = lerpColor(obj.color, "#ffffff", 0.15);
      roundRect(ctx, -bw * 0.4, -bh / 2 + bh * 0.7, bw * 0.8, bh * 0.3, r); ctx.fill();
      ctx.fillStyle = "#ff4500aa"; ctx.fillRect(-bw / 2 + 1, -bh / 2 + 1, bw - 2, 3 * sc);
      break;
    }
    case "pedestrian": {
      const h = 28 * sc;
      ctx.fillStyle = "#f5c6aa";
      ctx.beginPath(); ctx.arc(0, -h * 0.35, 4.5 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = obj.color; ctx.lineWidth = Math.max(2, 3 * sc); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, -h * 0.15); ctx.lineTo(0, h * 0.2); ctx.stroke();
      const swing = Math.sin(elapsed * 6 + obj.wobble) * 4 * sc;
      ctx.beginPath(); ctx.moveTo(-5 * sc + swing, 0); ctx.lineTo(5 * sc - swing, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h * 0.2); ctx.lineTo(-3 * sc + swing, h * 0.45);
      ctx.moveTo(0, h * 0.2); ctx.lineTo(3 * sc - swing, h * 0.45); ctx.stroke();
      break;
    }
    case "cyclist": {
      const h = 30 * sc;
      ctx.strokeStyle = "#666"; ctx.lineWidth = Math.max(1, 1.5 * sc);
      ctx.beginPath(); ctx.arc(-2 * sc, h * 0.25, 5 * sc, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(2 * sc, -h * 0.15, 5 * sc, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = obj.color; ctx.lineWidth = Math.max(1.5, 2 * sc);
      ctx.beginPath(); ctx.moveTo(-2 * sc, h * 0.25); ctx.lineTo(0, 0); ctx.lineTo(2 * sc, -h * 0.15);
      ctx.moveTo(0, 0); ctx.lineTo(0, -h * 0.35); ctx.stroke();
      ctx.fillStyle = "#f5c6aa"; ctx.beginPath(); ctx.arc(0, -h * 0.42, 3.5 * sc, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "cone": {
      const h = 16 * sc, bw = 10 * sc;
      ctx.fillStyle = "#ff6b35";
      ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(-bw / 2, 0); ctx.lineTo(bw / 2, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffffff88"; ctx.fillRect(-bw * 0.3, -h * 0.5, bw * 0.6, h * 0.15);
      ctx.fillStyle = "#ff6b3588"; ctx.fillRect(-bw * 0.6, 0, bw * 1.2, 3 * sc);
      break;
    }
    case "barrier": {
      const bw = 44 * sc, bh = 10 * sc;
      ctx.fillStyle = "#e6e6e6"; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 2 * sc); ctx.fill();
      ctx.fillStyle = "#ff4757cc";
      const stripeW = bw / 7;
      for (let i = 0; i < 4; i++) ctx.fillRect(-bw / 2 + i * stripeW * 2 + stripeW * 0.3, -bh / 2 + 1, stripeW * 0.8, bh - 2);
      ctx.fillStyle = "#999";
      ctx.fillRect(-bw * 0.35, bh / 2, 3 * sc, 8 * sc);
      ctx.fillRect(bw * 0.35 - 3 * sc, bh / 2, 3 * sc, 8 * sc);
      break;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function lerpColor(hex: string, target: string, t: number): string {
  const h2r = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = h2r(hex.length >= 7 ? hex : "#888888");
  const [r2, g2, b2] = h2r(target);
  const c = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}

// ── Sub-components ───────────────────────────────────────────────

function Pill({ label, on, color, pulse }: { label: string; on: boolean; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-[9px]">
      <span className={`w-1.5 h-1.5 rounded-full ${pulse && on ? "animate-pulse" : ""}`}
        style={{ backgroundColor: on ? color : "#30363d" }} />
      <span style={{ color: on ? color : "#484f58" }}>{label}</span>
    </div>
  );
}

function PS({ title, children, grow }: { title: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className={`px-2.5 py-2 border-b border-[#21262d] ${grow ? "flex-1 min-h-0 flex flex-col" : ""}`}>
      <div className="text-[8px] text-[#58a6ff] font-bold uppercase tracking-[0.12em] mb-1.5">{title}</div>
      <div className={`space-y-1.5 ${grow ? "flex-1 min-h-0 overflow-y-auto" : ""}`}>{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-[#0d1117] border border-[#21262d] rounded p-2">{children}</div>;
}

function Bar({ value, max, color, label, pct }: { value: number; max: number; color: string; label: string; pct?: boolean }) {
  const p = clamp((value / max) * 100, 0, 100);
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-[8px] text-[#484f58] uppercase w-10">{label}</span>
      <div className="flex-1 h-1 bg-[#21262d] rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${p}%`, backgroundColor: color }} />
      </div>
      <span className="text-[8px] text-[#8b949e] tabular-nums w-8 text-right">{pct ? `${Math.floor(p)}%` : fmt(value)}</span>
    </div>
  );
}

function StatRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-[9px]">
      <span className="text-[#8b949e]">{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""}`} style={{ color: color ?? "#e6edf3" }}>{value}</span>
    </div>
  );
}

function BStat({ v, l, s, c }: { v: number; l: string; s: string; c: string }) {
  return (
    <div>
      <div className="text-[24px] font-bold tabular-nums leading-none" style={{ color: c }}>{v}</div>
      <div className="text-[8px] text-[#484f58] uppercase tracking-wider leading-tight mt-px">{l}</div>
      {s && <div className="text-[8px] text-[#484f58] uppercase tracking-wider leading-tight">{s}</div>}
    </div>
  );
}
