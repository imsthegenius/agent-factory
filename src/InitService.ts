import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SANDBOX_REPO_DIR } from "./SandboxFactory.js";

const GITIGNORE = `.env
logs/
worktrees/
`;

export interface TemplateMetadata {
  name: string;
  description: string;
}

const TEMPLATES: TemplateMetadata[] = [
  {
    name: "blank",
    description: "Bare scaffold — write your own prompt and orchestration",
  },
  {
    name: "simple-loop",
    description: "Picks issues one by one and closes them",
  },
  {
    name: "sequential-reviewer",
    description:
      "Implements issues one by one, with a code review step after each",
  },
  {
    name: "parallel-planner",
    description:
      "Plans parallelizable issues, executes on separate branches, merges",
  },
  {
    name: "parallel-planner-with-review",
    description:
      "Plans parallelizable issues, executes with per-branch review, merges",
  },
];

export const listTemplates = (): TemplateMetadata[] => TEMPLATES;

// ---------------------------------------------------------------------------
// Agent registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface AgentEntry {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly defaultFactoryOptions?: string;
  readonly factoryImport: string;
  readonly dockerfileTemplate: string;
  /** Lines to include in the generated `.env.example` for this agent's auth setup. */
  readonly envExample: string;
}

interface PackageManagerConfig {
  readonly installCommand: string;
  readonly installCommandLabel: string;
  readonly installTimeoutMs: number;
  readonly dockerfileTools: string;
}

const CLAUDE_CODE_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{ISSUE_PROVIDER_TOOLS}}

{{PACKAGE_MANAGER_TOOLS}}

# Build-args for UID/GID alignment: narukami docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER \${AGENT_UID}:\${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Narukami Shrine bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const PI_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{ISSUE_PROVIDER_TOOLS}}

{{PACKAGE_MANAGER_TOOLS}}

# Build-args for UID/GID alignment: narukami docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install pi coding agent (run as root before USER agent)
RUN npm install -g @mariozechner/pi-coding-agent

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Narukami Shrine bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const CODEX_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{ISSUE_PROVIDER_TOOLS}}

{{PACKAGE_MANAGER_TOOLS}}

# Build-args for UID/GID alignment: narukami docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install Codex CLI (run as root before USER agent)
RUN npm install -g @openai/codex

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Narukami Shrine bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const OPENCODE_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  ripgrep \\
  && rm -rf /var/lib/apt/lists/*

{{ISSUE_PROVIDER_TOOLS}}

{{PACKAGE_MANAGER_TOOLS}}

# Build-args for UID/GID alignment: narukami docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install OpenCode CLI (run as root before USER agent)
RUN npm install -g opencode-ai@latest

USER \${AGENT_UID}:\${AGENT_GID}

WORKDIR /home/agent

# In worktree sandbox mode, Narukami Shrine bind-mounts the git worktree at \${SANDBOX_REPO_DIR}
# and overrides the working directory to \${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that \${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;

const AGENT_REGISTRY: AgentEntry[] = [
  {
    name: "codex",
    label: "Codex",
    defaultModel: "gpt-5.5",
    defaultFactoryOptions: `{ effort: "low" }`,
    factoryImport: "codex",
    dockerfileTemplate: CODEX_DOCKERFILE,
    envExample: `# Codex uses ChatGPT subscription auth by default.
# Run \`codex login\` on the host, then keep ~/.codex mounted into the sandbox.
# API key auth is available via Codex CLI, but this scaffold is subscription-first.`,
  },
  {
    name: "claude-code",
    label: "Claude Code",
    defaultModel: "claude-opus-4-6",
    factoryImport: "claudeCode",
    dockerfileTemplate: CLAUDE_CODE_DOCKERFILE,
    envExample: `# Anthropic API key
ANTHROPIC_API_KEY=`,
  },
  {
    name: "pi",
    label: "Pi",
    defaultModel: "claude-sonnet-4-6",
    factoryImport: "pi",
    dockerfileTemplate: PI_DOCKERFILE,
    envExample: `# Anthropic API key
ANTHROPIC_API_KEY=`,
  },
  {
    name: "opencode",
    label: "OpenCode",
    defaultModel: "opencode/big-pickle",
    factoryImport: "opencode",
    dockerfileTemplate: OPENCODE_DOCKERFILE,
    envExample: `# OpenCode API key
OPENCODE_API_KEY=`,
  },
];

export const listAgents = (): AgentEntry[] => AGENT_REGISTRY;

// ---------------------------------------------------------------------------
// Issue provider registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface IssueProviderEntry {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly usesShellExpansion?: boolean;
  readonly templateArgs: {
    readonly LIST_TASKS_COMMAND: string;
    readonly VIEW_TASK_COMMAND: string;
    readonly CLOSE_TASK_COMMAND: string;
    readonly ISSUE_PROVIDER_TOOLS: string;
  };
  /** Lines to append to `.env.example` for this issue provider, or empty string if none needed. */
  readonly envExample: string;
}

