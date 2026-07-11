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
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import {
  buildReplayBundle,
} from "../src/replay-v2-proof.mjs";

import {
  encodeValidateStatV2Data,
} from "../src/encode-validate-stat-v2.mjs";

import {
  buildUnsignedSettleKickTransaction,
  deriveDailyScoresRoot,
  PLACEHOLDER_RECENT_BLOCKHASH,
  SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR,
  writeUnsignedTransactionBundle,
} from "../src/build-settlekick-transaction.mjs";

const directory = path.dirname(
  fileURLToPath(import.meta.url),
);

const fixturePath = path.join(
  directory,
  "fixtures",
  "sample-v2-response.json",
);

const payer =
  "4JMJXsEnjt5i2ZX9ZBR39xPSWLDXEschje5L79sR4Hbo";

async function fixtureBundle() {
  const raw = JSON.parse(
    await readFile(
      fixturePath,
      "utf8",
    ),
  );

  return buildReplayBundle(raw);
}

test(
  "uses the verified Anchor instruction discriminator",
  () => {
    assert.deepEqual(
      Array.from(
        SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR,
      ),
      [
        195,
        167,
        159,
        225,
        45,
        55,
        30,
        91,
      ],
    );

    assert.equal(
      SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR
        .toString("hex"),
      "c3a79fe12d371e5b",
    );
  },
);

test(
  "derives the daily scores root from the proof timestamp",
  async () => {
    const bundle =
      await fixtureBundle();

    const root =
      deriveDailyScoresRoot({
        timestampMs:
          bundle.payload.ts,
      });

    assert.equal(
      root.epochDay,
      bundle.epochDay,
    );

    assert.deepEqual(
      root.epochDayU16Le,
      bundle.pdaSeeds
        .epochDayU16Le,
    );

    assert.ok(
      root.publicKey instanceof PublicKey,
    );

    assert.ok(
      Number.isInteger(root.bump),
    );
  },
);

test(
  "builds an inspectable unsigned SettleKick transaction",
  async () => {
    const bundle =
      await fixtureBundle();

    const build =
      buildUnsignedSettleKickTransaction({
        payer,
        payload: bundle.payload,
        strategy:
          bundle.strategies.success,
      });

    assert.equal(
      build.manifest.security
        .rpcRequested,
      false,
    );

    assert.equal(
      build.manifest.security.signed,
      false,
    );

    assert.equal(
      build.manifest.security.sent,
      false,
    );

    assert.equal(
      build.manifest.message
        .usesPlaceholderBlockhash,
      true,
    );

    assert.equal(
      build.manifest.message
        .recentBlockhash,
      PLACEHOLDER_RECENT_BLOCKHASH,
    );

    assert.equal(
      build.manifest.message
        .requiredSignatures,
      1,
    );

    assert.equal(
      build.manifest.transaction
        .signaturesAreZero,
      true,
    );

    assert.equal(
      build.unsignedTransactionBytes[0],
      1,
    );

    assert.ok(
      build.unsignedTransactionBytes
        .subarray(1, 65)
        .every(
          (byte) => byte === 0,
        ),
    );

    const parsed = Transaction.from(
      build.unsignedTransactionBytes,
    );

    assert.equal(
      parsed.feePayer.toBase58(),
      payer,
    );

    assert.equal(
      parsed.instructions.length,
      1,
    );

    assert.equal(
      parsed.instructions[0]
        .programId
        .toBase58(),
      "8pKvbZeZ51K6JMxhqwxx3nv5JGvWe87EQ9ToupRVMfSk",
    );

    assert.equal(
      parsed.instructions[0]
        .keys.length,
      2,
    );

    assert.equal(
      parsed.instructions[0]
        .keys[0]
        .pubkey
        .toBase58(),
      "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    );

    assert.equal(
      parsed.instructions[0]
        .keys[1]
        .pubkey
        .toBase58(),
      build.manifest
        .dailyScoresRoot.address,
    );

    assert.ok(
      parsed.instructions[0]
        .keys
        .every(
          (key) =>
            key.isSigner === false &&
            key.isWritable === false,
        ),
    );

    const innerData =
      encodeValidateStatV2Data(
        bundle.payload,
        bundle.strategies.success,
      );

    assert.deepEqual(
      build.instructionData
        .subarray(8),
      innerData.subarray(8),
    );
  },
);

test(
  "writes unsigned binary artifacts and a manifest",
  async () => {
    const bundle =
      await fixtureBundle();

    const build =
      buildUnsignedSettleKickTransaction({
        payer,
        payload: bundle.payload,
        strategy:
          bundle.strategies.success,
      });

    const outputDirectory =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-unsigned-",
        ),
      );

    const manifest =
      await writeUnsignedTransactionBundle(
        build,
        outputDirectory,
      );

    const savedManifest =
      JSON.parse(
        await readFile(
          path.join(
            outputDirectory,
            manifest.files.manifest,
          ),
          "utf8",
        ),
      );

    const transactionBytes =
      await readFile(
        path.join(
          outputDirectory,
          manifest.files.transaction,
        ),
      );

    assert.equal(
      savedManifest.transaction
        .sha256,
      build.manifest.transaction
        .sha256,
    );

    assert.deepEqual(
      transactionBytes,
      build.unsignedTransactionBytes,
    );
  },
);

test(
  "CLI builds from deterministic replay files",
  async () => {
    const replayDirectory =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-replay-input-",
        ),
      );

    const outputDirectory =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-builder-output-",
        ),
      );

    const replayCli = path.join(
      directory,
      "..",
      "src",
      "replay-v2-proof.mjs",
    );

    execFileSync(
      process.execPath,
      [
        replayCli,
        "--input",
        fixturePath,
        "--output-dir",
        replayDirectory,
      ],
      {
        encoding: "utf8",
      },
    );

    const builderCli = path.join(
      directory,
      "..",
      "src",
      "build-settlekick-transaction.mjs",
    );

    const stdout = execFileSync(
      process.execPath,
      [
        builderCli,
        "--input-dir",
        replayDirectory,
        "--payer",
        payer,
        "--output-dir",
        outputDirectory,
      ],
      {
        encoding: "utf8",
      },
    );

    const summary =
      JSON.parse(stdout);

    assert.equal(
      summary.payer,
      payer,
    );

    assert.equal(
      summary.transaction.signed,
      false,
    );

    assert.equal(
      summary.transaction
        .signaturesAreZero,
      true,
    );

    assert.equal(
      summary.message
        .usesPlaceholderBlockhash,
      true,
    );
  },
);
