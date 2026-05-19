#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { styleText } from "node:util";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const args = new Set(process.argv.slice(2));
const getArg = (name) => {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const githubOnly = args.has("--github-only");
const dryRun = args.has("--dry-run");
const explicitRepo = getArg("--repo");

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    if (options.allowFailure) return result;
    const rendered = [command, ...commandArgs].join(" ");
    throw new Error(`Command failed (${result.status}): ${rendered}`);
  }

  return result;
};

const output = (command, commandArgs, options = {}) =>
  run(command, commandArgs, { ...options, capture: true }).stdout.trim();

const info = (message) => {
  console.log(styleText("cyan", `\n${message}`));
};

const packageName = packageJson.name;
const version = packageJson.version;
const tag = `v${version}`;
const npmPackageUrl = `https://www.npmjs.com/package/${packageName}/v/${version}`;

const parseRepoSlug = (remoteUrl) => {
  const cleaned = remoteUrl.trim().replace(/\.git$/, "");
  const sshMatch = cleaned.match(/github\.com[:/]([^/]+\/[^/]+)$/);
  if (sshMatch) return sshMatch[1];
  try {
    const url = new URL(cleaned);
    if (url.hostname === "github.com") {
      return url.pathname.replace(/^\//, "");
    }
  } catch {
    // Fall through to a clearer error below.
  }
  throw new Error(`Could not infer GitHub repo from remote URL: ${remoteUrl}`);
};

const repoSlug =
  explicitRepo ?? parseRepoSlug(output("git", ["remote", "get-url", "origin"]));

const ensureCleanTree = () => {
  const status = output("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "Working tree is not clean. Commit or stash changes before publishing.\n\n" +
        status,
    );
  }
};

const npmVersionExists = () => {
  const result = run(
    "npm",
    [
      "view",
      `${packageName}@${version}`,
      "version",
      "--registry=https://registry.npmjs.org/",
    ],
    { capture: true, allowFailure: true },
  );
  return result.status === 0;
};

const ensureTag = () => {
  const head = output("git", ["rev-parse", "HEAD"]);
  const tagResult = run("git", ["rev-parse", tag], {
    capture: true,
    allowFailure: true,
  });

  if (tagResult.status === 0) {
    const taggedCommit = tagResult.stdout.trim();
    if (taggedCommit !== head) {
      throw new Error(
        `${tag} already exists at ${taggedCommit}, but HEAD is ${head}.`,
      );
    }
    return;
  }

  run("git", ["tag", "-a", tag, "-m", `${packageName} ${version}`]);
};

const releaseNotes = () => `# ${packageName} ${version}

## npm

- Package: [${packageName}@${version}](${npmPackageUrl})
- Install: \`npm install --save-dev ${packageName}@${version}\`
- pnpm: \`pnpm add -D ${packageName}@${version}\`
- CLI: \`pnpm exec factory --version\`

## Verification

This release was prepared from tag \`${tag}\`.
`;

const createOrUpdateGithubRelease = async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "factory-release-"));
  const notesPath = path.join(tempDir, "release-notes.md");

  try {
    await writeFile(notesPath, releaseNotes(), "utf8");
    const view = run("gh", ["release", "view", tag, "--repo", repoSlug], {
      capture: true,
      allowFailure: true,
    });

    if (view.status === 0) {
      run("gh", [
        "release",
        "edit",
        tag,
        "--repo",
        repoSlug,
        "--title",
        tag,
        "--notes-file",
        notesPath,
      ]);
    } else {
      run("gh", [
        "release",
        "create",
        tag,
        "--repo",
        repoSlug,
        "--title",
        tag,
        "--notes-file",
        notesPath,
      ]);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

if (!version) {
  throw new Error("package.json does not contain a version.");
}

info(`Preparing ${packageName}@${version}`);
if (!githubOnly) {
  run("npm", ["whoami"], { capture: true });
}
run("gh", ["auth", "status"], { capture: true });

if (!githubOnly) {
  ensureCleanTree();

  info("Running release checks");
  run("npm", ["run", "format:check"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["test"]);
  run("npm", ["run", "build"]);
  run("npm", ["pack", "--dry-run"]);

  if (npmVersionExists()) {
    info(`${packageName}@${version} already exists on npm; skipping publish`);
  } else if (dryRun) {
    info(`[dry-run] Would publish ${packageName}@${version}`);
  } else {
    info(`Publishing ${packageName}@${version} to npm`);
    run("npm", ["publish", "--access", "public"]);
  }

  if (!dryRun) {
    info(`Ensuring ${tag} exists and is pushed`);
    ensureTag();
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", tag]);
  }
}

if (!dryRun) {
  info(`Creating or updating GitHub Release ${tag}`);
  await createOrUpdateGithubRelease();
}

info(`Release ready: ${npmPackageUrl}`);
