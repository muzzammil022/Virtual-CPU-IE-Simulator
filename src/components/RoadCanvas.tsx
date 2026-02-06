import React, { useRef, useEffect, useCallback } from "react";
import { SimulationState, SimulationConfig, DEFAULT_CONFIG } from "@/lib/types";
import { getLaneCenter } from "@/lib/simulation";

interface RoadCanvasProps {
  state: SimulationState;
  config?: SimulationConfig;
  width?: number;
  height?: number;
  carColor?: string;
}

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 600;

export default function RoadCanvas({
  state,
  config = DEFAULT_CONFIG,
  width = CANVAS_WIDTH,
  height = CANVAS_HEIGHT,
  carColor = "#219ebc",
}: RoadCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { car, obstacles, status } = state;

      // Camera follows the car — car stays near bottom
      const cameraY = car.y - height * 0.75;

      // === Clear ===
      ctx.clearRect(0, 0, width, height);

      // === Road background ===
      const roadWidth = config.laneWidth * config.numLanes;
      const roadX = (width - roadWidth) / 2;

      // Grass
      ctx.fillStyle = "#2d5a27";
      ctx.fillRect(0, 0, width, height);

      // Road surface
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(roadX, 0, roadWidth, height);

      // Road edges
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(roadX, 0);
      ctx.lineTo(roadX, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(roadX + roadWidth, 0);
      ctx.lineTo(roadX + roadWidth, height);
      ctx.stroke();

      // === Lane markings (dashed center line) ===
      ctx.strokeStyle = "#f0c040";
      ctx.lineWidth = 2;
      ctx.setLineDash([30, 20]);
      for (let i = 1; i < config.numLanes; i++) {
        const lx = roadX + i * config.laneWidth;
        // Animate dashes with camera
        const dashOffset = -(cameraY % 50);
        ctx.lineDashOffset = dashOffset;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // === Helper: world Y → screen Y ===
      const toScreenY = (worldY: number) => height - (worldY - cameraY);
      const toScreenX = (worldX: number) => roadX + worldX;

      // === Detection zone indicator ===
      if (status === "running" || status === "patmos-triggered") {
        const zoneTop = toScreenY(car.y + config.detectionThreshold);
        const zoneBottom = toScreenY(car.y);
        ctx.fillStyle = "rgba(255, 200, 0, 0.08)";
        ctx.fillRect(roadX, zoneTop, roadWidth, zoneBottom - zoneTop);

        ctx.strokeStyle = "rgba(255, 200, 0, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(roadX, zoneTop);
        ctx.lineTo(roadX + roadWidth, zoneTop);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // === Obstacles ===
      for (const obs of obstacles) {
        const ox = toScreenX(obs.x) - obs.width / 2;
        const oy = toScreenY(obs.y) - obs.height / 2;

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(ox + 3, oy + 3, obs.width, obs.height);

        // Obstacle body
        ctx.fillStyle = "#e63946";
        ctx.fillRect(ox, oy, obs.width, obs.height);

        // Hazard stripes
        ctx.fillStyle = "#ffb703";
        for (let s = 0; s < obs.width; s += 12) {
          ctx.fillRect(ox + s, oy, 6, obs.height);
        }

        // Label
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText("OBSTACLE", toScreenX(obs.x), oy - 6);
      }

      // === Car ===
      const carWidth = 40;
      const carHeight = 60;
      const cx = toScreenX(car.x) - carWidth / 2;
      const cy = toScreenY(car.y) - carHeight / 2;

      // Car shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.roundRect(cx + 3, cy + 3, carWidth, carHeight, 6);
      ctx.fill();

      // Car body
      ctx.fillStyle = status === "collision" ? "#ff0000" : carColor;
      ctx.beginPath();
      ctx.roundRect(cx, cy, carWidth, carHeight, 6);
      ctx.fill();

      // Car windshield
      ctx.fillStyle = "rgba(200, 230, 255, 0.6)";
      ctx.beginPath();
      ctx.roundRect(cx + 6, cy + 8, carWidth - 12, 16, 3);
      ctx.fill();

      // Car rear lights
      if (car.braking) {
        ctx.fillStyle = "#ff2222";
        ctx.fillRect(cx + 2, cy + carHeight - 8, 8, 5);
        ctx.fillRect(cx + carWidth - 10, cy + carHeight - 8, 8, 5);
      }

      // Steering indicator
      if (car.steering !== 0) {
        ctx.fillStyle = "#ffb703";
        const indicatorX = car.steering > 0 ? cx + carWidth - 6 : cx;
        ctx.fillRect(indicatorX, cy + 2, 6, 6);
      }

      // === Status overlay ===
      if (status === "collision") {
        ctx.fillStyle = "rgba(255, 0, 0, 0.15)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#ff0000";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("COLLISION", width / 2, height / 2);
      } else if (status === "completed") {
        ctx.fillStyle = "rgba(0, 180, 0, 0.12)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#00b400";
        ctx.font = "bold 24px monospace";
        ctx.textAlign = "center";
        ctx.fillText("AVOIDED!", width / 2, height / 2);
      }

      // === HUD: Speed ===
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(width - 100, height - 36, 92, 28);
      ctx.fillStyle = "#0f0";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(car.speed)} px/s`, width - 14, height - 16);
    },
    [state, config, width, height, carColor]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-xl border border-zinc-700 shadow-2xl"
    />
  );
}