const GITHUB_CLI_TOOLS = `# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \\
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
  && apt-get update && apt-get install -y gh \\
  && rm -rf /var/lib/apt/lists/*`;

const BEADS_TOOLS = `# Install system dependencies for Beads
RUN apt-get update && apt-get install -y \\
  dpkg-dev \\
  libicu72 \\
  && rm -rf /var/lib/apt/lists/* \\
  && ARCH_DIR=$(dpkg-architecture -qDEB_HOST_MULTIARCH) \\
  && for lib in /usr/lib/$ARCH_DIR/libicu*.so.72; do \\
       ln -s "$lib" "\${lib%.72}.74"; \\
     done

RUN curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

RUN corepack enable`;

const ISSUE_PROVIDER_REGISTRY: IssueProviderEntry[] = [
  {
    name: "linear",
    label: "Linear",
    hint: "Requires the Linear MCP tool installed and available to the agent",
    usesShellExpansion: false,
    templateArgs: {
      LIST_TASKS_COMMAND:
        "Use the Linear MCP tool to list actionable open issues. Include each issue identifier, title, description, labels, comments, priority, status, and linked or parent issue context before choosing work.",
      VIEW_TASK_COMMAND:
        "Use the Linear MCP tool to read issue <ID>, including description, comments, labels, attachments, and linked or parent issues.",
      CLOSE_TASK_COMMAND:
        'Use the Linear MCP tool to comment on <ID> with "Completed by Narukami Shrine" and move it to a completed state.',
      ISSUE_PROVIDER_TOOLS:
        "# Linear issue tracking uses the Linear MCP tool configured for the agent",
    },
    envExample:
      "# Linear requires the Linear MCP tool to be installed and available to the agent.\n",
  },
  {
    name: "github-issues",
    label: "GitHub Issues",
    templateArgs: {
      LIST_TASKS_COMMAND: `gh issue list --state open --label Narukami Shrine --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,
      VIEW_TASK_COMMAND: "gh issue view <ID>",
      CLOSE_TASK_COMMAND: `gh issue close <ID> --comment "Completed by Narukami Shrine"`,
      ISSUE_PROVIDER_TOOLS: GITHUB_CLI_TOOLS,
    },
    envExample: `# GitHub personal access token
GH_TOKEN=`,
  },
  {
    name: "beads",
    label: "Beads",
    templateArgs: {
      LIST_TASKS_COMMAND: "bd ready --json",
      VIEW_TASK_COMMAND: "bd show <ID>",
      CLOSE_TASK_COMMAND: `bd close <ID> "Completed by Narukami Shrine"`,
      ISSUE_PROVIDER_TOOLS: BEADS_TOOLS,
    },
    envExample: "",
  },
];

export const listIssueProviders = (): IssueProviderEntry[] =>
  ISSUE_PROVIDER_REGISTRY;

export const getIssueProvider = (
  name: string,
): IssueProviderEntry | undefined =>
  ISSUE_PROVIDER_REGISTRY.find((b) => b.name === name);

export const getAgent = (name: string): AgentEntry | undefined =>
  AGENT_REGISTRY.find((a) => a.name === name);

// ---------------------------------------------------------------------------
// Sandbox provider registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface SandboxProviderEntry {
  readonly name: string;
  readonly label: string;
  /** Filename written to .narukami/ (e.g. "Dockerfile" or "Containerfile") */
  readonly containerfileName: string;
  /** CLI namespace for build/remove commands (e.g. "docker" or "podman") */
  readonly cliNamespace: string;
}

const SANDBOX_PROVIDER_REGISTRY: SandboxProviderEntry[] = [
  {
    name: "docker",
    label: "Docker",
    containerfileName: "Dockerfile",
    cliNamespace: "docker",
  },
  {
    name: "podman",
    label: "Podman",
    containerfileName: "Containerfile",
    cliNamespace: "podman",
  },
];

export const listSandboxProviders = (): SandboxProviderEntry[] =>
  SANDBOX_PROVIDER_REGISTRY;

export const getSandboxProvider = (
  name: string,
): SandboxProviderEntry | undefined =>
  SANDBOX_PROVIDER_REGISTRY.find((p) => p.name === name);

// ---------------------------------------------------------------------------
// Optional sandbox tool registry (internal — not part of public API)
// ---------------------------------------------------------------------------

export interface SandboxToolEntry {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly containerfileTools: string;
  readonly envExample: (options: { readonly sonarHostUrl?: string }) => string;
}

const SONAR_SCANNER_TOOLS = `# narukami-tool:sonar-scanner:start
ARG SONAR_SCANNER_VERSION=8.0.1.6346

# Install SonarScanner CLI for repos whose quality gates call sonar-scanner.
RUN set -eux; \\
  apt-get update; \\
  apt-get install -y unzip; \\
  arch="$(dpkg --print-architecture)"; \\
  case "$arch" in \\
    amd64) scanner_arch="linux-x64" ;; \\
    arm64) scanner_arch="linux-aarch64" ;; \\
    *) echo "Unsupported architecture for SonarScanner CLI: $arch" >&2; exit 1 ;; \\
  esac; \\
  curl -fsSL \\
    "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-\${SONAR_SCANNER_VERSION}-\${scanner_arch}.zip" \\
    -o /tmp/sonar-scanner.zip; \\
  unzip -q /tmp/sonar-scanner.zip -d /opt; \\
  mv "/opt/sonar-scanner-\${SONAR_SCANNER_VERSION}-\${scanner_arch}" /opt/sonar-scanner; \\
  ln -s /opt/sonar-scanner/bin/sonar-scanner /usr/local/bin/sonar-scanner; \\
  rm /tmp/sonar-scanner.zip; \\
  rm -rf /var/lib/apt/lists/*
# narukami-tool:sonar-scanner:end`;

const SANDBOX_TOOL_REGISTRY: SandboxToolEntry[] = [
  {
    name: "sonar-scanner",
    label: "SonarScanner CLI",
    hint: "Installs sonar-scanner for SonarQube/SonarCloud quality gates",
    containerfileTools: SONAR_SCANNER_TOOLS,
    envExample: ({ sonarHostUrl }) => `# narukami-env:sonar-scanner:start
# SonarScanner CLI (optional; required only if your repo quality gates run sonar-scanner)
# For local SonarQube on Docker Desktop, try http://host.docker.internal:9000
SONAR_HOST_URL=${sonarHostUrl ?? ""}
SONAR_TOKEN=
# narukami-env:sonar-scanner:end`,
  },
];

export const listSandboxTools = (): SandboxToolEntry[] => SANDBOX_TOOL_REGISTRY;

export const getSandboxTool = (name: string): SandboxToolEntry | undefined =>
  SANDBOX_TOOL_REGISTRY.find((tool) => tool.name === name);

const removeMarkedBlock = (
  content: string,
  markerKind: string,
  toolName: string,
) =>
  content.replace(
    new RegExp(
      `\\n?# narukami-${markerKind}:${toolName}:start[\\s\\S]*?# narukami-${markerKind}:${toolName}:end\\n?`,
      "g",
    ),
    "\n",
  );

export interface RemoveSandboxToolResult {
  readonly containerfilePath?: string;
  readonly envExamplePath?: string;
  readonly changed: boolean;
}

export const removeSandboxToolFromConfig = (
  repoDir: string,
  toolName: string,
): Effect.Effect<RemoveSandboxToolResult, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!getSandboxTool(toolName)) {
      const names = SANDBOX_TOOL_REGISTRY.map((tool) => tool.name).join(", ");
      yield* Effect.fail(
        new Error(`Unknown sandbox tool "${toolName}". Available: ${names}`),
      );
    }

    const fs = yield* FileSystem.FileSystem;
    const configDir = join(repoDir, ".narukami");
    const containerfileCandidates = ["Dockerfile", "Containerfile"].map(
      (file) => join(configDir, file),
    );
    let changed = false;
    let containerfilePath: string | undefined;

    for (const path of containerfileCandidates) {
      const exists = yield* fs
        .exists(path)
        .pipe(Effect.mapError((e) => new Error(e.message)));
      if (!exists) continue;

      const original = yield* fs
        .readFileString(path)
        .pipe(Effect.mapError((e) => new Error(e.message)));
      const updated = removeMarkedBlock(original, "tool", toolName);
      if (updated !== original) {
        yield* fs
          .writeFileString(path, updated)
          .pipe(Effect.mapError((e) => new Error(e.message)));
        changed = true;
        containerfilePath = path;
      }
    }

    const envExamplePath = join(configDir, ".env.example");
    const envExists = yield* fs
      .exists(envExamplePath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    let changedEnvExamplePath: string | undefined;
    if (envExists) {
      const original = yield* fs
        .readFileString(envExamplePath)
        .pipe(Effect.mapError((e) => new Error(e.message)));
      const updated = removeMarkedBlock(original, "env", toolName);
      if (updated !== original) {
        yield* fs
          .writeFileString(envExamplePath, updated)
          .pipe(Effect.mapError((e) => new Error(e.message)));
        changed = true;
        changedEnvExamplePath = envExamplePath;
      }
    }

    return {
      containerfilePath,
      envExamplePath: changedEnvExamplePath,
      changed,
    };
  });

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export function getNextStepsLines(
  template: string,
  mainFilename: string,
): string[] {
  if (template === "blank") {
    return [
      "Next steps:",
      `1. Set the required env vars in .narukami/.env (see .narukami/.env.example)`,
      "   For Codex subscription auth, run `codex login` on the host before starting the sandbox",
      "2. Read and customize .narukami/prompt.md to describe what you want the agent to do",
      `3. Customize .narukami/${mainFilename} — it uses the JS API (\`run()\`) to control how the agent runs`,
      `4. Add "narukami": "npx tsx .narukami/${mainFilename}" to your package.json scripts`,
      "5. Run `npm run narukami` to start the agent",
    ];
  } else {
    const hasReviewer = template.includes("review");
    let step = 1;
    const lines: string[] = [
      "Next steps:",
      `${step++}. Set the required env vars in .narukami/.env (see .narukami/.env.example)`,
      "   For Codex subscription auth, run `codex login` on the host before starting the sandbox",
      `${step++}. Add "narukami": "npx tsx .narukami/${mainFilename}" to your package.json scripts`,
      `${step++}. Templates keep \`copyToWorktree\` empty by default so host node_modules are not copied across platforms; the install hook prepares dependencies inside the sandbox`,
      `${step++}. Read and customize the prompt files in .narukami/ — they shape what the agent does`,
    ];
    if (hasReviewer) {
      lines.push(
        `${step++}. Customize .narukami/CODING_STANDARDS.md with your project's standards — the reviewer agent loads it during review`,
      );
    }
    lines.push(`${step++}. Run \`npm run narukami\` to start the agent`);
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Scaffolding helpers
// ---------------------------------------------------------------------------

function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "templates");
}

const getTemplateDir = (
  templateName: string,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    const template = TEMPLATES.find((t) => t.name === templateName);
    if (!template) {
      const names = TEMPLATES.map((t) => t.name).join(", ");
      yield* Effect.fail(
        new Error(`Unknown template: "${templateName}". Available: ${names}`),
      );
    }
    return join(getTemplatesDir(), templateName);
  });

const COMPILED_FILE_EXTENSIONS = [
  ".js",
  ".js.map",
  ".d.ts",
  ".d.ts.map",
  ".mjs",
  ".mjs.map",
  ".d.mts",
  ".d.mts.map",
];

const copyTemplateFiles = (
  templateDir: string,
  destDir: string,
  mainFilename: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(templateDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    yield* Effect.all(
      files
        .filter(
          (f) =>
            f !== "template.json" &&
            f !== ".env.example" &&
            !COMPILED_FILE_EXTENSIONS.some((ext) => f.endsWith(ext)),
        )
        .map((f) => {
          const destName = f === "main.mts" ? mainFilename : f;
          return fs
            .copyFile(join(templateDir, f), join(destDir, destName))
            .pipe(Effect.mapError((e) => new Error(e.message)));
        }),
      { concurrency: "unbounded" },
    );
  });

/**
 * Replace the agent factory import and call in a scaffolded main.ts.
 *
 * Templates use `codex` as the default factory. When a different agent or
 * model is selected, this function rewrites the import and factory calls.
 */
