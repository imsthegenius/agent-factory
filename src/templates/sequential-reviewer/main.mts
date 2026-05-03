// Sequential Reviewer — implement-then-review loop
//
// This template drives a two-phase workflow per issue:
//   Phase 1 (Implement): An agent picks an open issue, works on it
//                        on a dedicated branch, commits the changes, and signals
//                        completion.
//   Phase 2 (Review):    A second agent reviews the branch diff and either
//                        approves it or makes corrections directly on the branch.
//
// The outer loop repeats up to MAX_ITERATIONS times, processing one issue per
// iteration. This is a middle-complexity option between the simple-loop (no review
// gate) and the parallel-planner (concurrent execution with a planning phase).
//
// Usage:
//   npx tsx .narukami/main.mts
// Or add to package.json:
//   "scripts": { "narukami": "npx tsx .narukami/main.mts" }

import * as narukami from "@yae-tools/narukami-shrine";
import { docker } from "@yae-tools/narukami-shrine/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of implement→review cycles to run before stopping.
// Each cycle works on one issue. Raise this to process more issues per run.
const MAX_ITERATIONS = 10;

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Keep this empty by default. Copying host node_modules into a Linux sandbox
// can break native packages such as esbuild when the host is macOS/Windows.
const copyToWorktree: string[] = [];

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Implement
  //
  // An agent picks the next open issue, creates a branch, writes
  // the implementation (using RGR: Red → Green → Repeat → Refactor), and
  // commits the result.
  //
  // The agent signals completion via <promise>COMPLETE</promise> when done.
  // The result contains the branch name the agent worked on.
  // -------------------------------------------------------------------------
  const implement = await narukami.run({
    hooks,
    copyToWorktree,
    sandbox: docker(),
    branchStrategy: { type: "merge-to-head" },
    name: "implementer",
    maxIterations: 100,
    agent: narukami.claudeCode("claude-sonnet-4-6"),
    promptFile: "./.narukami/implement-prompt.md",
  });

  // Extract the branch the agent worked on so the reviewer can target it.
  const branch = implement.branch;

  if (!implement.commits.length) {
    console.log("Implementation agent made no commits. Skipping review.");
    continue;
  }

  console.log(`\nImplementation complete on branch: ${branch}`);
  console.log(`Commits: ${implement.commits.length}`);

  // -------------------------------------------------------------------------
  // Phase 2: Review
  //
  // A second agent reviews the diff of the branch produced by Phase 1.
  // It uses the {{BRANCH}} prompt argument to inspect the right branch, and
  // either approves or makes corrections directly on the branch.
  // -------------------------------------------------------------------------
  await narukami.run({
    hooks,
    copyToWorktree,
    sandbox: docker(),
    branchStrategy: { type: "branch", branch },
    name: "reviewer",
    maxIterations: 1,
    agent: narukami.claudeCode("claude-sonnet-4-6"),
    promptFile: "./.narukami/review-prompt.md",
    // Prompt arguments substitute {{BRANCH}} in review-prompt.md before the
    // agent sees the prompt.
    promptArgs: {
      BRANCH: branch,
    },
  });

  console.log("\nReview complete.");
}

console.log("\nAll done.");
