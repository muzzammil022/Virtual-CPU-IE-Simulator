import type { NextApiRequest, NextApiResponse } from "next";
import { CodeRunnerRequest, CodeRunnerResponse, TimingComparison } from "@/lib/types";

/**
 * Mock Patmos code execution endpoint.
 *
 * In production, this would:
 *   1. Write the C code to a temp file
 *   2. Compile with patmos-clang
 *   3. Execute with pasim and capture trace
 *   4. Also compile with gcc and run natively for comparison
 *
 * For now, we analyze the code structure and simulate realistic timing.
 */
export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<CodeRunnerResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { code, inputs } = req.body as CodeRunnerRequest;

  // Analyze code to simulate execution
  const analysis = analyzeCode(code);

  // Simulate Patmos deterministic execution
  const patmosCycles = analysis.baseCycles;
  const patmosWcet = patmosCycles; // Patmos: WCET = actual cycles (deterministic)
  const patmosBcet = patmosCycles; // No variation

  // Simulate normal processor (non-deterministic)
  // Cache behavior, branch prediction, pipeline hazards cause jitter
  const normalBase = Math.floor(patmosCycles * 0.85); // Normal CPU often faster on average
  const normalJitter = Math.floor(patmosCycles * 0.35); // But with significant jitter
  const normalCycles = normalBase + Math.floor(Math.random() * normalJitter);
  const normalWcet = normalBase + normalJitter; // Worst case is much worse
  const normalBcet = normalBase; // Best case is better

  const timing: TimingComparison = {
    patmos: {
      cycles: patmosCycles,
      wcet: patmosWcet,
      bcet: patmosBcet,
      jitter: 0,
      executionTimeMs: patmosCycles * 0.01, // ~100MHz clock
    },
    normal: {
      cycles: normalCycles,
      wcet: normalWcet,
      bcet: normalBcet,
      jitter: normalWcet - normalBcet,
      executionTimeMs: normalCycles * 0.004, // ~250MHz but jittery
    },
    speedup: normalCycles / patmosCycles,
    predictabilityGain: normalJitter / 1, // Patmos jitter is 0, so gain is effectively infinite; we cap it
  };

  // Cap predictability gain for display
  timing.predictabilityGain = Math.min(timing.predictabilityGain, 999);

  const output = simulateOutput(code, inputs);

  // Simulate execution latency
  setTimeout(() => {
    res.status(200).json({
      success: !analysis.hasError,
      output,
      error: analysis.hasError ? analysis.errorMsg : undefined,
      timing,
      patmos_trace: {
        branch_taken: analysis.branchPath,
        instructions_executed: Math.floor(patmosCycles / 3),
        cache_hits: analysis.baseCycles,
        cache_misses: 0, // Patmos uses scratchpad, no cache misses
      },
      normal_trace: {
        branch_taken: analysis.branchPath,
        instructions_executed: Math.floor(normalCycles / 2.5),
        cache_hits: Math.floor(analysis.baseCycles * 0.85),
        cache_misses: Math.floor(analysis.baseCycles * 0.15),
        pipeline_stalls: Math.floor(normalJitter * 0.3),
        branch_mispredictions: analysis.branches > 0 ? Math.floor(analysis.branches * 0.2) : 0,
      },
    });
  }, 100 + Math.floor(Math.random() * 100));
}

interface CodeAnalysis {
  baseCycles: number;
  branches: number;
  loops: number;
  branchPath: string;
  hasError: boolean;
  errorMsg: string;
}

function analyzeCode(code: string): CodeAnalysis {
  // Count structural elements to estimate cycles
  const ifCount = (code.match(/\bif\s*\(/g) || []).length;
  const elseCount = (code.match(/\belse\b/g) || []).length;
  const forCount = (code.match(/\bfor\s*\(/g) || []).length;
  const whileCount = (code.match(/\bwhile\s*\(/g) || []).length;
  const funcCount = (code.match(/\b\w+\s*\([^)]*\)\s*\{/g) || []).length;
  const assignments = (code.match(/[^=!<>]=[^=]/g) || []).length;
  const arithmetic = (code.match(/[+\-*/%]/g) || []).length;

  const branches = ifCount + elseCount;
  const loops = forCount + whileCount;

  // Base cycle estimation (simplified model)
  let baseCycles = 120; // function prologue/epilogue
  baseCycles += assignments * 8; // load/store
  baseCycles += arithmetic * 4; // ALU ops
  baseCycles += branches * 24; // branch evaluation
  baseCycles += loops * 180; // loop body (bounded iterations)
  baseCycles += funcCount * 32; // call overhead

  // Check for common errors
  let hasError = false;
  let errorMsg = "";

  if (!code.trim()) {
    hasError = true;
    errorMsg = "Empty code";
  } else if (code.includes("malloc") || code.includes("calloc")) {
    hasError = true;
    errorMsg = "Dynamic memory allocation not allowed in time-predictable code";
  } else if (code.includes("printf") && !code.includes("stdio.h") && !code.includes("<stdio.h>")) {
    // Allow printf but note it
  }

  const branchPath = branches > 0
    ? `${branches} branches analyzed, all statically bounded`
    : "straight-line code, no branches";

  return {
    baseCycles: Math.max(baseCycles, 80),
    branches,
    loops,
    branchPath,
    hasError,
    errorMsg,
  };
}

function simulateOutput(code: string, inputs?: Record<string, number>): string {
  // Try to extract what the code would print
  const printfMatches = code.match(/printf\s*\(\s*"([^"]*)"[^)]*\)/g);
  if (printfMatches && printfMatches.length > 0) {
    return printfMatches
      .map((m) => {
        const strMatch = m.match(/"([^"]*)"/);
        if (!strMatch) return "";
        let str = strMatch[1];
        // Replace common format specifiers with sample values
        str = str.replace(/%d/g, "42");
        str = str.replace(/%f/g, "3.14");
        str = str.replace(/%s/g, "result");
        str = str.replace(/\\n/g, "\n");
        return str;
      })
      .join("");
  }

  // Check if the code has a return statement with a value
  const returnMatch = code.match(/return\s+(\d+)/);
  if (returnMatch) {
    return `Program exited with code ${returnMatch[1]}`;
  }

  return "Program executed successfully (no output)";
}
