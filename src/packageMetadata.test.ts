import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("publishes Narukami CLI bins without the upstream sandcastle alias", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf-8"),
    ) as {
      name: string;
      bin?: Record<string, string>;
      files?: string[];
    };

    expect(packageJson.name).toBe("@yae-tools/narukami-shrine");
    expect(packageJson.bin).toEqual({
      narukami: "dist/main.js",
      "narukami-shrine": "dist/main.js",
    });
    expect(packageJson.bin).not.toHaveProperty("sandcastle");
    expect(packageJson.files).toEqual(["dist"]);
  });
});
