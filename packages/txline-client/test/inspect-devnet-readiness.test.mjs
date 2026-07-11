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
  buildReplayBundle,
} from "../src/replay-v2-proof.mjs";

import {
  inspectDevnetReadiness,
  UPGRADEABLE_LOADER_PROGRAM_ID,
  writeReadinessReport,
} from "../src/inspect-devnet-readiness.mjs";

const directory = path.dirname(
  fileURLToPath(import.meta.url),
);

const fixturePath = path.join(
  directory,
  "fixtures",
  "sample-v2-response.json",
);

async function fixtureBundle() {
  const raw = JSON.parse(
    await readFile(
      fixturePath,
      "utf8",
    ),
  );

  return buildReplayBundle(raw);
}

function account({
  owner,
  executable = false,
  dataLength = 32,
  lamports = 1_000_000,
}) {
  return {
    executable,
    owner:
      new PublicKey(owner),
    lamports,
    rentEpoch: 0,
    data:
      Buffer.alloc(dataLength),
  };
}

class FakeConnection {
  constructor({
    rootExists = true,
  } = {}) {
    this.rootExists =
      rootExists;

    this.calls = [];
  }

  async getSlot(commitment) {
    this.calls.push([
      "getSlot",
      commitment,
    ]);

    return 500_000_000;
  }

  async getGenesisHash() {
    this.calls.push([
      "getGenesisHash",
    ]);

    return "fake-devnet-genesis";
  }

  async getLatestBlockhash(
    commitment,
  ) {
    this.calls.push([
      "getLatestBlockhash",
      commitment,
    ]);

    return {
      blockhash:
        "11111111111111111111111111111111",
      lastValidBlockHeight:
        123_456,
    };
  }

  async getAccountInfo(
    publicKey,
    commitment,
  ) {
    const address =
      publicKey.toBase58();

    this.calls.push([
      "getAccountInfo",
      address,
      commitment,
    ]);

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

    if (
      address ===
      "8pKvbZeZ51K6JMxhqwxx3nv5JGvWe87EQ9ToupRVMfSk"
    ) {
      return null;
    }

    if (!this.rootExists) {
      return null;
    }

    return account({
      owner:
        "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      executable: false,
      dataLength: 96,
    });
  }
}

test(
  "builds a read-only readiness report",
  async () => {
    const bundle =
      await fixtureBundle();

    const connection =
      new FakeConnection();

    const report =
      await inspectDevnetReadiness({
        connection,
        payload:
          bundle.payload,
      });

    assert.equal(
      report.security.readOnlyRpc,
      true,
    );

    assert.equal(
      report.security
        .privateKeyRead,
      false,
    );

    assert.equal(
      report.security.signed,
      false,
    );

    assert.equal(
      report.security.sent,
      false,
    );

    assert.equal(
      report.checks
        .txlineProgramExists,
      true,
    );

    assert.equal(
      report.checks
        .txlineProgramExecutable,
      true,
    );

    assert.equal(
      report.checks
        .txlineProgramUsesUpgradeableLoader,
      true,
    );

    assert.equal(
      report.checks
        .settlekickProgramDeployed,
      false,
    );

    assert.equal(
      report.checks
        .dailyRootExists,
      true,
    );

    assert.equal(
      report.checks
        .dailyRootOwnedByTxline,
      true,
    );

    assert.equal(
      connection.calls.some(
        ([name]) =>
          name === "sendTransaction",
      ),
      false,
    );
  },
);

test(
  "reports a missing synthetic root without treating it as signing failure",
  async () => {
    const bundle =
      await fixtureBundle();

    const report =
      await inspectDevnetReadiness({
        connection:
          new FakeConnection({
            rootExists: false,
          }),
        payload:
          bundle.payload,
      });

    assert.equal(
      report.checks
        .dailyRootExists,
      false,
    );

    assert.equal(
      report.checks
        .dailyRootOwnedByTxline,
      false,
    );

    assert.equal(
      report.security.signed,
      false,
    );
  },
);

test(
  "writes an inspectable readiness JSON report",
  async () => {
    const bundle =
      await fixtureBundle();

    const report =
      await inspectDevnetReadiness({
        connection:
          new FakeConnection(),
        payload:
          bundle.payload,
      });

    const directoryPath =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-readiness-",
        ),
      );

    const outputPath =
      path.join(
        directoryPath,
        "report.json",
      );

    await writeReadinessReport(
      report,
      outputPath,
    );

    const saved =
      JSON.parse(
        await readFile(
          outputPath,
          "utf8",
        ),
      );

    assert.deepEqual(
      saved,
      report,
    );
  },
);
