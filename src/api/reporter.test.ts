import { describe, expect, it, vi } from "vitest";
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

  it("uses the same development fallback across separately evaluated modules", async () => {
    const originalSecret = process.env.REPORTER_SESSION_SECRET;
    delete process.env.REPORTER_SESSION_SECRET;
    try {
      vi.resetModules();
      const signer = await import("./reporter.js");
      const cookie = signer.signReporterSession(reporterId);

      vi.resetModules();
      const verifier = await import("./reporter.js");
      expect(verifier.verifyReporterSession(cookie)).toBe(reporterId);
    } finally {
      if (originalSecret === undefined) delete process.env.REPORTER_SESSION_SECRET;
      else process.env.REPORTER_SESSION_SECRET = originalSecret;
    }
  });
});
