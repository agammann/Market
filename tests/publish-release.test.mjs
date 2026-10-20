import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { publishRelease } from "../scripts/publish-release.mjs";

const sha = "a".repeat(40),
  tag = "v1.0.2";
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "agammann/Market",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
};

function fixture(t, options = {}) {
  const destination = fs.mkdtempSync(path.join(tmpdir(), "market-publisher-"));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(destination, "release.json"),
    JSON.stringify({
      version: "1.0.2",
      sourceCommit: sha,
      sourceTree: "b".repeat(40),
    }),
  );
  fs.writeFileSync(
    path.join(destination, "Market-1.0.2-source.zip"),
    "source fixture",
  );
  for (const name of [
    "Market-1.0.2-source.zip.sha256",
    "release.json.sha256",
    "SHA256SUMS",
  ])
    fs.writeFileSync(path.join(destination, name), "checksum fixture");
  const payload = new Map(
    fs
      .readdirSync(destination)
      .map((name) => [name, fs.readFileSync(path.join(destination, name))]),
  );
  const asset = (name) => {
    const bytes = payload.get(name);
    return {
      name,
      size: bytes.length,
      digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      state: "uploaded",
    };
  };
  const state = {
    ref: options.draft ? sha : null,
    release: options.draft
      ? {
          id: 123,
          tag_name: tag,
          target_commitish: sha,
          draft: true,
          prerelease: false,
        }
      : null,
    assets: options.partial ? [asset("Market-1.0.2-source.zip")] : [],
    calls: [],
  };
  const request = async (route, input = {}) => {
    const method = input.method || "GET";
    state.calls.push({ route, method });
    if (options.intercept) options.intercept(state, route, input);
    if (route === "git/ref/heads/main")
      return { object: { sha: state.head || sha } };
    if (route.startsWith("releases?")) {
      const page = Number(new URLSearchParams(route.split("?")[1]).get("page"));
      if (options.pages && page === 1)
        return Array.from({ length: 100 }, (_, i) => ({
          tag_name: "v0.0." + i,
          draft: false,
        }));
      // Deliberately keep new drafts absent from this listing after creation.
      return options.draft ? [structuredClone(state.release)] : [];
    }
    if (route.startsWith("git/matching-refs/"))
      return state.ref ? [{ ref: "refs/tags/" + tag }] : [];
    if (route === "git/refs" && method === "POST") {
      state.ref = input.body.sha;
      return {};
    }
    if (route === "git/ref/tags/" + tag)
      return { object: { type: "commit", sha: state.ref } };
    if (route === "releases" && method === "POST") {
      assert.equal(state.release, null, "Do not create a second release");
      state.release = { id: 123, ...input.body };
      return structuredClone(state.release);
    }
    if (route === "releases/123") {
      if (method === "PATCH") {
        assert.deepEqual(input.body, { draft: false });
        state.release.draft = false;
      }
      return structuredClone(state.release);
    }
    if (route.startsWith("releases/123/assets?") && method === "GET")
      return structuredClone(state.assets);
    if (route.startsWith("releases/123/assets?") && method === "POST") {
      const name = new URLSearchParams(route.split("?")[1]).get("name");
      assert.equal(input.upload, true);
      assert.ok(
        !state.assets.some((a) => a.name === name),
        "Never overwrite an existing asset",
      );
      assert.deepEqual(input.body, payload.get(name));
      const uploaded = asset(name);
      state.assets.push(uploaded);
      return uploaded;
    }
    throw Error("Unexpected request: " + method + " " + route);
  };
  return {
    destination,
    state,
    asset,
    run: () =>
      publishRelease({
        destination,
        env,
        request,
        checkSource(snapshot) {
          options.checkSource?.(snapshot, destination);
        },
      }),
  };
}

test("keeps the returned draft ID when list discovery lags", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run()).releaseId, 123);
  assert.equal(f.state.release.draft, false);
  assert.equal(f.state.assets.length, 5);
  assert.equal(
    f.state.calls.filter((c) => c.route.startsWith("releases?")).length,
    1,
  );
});

test("resumes a paginated existing draft by uploading only missing assets", async (t) => {
  const f = fixture(t, { draft: true, partial: true, pages: true });
  await f.run();
  assert.ok(
    f.state.calls.some((c) => c.route === "releases?per_page=100&page=2"),
  );
  assert.equal(f.state.calls.filter((c) => c.method === "POST").length, 4);
  assert.equal(f.state.assets.length, 5);
});

