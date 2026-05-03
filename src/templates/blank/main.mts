import { run, codex } from "@yae-tools/narukami-shrine";
import { docker } from "@yae-tools/narukami-shrine/sandboxes/docker";

// Blank template: customize this to build your own orchestration.
// Run this with: npx tsx .narukami/main.mts
// Or add to package.json scripts: "narukami": "npx tsx .narukami/main.mts"

await run({
  agent: codex("gpt-5.5", { effort: "low" }),
  sandbox: docker(),
  promptFile: "./.narukami/prompt.md",
});
