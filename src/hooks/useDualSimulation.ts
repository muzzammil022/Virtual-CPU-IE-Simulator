import { useRef, useState, useCallback, useEffect } from "react";
import {
  SimulationState,
  SimulationConfig,
  DEFAULT_CONFIG,
  PatmosResponse,
} from "@/lib/types";
import {
  createInitialState,
  stepSimulation,
  shouldTriggerPatmos,
  applyPatmosDecision,
  getNextObstacle,
} from "@/lib/simulation";

const FIXED_DT = 1 / 60;

/** Per-obstacle timing record */
export interface ObstacleTimingEvent {
  obstacleIndex: number;
  detectedAt: number;
  decidedAt: number;
  avoidedAt: number | null;
  reactionMs: number;
  action: string;
  cycles: number;
}

export interface DualSimState {
  patmos: SimulationState;
  normal: SimulationState;
  patmosEvents: ObstacleTimingEvent[];
  normalEvents: ObstacleTimingEvent[];
}

// ── decision helpers (pure functions, no hooks) ──────────────────────

function buildDecision(
  simState: SimulationState,
  obsIdx: number,
  config: SimulationConfig,
  mode: "patmos" | "normal"
): { result: PatmosResponse; delayMs: number } {
  const obstacle = simState.obstacles[obsIdx];
  const dist = obstacle.y - simState.car.y;
  const car = simState.car;

  const sameLane = Math.abs(car.x - obstacle.x) < config.laneWidth * 0.4;
  let action: "steer" | "brake" | "none" = "none";
  let targetLane = car.lane;
  let baseCycles = 124;
  let execPath = "branch_C: no obstacle in lane";

  if (sameLane && dist > 0 && dist < config.detectionThreshold) {
    if (car.lane === 0) {
      action = "steer";
      targetLane = 1;
      baseCycles = 542;
      execPath = "branch_A: steer right";
    } else {
      action = "steer";
      targetLane = 0;
      baseCycles = 542;
      execPath = "branch_A: steer left";
    }
  }

  let cycles = baseCycles;
  let delayMs = 5; // Patmos: deterministic 5 ms

  if (mode === "normal") {
    const jitter = Math.floor(baseCycles * 0.15 + Math.random() * baseCycles * 0.35);
    cycles = baseCycles + jitter;
    delayMs = 80 + Math.floor(Math.random() * 170); // 80-250 ms
    execPath += " (+ cache/pipeline jitter)";
  }

  return {
    result: {
      action,
      target_lane: targetLane,
      brake_force: 0,
      cycles_used: cycles,
      deadline_cycles: 800,
      deadline_met: cycles <= 800,
      execution_path: execPath,
      timestamp: Date.now(),
    },
    delayMs,
  };
}

// ── hook ─────────────────────────────────────────────────────────────