const rewriteMainTs = (
  configDir: string,
  agent: AgentEntry,
  model: string,
  mainFilename: string,
  packageManager: PackageManagerConfig,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const mainTsPath = join(configDir, mainFilename);

    const exists = yield* fs
      .exists(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (!exists) return;

    let content = yield* fs
      .readFileString(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));

    // Templates use main.mts as the canonical filename in comments.
    // When the target is main.ts, rewrite those references.
    if (mainFilename === "main.ts") {
      content = content.replace(/main\.mts/g, "main.ts");
    }

    content = applyPackageManagerConfig(content, packageManager);

    // Replace factory function name in imports (e.g. codex → claudeCode)
    // and all factory calls with the correct model.
    // Older templates used claudeCode as the placeholder factory, so accept both.
    content = content.replace(/\b(?:claudeCode|codex)\b/g, agent.factoryImport);
    // Replace model strings in factory calls: factoryImport("any-model")
    const factoryCallRe = new RegExp(
      `${agent.factoryImport}\\(["'][^"']+["'](?:\\s*,\\s*\\{[^)]*\\})?\\)`,
      "g",
    );
    const factoryArgs = agent.defaultFactoryOptions
      ? `"${model}", ${agent.defaultFactoryOptions}`
      : `"${model}"`;
    content = content.replace(
      factoryCallRe,
      `${agent.factoryImport}(${factoryArgs})`,
    );

    if (agent.name === "codex") {
      content = content.replace(
        /\bdocker\(\)/g,
        'docker({ mounts: [{ hostPath: "~/.codex", sandboxPath: "~/.codex" }] })',
      );
    }

    yield* fs
      .writeFileString(mainTsPath, content)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

/**
 * When the user opted out of the Narukami Shrine label, strip ` --label Narukami Shrine`
 * from all `.md` files in the scaffolded config directory so that `gh issue list`
 * commands work without a label filter.
 */
const rewritePromptFiles = (
  configDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    yield* Effect.all(
      mdFiles.map((f) =>
        Effect.gen(function* () {
          const filePath = join(configDir, f);
          const content = yield* fs
            .readFileString(filePath)
            .pipe(Effect.mapError((e) => new Error(e.message)));
          const updated = content.replace(/ --label Narukami Shrine/g, "");
          if (updated !== content) {
            yield* fs
              .writeFileString(filePath, updated)
              .pipe(Effect.mapError((e) => new Error(e.message)));
          }
        }),
      ),
      { concurrency: "unbounded" },
    );
  });

