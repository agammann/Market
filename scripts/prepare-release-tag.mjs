import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRequest } from "./publish-release.mjs";

const repo = "agammann/Market";
const readPackage = () =>
  JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

// Both manual modes must name the reviewed commit and its current version.
// This check runs before either write step; the publisher also rechecks main
// and the tag throughout its existing asset verification and publication gates.
export function validateReleaseDispatch({
  env = process.env,
  packageMetadata = readPackage(),
} = {}) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, repo);
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(env.GITHUB_SHA || "", /^[a-f0-9]{40}$/);
  assert.equal(
    env.MARKET_RELEASE_SHA,
    env.GITHUB_SHA,
    "Expected release commit must equal the workflow commit",
  );
  assert.ok(
    ["prepare-tag", "publish"].includes(env.MARKET_RELEASE_MODE),
    "Select prepare-tag or publish explicitly",
  );
  assert.equal(packageMetadata.name, "market");
  assert.match(
    packageMetadata.version || "",
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  );
  assert.equal(
    env.MARKET_RELEASE_VERSION,
    packageMetadata.version,
    "Expected release version must equal package.json",
  );
  return {
    mode: env.MARKET_RELEASE_MODE,
    sha: env.GITHUB_SHA,
    tag: "v" + packageMetadata.version,
  };
}

export async function prepareReleaseTag({
  env = process.env,
  packageMetadata = readPackage(),
  request,
} = {}) {
  const { mode, sha, tag } = validateReleaseDispatch({ env, packageMetadata });
  assert.equal(mode, "prepare-tag", "Tag preparation cannot publish a release");
  const api = request || githubRequest(env);
  const ref = "refs/tags/" + tag;
  const checkMain = async () => {
    const main = await api("git/ref/heads/main");
    assert.equal(main.object?.type, "commit", "Main must point to a commit");
    assert.equal(main.object.sha, sha, "Main advanced; review the new commit");
  };
  const checkTag = (value) => {
    assert.equal(value.ref, ref, "Unexpected tag reference");
    assert.equal(
      value.object?.type,
      "commit",
      "Release tag must be lightweight",
    );
    assert.equal(value.object.sha, sha, "Release tag points to another commit");
  };

  await checkMain();
  const matches = await api("git/matching-refs/tags/" + tag);
  assert.ok(Array.isArray(matches), "Expected a list of tag references");
  const exists = matches.some((value) => value.ref === ref);
  if (exists) {
    checkTag(await api("git/ref/tags/" + tag));
  } else {
    // GitHub's create-ref endpoint refuses existing refs. Never update or
    // delete a conflicting tag, including one created after the listing.
    await checkMain();
    checkTag(await api("git/refs", { method: "POST", body: { ref, sha } }));
  }
  checkTag(await api("git/ref/tags/" + tag));
  await checkMain();
  return { prepared: tag, sourceCommit: sha, created: !exists };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 1 && args[0] === "--validate"),
    "Usage: node scripts/prepare-release-tag.mjs [--validate]",
  );
  console.log(
    JSON.stringify(
      args.length ? validateReleaseDispatch() : await prepareReleaseTag(),
    ),
  );
}