export function useDualSimulation(config: SimulationConfig = DEFAULT_CONFIG) {
  // Mutable sim state lives in a ref so the RAF loop never goes stale
  const simRef = useRef<DualSimState>({
    patmos: createInitialState(config),
    normal: createInitialState(config),
    patmosEvents: [],
    normalEvents: [],
  });

  // React state purely for triggering re-renders
  const [renderState, setRenderState] = useState<DualSimState>(simRef.current);

  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const accRef = useRef(0);
  const runningRef = useRef(false);

  const patmosTriggeredRef = useRef(new Set<number>());
  const normalTriggeredRef = useRef(new Set<number>());
  const patmosPendingRef = useRef(new Map<number, number>());
  const normalPendingRef = useRef(new Map<number, number>());
  const configRef = useRef(config);
  configRef.current = config;

  // ── decision dispatchers ───────────────────────────────────────────

  const dispatchDecision = useCallback(
    (mode: "patmos" | "normal", obsIdx: number) => {
      const cfg = configRef.current;
      const sim = mode === "patmos" ? simRef.current.patmos : simRef.current.normal;
      const { result, delayMs } = buildDecision(sim, obsIdx, cfg, mode);

      setTimeout(() => {
        const s = simRef.current;
        const prev = mode === "patmos" ? s.patmos : s.normal;
        if (prev.status === "collision" || prev.status === "completed") return;

        const next = applyPatmosDecision(prev, result, cfg);
        const pendingMap = mode === "patmos" ? patmosPendingRef.current : normalPendingRef.current;
        const detectedAt = pendingMap.get(obsIdx) ?? prev.elapsedTime;

        const event: ObstacleTimingEvent = {
          obstacleIndex: obsIdx,
          detectedAt,
          decidedAt: next.elapsedTime,
          avoidedAt: null,
          reactionMs: delayMs,
          action: result.action,
          cycles: result.cycles_used,
        };

        if (mode === "patmos") {
          simRef.current = {
            ...simRef.current,
            patmos: next,
            patmosEvents: [
              ...simRef.current.patmosEvents.filter((e) => e.obstacleIndex !== obsIdx),
              event,
            ],
          };
        } else {
          simRef.current = {
            ...simRef.current,
            normal: next,
            normalEvents: [
              ...simRef.current.normalEvents.filter((e) => e.obstacleIndex !== obsIdx),
              event,
            ],
          };
        }
      }, delayMs);
    },
    []
  );

  // ── RAF loop ───────────────────────────────────────────────────────

  const loop = useCallback((time: number) => {
    if (!runningRef.current) return;

    if (lastTimeRef.current === 0) lastTimeRef.current = time;
    const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = time;
    accRef.current += dt;

    const cfg = configRef.current;
    const s = simRef.current;
    let patmos = s.patmos;
    let normal = s.normal;
    let patmosEvents = s.patmosEvents;
    let normalEvents = s.normalEvents;

    while (accRef.current >= FIXED_DT) {
      const pDone = patmos.status === "collision" || patmos.status === "completed";
      const nDone = normal.status === "collision" || normal.status === "completed";

      if (pDone && nDone) {
        accRef.current = 0;
        break;
      }

      // ── step Patmos sim ──
      if (!pDone) {
        patmos = stepSimulation(patmos, FIXED_DT, cfg);

        if (shouldTriggerPatmos(patmos, cfg)) {
          const nxt = getNextObstacle(patmos, cfg);
          if (nxt) {
            const idx = patmos.obstacles.indexOf(nxt.obstacle);
            if (idx >= 0 && !patmosTriggeredRef.current.has(idx)) {
              patmosTriggeredRef.current.add(idx);
              patmosPendingRef.current.set(idx, patmos.elapsedTime);
              patmos = { ...patmos, status: "patmos-triggered", triggerDistance: nxt.distance };
              // save immediately so dispatcher reads fresh state
              simRef.current = { ...simRef.current, patmos };
              dispatchDecision("patmos", idx);
            }
          }
        }

        patmosEvents = patmosEvents.map((ev) => {
          if (ev.avoidedAt === null) {
            const obs = patmos.obstacles[ev.obstacleIndex];
            if (obs && patmos.car.y > obs.y + 50) return { ...ev, avoidedAt: patmos.elapsedTime };
          }
          return ev;
        });
      }

      // ── step Normal sim ──
      if (!nDone) {
        normal = stepSimulation(normal, FIXED_DT, cfg);

        if (shouldTriggerPatmos(normal, cfg)) {
          const nxt = getNextObstacle(normal, cfg);
          if (nxt) {
            const idx = normal.obstacles.indexOf(nxt.obstacle);
            if (idx >= 0 && !normalTriggeredRef.current.has(idx)) {
              normalTriggeredRef.current.add(idx);
              normalPendingRef.current.set(idx, normal.elapsedTime);
              normal = { ...normal, status: "patmos-triggered", triggerDistance: nxt.distance };
              simRef.current = { ...simRef.current, normal };
              dispatchDecision("normal", idx);
            }
          }
        }

        normalEvents = normalEvents.map((ev) => {
          if (ev.avoidedAt === null) {
            const obs = normal.obstacles[ev.obstacleIndex];
            if (obs && normal.car.y > obs.y + 50) return { ...ev, avoidedAt: normal.elapsedTime };
          }
          return ev;
        });
      }

      accRef.current -= FIXED_DT;
    }

    simRef.current = { patmos, normal, patmosEvents, normalEvents };
    setRenderState(simRef.current); // trigger React re-render

    rafRef.current = requestAnimationFrame(loop);
  }, [dispatchDecision]);

  // ── controls ───────────────────────────────────────────────────────

  const start = useCallback(() => {
    const s = simRef.current;
    simRef.current = {
      ...s,
      patmos: { ...s.patmos, status: "running" },
      normal: { ...s.normal, status: "running" },
    };
    setRenderState(simRef.current);

    lastTimeRef.current = 0;
    accRef.current = 0;
    patmosTriggeredRef.current = new Set();
    normalTriggeredRef.current = new Set();
    patmosPendingRef.current = new Map();
    normalPendingRef.current = new Map();
    runningRef.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const pause = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    lastTimeRef.current = 0;
    accRef.current = 0;
    patmosTriggeredRef.current = new Set();
    normalTriggeredRef.current = new Set();
    patmosPendingRef.current = new Map();
    normalPendingRef.current = new Map();

    simRef.current = {
      patmos: createInitialState(configRef.current),
      normal: createInitialState(configRef.current),
      patmosEvents: [],
      normalEvents: [],
    };
    setRenderState(simRef.current);
  }, []);

  // Reset on config change
  useEffect(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    simRef.current = {
      patmos: createInitialState(config),
      normal: createInitialState(config),
      patmosEvents: [],
      normalEvents: [],
    };
    setRenderState(simRef.current);
  }, [config]);

  useEffect(() => () => { runningRef.current = false; cancelAnimationFrame(rafRef.current); }, []);

  // ── combined status for UI ─────────────────────────────────────────

  const p = renderState.patmos.status;
  const n = renderState.normal.status;
  let combinedStatus: "idle" | "running" | "completed" | "collision" = "running";
  if (p === "idle" && n === "idle") combinedStatus = "idle";
  else if (p === "collision" || n === "collision") combinedStatus = "collision";
  else if (p === "completed" && n === "completed") combinedStatus = "completed";

  return { dualState: renderState, combinedStatus, start, reset, pause };
}