/** Text file extensions eligible for `{{KEY}}` template argument substitution. */
const TEXT_FILE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".env",
  ".example",
  // Dockerfile / Containerfile have no extension — handled by name check below
]);

const isTextFile = (filename: string): boolean => {
  if (
    filename === "Dockerfile" ||
    filename === "Containerfile" ||
    filename === ".gitignore"
  )
    return true;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return TEXT_FILE_EXTENSIONS.has(filename.slice(dotIdx));
};

/**
 * Replace `{{KEY}}` template arguments from the issue provider's
 * `templateArgs` map in all text files in the scaffolded config directory.
 */
const substituteTemplateArgs = (
  configDir: string,
  issueProvider: IssueProviderEntry,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    const textFiles = files.filter(isTextFile);
    yield* Effect.all(
      textFiles.map((f) =>
        Effect.gen(function* () {
          const filePath = join(configDir, f);
          let content = yield* fs
            .readFileString(filePath)
            .pipe(Effect.mapError((e) => new Error(e.message)));
          const original = content;
          if (issueProvider.usesShellExpansion === false) {
            content = content.replace(
              /!`\{\{LIST_TASKS_COMMAND\}\}`/g,
              "{{LIST_TASKS_COMMAND}}",
            );
          }
          for (const [key, value] of Object.entries(
            issueProvider.templateArgs,
          )) {
            content = content.replace(
              new RegExp(`\\{\\{${key}\\}\\}`, "g"),
              value,
            );
          }
          if (content !== original) {
            yield* fs
              .writeFileString(filePath, content)
              .pipe(Effect.mapError((e) => new Error(e.message)));
          }
        }),
      ),
      { concurrency: "unbounded" },
    );
  });

