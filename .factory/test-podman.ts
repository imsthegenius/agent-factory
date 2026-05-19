import * as factory from "@imsthegenius/agent-factory";
import { podman } from "@imsthegenius/agent-factory/sandboxes/podman";

const { commits, branch } = await factory.run({
  sandbox: podman(),
  name: "Test",
  agent: factory.pi("openai-codex/gpt-5.5"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  hooks: {
    sandbox: {
      onSandboxReady: [
        {
          command: "npm install && npm run build",
        },
      ],
    },
  },
});

console.log("Commits:", commits);
console.log("Branch:", branch);
