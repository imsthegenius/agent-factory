import { Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as clack from "@clack/prompts";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { styleText } from "node:util";

import { Display } from "./Display.js";
import { buildImage, removeImage } from "./DockerLifecycle.js";
import {
  buildImage as podmanBuildImage,
  removeImage as podmanRemoveImage,
} from "./PodmanLifecycle.js";
import {
  scaffold,
  listTemplates,
  listAgents,
  getAgent,
  listIssueProviders,
  getIssueProvider,
  listSandboxProviders,
  getSandboxProvider,
  listSandboxTools,
  getSandboxTool,
  removeSandboxToolFromConfig,
  getNextStepsLines,
} from "./InitService.js";
import { defaultImageName } from "./sandboxes/docker.js";
import type {
  AgentEntry,
  IssueProviderEntry,
  ReviewBackend,
  SandboxProviderEntry,
  SandboxToolEntry,
} from "./InitService.js";
import { ConfigDirError, InitError } from "./errors.js";

const require = createRequire(import.meta.url);
const VERSION = (require("../package.json") as { version: string }).version;

// --- Shared options ---

const imageNameOption = Options.text("image-name").pipe(
  Options.withDescription("Docker image name"),
  Options.optional,
);

const resolveImageName = (
  cliFlag: import("effect").Option.Option<string>,
  cwd: string,
): string => (cliFlag._tag === "Some" ? cliFlag.value : defaultImageName(cwd));

// --- UID build-args ---

/** Build-args that align the image UID/GID to the host (Linux/macOS). No-op on Windows. */
const defaultUidBuildArgs = (): Record<string, string> => {
  const args: Record<string, string> = {};
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid !== undefined) args.AGENT_UID = String(uid);
  if (gid !== undefined) args.AGENT_GID = String(gid);
  return args;
};

// --- Config directory check ---

const CONFIG_DIR = ".narukami";

const requireConfigDir = (
  cwd: string,
): Effect.Effect<void, ConfigDirError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs
      .exists(join(cwd, CONFIG_DIR))
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!exists) {
      yield* Effect.fail(
        new ConfigDirError({
          message: "No .narukami/ found. Run `narukami init` first.",
        }),
      );
    }
  });