// ---------------------------------------------------------------------------
// Main scaffold function
// ---------------------------------------------------------------------------

export interface ScaffoldOptions {
  agent: AgentEntry;
  model: string;
  templateName?: string;
  createLabel?: boolean;
  issueProvider?: IssueProviderEntry;
  sandboxProvider?: SandboxProviderEntry;
  sandboxTools?: ReadonlyArray<SandboxToolEntry>;
  sonarHostUrl?: string;
  reviewBackend?: ReviewBackend;
}

export interface ScaffoldResult {
  mainFilename: string;
}

export type ReviewBackend = "codex-review" | "prompt";

const templateHasReview = (templateName: string): boolean =>
  templateName === "sequential-reviewer" ||
  templateName === "parallel-planner-with-review";

const renderContainerfile = (
  agent: AgentEntry,
  packageManager: PackageManagerConfig,
  sandboxTools: ReadonlyArray<SandboxToolEntry>,
): string => {
  const packageAndSandboxTools = [
    packageManager.dockerfileTools,
    ...sandboxTools.map((tool) => tool.containerfileTools),
  ]
    .filter((block) => block.trim().length > 0)
    .join("\n\n");

  return agent.dockerfileTemplate.replace(
    "{{PACKAGE_MANAGER_TOOLS}}",
    packageAndSandboxTools,
  );
};

