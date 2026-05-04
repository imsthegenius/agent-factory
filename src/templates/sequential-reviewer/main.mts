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
import { execSync } from "node:child_process";

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

// Codex review has built-in review instructions, so no prompt is needed by
// default. Set this to "./.narukami/review-prompt.md" to add custom review
// instructions, or when using a general agent provider for review.
const reviewPromptFile: string | undefined = undefined;

const hasReviewFindings = (stdout: string): boolean =>
  /^Review comment:/m.test(stdout) ||
  /^\s*-\s*\[P[0-3]\]/m.test(stdout) ||
  /::code-comment\{/.test(stdout);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);
  const reviewBase = execSync("git rev-parse HEAD", {
    encoding: "utf8",
  }).trim();

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
    if (implement.completionSignal !== undefined) {
      console.log(
        "Implementation agent reported no actionable work. Stopping.",
      );
      break;
    }
    console.log("Implementation agent made no commits. Skipping review.");
    continue;
  }

  console.log(`\nImplementation complete on branch: ${branch}`);
  console.log(`Commits: ${implement.commits.length}`);

  // -------------------------------------------------------------------------
  // Phase 2: Review
  //
  // A second agent reviews the commits produced by Phase 1, using the
  // pre-implementation HEAD as the review base. It runs on its own temporary
  // branch and Narukami merges reviewer fixes back into the current branch.
  // -------------------------------------------------------------------------
  const review = await narukami.run({
    hooks,
    copyToWorktree,
    sandbox: docker(),
    branchStrategy: { type: "merge-to-head" },
    name: "reviewer",
    maxIterations: 1,
    agent: narukami.codexReview("gpt-5.5", {
      effort: "low",
      base: reviewBase,
    }),
    ...(reviewPromptFile === undefined
      ? {}
      : {
          promptFile: reviewPromptFile,
          promptArgs: {
            BRANCH: branch,
            REVIEW_BASE: reviewBase,
          },
        }),
  });

  if (hasReviewFindings(review.stdout) && !review.commits.length) {
    throw new Error(
      "Reviewer reported findings but did not commit fixes. Check the reviewer log before continuing.",
    );
  }

  console.log("\nReview complete.");
}

console.log("\nAll done.");