test("leaves a published version untouched, including when main changed since release", async (t) => {
  const f = fixture(t, { draft: true });
  f.state.release.draft = false;
  f.state.release.target_commitish = "c".repeat(40);
  assert.equal((await f.run()).skipped, tag);
  assert.ok(f.state.calls.every((c) => c.method === "GET"));
});

test("fails closed on source, tag and existing asset conflicts without mutation", async (t) => {
  for (const conflict of [
    "source",
    "tag",
    "digest",
    "extra",
    "duplicate",
    "incomplete",
  ]) {
    const f = fixture(t, { draft: true, partial: true });
    if (conflict === "source")
      f.state.release.target_commitish = "c".repeat(40);
    if (conflict === "tag") f.state.ref = "c".repeat(40);
    if (conflict === "digest") f.state.assets[0].digest = "sha256:bad";
    if (conflict === "extra")
      f.state.assets.push({
        ...f.asset("Market-1.0.2-source.zip"),
        name: "unexpected.zip",
      });
    if (conflict === "duplicate")
      f.state.assets.push(f.asset("Market-1.0.2-source.zip"));
    if (conflict === "incomplete") f.state.assets[0].state = "starter";
    await assert.rejects(f.run(), undefined, conflict);
    assert.ok(
      f.state.calls.every((c) => c.method === "GET"),
      conflict,
    );
  }
});

test("an interrupted upload keeps the same draft and resumes without replacing assets", async (t) => {
  let fail = true;
  const f = fixture(t, {
    draft: true,
    intercept(state, route, input) {
      if (fail && input.upload && state.assets.length === 1) {
        fail = false;
        throw Error("Connection interrupted");
      }
    },
  });
  await assert.rejects(f.run(), /Connection interrupted/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.state.assets.length, 1);
  await f.run();
  assert.equal(f.state.release.draft, false);
  assert.equal(
    f.state.calls.filter((c) => c.route === "releases" && c.method === "POST")
      .length,
    0,
  );
});

test("main movement while uploading leaves the complete draft unpublished", async (t) => {
  const f = fixture(t, {
    intercept(state, route) {
      if (route.startsWith("releases/123/assets?") && state.assets.length === 5)
        state.head = "c".repeat(40);
    },
  });
  await assert.rejects(f.run(), /Main advanced/);
  assert.equal(f.state.release.draft, true);
  assert.ok(!f.state.calls.some((c) => c.method === "PATCH"));
});

test("uploads the checked snapshot bytes after the original files are replaced", async (t) => {
  let checked;
  const f = fixture(t, {
    checkSource(snapshot, destination) {
      checked = snapshot;
      assert.notEqual(snapshot, destination);
      assert.equal(fs.readdirSync(snapshot).length, 5);
      assert.equal(
        fs.readFileSync(path.join(snapshot, "Market-1.0.2-source.zip"), "utf8"),
        "source fixture",
      );
      fs.writeFileSync(
        path.join(destination, "Market-1.0.2-source.zip"),
        "replaced after admission",
      );
    },
  });
  await f.run();
  assert.ok(!fs.existsSync(checked));
  assert.equal(
    f.state.assets.find((a) => a.name === "Market-1.0.2-source.zip").size,
    Buffer.byteLength("source fixture"),
  );
});

test("rejects nonregular, shared and oversized assets before contacting GitHub", async (t) => {
  for (const kind of ["directory", "shared", "oversized"]) {
    const f = fixture(t);
    const file = path.join(f.destination, "Market-1.0.2-source.zip");
    if (kind === "directory") {
      fs.unlinkSync(file);
      fs.mkdirSync(file);
    }
    if (kind === "shared") {
      const checksum = path.join(f.destination, "release.json.sha256");
      fs.unlinkSync(checksum);
      fs.linkSync(file, checksum);
    }
    if (kind === "oversized") fs.truncateSync(file, 64 * 1024 * 1024 + 1);
    await assert.rejects(f.run());
    assert.equal(f.state.calls.length, 0);
  }
});

test("a failed source check cleans its private snapshot and performs no GitHub calls", async (t) => {
  let checked;
  const f = fixture(t, {
    checkSource(snapshot) {
      checked = snapshot;
      throw Error("Invalid source archive");
    },
  });
  await assert.rejects(f.run(), /Invalid source archive/);
  assert.ok(!fs.existsSync(checked));
  assert.equal(f.state.calls.length, 0);
});
