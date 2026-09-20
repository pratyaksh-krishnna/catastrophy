import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshEvidenceStatus } from "./status-refresh";

afterEach(() => vi.unstubAllGlobals());

describe("receipt status refresh", () => {
  it("polls the receipt API before refreshing the server-rendered receipt", async () => {
    const fetchMock = vi.fn(async () => new Response());
    const refresh = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    refreshEvidenceStatus("965c663b-ea9b-4fd6-9eb2-dd4b9611b6f3", refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evidence/965c663b-ea9b-4fd6-9eb2-dd4b9611b6f3",
      { cache: "no-store" },
    );
  });
});
