import { beforeAll, afterAll, vi } from "vitest";

// Every selected test uses example input or a mocked database interface.
// Fail the test if a code path unexpectedly attempts an HTTP fetch.
beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Offline showcase tests prohibit network requests");
  });
});
afterAll(() => { vi.unstubAllGlobals(); });
