import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repo = "agammann/Market";
const root = path.resolve(import.meta.dirname, "..");
const notes = (version) =>
  "Market " +
  version +
  " is a self-hosted reference marketplace for physical goods and digital downloads.\n\nThe source ZIP includes the application, MIT license, installation, developer and recovery instructions. It requires Docker Linux for the optional Tor deployment, or Node 24.19.0 and pnpm 11.25.0 for local development. Each seller supplies a separate supported BTCPay connection. No payment service or hosted marketplace is included.\n\nVerify the source ZIP with SHA256SUMS before extracting it. RELEASE.json records the exact source commit, tree and file hashes. Tests use isolated fixtures; actual chain verification is limited to disposable Bitcoin regtest and Monero fakechain. See docs/VERIFICATION.md for observed results and limits.";

function readRegular(file, limit) {
  const entry = fs.lstatSync(file);
  assert.ok(
    entry.isFile() && !entry.isSymbolicLink(),
    "Release assets must be regular files",
  );
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) |
      (fs.constants.O_NONBLOCK || 0),
  );
  try {
    const stat = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    // Windows lacks O_NOFOLLOW. The descriptor identities and checked snapshot
    // protect the upload bytes; this does not sandbox ancestor directories.
    assert.ok(
      stat.isFile() &&
        entry.dev === stat.dev &&
        entry.ino === stat.ino &&
        current.isFile() &&
        !current.isSymbolicLink() &&
        current.dev === stat.dev &&
        current.ino === stat.ino,
      "Release asset changed during admission",
    );
    assert.ok(
      stat.nlink === 1 &&
        Number.isSafeInteger(stat.size) &&
        stat.size >= 0 &&
        stat.size <= limit,
      "Release asset exceeds its file limit or has shared links",
    );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      assert.ok(count, "Release asset was truncated during admission");
      offset += count;
    }
    assert.equal(
      fs.readSync(fd, Buffer.alloc(1), 0, 1, null),
      0,
      "Release asset grew during admission",
    );
    assert.equal(fs.fstatSync(fd).size, stat.size);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function snapshotPayload(destination, checkSource) {
  const directory = fs.lstatSync(destination);
  assert.ok(
    directory.isDirectory() && !directory.isSymbolicLink(),
    "Release destination must be a regular directory",
  );
  const manifestBytes = readRegular(
    path.join(destination, "release.json"),
    8 * 1024 * 1024,
  );
  const manifest = JSON.parse(manifestBytes);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const archive = "Market-" + manifest.version + "-source.zip";
  const names = [
    archive,
    archive + ".sha256",
    "release.json",
    "release.json.sha256",
    "SHA256SUMS",
  ].sort();
  assert.deepEqual(
    fs.readdirSync(destination).sort(),
    names,
    "Unexpected release payload set",
  );
  const assets = new Map(
    names.map((name) => {
      const bytes =
        name === "release.json"
          ? manifestBytes
          : readRegular(
              path.join(destination, name),
              name === archive ? 64 * 1024 * 1024 : 4096,
            );
      return [
        name,
        {
          bytes,
          digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
        },
      ];
    }),
  );
  const snapshot = fs.mkdtempSync(
    path.join(tmpdir(), "market-release-publish-"),
  );
  try {
    fs.chmodSync(snapshot, 0o700);
    for (const [name, { bytes }] of assets)
      fs.writeFileSync(path.join(snapshot, name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    checkSource(snapshot);
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
  return { manifest, names, assets };
}

function githubRequest(env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  assert.ok(token, "A GitHub workflow token is required");
  return async (route, { method = "GET", body, upload = false } = {}) => {
    const response = await fetch(
      "https://" +
        (upload ? "uploads.github.com" : "api.github.com") +
        "/repos/" +
        repo +
        "/" +
        route,
      {
        method,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": upload
            ? "application/octet-stream"
            : "application/json",
        },
        ...(body === undefined
          ? {}
          : { body: upload ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      },
    );
    assert.ok(
      response.ok,
      "GitHub " + method + " " + route + " returned " + response.status,
    );
    return response.json();
  };
}

export async function publishRelease({
  destination = path.join(root, "dist-release"),
  env = process.env,
  request,
  checkSource = (snapshot) =>
    execFileSync(
      "python",
      ["scripts/check-release.py", snapshot, "--source", root],
      { cwd: root, stdio: "inherit" },
    ),
} = {}) {
  const sha = env.GITHUB_SHA;
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, repo);
  assert.equal(env.GITHUB_EVENT_NAME, "push");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(sha || "", /^[a-f0-9]{40}$/);
  const { manifest, names, assets } = snapshotPayload(destination, checkSource);
  assert.equal(manifest.sourceCommit, sha);
  const tag = "v" + manifest.version;
  const api = request || githubRequest(env);
  const list = async (route) => {
    const all = [];
    for (let page = 1; ; page++) {
      const batch = await api(
        route + (route.includes("?") ? "&" : "?") + "per_page=100&page=" + page,
      );
      assert.ok(Array.isArray(batch), "Expected a GitHub list response");
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  };
  const checkMain = async () =>
    assert.equal(
      (await api("git/ref/heads/main")).object.sha,
      sha,
      "Main advanced before publication",
    );
  const checkTag = async () => {
    const ref = await api("git/ref/tags/" + tag);
    assert.equal(ref.object.type, "commit");
    assert.equal(ref.object.sha, sha, "Version tag points to different source");
  };
  const checkRelease = (release) => {
    assert.ok(Number.isSafeInteger(release.id) && release.id > 0);
    assert.equal(release.tag_name, tag);
    assert.equal(release.target_commitish, sha);
    assert.equal(release.draft, true);
    assert.equal(release.prerelease, false);
  };
  await checkMain();
  const matching = (await list("releases")).filter(
    (release) => release.tag_name === tag,
  );
  assert.ok(matching.length <= 1, "Multiple releases use the version tag");
  if (matching[0] && !matching[0].draft) {
    return {
      skipped: tag,
      reason: "Published versions are immutable",
      releaseId: matching[0].id,
    };
  }
  const checkAssets = (remote, complete = false) => {
    assert.equal(
      new Set(remote.map((asset) => asset.name)).size,
      remote.length,
      "Duplicate release asset",
    );
    for (const asset of remote) {
      assert.ok(
        assets.has(asset.name),
        "Unexpected release asset: " + asset.name,
      );
      const expected = assets.get(asset.name);
      assert.equal(
        asset.size,
        expected.bytes.length,
        "Release asset size differs: " + asset.name,
      );
      assert.equal(
        asset.digest,
        expected.digest,
        "Release asset digest differs: " + asset.name,
      );
      assert.equal(
        asset.state,
        "uploaded",
        "Release asset upload is incomplete: " + asset.name,
      );
    }
    if (complete)
      assert.deepEqual(remote.map((asset) => asset.name).sort(), names);
  };
  let release = matching[0];
  if (release) checkRelease(release);
  const refs = await api("git/matching-refs/tags/" + tag);
  if (refs.some((ref) => ref.ref === "refs/tags/" + tag)) await checkTag();
  else {
    assert.ok(!release, "Existing draft has no version tag");
    await checkMain();
    await api("git/refs", {
      method: "POST",
      body: { ref: "refs/tags/" + tag, sha },
    });
    await checkTag();
  }
  if (!release) {
    await checkMain();
    // Keep the creation response: a new draft may not appear in list results yet.
    release = await api("releases", {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: sha,
        name: "Market " + manifest.version,
        body: notes(manifest.version),
        draft: true,
        prerelease: false,
      },
    });
    checkRelease(release);
  }
  const releaseId = release.id;
  release = await api("releases/" + releaseId);
  assert.equal(release.id, releaseId);
  checkRelease(release);
  let remote = await list("releases/" + releaseId + "/assets");
  // Check every existing asset before uploading anything. Never replace assets.
  checkAssets(remote);
  for (const [name, expected] of assets) {
    if (remote.some((asset) => asset.name === name)) continue;
    await checkMain();
    checkAssets([
      await api(
        "releases/" + releaseId + "/assets?name=" + encodeURIComponent(name),
        { method: "POST", body: expected.bytes, upload: true },
      ),
    ]);
  }
  remote = await list("releases/" + releaseId + "/assets");
  checkAssets(remote, true);
  await checkTag();
  await checkMain();
  checkRelease(await api("releases/" + releaseId));
  await api("releases/" + releaseId, {
    method: "PATCH",
    body: { draft: false },
  });
  const published = await api("releases/" + releaseId);
  assert.equal(published.id, releaseId);
  assert.equal(published.tag_name, tag);
  assert.equal(published.target_commitish, sha);
  assert.equal(published.draft, false);
  assert.equal(published.prerelease, false);
  checkAssets(await list("releases/" + releaseId + "/assets"), true);
  return {
    released: tag,
    sourceCommit: sha,
    sourceTree: manifest.sourceTree,
    releaseId,
    assets: remote.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
    })),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await publishRelease({
        destination: path.resolve(
          process.argv[2] || path.join(root, "dist-release"),
        ),
      }),
    ),
  );
}
