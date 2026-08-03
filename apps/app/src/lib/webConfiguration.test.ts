import { describe, expect, it } from "vitest";
import { resolveWebOrigin } from "./webConfiguration";

describe("hosted web origin", () => {
  it("accepts a GitHub Pages project URL and keeps its subpath", () => {
    expect(resolveWebOrigin("https://sweetcornna.github.io/AA/")).toEqual({
      origin: "https://sweetcornna.github.io/AA/",
      error: null,
    });
  });

  it("normalizes a missing trailing slash and surrounding whitespace", () => {
    expect(resolveWebOrigin("  https://sweetcornna.github.io/AA  ").origin).toBe(
      "https://sweetcornna.github.io/AA/",
    );
    expect(resolveWebOrigin("https://sweetcornna.github.io").origin).toBe(
      "https://sweetcornna.github.io/",
    );
  });

  it("treats an unset value as a build without a hosted counterpart", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(resolveWebOrigin(value)).toEqual({ origin: null, error: null });
    }
  });

  it.each([
    ["not a URL", "sweetcornna.github.io/AA/"],
    ["plain http", "http://sweetcornna.github.io/AA/"],
    ["credentials", "https://user:pass@sweetcornna.github.io/AA/"],
    ["query string", "https://sweetcornna.github.io/AA/?ref=1"],
    ["fragment", "https://sweetcornna.github.io/AA/#/join"],
    ["placeholder", "https://your-name.github.io/AA/"],
  ])("rejects %s", (_label, value) => {
    const result = resolveWebOrigin(value);
    expect(result.origin).toBe(null);
    expect(result.error).toBeTruthy();
  });
});
