import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  buildReplayBundle,
  writeReplayBundle,
} from "../src/replay-v2-proof.mjs";

const currentDirectory = path.dirname(
  fileURLToPath(import.meta.url),
);

const fixturePath = path.join(
  currentDirectory,
  "fixtures",
  "sample-v2-response.json",
);

async function readFixture() {
  return JSON.parse(
    await readFile(fixturePath, "utf8"),
  );
}

test(
  "builds success, rejection, and invalid-proof replay cases",
  async () => {
    const bundle = buildReplayBundle(
      await readFixture(),
    );

    assert.equal(bundle.payload.stats.length, 1);

    assert.equal(
      bundle
        .strategies
        .success
        .discretePredicates[0]
        .single
        .predicate
        .threshold,
      3,
    );

    assert.equal(
      bundle
        .strategies
        .rejection
        .discretePredicates[0]
        .single
        .predicate
        .threshold,
      4,
    );

    assert.notDeepEqual(
      bundle
        .mutations
        .invalidProofPayload
        .eventStatRoot,
      bundle.payload.eventStatRoot,
    );

    assert.equal(
      bundle.expectations
        .validPayloadWithSuccessStrategy,
      true,
    );

    assert.equal(
      bundle.expectations
        .validPayloadWithRejectionStrategy,
      false,
    );
  },
);

test(
  "writes deterministic replay documents and manifest",
  async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "settlekick-replay-"),
    );

    const bundle = buildReplayBundle(
      await readFixture(),
    );

    const manifest = await writeReplayBundle(
      bundle,
      outputDirectory,
    );

    const validPayload = JSON.parse(
      await readFile(
        path.join(
          outputDirectory,
          manifest.files.validPayload,
        ),
        "utf8",
      ),
    );

    const savedManifest = JSON.parse(
      await readFile(
        path.join(
          outputDirectory,
          manifest.files.manifest,
        ),
        "utf8",
      ),
    );

    assert.deepEqual(
      validPayload,
      bundle.payload,
    );

    assert.equal(
      savedManifest.integrity.validPayloadSha256,
      bundle.integrity.validPayloadSha256,
    );

    assert.deepEqual(
      savedManifest.pdaSeeds,
      bundle.pdaSeeds,
    );
  },
);

test(
  "CLI prepares replay output from a raw response file",
  async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "settlekick-cli-"),
    );

    const cliPath = path.join(
      currentDirectory,
      "..",
      "src",
      "replay-v2-proof.mjs",
    );

    const stdout = execFileSync(
      process.execPath,
      [
        cliPath,
        "--input",
        fixturePath,
        "--output-dir",
        outputDirectory,
      ],
      {
        encoding: "utf8",
      },
    );

    const summary = JSON.parse(stdout);

    assert.equal(summary.statCount, 1);
    assert.equal(
      summary.outputDirectory,
      outputDirectory,
    );

    assert.equal(
      summary.expectations
        .validPayloadWithSuccessStrategy,
      true,
    );
  },
);