const runScaffoldEntrypoint = (
  entrypoint: string,
  cwd: string,
): Effect.Effect<void, InitError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("npx", ["--yes", "tsx", entrypoint], {
          cwd,
          stdio: "inherit",
          shell: process.platform === "win32",
        });

        child.on("error", (error) => {
          reject(error);
        });
        child.on("exit", (code, signal) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                signal
                  ? `Narukami entrypoint was terminated by ${signal}.`
                  : `Narukami entrypoint exited with code ${code ?? "unknown"}.`,
              ),
            );
          }
        });
      }),
    catch: (error) =>
      new InitError({
        message: `Failed to run ${entrypoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
  });

// --- Init command ---

const templateOption = Options.text("template").pipe(
  Options.withDescription(
    "Template to scaffold (e.g. blank, simple-loop, parallel-planner)",
  ),
  Options.optional,
);

const agentOption = Options.text("agent").pipe(
  Options.withDescription("Agent to use (e.g. codex)"),
  Options.optional,
);

const initModelOption = Options.text("model").pipe(
  Options.withDescription(
    "Model to use for the agent (e.g. gpt-5.5). Defaults to the agent's default model",
  ),
  Options.optional,
);

const initToolsOption = Options.text("tools").pipe(
  Options.withDescription(
    "Comma-separated optional sandbox tools to install (e.g. sonar-scanner)",
  ),
  Options.optional,
);

const sonarHostUrlOption = Options.text("sonar-host-url").pipe(
  Options.withDescription(
    "Prefill SONAR_HOST_URL in .narukami/.env.example when using --tools sonar-scanner",
  ),
  Options.optional,
);

const initCommand = Command.make(
  "init",
  {
    imageName: imageNameOption,
    template: templateOption,
    agent: agentOption,
    model: initModelOption,
    tools: initToolsOption,
    sonarHostUrl: sonarHostUrlOption,
  },
  ({
    imageName: imageNameFlag,
    template,
    agent: agentFlag,
    model: modelFlag,
    tools: toolsFlag,
    sonarHostUrl: sonarHostUrlFlag,
  }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();
      const imageName = resolveImageName(imageNameFlag, cwd);

      // Early validation of CLI flags before interactive prompts
      const templates = listTemplates();
      if (template._tag === "Some") {
        const valid = templates.find((tmpl) => tmpl.name === template.value);
        if (!valid) {
          const names = templates.map((tmpl) => tmpl.name).join(", ");
          yield* Effect.fail(
            new InitError({
              message: `Unknown template "${template.value}". Available: ${names}`,
            }),
          );
        }
      }

      // Resolve agent: CLI flag > interactive select
      const agents = listAgents();
      let selectedAgent: AgentEntry;
      if (agentFlag._tag === "Some") {
        const entry = getAgent(agentFlag.value);
        if (!entry) {
          const names = agents.map((a) => a.name).join(", ");
          yield* Effect.fail(
            new InitError({
              message: `Unknown agent "${agentFlag.value}". Available: ${names}`,
            }),
          );
        }
        selectedAgent = entry!;
      } else {
        const selected = yield* Effect.promise(() =>
          clack.select({
            message: "Select an agent:",
            initialValue: "codex",
            options: agents.map((a) => ({
              value: a.name,
              label: a.label,
              hint:
                a.name === "codex"
                  ? `Default model: ${a.defaultModel} / low reasoning; uses ChatGPT subscription auth`
                  : `Default model: ${a.defaultModel}`,
            })),
          }),
        );
        if (clack.isCancel(selected)) {
          yield* Effect.fail(
            new InitError({ message: "Agent selection cancelled." }),
          );
        }
        selectedAgent = getAgent(selected as string)!;
      }

      // Resolve model: CLI flag > agent default
      const selectedModel =
        modelFlag._tag === "Some"
          ? modelFlag.value
          : selectedAgent.defaultModel;

      // Resolve sandbox provider: interactive select (no default — user must choose)
      const sandboxProviders = listSandboxProviders();
      let selectedSandboxProvider: SandboxProviderEntry;
      {
        const selected = yield* Effect.promise(() =>
          clack.select({
            message: "Select a sandbox provider:",
            options: sandboxProviders.map((p) => ({
              value: p.name,
              label: p.label,
            })),
          }),
        );
        if (clack.isCancel(selected)) {
          yield* Effect.fail(
            new InitError({
              message: "Sandbox provider selection cancelled.",
            }),
          );
        }
        selectedSandboxProvider = getSandboxProvider(selected as string)!;
      }

      const optionalTools = listSandboxTools();
      let selectedSandboxTools: SandboxToolEntry[] = [];
      if (toolsFlag._tag === "Some") {
        const requestedToolNames = toolsFlag.value
          .split(",")
          .map((tool) => tool.trim())
          .filter((tool) => tool.length > 0);
        for (const toolName of requestedToolNames) {
          const tool = getSandboxTool(toolName);
          if (!tool) {
            const names = optionalTools.map((t) => t.name).join(", ");
            yield* Effect.fail(
              new InitError({
                message: `Unknown sandbox tool "${toolName}". Available: ${names}`,
              }),
            );
          } else {
            selectedSandboxTools.push(tool);
          }
        }
      } else {
        const sonarTool = getSandboxTool("sonar-scanner")!;
        const shouldInstallSonar = yield* Effect.promise(() =>
          clack.confirm({
            message:
              "Install SonarScanner CLI in the sandbox image? (Useful if repo quality gates run sonar-scanner)",
            initialValue: false,
          }),
        );
        if (clack.isCancel(shouldInstallSonar)) {
          yield* Effect.fail(
            new InitError({ message: "Optional tool selection cancelled." }),
          );
        }
        if (shouldInstallSonar === true) {
          selectedSandboxTools = [sonarTool];
        }
      }

      let sonarHostUrl =
        sonarHostUrlFlag._tag === "Some" ? sonarHostUrlFlag.value : undefined;
      if (
        selectedSandboxTools.some((tool) => tool.name === "sonar-scanner") &&
        sonarHostUrl === undefined
      ) {
        const entered = yield* Effect.promise(() =>
          clack.text({
            message:
              "Sonar host URL for .narukami/.env.example (leave blank to fill later):",
            placeholder: "http://host.docker.internal:9000",
          }),
        );
        if (clack.isCancel(entered)) {
          yield* Effect.fail(
            new InitError({ message: "Sonar host URL entry cancelled." }),
          );
        }
        const trimmed = String(entered).trim();
        sonarHostUrl = trimmed.length > 0 ? trimmed : undefined;
      }

      // Resolve issue provider: interactive select
      const issueProviders = listIssueProviders();
      let selectedIssueProvider: IssueProviderEntry;
      {
        const selected = yield* Effect.promise(() =>
          clack.select({
            message: "Select an issue provider:",
            initialValue: "linear",
            options: issueProviders.map((b) => ({
              value: b.name,
              label: b.label,
              hint: b.hint,
            })),
          }),
        );
        if (clack.isCancel(selected)) {
          yield* Effect.fail(
            new InitError({
              message: "Issue provider selection cancelled.",
            }),
          );
        }
        selectedIssueProvider = getIssueProvider(selected as string)!;
      }

      // Resolve template: CLI flag > interactive select (already validated above)
      let selectedTemplate: string;
      if (template._tag === "Some") {
        selectedTemplate = template.value;
      } else {
        const selected = yield* Effect.promise(() =>
          clack.select({
            message: "Select a template:",
            initialValue: "blank",
            options: templates.map((tmpl) => ({
              value: tmpl.name,
              label: tmpl.name,
              hint: tmpl.description,
            })),
          }),
        );
        if (clack.isCancel(selected)) {
          yield* Effect.fail(
            new InitError({ message: "Template selection cancelled." }),
          );
        }
        selectedTemplate = selected as string;
      }

      let reviewBackend: ReviewBackend | undefined;
      const templateHasReview =
        selectedTemplate === "sequential-reviewer" ||
        selectedTemplate === "parallel-planner-with-review";
      if (templateHasReview) {
        if (selectedAgent.name === "codex") {
          const selected = yield* Effect.promise(() =>
            clack.select({
              message: "Select a review backend:",
              initialValue: "codex-review",
              options: [
                {
                  value: "codex-review",
                  label: "Codex built-in review",
                  hint: "Uses `codex review`; review-prompt.md remains available for custom instructions",
                },
                {
                  value: "prompt",
                  label: "Prompt-based review",
                  hint: "Uses .narukami/review-prompt.md with the selected agent",
                },
              ],
            }),
          );
          if (clack.isCancel(selected)) {
            yield* Effect.fail(
              new InitError({ message: "Review backend selection cancelled." }),
            );
          }
          reviewBackend = selected as ReviewBackend;
        } else {
          reviewBackend = "prompt";
        }
      }

      // Offer to create the "Narukami Shrine" label on the repo (skip for non-GitHub issue providers)
      let shouldCreateLabel: boolean | symbol = false;
      if (selectedIssueProvider.name === "github-issues") {
        shouldCreateLabel = yield* Effect.promise(() =>
          clack.confirm({
            message:
              'Create a "Narukami Shrine" GitHub label? (Templates filter issues by this label)',
            initialValue: true,
          }),
        );

        if (shouldCreateLabel === true) {
          yield* Effect.try({
            try: () =>
              execSync(
                'gh label create "Narukami Shrine" --description "Issues for Narukami Shrine to work on" --color "F9A825" 2>/dev/null',
                { cwd, stdio: "ignore" },
              ),
            catch: () => undefined,
          }).pipe(Effect.ignore);
        }
      }

      const scaffoldResult = yield* d.spinner(
        "Scaffolding .narukami/ config directory...",
        scaffold(cwd, {
          agent: selectedAgent,
          model: selectedModel,
          templateName: selectedTemplate,
          createLabel: shouldCreateLabel === true,
          issueProvider: selectedIssueProvider,
          sandboxProvider: selectedSandboxProvider,
          sandboxTools: selectedSandboxTools,
          sonarHostUrl,
          reviewBackend,
        }).pipe(
          Effect.mapError(
            (e) =>
              new InitError({
                message: `${e instanceof Error ? e.message : e}`,
              }),
          ),
        ),
      );

      // Prompt user before building image
      const providerLabel = selectedSandboxProvider.label;
      const shouldBuild = yield* Effect.promise(() =>
        clack.confirm({
          message: `Build the default ${providerLabel} image now?`,
          initialValue: true,
        }),
      );

      if (shouldBuild === true) {
        const containerfileDir = join(cwd, CONFIG_DIR);
        if (selectedSandboxProvider.name === "podman") {
          yield* d.spinner(
            `Building ${providerLabel} image '${imageName}'...`,
            podmanBuildImage(imageName, containerfileDir),
          );
        } else {
          yield* d.spinner(
            `Building ${providerLabel} image '${imageName}'...`,
            buildImage(imageName, containerfileDir, {
              buildArgs: defaultUidBuildArgs(),
            }),
          );
        }
        yield* d.status("Init complete! Image built successfully.", "success");
      } else {
        yield* d.status(
          `Init complete! Run \`narukami ${selectedSandboxProvider.cliNamespace} build-image\` to build the ${providerLabel} image later.`,
          "success",
        );
      }

      // Show template-specific next steps
      const nextSteps = getNextStepsLines(
        selectedTemplate,
        scaffoldResult.mainFilename,
      );
      for (const [i, line] of nextSteps.entries()) {
        yield* d.text(i === 0 ? line : styleText("dim", line));
      }
    }),
);

