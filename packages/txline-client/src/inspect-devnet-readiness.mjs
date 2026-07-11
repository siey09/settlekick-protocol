#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";

import {
  deriveDailyScoresRoot,
  SETTLEKICK_DEVNET_PROGRAM_ID,
} from "./build-settlekick-transaction.mjs";

import {
  TXLINE_DEVNET,
} from "./normalize-v2-proof.mjs";

export const SOLANA_DEVNET_RPC_URL =
  "https://api.devnet.solana.com";

export const UPGRADEABLE_LOADER_PROGRAM_ID =
  "BPFLoaderUpgradeab1e11111111111111111111111";

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize(value[key]),
        ]),
    );
  }

  return value;
}

function sha256Json(value) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize(value),
      ),
    )
    .digest("hex");
}

function requireObject(value, pathName) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${pathName}: expected an object`,
    );
  }

  return value;
}

function accountSummary(accountInfo) {
  if (accountInfo === null) {
    return {
      exists: false,
      executable: false,
      owner: null,
      lamports: null,
      dataLength: null,
    };
  }

  return {
    exists: true,
    executable:
      accountInfo.executable,
    owner:
      accountInfo.owner.toBase58(),
    lamports:
      accountInfo.lamports,
    dataLength:
      accountInfo.data.length,
  };
}

export async function inspectDevnetReadiness({
  connection,
  payload: payloadValue,
  rpcUrl =
    SOLANA_DEVNET_RPC_URL,
  settlekickProgramId =
    SETTLEKICK_DEVNET_PROGRAM_ID,
  txlineProgramId =
    TXLINE_DEVNET.programId,
}) {
  const payload = requireObject(
    payloadValue,
    "payload",
  );

  if (
    !Number.isSafeInteger(payload.ts)
  ) {
    throw new TypeError(
      "payload.ts: expected a safe integer",
    );
  }

  const txlineProgram =
    new PublicKey(
      txlineProgramId,
    );

  const settlekickProgram =
    new PublicKey(
      settlekickProgramId,
    );

  const root =
    deriveDailyScoresRoot({
      timestampMs: payload.ts,
      txlineProgramId:
        txlineProgram.toBase58(),
    });

  const [
    slot,
    genesisHash,
    latestBlockhash,
    txlineAccountInfo,
    settlekickAccountInfo,
    rootAccountInfo,
  ] = await Promise.all([
    connection.getSlot("confirmed"),
    connection.getGenesisHash(),
    connection.getLatestBlockhash(
      "confirmed",
    ),
    connection.getAccountInfo(
      txlineProgram,
      "confirmed",
    ),
    connection.getAccountInfo(
      settlekickProgram,
      "confirmed",
    ),
    connection.getAccountInfo(
      root.publicKey,
      "confirmed",
    ),
  ]);

  const txlineAccount =
    accountSummary(
      txlineAccountInfo,
    );

  const settlekickAccount =
    accountSummary(
      settlekickAccountInfo,
    );

  const dailyRootAccount =
    accountSummary(
      rootAccountInfo,
    );

  const checks = {
    txlineProgramExists:
      txlineAccount.exists,

    txlineProgramExecutable:
      txlineAccount.executable,

    txlineProgramUsesUpgradeableLoader:
      txlineAccount.owner ===
      UPGRADEABLE_LOADER_PROGRAM_ID,

    settlekickProgramDeployed:
      settlekickAccount.exists &&
      settlekickAccount.executable,

    dailyRootExists:
      dailyRootAccount.exists,

    dailyRootOwnedByTxline:
      dailyRootAccount.exists &&
      dailyRootAccount.owner ===
        txlineProgram.toBase58(),
  };

  const report = {
    version: 1,
    network: "devnet",
    rpcUrl,
    commitment: "confirmed",

    security: {
      readOnlyRpc: true,
      privateKeyRead: false,
      transactionBuilt: false,
      signed: false,
      sent: false,
    },

    cluster: {
      slot,
      genesisHash,
      latestBlockhash:
        latestBlockhash.blockhash,
      lastValidBlockHeight:
        latestBlockhash
          .lastValidBlockHeight,
    },

    proofContext: {
      timestampMs: payload.ts,
      epochDay: root.epochDay,
      seed:
        TXLINE_DEVNET
          .dailyScoresRootSeed,
      epochDayU16Le:
        root.epochDayU16Le,
    },

    programs: {
      txline: {
        address:
          txlineProgram.toBase58(),
        ...txlineAccount,
      },

      settlekick: {
        address:
          settlekickProgram
            .toBase58(),
        ...settlekickAccount,
      },
    },

    dailyScoresRoot: {
      address:
        root.publicKey.toBase58(),
      bump: root.bump,
      ...dailyRootAccount,
    },

    checks,
  };

  return {
    ...report,
    integrity: {
      reportSha256:
        sha256Json(report),
    },
  };
}

export async function writeReadinessReport(
  report,
  outputPath,
) {
  const resolvedPath =
    path.resolve(outputPath);

  await mkdir(
    path.dirname(resolvedPath),
    {
      recursive: true,
    },
  );

  await writeFile(
    resolvedPath,
    `${JSON.stringify(
      report,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return resolvedPath;
}

function usage() {
  return [
    "Usage:",
    "  npm run txline:inspect-devnet -- \\",
    "    --input-dir <replay-directory> \\",
    "    [--rpc-url <devnet-rpc-url>] \\",
    "    [--output <report.json>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const argument = argv[index];

    if (
      argument === "--help" ||
      argument === "-h"
    ) {
      options.help = true;
      continue;
    }

    const value =
      argv[index + 1];

    if (
      argument === "--input-dir"
    ) {
      options.inputDir = value;
      index += 1;
      continue;
    }

    if (
      argument === "--rpc-url"
    ) {
      options.rpcUrl = value;
      index += 1;
      continue;
    }

    if (
      argument === "--output"
    ) {
      options.output = value;
      index += 1;
      continue;
    }

    throw new Error(
      `Unknown argument: ${argument}`,
    );
  }

  return options;
}

async function main() {
  const options = parseArguments(
    process.argv.slice(2),
  );

  if (options.help) {
    console.log(usage());
    return;
  }

  if (!options.inputDir) {
    throw new Error(
      `Missing --input-dir.\n\n${usage()}`,
    );
  }

  const inputDirectory =
    path.resolve(
      options.inputDir,
    );

  const payload = JSON.parse(
    await readFile(
      path.join(
        inputDirectory,
        "payload.valid.json",
      ),
      "utf8",
    ),
  );

  const rpcUrl =
    options.rpcUrl ??
    SOLANA_DEVNET_RPC_URL;

  const connection =
    new Connection(
      rpcUrl,
      "confirmed",
    );

  const report =
    await inspectDevnetReadiness({
      connection,
      payload,
      rpcUrl,
    });

  if (options.output) {
    await writeReadinessReport(
      report,
      options.output,
    );
  }

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

const currentFile =
  fileURLToPath(
    import.meta.url,
  );

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(
    process.argv[1],
  ) === currentFile;

if (isMain) {
  main().catch((error) => {
    console.error(
      `Devnet readiness inspection failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}
