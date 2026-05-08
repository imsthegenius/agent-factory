// Sequential Reviewer — implement-then-review loop
//
// This template drives a two-phase workflow per issue:
//   Phase 1 (Implement): An agent picks an open issue, works on it
//                        on a dedicated branch, commits the changes, and signals
//                        completion.
//   Phase 2 (Review):    A second agent reviews the branch diff and either
//                        approves it or makes corrections directly on the branch.
//
// Both phases share a single sandbox created via createSandbox(), so the
// implementer, reviewer, and repairer work on the same explicit branch. After
// review passes, that branch is merged into the current checkout.
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
import { execFileSync, execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of implement→review cycles to run before stopping.
// Each cycle works on one issue. Raise this to process more issues per run.
const MAX_ITERATIONS = 10;

// Maximum self-healing attempts when review reports findings but produces no
// fix commit. Keep this bounded so a stubborn review issue does not spin forever.
const MAX_REPAIR_ATTEMPTS = 3;

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

const repairPrompt = (
  reviewStdout: string,
  previousFindings: string[],
): string => `The reviewer found issues in the current branch but did not commit fixes.

Address the findings below directly on the current branch. Keep the scope limited to review feedback, run the repo-defined checks that fit the change, and commit the fix with a NARUKAMI-prefixed message.

Previous review findings from this repair loop:

${previousFindings.length === 0 ? "None yet." : previousFindings.map((finding, index) => `Attempt ${index + 1}:\n${finding}`).join("\n\n")}

Latest reviewer output:

${reviewStdout}`;

const mergeReviewedBranch = (branch: string): void => {
  const targetBranch = execFileSync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    {
      encoding: "utf8",
    },
  ).trim();

  console.log(`\nMerging reviewed branch ${branch} into ${targetBranch}.`);

  try {
    execFileSync("git", ["merge", branch], { stdio: "inherit" });
  } catch {
    throw new Error(
      `Merge of '${branch}' into '${targetBranch}' failed. ` +
        `The branch has been preserved. Resolve the conflict, then retry with: git merge ${branch}`,
    );
  }

  try {
    execFileSync("git", ["branch", "-d", branch], { stdio: "inherit" });
  } catch {
    console.warn(
      `Reviewed branch ${branch} was merged but could not be deleted automatically. ` +
        `Clean it up with: git branch -d ${branch}`,
    );
  }
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  const reviewBase = execSync("git rev-parse HEAD", {
    encoding: "utf8",
  }).trim();
  const branch = `narukami/sequential-reviewer/${Date.now()}`;

  const sandbox = await narukami.createSandbox({
    branch,
    sandbox: docker(),
    hooks,
    copyToWorktree,
  });

  let shouldMergeReviewedBranch = false;

  try {
    // -----------------------------------------------------------------------
    // Phase 1: Implement
    //
    // An agent picks the next open issue, writes the implementation
    // (using RGR: Red → Green → Repeat → Refactor), and commits the result.
    //
    // The agent signals completion via <promise>COMPLETE</promise> when done.
    // -----------------------------------------------------------------------
    const implement = await sandbox.run({
      name: "implementer",
      maxIterations: 100,
      agent: narukami.codex("gpt-5.5", { effort: "low" }),
      promptFile: "./.narukami/implement-prompt.md",
    });

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

    const repairAgent = narukami.codex("gpt-5.5", { effort: "low" });
    let repairResumeSession =
      repairAgent.name === "codex"
        ? implement.iterations.at(-1)?.sessionId
        : undefined;

    // -----------------------------------------------------------------------
    // Phase 2: Review
    //
    // Codex-agent scaffolds use Codex CLI's built-in review mode by default.
    // Prompt-based review remains available for non-Codex agents or custom
    // reviewer instructions.
    // -----------------------------------------------------------------------
    let review = await sandbox.run({
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

    const previousReviewFindings: string[] = [];
    for (
      let repairAttempt = 1;
      hasReviewFindings(review.stdout) &&
      review.commits.length === 0 &&
      repairAttempt <= MAX_REPAIR_ATTEMPTS;
      repairAttempt++
    ) {
      console.log(
        `\nReviewer reported findings without fixes. Running repair attempt ${repairAttempt}/${MAX_REPAIR_ATTEMPTS}.`,
      );

      const priorFindings = [...previousReviewFindings];
      previousReviewFindings.push(review.stdout);

      const repair = await sandbox.run({
        name: "repairer",
        maxIterations: repairResumeSession ? 1 : 20,
        agent: repairAgent,
        prompt: repairPrompt(review.stdout, priorFindings),
        ...(repairResumeSession === undefined
          ? {}
          : { resumeSession: repairResumeSession }),
      });

      if (!repair.commits.length) {
        throw new Error(
          "Repair agent did not commit fixes for reviewer findings. Check the reviewer and repairer logs before continuing.",
        );
      }

      if (repairAgent.name === "codex") {
        repairResumeSession =
          repair.iterations.at(-1)?.sessionId ?? repairResumeSession;
      }

      review = await sandbox.run({
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
    }

    if (hasReviewFindings(review.stdout) && review.commits.length === 0) {
      throw new Error(
        "Reviewer still reports findings after repair attempts. Check the reviewer and repairer logs before continuing.",
      );
    }

    console.log("\nReview complete.");
    shouldMergeReviewedBranch = true;
  } finally {
    const closeResult = await sandbox.close();
    if (shouldMergeReviewedBranch && closeResult.preservedWorktreePath) {
      throw new Error(
        `Reviewed branch ${branch} still has uncommitted work in ${closeResult.preservedWorktreePath}. ` +
          "Commit or discard those changes before merging.",
      );
    }
  }

  if (shouldMergeReviewedBranch) {
    mergeReviewedBranch(branch);
  }
}

console.log("\nAll done.");
