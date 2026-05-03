import { run, codex } from "@yae-tools/narukami-shrine";
import { docker } from "@yae-tools/narukami-shrine/sandboxes/docker";

// Simple loop: an agent that picks open issues one by one and closes them.
// Run this with: npx tsx .narukami/main.mts
// Or add to package.json scripts: "narukami": "npx tsx .narukami/main.mts"

await run({
  // A name for this run, shown as a prefix in log output.
  name: "worker",

  // Sandbox provider — Docker is the default runtime.
  sandbox: docker(),

  // The agent provider. `narukami init` rewrites this placeholder to your
  // selected agent and model.
  agent: codex("gpt-5.5", { effort: "low" }),

  // Path to the prompt file. Shell expressions inside are evaluated inside the
  // sandbox at the start of each iteration, so the agent always sees fresh data.
  promptFile: "./.narukami/prompt.md",

  // Maximum number of iterations (agent invocations) to run in a session.
  // Each iteration works on a single issue. Increase this to process more issues
  // per run, or set it to 1 for a single-shot mode.
  maxIterations: 3,

  // Branch strategy — merge-to-head creates a temporary branch for the agent
  // to work on, then merges the result back to HEAD when the run completes.
  // This is required when using copyToWorktree, since head mode bind-mounts
  // the host directory directly (no worktree to copy into).
  branchStrategy: { type: "merge-to-head" },

  // Keep this empty by default. Copying host node_modules into a Linux sandbox
  // can break native packages such as esbuild when the host is macOS/Windows.
  copyToWorktree: [],

  // Lifecycle hooks — commands grouped by where they run (host or sandbox).
  hooks: {
    sandbox: {
      // onSandboxReady runs once after the sandbox is initialised and the repo is
      // synced in, before the agent starts. Use it to install dependencies or run
      // any other setup steps your project needs.
      onSandboxReady: [{ command: "npm install" }],
    },
  },
});
