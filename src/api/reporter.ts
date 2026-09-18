import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Pseudonymous identity shared by submission and Evidence-status boundaries. */
export const REPORTER_COOKIE = "catastrophy_reporter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const developmentSecret = randomBytes(32).toString("hex");

function secret(): string {
  const configured = process.env.REPORTER_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REPORTER_SESSION_SECRET must contain at least 32 characters");
  }
  return developmentSecret;
}

function signature(reporterId: string): string {
  return createHmac("sha256", secret()).update(reporterId).digest("hex");
}

export function signReporterSession(reporterId: string): string {
  if (!UUID.test(reporterId)) throw new Error("Invalid Reporter id");
  return `${reporterId}.${signature(reporterId)}`;
}

export function verifyReporterSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [reporterId, mac, extra] = cookie.split(".");
  if (!reporterId || !mac || extra || !UUID.test(reporterId) || !/^[0-9a-f]{64}$/.test(mac)) {
    return null;
  }
  const expected = Buffer.from(signature(reporterId), "hex");
  const received = Buffer.from(mac, "hex");
  return timingSafeEqual(expected, received) ? reporterId : null;
}
