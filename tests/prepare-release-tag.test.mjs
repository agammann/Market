import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareReleaseTag,
  validateReleaseDispatch,
} from "../scripts/prepare-release-tag.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const tag = "v1.0.3";
const ref = "refs/tags/" + tag;
const packageMetadata = { name: "market", version: "1.0.3" };
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "agammann/Market",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  MARKET_RELEASE_MODE: "prepare-tag",
  MARKET_RELEASE_SHA: sha,
  MARKET_RELEASE_VERSION: "1.0.3",
};
const tagValue = (commit = sha, type = "commit") => ({
  ref,
  object: { type, sha: commit },
});

function github({ existing, prefixOnly = false, intercept } = {}) {
  const state = { main: sha, tag: existing, calls: [] };
  const request = async (route, input = {}) => {
    const method = input.method || "GET";
    state.calls.push({ route, method, body: input.body });
    if (intercept) intercept(state, route, input);
    if (route === "git/ref/heads/main" && method === "GET")
      return { object: { type: "commit", sha: state.main } };
    if (route === "git/matching-refs/tags/" + tag && method === "GET")
      return state.tag
        ? [structuredClone(state.tag)]
        : prefixOnly
          ? [{ ref: ref + "0", object: { type: "commit", sha: other } }]
          : [];
    if (route === "git/refs" && method === "POST") {
      assert.equal(state.tag, undefined, "Create-ref must not overwrite tags");
      assert.deepEqual(input.body, { ref, sha });
      state.tag = tagValue();
      return structuredClone(state.tag);
    }
    if (route === "git/ref/tags/" + tag && method === "GET") {
      assert.ok(state.tag, "Tag must exist");
      return structuredClone(state.tag);
    }
    assert.fail("Unexpected GitHub operation: " + method + " " + route);
  };
  return { state, request };
}
const mutations = (state) =>
  state.calls.filter(({ method }) => method !== "GET");

test("prepares only the current version's lightweight tag at the reviewed main commit", async () => {
  const { state, request } = github();
  assert.deepEqual(await prepareReleaseTag({ env, packageMetadata, request }), {
    prepared: tag,
    sourceCommit: sha,
    created: true,
  });
  assert.deepEqual(mutations(state), [
    { route: "git/refs", method: "POST", body: { ref, sha } },
  ]);
  assert.deepEqual(state.tag, tagValue());
});

test("retries accept a matching lightweight tag without any writes", async () => {
  const { state, request } = github({ existing: tagValue() });
  assert.equal(
    (await prepareReleaseTag({ env, packageMetadata, request })).created,
    false,
  );
  assert.deepEqual(mutations(state), []);
});

test("a longer version tag is not mistaken for the exact release tag", async () => {
  const { state, request } = github({ prefixOnly: true });
  await prepareReleaseTag({ env, packageMetadata, request });
  assert.equal(mutations(state).length, 1);
});

test("rejects stale main, conflicting tags and annotated tags without writes", async (t) => {
  for (const [label, options, pattern] of [
    [
      "stale main",
      { intercept: (state) => (state.main = other) },
      /Main advanced/,
    ],
    ["conflicting tag", { existing: tagValue(other) }, /another commit/],
    ["annotated tag", { existing: tagValue(sha, "tag") }, /lightweight/],
  ]) {
    await t.test(label, async () => {
      const { state, request } = github(options);
      await assert.rejects(
        prepareReleaseTag({ env, packageMetadata, request }),
        pattern,
      );
      assert.deepEqual(mutations(state), []);
    });
  }
});

test("rechecks main after listing tags before creating a ref", async () => {
  const { state, request } = github({
    intercept: (state, route) => {
      if (route.startsWith("git/matching-refs/")) state.main = other;
    },
  });
  await assert.rejects(
    prepareReleaseTag({ env, packageMetadata, request }),
    /Main advanced/,
  );
  assert.deepEqual(mutations(state), []);
});

test("fails closed on a concurrent tag creation and never updates or deletes it", async () => {
  const { state, request } = github({
    intercept: (state, route, input) => {
      if (route === "git/refs" && input.method === "POST") {
        state.tag = tagValue(other);
        throw new Error("GitHub POST git/refs returned 422");
      }
    },
  });
  await assert.rejects(
    prepareReleaseTag({ env, packageMetadata, request }),
    /422/,
  );
  assert.equal(mutations(state).length, 1);
  assert.deepEqual(state.tag, tagValue(other));
});

test("detects tag replacement or main advancement after creation without releasing", async (t) => {
  for (const [label, change, pattern] of [
    [
      "tag replaced",
      (state) => (state.tag = tagValue(other)),
      /another commit/,
    ],
    ["main advanced", (state) => (state.main = other), /Main advanced/],
  ]) {
    await t.test(label, async () => {
      const { state, request } = github({
        intercept: (state, route) => {
          if (route === "git/ref/tags/" + tag) change(state);
        },
      });
      await assert.rejects(
        prepareReleaseTag({ env, packageMetadata, request }),
        pattern,
      );
      assert.equal(mutations(state).length, 1);
      assert.equal(mutations(state)[0].route, "git/refs");
    });
  }
});

test("wrong workflow context, inputs and versions fail before any GitHub call", async (t) => {
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["GITHUB_REPOSITORY", "another/Market"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_SHA", "short"],
    ["MARKET_RELEASE_SHA", undefined],
    ["MARKET_RELEASE_SHA", other],
    ["MARKET_RELEASE_MODE", undefined],
    ["MARKET_RELEASE_MODE", "unknown"],
    ["MARKET_RELEASE_VERSION", undefined],
    ["MARKET_RELEASE_VERSION", "1.0.2"],
    ["MARKET_RELEASE_VERSION", "v1.0.3"],
  ]) {
    await t.test(key + "=" + value, async () => {
      const { state, request } = github();
      await assert.rejects(
        prepareReleaseTag({
          env: { ...env, [key]: value },
          packageMetadata,
          request,
        }),
      );
      assert.deepEqual(state.calls, []);
    });
  }
  for (const version of ["1.0.3-rc.1", "01.0.3", "1.0.3/other", "", null]) {
    await t.test("invalid package version " + version, async () => {
      const { state, request } = github();
      await assert.rejects(
        prepareReleaseTag({
          env: { ...env, MARKET_RELEASE_VERSION: version },
          packageMetadata: { ...packageMetadata, version },
          request,
        }),
      );
      assert.deepEqual(state.calls, []);
    });
  }
});

test("publish dispatch validates the same exact inputs but cannot call tag preparation", async () => {
  const publishEnv = { ...env, MARKET_RELEASE_MODE: "publish" };
  assert.deepEqual(
    validateReleaseDispatch({ env: publishEnv, packageMetadata }),
    {
      mode: "publish",
      sha,
      tag,
    },
  );
  assert.throws(() =>
    validateReleaseDispatch({
      env: { ...publishEnv, MARKET_RELEASE_SHA: other },
      packageMetadata,
    }),
  );
  const { state, request } = github();
  await assert.rejects(
    prepareReleaseTag({ env: publishEnv, packageMetadata, request }),
    /cannot publish/,
  );
  assert.deepEqual(state.calls, []);
});
