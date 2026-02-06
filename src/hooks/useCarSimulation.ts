import { useRef, useState, useCallback, useEffect } from "react";
import {
  SimulationState,
  SimulationConfig,
  DEFAULT_CONFIG,
  PatmosResponse,
  TimingComparison,
} from "@/lib/types";
import {
  createInitialState,
  stepSimulation,
  shouldTriggerPatmos,
  applyPatmosDecision,
  getDistanceToObstacle,
} from "@/lib/simulation";

const FIXED_DT = 1 / 60; // 60fps fixed timestep

export function useCarSimulation(config: SimulationConfig = DEFAULT_CONFIG) {
  const [state, setState] = useState<SimulationState>(() =>
    createInitialState(config)
  );
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const patmosTriggeredRef = useRef(false);

  const callPatmosAPI = useCallback(
    async (simState: SimulationState) => {
      const distance = getDistanceToObstacle(simState.car, simState.obstacles);
      try {
        const res = await fetch("/api/avoid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distance,
            speed: simState.car.speed,
            lane: simState.car.lane,
            deadline_cycles: 800,
          }),
        });
        const result: PatmosResponse & { timingComparison?: TimingComparison } = await res.json();
        const { timingComparison, ...patmosResult } = result;
        setState((prev) => {
          if (prev.status === "collision" || prev.status === "completed") return prev;
          const next = applyPatmosDecision(prev, patmosResult, config);
          return {
            ...next,
            timingComparison: timingComparison ?? null,
          };
        });
      } catch (err) {
        console.error("Patmos API error:", err);
      }
    },
    [config]
  );

  const loop = useCallback(
    (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const elapsed = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // Accumulate time across frames (fixes sub-frame drift)
      accumulatorRef.current += Math.min(elapsed, 0.1);

      setState((prev) => {
        let current = prev;

        while (accumulatorRef.current >= FIXED_DT) {
          if (current.status === "collision" || current.status === "completed") {
            accumulatorRef.current = 0;
            return current;
          }

          current = stepSimulation(current, FIXED_DT, config);
          accumulatorRef.current -= FIXED_DT;

          // Check Patmos trigger
          if (shouldTriggerPatmos(current, config) && !patmosTriggeredRef.current) {
            patmosTriggeredRef.current = true;
            current = {
              ...current,
              status: "patmos-triggered",
              triggerDistance: getDistanceToObstacle(current.car, current.obstacles),
            };
            // Fire async call (outside of setState)
            setTimeout(() => callPatmosAPI(current), 0);
          }
        }

        return current;
      });

      rafRef.current = requestAnimationFrame(loop);
    },
    [config, callPatmosAPI]
  );

  const start = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "running",
    }));
    lastTimeRef.current = 0;
    accumulatorRef.current = 0;
    patmosTriggeredRef.current = false;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    lastTimeRef.current = 0;
    accumulatorRef.current = 0;
    patmosTriggeredRef.current = false;
    setState(createInitialState(config));
  }, [config]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return { state, start, reset, pause };
}
