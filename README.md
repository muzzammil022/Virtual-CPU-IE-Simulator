# SDTime Patmos

> An educational platform demonstrating time-predictable computing through live cycle-accurate simulation and autonomous obstacle avoidance.

![Patmos](https://img.shields.io/badge/Processor-Patmos%2032--bit-00D4AA)
![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED)
![Next.js](https://img.shields.io/badge/Frontend-Next.js-000000)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)

---

## What is this?

Modern CPUs are fast on average but unpredictable at worst. Cache misses, branch mispredictions, and OS scheduling jitter mean you can never *prove* a program will finish within a deadline — fatal in safety-critical systems like autonomous vehicles, surgical robots, and fly-by-wire aircraft.

**Patmos** is a 32-bit processor from DTU (Technical University of Denmark) where every memory access has a known, fixed cost. Worst-Case Execution Time (WCET) equals Best-Case Execution Time (BCET). Always.

This platform lets you see that difference live — same task, two CPUs, two outcomes.

---

## The Flight Control Example

A fly-by-wire aircraft runs a control loop every **1 ms**. The loop reads sensor data, runs a PID calculation, and writes actuator commands. Miss the deadline once and the control surface doesn't respond — at 900 km/h that is an immediate stability loss.

| | Patmos | x86-64 |
|---|---|---|
| Sensor read | `lwm` → exactly 21 cycles | `MOV` → 4 to 300 cycles (unknown) |
| Stack variables | `lws` → exactly 1 cycle | L1-D cache → varies with pressure |
| Total WCET | **542 cycles, proven** | **1200+ cycles, unbounded** |
| Jitter | 0 cycles | Up to 20% variance |
| Deadline met | Always | 98.5% of the time |

The 1.5% failure rate on a conventional CPU is not a benchmark number — it is a crash.

Patmos eliminates this through three architectural decisions:

- **Method cache** — caches entire functions, not 64-byte lines. Local branches (`br`) inside a cached function are guaranteed hits. Mid-loop instruction cache misses are architecturally impossible.
- **Typed memory instructions** — every load/store declares its destination: `lwm` (global RAM, 21 cycles), `lws` (stack cache, 1 cycle), `lwl` (scratchpad, 1 cycle), `lwc` (data cache, bounded). The compiler decides before runtime, not the hardware during runtime.
- **Hardware stack cache** — local variables live in dedicated on-chip hardware managed by `sres`/`sfree` instructions. No competition with heap or global data.

---

## System Architecture

```
Browser (Next.js)
    │
    │  C code submission
    ▼
FastAPI Backend (Uvicorn)
    │
    │  compile + execute
    ▼
Docker Container
├── patmos-clang   (LLVM cross-compiler → Patmos ELF)
├── pasim          (software simulator)
└── patemu         (cycle-accurate hardware emulator)
    │
    │  cycle counts, cache stats
    ▼
Timing Model (lib/timing-model.ts)
├── Patmos path    → deterministic O(1): T = N × CPI (fixed 1.0, 80 MHz)
└── Normal CPU     → Monte Carlo: T = (N × CPI_base) + C_cache + C_branch + C_os
    │
    ▼
Dual Simulation (useDualSimulation.ts)
└── Two physics engines at 60fps with different reaction times
```

---

## Modules

| Module | Name | Description |
|---|---|---|
| 01 | Browser IDE | Monaco Editor for writing Patmos-C. No local toolchain needed. |
| 02 | Compilation & Emulation | patmos-clang compiles C → Patmos ELF. pasim/patemu return real cycle counts. |
| 03 | Timing Predictability Engine | Patmos: deterministic formula. Standard CPU: stochastic Monte Carlo model. |
| 04 | Dual Obstacle Avoidance | Two cars, two CPUs, 60fps. Patmos always reacts in time. Standard CPU collides on bad samples. |
| 05 | Road Canvas + Radar | Top-down RoadCanvas and forward-looking RadarDashboard. Live collision vs avoidance events. |
| 06 | Analytics Dashboard | Live WCET/BCET/jitter graphs, deadline compliance indicators, cycle breakdown per instruction type. |

---

## Key Results

| Metric | Patmos | Standard CPU |
|---|---|---|
| WCET | 542 cycles | 1200+ cycles |
| BCET | 542 cycles | ~434 cycles |
| Jitter | 0 cycles | Up to 20% variance |
| Hard deadline (800 cycles) | Always met | Sometimes missed |
| Safety margin | +258 cycles (stable) | Variable, can go negative |
| Avoidance success rate | 100% | ~98.5% |
| OS scheduling noise | 0 cycles | 5–50 cycles |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-repo/sdtime-patmos
cd sdtime-patmos

# Start all services
docker compose up --build

# Frontend  →  http://localhost:3000
# Backend   →  http://localhost:8000
# API docs  →  http://localhost:8000/docs
```

### Prerequisites

- Docker Desktop (or Docker Engine + Compose on Linux)
- 4 GB RAM minimum (patmos toolchain build requires ~2 GB)
- Ports 3000 and 8000 free

### First build note

The Patmos toolchain (patmos-clang + pasim) compiles from source inside Docker on the first build. This takes 5–10 minutes. Subsequent builds use the cached layer and start in seconds.

---

## Tech Stack

**Frontend**
- Next.js (React) — UI framework
- TypeScript — type-safe timing models and simulation logic
- Tailwind CSS — utility-first styling
- Monaco Editor — browser-based C code editor
- HTML5 Canvas API — 60fps road simulation rendering

**Backend**
- FastAPI — REST API framework
- Uvicorn — ASGI server
- Pydantic — request validation

**Emulation & Toolchain**
- Docker + Docker Compose — isolated Patmos execution environment
- patmos-clang — LLVM-based cross-compiler for Patmos ISA
- pasim — official Patmos software simulator
- patemu — cycle-accurate hardware emulator

---

## Project Context

This project is grounded in the Patmos Reference Handbook (DTU Compute) and the T-CREST research project. Core references:

- Schoeberl et al., *Patmos: A Time-Predictable Microprocessor*, 2018
- Wilhelm et al., *The Worst-Case Execution Time Problem*, ACM TECS, 2008
- Khodadad et al., *Towards Lingua Franca on the Patmos Processor*, 2024

---