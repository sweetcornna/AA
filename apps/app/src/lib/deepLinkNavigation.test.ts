import { describe, expect, it } from "vitest";
import { firstNewInvitePath } from "./deepLinkNavigation";

const FIRST = "AbCdEf0123456789_-xyZWvu";
const SECOND = "ZyxWvu9876543210_-AbCdEf";

describe("deep-link navigation deduplication", () => {
  it("selects the first valid cold-start or warm-event URL", () => {
    expect(firstNewInvitePath(["invalid", `aa://join?token=${FIRST}`], "/")).toBe(
      `/join?token=${FIRST}`,
    );
  });

  it("does not renavigate from a stale getCurrent value after the event was handled", () => {
    const firstPath = `/join?token=${FIRST}`;
    const startupEventPaths = new Set([firstPath]);

    expect(firstNewInvitePath([`aa://join?token=${FIRST}`], firstPath)).toBeNull();
    expect(firstNewInvitePath([`aa://join?token=${FIRST}`], "/", startupEventPaths)).toBeNull();
  });

  it("allows the same invitation to retry after startup deduplication ends", () => {
    const firstPath = `/join?token=${FIRST}`;
    const startupEventPaths = new Set([firstPath]);
    startupEventPaths.clear();

    expect(firstNewInvitePath([`aa://join?token=${FIRST}`], "/", startupEventPaths)).toBe(firstPath);
  });

  it("allows a different invitation after a duplicate", () => {
    expect(
      firstNewInvitePath(
        [`aa://join?token=${FIRST}`, `aa://join?token=${SECOND}`],
        "/",
        new Set([`/join?token=${FIRST}`]),
      ),
    ).toBe(`/join?token=${SECOND}`);
  });
});
