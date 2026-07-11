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
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";

import {
  encodeNDimensionalStrategy,
  encodeStatValidationInput,
  encodeValidateStatV2Data,
} from "./encode-validate-stat-v2.mjs";

import {
  epochDayFromTimestampMs,
  TXLINE_DEVNET,
} from "./normalize-v2-proof.mjs";

export const SETTLEKICK_DEVNET_PROGRAM_ID =
  "8pKvbZeZ51K6JMxhqwxx3nv5JGvWe87EQ9ToupRVMfSk";

export const PLACEHOLDER_RECENT_BLOCKHASH =
  "11111111111111111111111111111111";

export const SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR =
  createHash("sha256")
    .update("global:validate_txline")
    .digest()
    .subarray(0, 8);

function sha256Hex(value) {
  return createHash("sha256")
    .update(value)
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

function parsePublicKey(value, pathName) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${pathName}: expected a base58 public key`,
    );
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new TypeError(
      `${pathName}: invalid Solana public key`,
    );
  }
}

export function deriveDailyScoresRoot({
  timestampMs,
  txlineProgramId = TXLINE_DEVNET.programId,
}) {
  const epochDay =
    epochDayFromTimestampMs(timestampMs);

  const epochDayBytes = Buffer.alloc(2);
  epochDayBytes.writeUInt16LE(epochDay);

  const programId = parsePublicKey(
    txlineProgramId,
    "txlineProgramId",
  );

  const [publicKey, bump] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from(
          TXLINE_DEVNET.dailyScoresRootSeed,
          "utf8",
        ),
        epochDayBytes,
      ],
      programId,
    );

  return {
    publicKey,
    bump,
    epochDay,
    epochDayU16Le:
      Array.from(epochDayBytes),
  };
}

export function encodeSettleKickValidateTxlineData(
  payloadValue,
  strategyValue,
) {
  const payload = requireObject(
    payloadValue,
    "payload",
  );

  const strategy = requireObject(
    strategyValue,
    "strategy",
  );

  return Buffer.concat([
    SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR,
    encodeStatValidationInput(payload),
    encodeNDimensionalStrategy(strategy),
  ]);
}

export function buildUnsignedSettleKickTransaction({
  payer,
  payload: payloadValue,
  strategy: strategyValue,
  recentBlockhash =
    PLACEHOLDER_RECENT_BLOCKHASH,
  settlekickProgramId =
    SETTLEKICK_DEVNET_PROGRAM_ID,
  txlineProgramId =
    TXLINE_DEVNET.programId,
}) {
  const payload = requireObject(
    payloadValue,
    "payload",
  );

  const strategy = requireObject(
    strategyValue,
    "strategy",
  );

  const payerPublicKey = parsePublicKey(
    payer,
    "payer",
  );

  const settlekickProgramPublicKey =
    parsePublicKey(
      settlekickProgramId,
      "settlekickProgramId",
    );

  const txlineProgramPublicKey =
    parsePublicKey(
      txlineProgramId,
      "txlineProgramId",
    );

  parsePublicKey(
    recentBlockhash,
    "recentBlockhash",
  );

  const root = deriveDailyScoresRoot({
    timestampMs: payload.ts,
    txlineProgramId:
      txlineProgramPublicKey.toBase58(),
  });

  const instructionData =
    encodeSettleKickValidateTxlineData(
      payload,
      strategy,
    );

  const instruction =
    new TransactionInstruction({
      programId:
        settlekickProgramPublicKey,
      keys: [
        {
          pubkey: txlineProgramPublicKey,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: root.publicKey,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: instructionData,
    });

  const message =
    new TransactionMessage({
      payerKey: payerPublicKey,
      recentBlockhash,
      instructions: [instruction],
    }).compileToLegacyMessage();

  const messageBytes = Buffer.from(
    message.serialize(),
  );

  const transaction =
    Transaction.populate(message);

  const unsignedTransactionBytes =
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

  const innerTxlineData =
    encodeValidateStatV2Data(
      payload,
      strategy,
    );

  if (
    !instructionData
      .subarray(8)
      .equals(innerTxlineData.subarray(8))
  ) {
    throw new Error(
      "SettleKick and TxLINE argument bytes differ",
    );
  }

  const signatureCount =
    message.header.numRequiredSignatures;

  const wireSignatureCount =
    unsignedTransactionBytes[0];

  if (wireSignatureCount !== signatureCount) {
    throw new Error(
      "Unsigned wire signature count mismatch",
    );
  }

  const signatureBytes =
    unsignedTransactionBytes.subarray(
      1,
      1 + signatureCount * 64,
    );

  const signaturesAreZero =
    signatureBytes.every(
      (byte) => byte === 0,
    );

  if (!signaturesAreZero) {
    throw new Error(
      "Unsigned transaction contains a non-zero signature",
    );
  }

  const accountKeys =
    message.accountKeys.map(
      (key) => key.toBase58(),
    );

  return {
    instruction,
    instructionData,
    message,
    messageBytes,
    unsignedTransactionBytes,

    manifest: {
      version: 1,
      network: "devnet",
      transactionKind:
        "unsigned-legacy-transaction",

      security: {
        rpcRequested: false,
        privateKeyRead: false,
        signed: false,
        sent: false,
        signaturesAreZero,
      },

      programIds: {
        settlekick:
          settlekickProgramPublicKey
            .toBase58(),
        txline:
          txlineProgramPublicKey
            .toBase58(),
      },

      payer:
        payerPublicKey.toBase58(),

      dailyScoresRoot: {
        address:
          root.publicKey.toBase58(),
        bump: root.bump,
        epochDay: root.epochDay,
        seed:
          TXLINE_DEVNET
            .dailyScoresRootSeed,
        epochDayU16Le:
          root.epochDayU16Le,
      },

      instruction: {
        programId:
          settlekickProgramPublicKey
            .toBase58(),
        discriminatorHex:
          SETTLEKICK_VALIDATE_TXLINE_DISCRIMINATOR
            .toString("hex"),
        dataLength:
          instructionData.length,
        dataSha256:
          sha256Hex(instructionData),
        dataBase64:
          instructionData.toString(
            "base64",
          ),
        accounts: [
          {
            name: "txlineProgram",
            address:
              txlineProgramPublicKey
                .toBase58(),
            isSigner: false,
            isWritable: false,
          },
          {
            name:
              "dailyScoresMerkleRoots",
            address:
              root.publicKey.toBase58(),
            isSigner: false,
            isWritable: false,
          },
        ],
      },

      message: {
        format: "legacy",
        recentBlockhash,
        usesPlaceholderBlockhash:
          recentBlockhash ===
          PLACEHOLDER_RECENT_BLOCKHASH,
        requiredSignatures:
          signatureCount,
        readonlySignedAccounts:
          message.header
            .numReadonlySignedAccounts,
        readonlyUnsignedAccounts:
          message.header
            .numReadonlyUnsignedAccounts,
        accountKeys,
        byteLength:
          messageBytes.length,
        sha256:
          sha256Hex(messageBytes),
        base64:
          messageBytes.toString(
            "base64",
          ),
      },

      transaction: {
        signed: false,
        broadcastReady: false,
        signatureCount,
        signaturesAreZero,
        byteLength:
          unsignedTransactionBytes.length,
        sha256:
          sha256Hex(
            unsignedTransactionBytes,
          ),
        base64:
          unsignedTransactionBytes
            .toString("base64"),
      },
    },
  };
}

export async function writeUnsignedTransactionBundle(
  build,
  outputDirectory,
) {
  const outputDir =
    path.resolve(outputDirectory);

  await mkdir(outputDir, {
    recursive: true,
  });

  const files = {
    instruction:
      "settlekick-instruction.bin",
    message:
      "settlekick-message.bin",
    transaction:
      "settlekick-unsigned-transaction.bin",
    transactionBase64:
      "settlekick-unsigned-transaction.base64",
    manifest:
      "unsigned-transaction-manifest.json",
  };

  await writeFile(
    path.join(
      outputDir,
      files.instruction,
    ),
    build.instructionData,
  );

  await writeFile(
    path.join(
      outputDir,
      files.message,
    ),
    build.messageBytes,
  );

  await writeFile(
    path.join(
      outputDir,
      files.transaction,
    ),
    build.unsignedTransactionBytes,
  );

  await writeFile(
    path.join(
      outputDir,
      files.transactionBase64,
    ),
    `${
      build.unsignedTransactionBytes
        .toString("base64")
    }\n`,
    "utf8",
  );

  const manifest = {
    ...build.manifest,
    files,
  };

  await writeFile(
    path.join(
      outputDir,
      files.manifest,
    ),
    `${JSON.stringify(
      manifest,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return manifest;
}

function usage() {
  return [
    "Usage:",
    "  npm run txline:build-unsigned -- \\",
    "    --input-dir <replay-directory> \\",
    "    --payer <public-key> \\",
    "    --output-dir <directory> \\",
    "    [--payload valid|invalid-proof] \\",
    "    [--strategy success|rejection] \\",
    "    [--recent-blockhash <blockhash>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    payload: "valid",
    strategy: "success",
  };

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

    const value = argv[index + 1];

    if (argument === "--input-dir") {
      options.inputDir = value;
      index += 1;
      continue;
    }

    if (argument === "--payer") {
      options.payer = value;
      index += 1;
      continue;
    }

    if (argument === "--output-dir") {
      options.outputDir = value;
      index += 1;
      continue;
    }

    if (argument === "--payload") {
      options.payload = value;
      index += 1;
      continue;
    }

    if (argument === "--strategy") {
      options.strategy = value;
      index += 1;
      continue;
    }

    if (
      argument === "--recent-blockhash"
    ) {
      options.recentBlockhash = value;
      index += 1;
      continue;
    }

    throw new Error(
      `Unknown argument: ${argument}`,
    );
  }

  return options;
}

function payloadFilename(value) {
  if (value === "valid") {
    return "payload.valid.json";
  }

  if (value === "invalid-proof") {
    return "payload.invalid-proof.json";
  }

  throw new Error(
    "--payload must be valid or invalid-proof",
  );
}

function strategyFilename(value) {
  if (value === "success") {
    return "strategy.success.json";
  }

  if (value === "rejection") {
    return "strategy.rejection.json";
  }

  throw new Error(
    "--strategy must be success or rejection",
  );
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

  if (!options.payer) {
    throw new Error(
      `Missing --payer.\n\n${usage()}`,
    );
  }

  if (!options.outputDir) {
    throw new Error(
      `Missing --output-dir.\n\n${usage()}`,
    );
  }

  const inputDirectory =
    path.resolve(options.inputDir);

  const payload = JSON.parse(
    await readFile(
      path.join(
        inputDirectory,
        payloadFilename(
          options.payload,
        ),
      ),
      "utf8",
    ),
  );

  const strategy = JSON.parse(
    await readFile(
      path.join(
        inputDirectory,
        strategyFilename(
          options.strategy,
        ),
      ),
      "utf8",
    ),
  );

  const build =
    buildUnsignedSettleKickTransaction({
      payer: options.payer,
      payload,
      strategy,
      recentBlockhash:
        options.recentBlockhash ??
        PLACEHOLDER_RECENT_BLOCKHASH,
    });

  const manifest =
    await writeUnsignedTransactionBundle(
      build,
      options.outputDir,
    );

  console.log(
    JSON.stringify(
      {
        outputDirectory:
          path.resolve(
            options.outputDir,
          ),
        payer: manifest.payer,
        dailyScoresRoot:
          manifest.dailyScoresRoot,
        instruction:
          manifest.instruction,
        message: {
          format:
            manifest.message.format,
          usesPlaceholderBlockhash:
            manifest.message
              .usesPlaceholderBlockhash,
          requiredSignatures:
            manifest.message
              .requiredSignatures,
          byteLength:
            manifest.message
              .byteLength,
          sha256:
            manifest.message.sha256,
        },
        transaction:
          manifest.transaction,
        files: manifest.files,
      },
      null,
      2,
    ),
  );
}

const currentFile =
  fileURLToPath(import.meta.url);

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    currentFile;

if (isMain) {
  main().catch((error) => {
    console.error(
      `Unsigned transaction build failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}
