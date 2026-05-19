import * as factory from "@imsthegenius/agent-factory";
import { noSandbox } from "@imsthegenius/agent-factory/sandboxes/no-sandbox";

// /matt-pococks-projects/sandcastle
const { commits, branch } = await factory.interactive({
  branchStrategy: {
    type: "merge-to-head",
  },
  name: "Test",
  agent: factory.pi("openai-codex/gpt-5.5"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  copyToWorkspace: ["node_modules"],
});

console.log("Commits:", commits);
console.log("Branch:", branch);