// --- Build-image command ---

const dockerfileOption = Options.file("dockerfile").pipe(
  Options.withDescription(
    "Path to a custom Dockerfile (build context will be the current working directory)",
  ),
  Options.optional,
);

const buildImageCommand = Command.make(
  "build-image",
  {
    imageName: imageNameOption,
    dockerfile: dockerfileOption,
  },
  ({ imageName: imageNameFlag, dockerfile }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();
      yield* requireConfigDir(cwd);

      const imageName = resolveImageName(imageNameFlag, cwd);

      const dockerfileDir = join(cwd, CONFIG_DIR);
      const dockerfilePath =
        dockerfile._tag === "Some" ? dockerfile.value : undefined;

      yield* d.spinner(
        `Building Docker image '${imageName}'...`,
        buildImage(imageName, dockerfileDir, {
          dockerfile: dockerfilePath,
          buildArgs: defaultUidBuildArgs(),
        }),
      );

      yield* d.status("Build complete!", "success");
    }),
);

// --- Remove-image command ---

const removeImageCommand = Command.make(
  "remove-image",
  {
    imageName: imageNameOption,
  },
  ({ imageName: imageNameFlag }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();

      const imageName = resolveImageName(imageNameFlag, cwd);

      yield* d.spinner(
        `Removing Docker image '${imageName}'...`,
        removeImage(imageName),
      );
      yield* d.status("Image removed.", "success");
    }),
);

