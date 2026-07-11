import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PublicKey,
} from "@solana/web3.js";

import {
  UPGRADEABLE_LOADER_PROGRAM_ID,
} from "../src/inspect-devnet-readiness.mjs";

import {
  runPhase1Pipeline,
} from "../src/run-phase1-pipeline.mjs";

const directory = path.dirname(
  fileURLToPath(import.meta.url),
);

const fixturePath =
  path.join(
    directory,
    "fixtures",
    "sample-v2-response.json",
  );

const payer =
  "4JMJXsEnjt5i2ZX9ZBR39xPSWLDXEschje5L79sR4Hbo";

function account({
  owner,
  executable = false,
  dataLength = 32,
}) {
  return {
    executable,
    owner:
      new PublicKey(owner),
    lamports:
      1_000_000,
    rentEpoch: 0,
    data:
      Buffer.alloc(
        dataLength,
      ),
  };
}

class FakeConnection {
  async getSlot() {
    return 500_000_000;
  }

  async getGenesisHash() {
    return "fake-devnet-genesis";
  }

  async getLatestBlockhash() {
    return {
      blockhash:
        "11111111111111111111111111111111",
      lastValidBlockHeight:
        123_456,
    };
  }

  async getAccountInfo(
    publicKey,
  ) {
    const address =
      publicKey.toBase58();

    if (
      address ===
      "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
    ) {
      return account({
        owner:
          UPGRADEABLE_LOADER_PROGRAM_ID,
        executable: true,
        dataLength: 36,
      });
    }

    return null;
  }
}

test(
  "runs the complete synthetic Phase 1 preparation pipeline",
  async () => {
    const outputDirectory =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-phase1-",
        ),
      );

    const result =
      await runPhase1Pipeline({
        fixturePath,
        outputDirectory,
        payer,
        statKeys: [1],
        seq: 42,
        connection:
          new FakeConnection(),
      });

    const manifest =
      JSON.parse(
        await readFile(
          result.manifestPath,
          "utf8",
        ),
      );

    assert.equal(
      manifest.sourceMode,
      "synthetic-mock",
    );

    assert.equal(
      manifest.truthLabels
        .txlineVerified,
      false,
    );

    assert.equal(
      manifest.truthLabels
        .realHistoricalProof,
      false,
    );

    assert.equal(
      manifest.truthLabels
        .transactionsSent,
      false,
    );

    assert.equal(
      manifest.security
        .privateKeyRead,
      false,
    );

    assert.equal(
      manifest.readiness
        .checks
        .txlineProgramExecutable,
      true,
    );

    assert.equal(
      manifest.readiness
        .checks
        .settlekickProgramDeployed,
      false,
    );

    assert.deepEqual(
      manifest.transactions.map(
        (entry) =>
          entry.name,
      ),
      [
        "success",
        "rejection",
        "invalid-proof",
      ],
    );

    for (
      const transaction
      of manifest.transactions
    ) {
      assert.equal(
        transaction.signed,
        false,
      );

      assert.equal(
        transaction.broadcastReady,
        false,
      );

      assert.equal(
        transaction.signaturesAreZero,
        true,
      );

      const transactionManifest =
        JSON.parse(
          await readFile(
            path.join(
              outputDirectory,
              transaction.manifest,
            ),
            "utf8",
          ),
        );

      assert.equal(
        transactionManifest
          .transaction.signed,
        false,
      );
    }

    const manifestText =
      JSON.stringify(
        manifest,
      );

    assert.equal(
      manifestText.includes(
        "synthetic-api-token",
      ),
      false,
    );

    assert.equal(
      manifestText.includes(
        "synthetic-guest-jwt",
      ),
      false,
    );
  },
);
