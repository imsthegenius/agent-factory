// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             A planning agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
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

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your issue queue is large; lower it for a quick smoke-test run.
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
  issue: {
    id: string;
    title: string;
    branch: string;
  },
  reviewStdout: string,
  previousFindings: string[],
): string => `The reviewer found issues for ${issue.id}: ${issue.title}, but did not commit fixes.

Address the findings below directly on branch ${issue.branch}. Keep the scope limited to review feedback, run the repo-defined checks that fit the change, and commit the fix with a NARUKAMI-prefixed message.

Previous review findings from this repair loop:

${previousFindings.length === 0 ? "None yet." : previousFindings.map((finding, index) => `Attempt ${index + 1}:\n${finding}`).join("\n\n")}

Latest reviewer output:

${reviewStdout}`;

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);
  const reviewBase = execSync("git rev-parse HEAD", {
    encoding: "utf8",
  }).trim();

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — we parse that to drive Phase 2.
  // -------------------------------------------------------------------------
  const plan = await narukami.run({
    hooks,
    sandbox: docker(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code.
    maxIterations: 1,
    // The scaffold rewrites this placeholder to your selected planning agent.
    agent: narukami.codex("gpt-5.5", { effort: "low" }),
    promptFile: "./.narukami/plan-prompt.md",
  });

  // Extract the <plan>…</plan> block from the agent's stdout.
  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error(
      "Planning agent did not produce a <plan> tag.\n\n" + plan.stdout,
    );
  }

  // The plan JSON contains an array of issues, each with id, title, branch.
  const { issues } = JSON.parse(planMatch[1]!) as {
    issues: { id: string; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await narukami.createSandbox({
        branch: issue.branch,
        sandbox: docker(),
        hooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: narukami.codex("gpt-5.5", { effort: "low" }),
          promptFile: "./.narukami/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const repairAgent = narukami.codex("gpt-5.5", { effort: "low" });
          let repairResumeSession =
            repairAgent.name === "codex"
              ? implement.iterations.at(-1)?.sessionId
              : undefined;

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
                    BRANCH: issue.branch,
                  },
                }),
          });

          const repairCommits: typeof implement.commits = [];
          const previousReviewFindings: string[] = [];

          for (
            let repairAttempt = 1;
            hasReviewFindings(review.stdout) &&
            review.commits.length === 0 &&
            repairAttempt <= MAX_REPAIR_ATTEMPTS;
            repairAttempt++
          ) {
            console.log(
              `Reviewer reported findings for ${issue.id} without fixes. Running repair attempt ${repairAttempt}/${MAX_REPAIR_ATTEMPTS}.`,
            );

            const priorFindings = [...previousReviewFindings];
            previousReviewFindings.push(review.stdout);

            const repair = await sandbox.run({
              name: "repairer",
              maxIterations: repairResumeSession ? 1 : 20,
              agent: repairAgent,
              prompt: repairPrompt(issue, review.stdout, priorFindings),
              ...(repairResumeSession === undefined
                ? {}
                : { resumeSession: repairResumeSession }),
            });

            if (!repair.commits.length) {
              throw new Error(
                `Repair agent did not commit fixes for reviewer findings on ${issue.id}. Check the reviewer and repairer logs before merging.`,
              );
            }

            repairCommits.push(...repair.commits);
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
                      BRANCH: issue.branch,
                    },
                  }),
            });
          }

          if (hasReviewFindings(review.stdout) && review.commits.length === 0) {
            throw new Error(
              `Reviewer still reports findings for ${issue.id} after repair attempts. Check the reviewer and repairer logs before merging.`,
            );
          }

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [
              ...implement.commits,
              ...repairCommits,
              ...review.commits,
            ],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await narukami.run({
    hooks,
    sandbox: docker(),
    name: "merger",
    maxIterations: 1,
    agent: narukami.codex("gpt-5.5", { effort: "low" }),
    promptFile: "./.narukami/merge-prompt.md",
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
