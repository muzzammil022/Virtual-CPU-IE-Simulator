import {
  CarState,
  Obstacle,
  SimulationConfig,
  SimulationState,
  PatmosResponse,
  DEFAULT_CONFIG,
} from "./types";

/** Generate obstacles spread along the road based on config */
function generateObstacles(config: SimulationConfig): Obstacle[] {
  const count = Math.max(1, Math.min(5, config.numObstacles));
  const obstacles: Obstacle[] = [];
  const startY = 500;
  const spacing = config.difficulty === "hard" ? 350 : 500;

  for (let i = 0; i < count; i++) {
    // Alternate lanes, with some variation for hard mode
    const lane = config.difficulty === "hard"
      ? (i % 2 === 0 ? 0 : 1) // alternating makes you zigzag
      : (i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 0); // mostly lane 0
    obstacles.push({
      x: getLaneCenter(lane, config),
      y: startY + i * spacing,
      lane,
      width: 60,
      height: 40,
    });
  }
  return obstacles;
}

/** Create initial simulation state */
export function createInitialState(config: SimulationConfig = DEFAULT_CONFIG): SimulationState {
  const carLane = 0;
  // Adjust road length based on obstacle count
  const adjustedConfig = {
    ...config,
    roadLength: Math.max(config.roadLength, 500 + config.numObstacles * 600),
  };

  return {
    car: {
      x: getLaneCenter(carLane, adjustedConfig),
      y: 0,
      speed: adjustedConfig.initialSpeed,
      lane: carLane,
      steering: 0,
      braking: false,
    },
    obstacles: generateObstacles(adjustedConfig),
    status: "idle",
    patmosResult: null,
    patmosHistory: [],
    elapsedTime: 0,
    triggerDistance: null,
    timingComparison: null,
  };
}

/** Get the pixel center of a lane */
export function getLaneCenter(lane: number, config: SimulationConfig): number {
  const roadLeft = 0;
  return roadLeft + config.laneWidth * lane + config.laneWidth / 2;
}

/** Calculate distance from car to nearest obstacle in same lane */
export function getDistanceToObstacle(car: CarState, obstacles: Obstacle[]): number {
  let minDist = Infinity;
  for (const obs of obstacles) {
    const dist = obs.y - car.y;
    if (dist > 0 && dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/** Check if obstacle is in the same lane as car */
export function isObstacleInLane(car: CarState, obstacle: Obstacle, config: SimulationConfig): boolean {
  const carLaneCenter = getLaneCenter(car.lane, config);
  const obstacleLaneCenter = getLaneCenter(obstacle.lane, config);
  return Math.abs(carLaneCenter - obstacleLaneCenter) < config.laneWidth * 0.5;
}

/** Step the simulation forward by dt seconds */
export function stepSimulation(
  state: SimulationState,
  dt: number,
  config: SimulationConfig = DEFAULT_CONFIG
): SimulationState {
  const next = structuredClone(state);
  next.elapsedTime += dt;

  // Move car forward
  next.car.y += next.car.speed * dt;

  // Apply braking
  if (next.car.braking) {
    next.car.speed = Math.max(0, next.car.speed - config.brakeDeceleration * dt);
  }

  // Animate lane change
  const targetX = getLaneCenter(next.car.lane, config);
  const dx = targetX - next.car.x;
  if (Math.abs(dx) > 1) {
    next.car.x += Math.sign(dx) * config.laneChangeSpeed * config.laneWidth * dt;
    next.car.steering = Math.sign(dx) as -1 | 0 | 1;
  } else {
    next.car.x = targetX;
    next.car.steering = 0;
  }

  // Check collision
  for (const obs of next.obstacles) {
    const dist = obs.y - next.car.y;
    const sameLane = Math.abs(next.car.x - obs.x) < config.laneWidth * 0.4;
    if (dist > -20 && dist < 30 && sameLane) {
      next.status = "collision";
    }
  }

  // Check completion (car passed all obstacles)
  const allPassed = next.obstacles.every((obs) => next.car.y > obs.y + 100);
  if (allPassed && next.status !== "collision") {
    next.status = "completed";
  }

  // After passing an obstacle during avoidance, resume running for next obstacle
  if (next.status === "avoiding") {
    // Find the obstacle we're currently avoiding (closest one behind or just passed)
    let currentlyAvoiding = false;
    for (const obs of next.obstacles) {
      const dist = obs.y - next.car.y;
      // If there's an obstacle within close range ahead, we're still avoiding
      if (dist > -30 && dist < 80) {
        currentlyAvoiding = true;
        break;
      }
    }
    if (!currentlyAvoiding && !allPassed) {
      next.status = "running";
      next.car.braking = false;
    }
  }

  return next;
}

/** Apply a Patmos decision to the simulation state */
export function applyPatmosDecision(
  state: SimulationState,
  result: PatmosResponse,
  config: SimulationConfig = DEFAULT_CONFIG
): SimulationState {
  const next = structuredClone(state);
  next.patmosResult = result;
  next.patmosHistory.push(result);
  next.status = "avoiding";

  if (result.action === "steer") {
    next.car.lane = result.target_lane;
  } else if (result.action === "brake") {
    next.car.braking = true;
  }

  return next;
}

/** Check if obstacle detection threshold is crossed — returns true if an obstacle is in detection range */
export function shouldTriggerPatmos(
  state: SimulationState,
  config: SimulationConfig = DEFAULT_CONFIG
): boolean {
  if (state.status !== "running") return false;

  for (const obs of state.obstacles) {
    const dist = obs.y - state.car.y;
    if (dist > 0 && dist < config.detectionThreshold) {
      const sameLane = isObstacleInLane(state.car, obs, config);
      if (sameLane) return true;
    }
  }
  return false;
}

/** Find the next obstacle that needs to be avoided */
export function getNextObstacle(
  state: SimulationState,
  config: SimulationConfig = DEFAULT_CONFIG
): { distance: number; obstacle: Obstacle } | null {
  let nearest: { distance: number; obstacle: Obstacle } | null = null;
  for (const obs of state.obstacles) {
    const dist = obs.y - state.car.y;
    if (dist > 0 && isObstacleInLane(state.car, obs, config)) {
      if (!nearest || dist < nearest.distance) {
        nearest = { distance: dist, obstacle: obs };
      }
    }
  }
  return nearest;
}
