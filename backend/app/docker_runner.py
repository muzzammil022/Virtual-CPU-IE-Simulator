"""
Docker runner — spins up a Patmos toolchain container,
compiles C code with patmos-clang, runs it on pasim (simulator)
and/or patemu (emulator), captures output + timing.
"""

import re
import time
import tempfile
import os
import base64
import docker
from docker.errors import ContainerError, ImageNotFound, APIError

EXECUTOR_IMAGE = "sdtime-executor:latest"

client: docker.DockerClient | None = None


def _get_client() -> docker.DockerClient:
    global client
    if client is None:
        client = docker.from_env()
    return client


def _write_code_to_tempfile(code: str) -> str:
    """Write user code to a temp file and return the path."""
    fd, path = tempfile.mkstemp(suffix=".c", prefix="patmos_")
    with os.fdopen(fd, "w") as f:
        f.write(code)
    return path


def _parse_pasim_stats(output: str) -> dict:
    """
    Parse pasim's or patemu's statistics output.
    Both tools print stats to stderr like:
      Cycles: 12345
      Instructions: 9876
      Bundles: 654
      Cache Hits: 432
      Cache Misses: 10
      Method Cache Hits: 400
      Method Cache Misses: 2
      Stack Cache Spills: 5
    
    This function is flexible with formatting and handles various case/spacing variations.
    """
    stats = {}

    # Normalize output: lowercase for case-insensitive matching, extra whitespace
    normalized = output.lower()

    # Cycle count (try multiple patterns)
    for pattern in [r"cycles?\s*:\s*(\d+)", r"total\s+cycles?\s*:\s*(\d+)"]:
        m = re.search(pattern, normalized)
        if m:
            stats["cycles"] = int(m.group(1))
            break

    # Instructions (dynamic/instruction count)
    for pattern in [r"instructions?\s*:\s*(\d+)", r"dynamic\s+instructions?\s*:\s*(\d+)"]:
        m = re.search(pattern, normalized)
        if m:
            stats["instructions"] = int(m.group(1))
            break

    # Bundle count (VLIW bundles/words)
    for pattern in [r"bundles?\s*:\s*(\d+)", r"instruction\s+words?\s*:\s*(\d+)"]:
        m = re.search(pattern, normalized)
        if m:
            stats["bundles"] = int(m.group(1))
            break

    # Cache stats (data cache)
    m = re.search(r"cache\s+hits?\s*:\s*(\d+)", normalized)
    if m:
        stats["cache_hits"] = int(m.group(1))

    m = re.search(r"cache\s+misses?\s*:\s*(\d+)", normalized)
    if m:
        stats["cache_misses"] = int(m.group(1))

    # Method cache (instruction cache)
    m = re.search(r"method\s+cache\s+hits?\s*:\s*(\d+)", normalized)
    if m:
        stats["method_cache_hits"] = int(m.group(1))

    m = re.search(r"method\s+cache\s+misses?\s*:\s*(\d+)", normalized)
    if m:
        stats["method_cache_misses"] = int(m.group(1))

    # Stack cache (spills/fills/operations)
    for pattern in [
        r"stack\s+cache\s+spills?\s*:\s*(\d+)",
        r"stack\s+cache\s+fills?\s*:\s*(\d+)",
        r"stack\s+cache\s+(?:operations?|ops?)\s*:\s*(\d+)",
    ]:
        m = re.search(pattern, normalized)
        if m:
            stats["stack_cache_ops"] = int(m.group(1))
            break

    return stats


