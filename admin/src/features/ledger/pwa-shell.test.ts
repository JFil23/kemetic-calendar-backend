import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

function shellHarness(offline = false) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const cached: string[] = [];
  vm.runInNewContext(worker, {
    URL,
    Response,
    self: {
      location: { origin: "https://haw-admin.example.test" },
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
    },
    fetch: async () => {
      if (offline) throw new Error("Offline fixture");
      return new Response("public shell asset");
    },
    caches: {
      open: async () => ({ put: async (request: string | { url: string }) => { cached.push(typeof request === "string" ? request : request.url); } }),
      match: async () => new Response("cached auth-gated shell"),
    },
  });
  return {
    cached,
    request(path: string, method = "GET", mode = "cors") {
      let response: Promise<Response> | undefined;
      handlers.get("fetch")!({
        request: { url: new URL(path, "https://haw-admin.example.test").href, method, mode },
        respondWith: (value: Promise<Response>) => { response = value; },
      });
      return response;
    },
  };
}

describe("admin PWA shell boundary", () => {
  it("never handles auth, activity, function, cross-origin, or write requests", () => {
    const shell = shellHarness();
    for (const path of [
      "/rest/v1/rpc/admin_activity_users",
      "/auth/v1/user",
      "/functions/v1/admin_auth/me",
      "/admin_activity_user_detail",
      "https://project.supabase.co/rest/v1/rpc/admin_activity_users",
    ]) {
      assert.equal(shell.request(path), undefined, path);
    }
    assert.equal(shell.request("/assets/app.js", "POST"), undefined);
    assert.deepEqual(shell.cached, []);
  });

  it("caches only the successful interface response", async () => {
    const shell = shellHarness();
    const response = await shell.request("/assets/app.js");
    assert.equal(await response?.text(), "public shell asset");
    assert.deepEqual(shell.cached, ["https://haw-admin.example.test/assets/app.js"]);
  });

  it("falls back to the gated shell for offline navigation", async () => {
    const shell = shellHarness(true);
    const response = await shell.request("/", "GET", "navigate");
    assert.equal(await response?.text(), "cached auth-gated shell");
    assert.deepEqual(shell.cached, []);
  });
});