// --- Docker namespace command ---

const dockerCommand = Command.make("docker", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display;
    yield* d.status(
      "Docker sandbox commands. Use --help to see available subcommands.",
      "info",
    );
  }),
).pipe(Command.withSubcommands([buildImageCommand, removeImageCommand]));

// --- Podman build-image command ---

const containerfileOption = Options.file("containerfile").pipe(
  Options.withDescription(
    "Path to a custom Containerfile (build context will be the current working directory)",
  ),
  Options.optional,
);

const podmanBuildImageCommand = Command.make(
  "build-image",
  {
    imageName: imageNameOption,
    containerfile: containerfileOption,
  },
  ({ imageName: imageNameFlag, containerfile }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();
      yield* requireConfigDir(cwd);

      const imageName = resolveImageName(imageNameFlag, cwd);

      const containerfileDir = join(cwd, CONFIG_DIR);
      const containerfilePath =
        containerfile._tag === "Some" ? containerfile.value : undefined;
      yield* d.spinner(
        `Building Podman image '${imageName}'...`,
        podmanBuildImage(imageName, containerfileDir, {
          containerfile: containerfilePath,
        }),
      );

      yield* d.status("Build complete!", "success");
    }),
);

// --- Podman remove-image command ---

const podmanRemoveImageCommand = Command.make(
  "remove-image",
  {
    imageName: imageNameOption,
  },
  ({ imageName: imageNameFlag }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();

      const imageName = resolveImageName(imageNameFlag, cwd);

      yield* d.spinner(
        `Removing Podman image '${imageName}'...`,
        podmanRemoveImage(imageName),
      );
      yield* d.status("Image removed.", "success");
    }),
);