def _build_compile_and_run_cmd(mode: str = "simulate") -> str:
    """
    Build the shell command that:
    1. Compiles /tmp/main.c with patmos-clang
    2. Runs the binary with pasim or patemu
    """
    compile_cmd = "patmos-clang -O2 /tmp/main.c -o /tmp/main 2>&1"

    if mode == "emulate":
        # patemu: cycle-accurate hardware emulator
        run_cmd = "patemu /tmp/main 2>&1"
    else:
        # pasim: fast instruction-set simulator with stats
        # -V  prints detailed execution statistics
        run_cmd = "pasim -V /tmp/main 2>&1"

    return f'sh -c "{compile_cmd} && echo \'===EXEC_OUTPUT_START===\' && {run_cmd} && echo \'===EXEC_OUTPUT_END===\'"'


def _build_gcc_compile_and_run_cmd() -> str:
    """
    Build the shell command for normal GCC compilation + execution.
    Used as the 'normal CPU' comparison baseline.
    """
    compile_cmd = "gcc -O2 /tmp/main.c -o /tmp/main_gcc 2>&1"
    run_cmd = "/tmp/main_gcc 2>&1"
    return f'sh -c "{compile_cmd} && {run_cmd}"'


def run_on_patmos(
    code: str,
    mode: str = "simulate",
    timeout: int = 30,
) -> dict:
    """
    Compile and run C code on the Patmos toolchain inside a Docker container.

    Args:
        code: C source code
        mode: "simulate" (pasim, fast) or "emulate" (patemu, cycle-accurate)
        timeout: max seconds before killing container

    Returns:
        dict with success, stdout, stderr, exit_code, stats, container_time_ms
    """
    dk = _get_client()

    # Base64-encode the code to avoid all shell escaping issues
    b64 = base64.b64encode(code.encode()).decode()

    full_cmd = (
        "sh -c \""
        "touch /tmp/compile_err /tmp/run_stats && "
        f"echo '{b64}' | base64 -d > /tmp/main.c && "
        "patmos-clang -O2 /tmp/main.c -o /tmp/main 2>/tmp/compile_err && "
        "echo '===COMPILE_OK===' && "
    )

    if mode == "emulate":
        # patemu: cycle-accurate emulator; -v enables verbose stats output
        full_cmd += "patemu -v /tmp/main 2>/tmp/run_stats; "
    else:
        # pasim: fast simulator; -V enables detailed statistics
        full_cmd += "pasim -V /tmp/main 2>/tmp/run_stats; "

    full_cmd += (
        "echo '===PROGRAM_OUTPUT_END==='; "
        "echo '===STATS_START==='; "
        "cat /tmp/run_stats 2>/dev/null; "
        "echo '===STATS_END==='; "
        "cat /tmp/compile_err 2>/dev/null\""
    )

    try:
        t0 = time.perf_counter()
        container_output = dk.containers.run(
            image=EXECUTOR_IMAGE,
            command=full_cmd,
            platform="linux/amd64",
            remove=True,
            network_disabled=True,
            mem_limit="256m",
            cpu_period=100_000,
            cpu_quota=80_000,       # 80% of one core
            stderr=True,
            stdout=True,
            detach=False,
        )
        elapsed = (time.perf_counter() - t0) * 1000
        raw = container_output.decode("utf-8") if isinstance(container_output, bytes) else str(container_output)

        # Parse sections
        compile_ok = "===COMPILE_OK===" in raw
        program_output = ""
        stats_text = ""

        if "===COMPILE_OK===" in raw:
            after_compile = raw.split("===COMPILE_OK===", 1)[1]

            if "===PROGRAM_OUTPUT_END===" in after_compile:
                program_output = after_compile.split("===PROGRAM_OUTPUT_END===", 1)[0].strip()

            if "===STATS_START===" in raw and "===STATS_END===" in raw:
                stats_text = raw.split("===STATS_START===", 1)[1].split("===STATS_END===", 1)[0].strip()
        else:
            # Compilation failed
            program_output = ""
            stats_text = ""

        # Parse stats from pasim/patemu output
        stats = _parse_pasim_stats(stats_text) if stats_text else {}

        # If pasim stats are in program_output (pasim -V prints to stderr which we redirect)
        if not stats and program_output:
            stats = _parse_pasim_stats(program_output)

        return {
            "success": compile_ok,
            "stdout": program_output,
            "stderr": raw if not compile_ok else None,
            "exit_code": 0 if compile_ok else 1,
            "container_time_ms": round(elapsed, 2),
            "stats": stats,
            "stats_raw": stats_text,
            "mode": mode,
        }

    except ContainerError as e:
        stderr_text = e.stderr.decode("utf-8") if e.stderr else str(e)
        return {
            "success": False,
            "stdout": "",
            "stderr": stderr_text,
            "exit_code": e.exit_status,
            "container_time_ms": 0,
            "stats": {},
            "stats_raw": "",
            "mode": mode,
        }
    except ImageNotFound:
        return {
            "success": False,
            "stdout": "",
            "stderr": (
                f"Executor image '{EXECUTOR_IMAGE}' not found. "
                "Run: docker compose build executor"
            ),
            "exit_code": 1,
            "container_time_ms": 0,
            "stats": {},
            "stats_raw": "",
            "mode": mode,
        }
    except APIError as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Docker API error: {e.explanation}",
            "exit_code": 1,
            "container_time_ms": 0,
            "stats": {},
            "stats_raw": "",
            "mode": mode,
        }