/**
 * Detect whether the project's package.json has `"type": "module"`.
 * If so, we can use plain `.ts`; otherwise we use `.mts` to ensure ESM.
 */
const detectMainFilename = (
  repoDir: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pkgPath = join(repoDir, "package.json");
    const exists = yield* fs
      .exists(pkgPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) return "main.mts";
    const content = yield* fs
      .readFileString(pkgPath)
      .pipe(Effect.orElseSucceed(() => ""));
    try {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      return pkg["type"] === "module" ? "main.ts" : "main.mts";
    } catch {
      return "main.mts";
    }
  });

const detectPackageManager = (
  repoDir: string,
): Effect.Effect<PackageManagerConfig, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = (path: string) =>
      fs.exists(join(repoDir, path)).pipe(Effect.orElseSucceed(() => false));
    const packageJson = yield* fs
      .readFileString(join(repoDir, "package.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    let packageManager: string | undefined;
    try {
      const parsed = JSON.parse(packageJson) as { packageManager?: unknown };
      if (typeof parsed.packageManager === "string") {
        packageManager = parsed.packageManager;
      }
    } catch {
      // Ignore malformed package.json and fall back to lockfile detection.
    }

    const hasPnpmLock = yield* exists("pnpm-lock.yaml");
    const hasYarnLock = yield* exists("yarn.lock");
    const hasPackageLock = yield* exists("package-lock.json");

    if (packageManager?.startsWith("pnpm@") || hasPnpmLock) {
      const version = packageManager?.match(/^pnpm@([^+\s]+)/)?.[1];
      const pnpmPackage = version ? `pnpm@${version}` : "pnpm";
      return {
        installCommand: "pnpm install --config.confirmModulesPurge=false",
        installCommandLabel: "pnpm install",
        installTimeoutMs: 600_000,
        dockerfileTools: `# Install pnpm globally for non-interactive sandbox hooks
RUN npm install -g ${pnpmPackage}`,
      };
    }

    if (packageManager?.startsWith("yarn@") || hasYarnLock) {
      return {
        installCommand: "yarn install",
        installCommandLabel: "yarn install",
        installTimeoutMs: 600_000,
        dockerfileTools: `# Enable Yarn via Corepack
RUN corepack enable`,
      };
    }

    if (packageManager?.startsWith("npm@") || hasPackageLock) {
      return {
        installCommand: "npm install",
        installCommandLabel: "npm install",
        installTimeoutMs: 600_000,
        dockerfileTools: "",
      };
    }

    return {
      installCommand: "npm install",
      installCommandLabel: "npm install",
      installTimeoutMs: 600_000,
      dockerfileTools: "",
    };
  });

const applyPackageManagerConfig = (
  content: string,
  packageManager: PackageManagerConfig,
): string =>
  content
    .replace(
      /onSandboxReady: \[\{ command: "npm install" \}\]/g,
      `onSandboxReady: [{ command: "${packageManager.installCommand}", timeoutMs: ${packageManager.installTimeoutMs} }]`,
    )
    .replace(
      /npm install ensures/g,
      `${packageManager.installCommandLabel} ensures`,
    );