// --- Podman namespace command ---

const podmanCommand = Command.make("podman", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display;
    yield* d.status(
      "Podman sandbox commands. Use --help to see available subcommands.",
      "info",
    );
  }),
).pipe(
  Command.withSubcommands([podmanBuildImageCommand, podmanRemoveImageCommand]),
);

// --- Optional sandbox tools namespace ---

const toolNameOption = Options.text("tool").pipe(
  Options.withDescription("Optional sandbox tool name (e.g. sonar-scanner)"),
);

const rebuildOption = Options.boolean("rebuild").pipe(
  Options.withDescription(
    "Rebuild the detected Docker/Podman image after editing .narukami/",
  ),
);

const removeToolCommand = Command.make(
  "remove",
  {
    imageName: imageNameOption,
    tool: toolNameOption,
    rebuild: rebuildOption,
  },
  ({ imageName: imageNameFlag, tool, rebuild }) =>
    Effect.gen(function* () {
      const d = yield* Display;
      const cwd = process.cwd();
      yield* requireConfigDir(cwd);

      const result = yield* d.spinner(
        `Removing optional sandbox tool '${tool}' from .narukami/...`,
        removeSandboxToolFromConfig(cwd, tool).pipe(
          Effect.mapError(
            (e) =>
              new InitError({
                message: `${e instanceof Error ? e.message : e}`,
              }),
          ),
        ),
      );

      if (!result.changed) {
        yield* d.status(`No '${tool}' blocks found in .narukami/.`, "info");
        return;
      }

      yield* d.status(`Removed '${tool}' from .narukami/.`, "success");

      if (rebuild) {
        const imageName = resolveImageName(imageNameFlag, cwd);
        const containerfileDir = join(cwd, CONFIG_DIR);
        const fs = yield* FileSystem.FileSystem;
        const hasContainerfile = yield* fs
          .exists(join(containerfileDir, "Containerfile"))
          .pipe(Effect.catchAll(() => Effect.succeed(false)));

        if (hasContainerfile) {
          yield* d.spinner(
            `Rebuilding Podman image '${imageName}'...`,
            podmanBuildImage(imageName, containerfileDir),
          );
        } else {
          yield* d.spinner(
            `Rebuilding Docker image '${imageName}'...`,
            buildImage(imageName, containerfileDir),
          );
        }
      }
    }),
);

const toolsCommand = Command.make("tools", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display;
    yield* d.status(
      "Optional sandbox tool commands. Use --help to see available subcommands.",
      "info",
    );
  }),
).pipe(Command.withSubcommands([removeToolCommand]));

// --- Root command ---

const rootCommand = Command.make("narukami", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display;
    const fs = yield* FileSystem.FileSystem;
    const cwd = process.cwd();
    const mainTs = join(cwd, CONFIG_DIR, "main.ts");
    const mainMts = join(cwd, CONFIG_DIR, "main.mts");

    const hasMainTs = yield* fs
      .exists(mainTs)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (hasMainTs) {
      yield* runScaffoldEntrypoint("./.narukami/main.ts", cwd);
      return;
    }

    const hasMainMts = yield* fs
      .exists(mainMts)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (hasMainMts) {
      yield* runScaffoldEntrypoint("./.narukami/main.mts", cwd);
      return;
    }

    yield* d.status(`Narukami Shrine v${VERSION}`, "info");
    yield* d.status("Use --help to see available commands.", "info");
  }),
);

export const narukami = rootCommand.pipe(
  Command.withSubcommands([
    initCommand,
    dockerCommand,
    podmanCommand,
    toolsCommand,
  ]),
);

export const cli = Command.run(narukami, {
  name: "narukami",
  version: VERSION,
});
