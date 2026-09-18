import { describe, expect, it } from "vitest";
import { signReporterSession, verifyReporterSession } from "./reporter";

const reporterId = "d4ae9141-5119-4db0-a870-861914a9e88b";

describe("signed Reporter session", () => {
  it("recognises the Reporter id only when the signature is intact", () => {
    const cookie = signReporterSession(reporterId);
    expect(verifyReporterSession(cookie)).toBe(reporterId);
    expect(verifyReporterSession(reporterId)).toBeNull();
    expect(verifyReporterSession(cookie.replace("d4ae", "d4af"))).toBeNull();
    expect(verifyReporterSession(`${cookie}.extra`)).toBeNull();
  });
});