const agentFactoryCall = (agent: AgentEntry, model: string): string => {
  const factoryArgs = agent.defaultFactoryOptions
    ? `"${model}", ${agent.defaultFactoryOptions}`
    : `"${model}"`;
  return `narukami.${agent.factoryImport}(${factoryArgs})`;
};

const rewriteReviewBackend = (
  configDir: string,
  agent: AgentEntry,
  model: string,
  mainFilename: string,
  reviewBackend: ReviewBackend,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const mainTsPath = join(configDir, mainFilename);
    const exists = yield* fs
      .exists(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (!exists) return;

    let content = yield* fs
      .readFileString(mainTsPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));

    if (reviewBackend === "codex-review") {
      content = content.replace(
        /const reviewPromptFile: string \| undefined = undefined;/,
        "const reviewPromptFile: string | undefined = undefined;",
      );
      content = content.replace(
        /agent: narukami\.codexReview\([\s\S]*?\n\s+\}\),/g,
        `agent: narukami.codexReview("${model}", {
      effort: "low",
      base: reviewBase,
    }),`,
      );
    } else {
      content = content.replace(
        /const reviewPromptFile: string \| undefined = undefined;/,
        'const reviewPromptFile: string | undefined = "./.narukami/review-prompt.md";',
      );
      content = content.replace(
        /agent: narukami\.codexReview\([\s\S]*?\n\s+\}\),/g,
        `agent: ${agentFactoryCall(agent, model)},`,
      );
    }

    yield* fs
      .writeFileString(mainTsPath, content)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });

export const scaffold = (
  repoDir: string,
  options: ScaffoldOptions,
): Effect.Effect<ScaffoldResult, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const {
      agent,
      model,
      templateName = "blank",
      createLabel = true,
      issueProvider = ISSUE_PROVIDER_REGISTRY[0]!, // default: linear
      sandboxProvider = SANDBOX_PROVIDER_REGISTRY[0]!, // default: docker
      sandboxTools = [],
      sonarHostUrl,
      reviewBackend = agent.name === "codex" ? "codex-review" : "prompt",
    } = options;
    const fs = yield* FileSystem.FileSystem;
    const configDir = join(repoDir, ".narukami");

    const exists = yield* fs
      .exists(configDir)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (exists) {
      yield* Effect.fail(
        new Error(
          ".narukami/ directory already exists. Remove it first if you want to re-initialize.",
        ),
      );
    }

    const mainFilename = yield* detectMainFilename(repoDir);
    const packageManager = yield* detectPackageManager(repoDir);

    yield* fs
      .makeDirectory(configDir, { recursive: false })
      .pipe(Effect.mapError((e) => new Error(e.message)));

    const templateDir = yield* getTemplateDir(templateName);

    // Build .env.example from agent + issue provider + optional sandbox tool env blocks
    const envExampleParts = [agent.envExample];
    if (issueProvider.envExample) {
      envExampleParts.push(issueProvider.envExample);
    }
    for (const tool of sandboxTools) {
      const envExample = tool.envExample({ sonarHostUrl });
      if (envExample) envExampleParts.push(envExample);
    }
    const envExampleContent = envExampleParts.join("\n") + "\n";

    yield* Effect.all(
      [
        fs
          .writeFileString(
            join(configDir, sandboxProvider.containerfileName),
            renderContainerfile(agent, packageManager, sandboxTools),
          )
          .pipe(Effect.mapError((e) => new Error(e.message))),
        fs
          .writeFileString(join(configDir, ".gitignore"), GITIGNORE)
          .pipe(Effect.mapError((e) => new Error(e.message))),
        fs
          .writeFileString(join(configDir, ".env.example"), envExampleContent)
          .pipe(Effect.mapError((e) => new Error(e.message))),
        copyTemplateFiles(templateDir, configDir, mainFilename),
      ],
      { concurrency: "unbounded" },
    );

    // Rewrite main file with the selected agent factory and model
    yield* rewriteMainTs(configDir, agent, model, mainFilename, packageManager);

    if (templateHasReview(templateName)) {
      yield* rewriteReviewBackend(
        configDir,
        agent,
        model,
        mainFilename,
        reviewBackend,
      );
    }

    // Replace issue provider template arguments in all text files (must run before label stripping)
    yield* substituteTemplateArgs(configDir, issueProvider);

    // Strip --label Narukami Shrine from prompt files when the user declined label creation
    if (!createLabel) {
      yield* rewritePromptFiles(configDir);
    }

    return { mainFilename };
  });
