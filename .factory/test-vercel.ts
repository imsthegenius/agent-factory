import * as factory from "@imsthegenius/agent-factory";
import { vercel } from "@imsthegenius/agent-factory/sandboxes/vercel";

const claudeInstallHook = {
  command: "curl -fsSL https://claude.ai/install.sh | bash",
};

const ghCliInstallHook = {
  command:
    "curl -fsSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo && dnf install -y gh",
  sudo: true,
};

// /matt-pococks-projects/sandcastle
const { commits, branch } = await factory.run({
  sandbox: vercel({
    token: process.env.VERCEL_OIDC_TOKEN,
    teamId: "matt-pococks-projects",
    projectId: "sandcastle",
  }),
  name: "Test",
  agent: factory.pi("openai-codex/gpt-5.5"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  hooks: {
    sandbox: {
      onSandboxReady: [
        claudeInstallHook,
        ghCliInstallHook,
        {
          command: "npm install && npm run build",
        },
      ],
    },
  },
});

console.log("Commits:", commits);
console.log("Branch:", branch);
