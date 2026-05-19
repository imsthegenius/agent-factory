import { run, codex } from "@imsthegenius/agent-factory";
import { docker } from "@imsthegenius/agent-factory/sandboxes/docker";

// Blank template: customize this to build your own orchestration.
// Run this with: npx tsx .factory/main.mts
// Or add to package.json scripts: "factory": "npx tsx .factory/main.mts"

await run({
  agent: codex("gpt-5.5", { effort: "low" }),
  sandbox: docker(),
  promptFile: "./.factory/prompt.md",
});