def run_on_gcc(
    code: str,
    timeout: int = 10,
) -> dict:
    """
    Compile and run C code with regular GCC as a baseline comparison.
    """
    dk = _get_client()

    b64 = base64.b64encode(code.encode()).decode()

    full_cmd = (
        "sh -c \""
        "touch /tmp/compile_err && "
        f"echo '{b64}' | base64 -d > /tmp/main.c && "
        "gcc -O2 /tmp/main.c -o /tmp/main_gcc 2>/tmp/compile_err && "
        "echo '===COMPILE_OK===' && "
        "START_NS=$(date +%s%N) && "
        "/tmp/main_gcc 2>&1; "
        "END_NS=$(date +%s%N); "
        "echo '===PROGRAM_OUTPUT_END==='; "
        "echo ===EXEC_NS===; "
        "echo $((END_NS - START_NS)); "
        "cat /tmp/compile_err 2>/dev/null\""
    )

    try:
        t0 = time.perf_counter()
        container_output = dk.containers.run(
            image=EXECUTOR_IMAGE,
            command=full_cmd,
            platform="linux/amd64",
            remove=True,
            network_disabled=True,
            mem_limit="128m",
            cpu_period=100_000,
            cpu_quota=50_000,
            stderr=True,
            stdout=True,
            detach=False,
        )
        elapsed = (time.perf_counter() - t0) * 1000
        raw = container_output.decode("utf-8") if isinstance(container_output, bytes) else str(container_output)

        compile_ok = "===COMPILE_OK===" in raw
        program_output = ""
        exec_time_ms = elapsed  # fallback to container time

        if compile_ok:
            after_compile = raw.split("===COMPILE_OK===", 1)[1]
            if "===PROGRAM_OUTPUT_END===" in after_compile:
                program_output = after_compile.split("===PROGRAM_OUTPUT_END===", 1)[0].strip()

            # Extract actual execution time (nanoseconds)
            if "===EXEC_NS===" in raw:
                try:
                    ns_str = raw.split("===EXEC_NS===", 1)[1].strip().split()[0]
                    exec_time_ms = int(ns_str) / 1_000_000
                except (ValueError, IndexError):
                    pass

        return {
            "success": compile_ok,
            "stdout": program_output,
            "stderr": raw if not compile_ok else None,
            "exit_code": 0 if compile_ok else 1,
            "container_time_ms": round(exec_time_ms, 3),
        }

    except ContainerError as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": e.stderr.decode("utf-8") if e.stderr else str(e),
            "exit_code": e.exit_status,
            "container_time_ms": 0,
        }
    except (ImageNotFound, APIError) as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "exit_code": 1,
            "container_time_ms": 0,
        }
