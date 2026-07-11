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
} from "@solana/web3.js";

import {
  captureV2Proof,
  parseStatKeys,
  TXLINE_DEVNET_API_ORIGIN,
} from "./fetch-v2-proof.mjs";

import {
  inspectDevnetReadiness,
  SOLANA_DEVNET_RPC_URL,
  writeReadinessReport,
} from "./inspect-devnet-readiness.mjs";

import {
  buildUnsignedSettleKickTransaction,
  PLACEHOLDER_RECENT_BLOCKHASH,
  writeUnsignedTransactionBundle,
} from "./build-settlekick-transaction.mjs";

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

function requirePositiveInteger(
  value,
  pathName,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new TypeError(
      `${pathName}: expected an integer >= 1`,
    );
  }

  return value;
}

function requireNonEmptyString(
  value,
  pathName,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${pathName}: expected a non-empty string`,
    );
  }

  return value.trim();
}

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

function jsonResponse(
  body,
  {
    status = 200,
  } = {},
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

function relativePath(
  root,
  target,
) {
  return path
    .relative(root, target)
    .split(path.sep)
    .join("/");
}

async function readJson(filePath) {
  return JSON.parse(
    await readFile(
      filePath,
      "utf8",
    ),
  );
}

export function createMockTxlineFetch({
  proofResponse,
  fixtureId,
  seq,
}) {
  const normalizedProof =
    requireObject(
      proofResponse,
      "proofResponse",
    );

  const normalizedFixtureId =
    requirePositiveInteger(
      fixtureId,
      "fixtureId",
    );

  const normalizedSeq =
    requirePositiveInteger(
      seq,
      "seq",
    );

  const calls = [];

  const fetchImpl =
    async (url, options = {}) => {
      const address =
        url.toString();

      calls.push({
        address,
        method:
          options.method ?? "GET",
      });

      if (
        address.endsWith(
          "/auth/guest/start",
        )
      ) {
        return jsonResponse({
          token:
            "synthetic-guest-jwt",
        });
      }

      if (
        address.includes(
          `/api/scores/historical/${normalizedFixtureId}`,
        )
      ) {
        return jsonResponse([
          {
            fixtureId:
              normalizedFixtureId,
            seq:
              normalizedSeq - 1,
            action:
              "score_change",
            statusId: 2,
            period: 2,
          },
          {
            fixtureId:
              normalizedFixtureId,
            seq:
              normalizedSeq,
            action:
              "game_finalised",
            statusId: 100,
            period: 100,
          },
        ]);
      }

      if (
        address.includes(
          "/api/scores/stat-validation",
        )
      ) {
        const parsed =
          new URL(address);

        if (
          parsed.searchParams.get(
            "fixtureId",
          ) !==
          String(
            normalizedFixtureId,
          )
        ) {
          return jsonResponse(
            {
              error:
                "fixture ID mismatch",
            },
            {
              status: 400,
            },
          );
        }

        if (
          parsed.searchParams.get(
            "seq",
          ) !==
          String(normalizedSeq)
        ) {
          return jsonResponse(
            {
              error:
                "sequence mismatch",
            },
            {
              status: 400,
            },
          );
        }

        return jsonResponse(
          normalizedProof,
        );
      }

      return jsonResponse(
        {
          error:
            `Unexpected mocked request: ${address}`,
        },
        {
          status: 404,
        },
      );
    };

  return {
    fetchImpl,
    calls,
  };
}

export async function runPhase1Pipeline({
  fixturePath,
  outputDirectory,
  payer,
  statKeys,
  seq = 42,
  connection,
  rpcUrl =
    SOLANA_DEVNET_RPC_URL,
  recentBlockhash =
    PLACEHOLDER_RECENT_BLOCKHASH,
}) {
  const resolvedFixturePath =
    path.resolve(
      requireNonEmptyString(
        fixturePath,
        "fixturePath",
      ),
    );

  const outputRoot =
    path.resolve(
      requireNonEmptyString(
        outputDirectory,
        "outputDirectory",
      ),
    );

  const payerAddress =
    requireNonEmptyString(
      payer,
      "payer",
    );

  const normalizedStatKeys =
    parseStatKeys(statKeys);

  const normalizedSeq =
    requirePositiveInteger(
      seq,
      "seq",
    );

  const proofFixture =
    requireObject(
      await readJson(
        resolvedFixturePath,
      ),
      "proof fixture",
    );

  const fixtureSummary =
    requireObject(
      proofFixture.summary,
      "proof fixture.summary",
    );

  const fixtureId =
    requirePositiveInteger(
      fixtureSummary.fixtureId,
      "proof fixture.summary.fixtureId",
    );

  const mock =
    createMockTxlineFetch({
      proofResponse:
        proofFixture,
      fixtureId,
      seq:
        normalizedSeq,
    });

  await mkdir(
    outputRoot,
    {
      recursive: true,
    },
  );

  const captureDirectory =
    path.join(
      outputRoot,
      "capture",
    );

  const readinessDirectory =
    path.join(
      outputRoot,
      "readiness",
    );

  const transactionsDirectory =
    path.join(
      outputRoot,
      "transactions",
    );

  const captureManifest =
    await captureV2Proof({
      fixtureId,
      statKeys:
        normalizedStatKeys,
      apiToken:
        "synthetic-api-token",
      fetchImpl:
        mock.fetchImpl,
      apiOrigin:
        TXLINE_DEVNET_API_ORIGIN,
      outputDirectory:
        captureDirectory,
    });

  const validPayload =
    await readJson(
      path.join(
        captureDirectory,
        "payload.valid.json",
      ),
    );

  const invalidProofPayload =
    await readJson(
      path.join(
        captureDirectory,
        "payload.invalid-proof.json",
      ),
    );

  const successStrategy =
    await readJson(
      path.join(
        captureDirectory,
        "strategy.success.json",
      ),
    );

  const rejectionStrategy =
    await readJson(
      path.join(
        captureDirectory,
        "strategy.rejection.json",
      ),
    );

  const capturedStatKeys =
    validPayload.stats.map(
      (leaf) =>
        leaf.stat.key,
    );

  if (
    JSON.stringify(
      capturedStatKeys,
    ) !==
    JSON.stringify(
      normalizedStatKeys,
    )
  ) {
    throw new Error(
      "Captured proof stat-key order does not match the requested stat-key order",
    );
  }

  const readinessReport =
    await inspectDevnetReadiness({
      connection,
      payload:
        validPayload,
      rpcUrl,
    });

  const readinessPath =
    path.join(
      readinessDirectory,
      "devnet-readiness.json",
    );

  await writeReadinessReport(
    readinessReport,
    readinessPath,
  );

  const transactionCases = [
    {
      name: "success",
      expectation:
        "Intended real-execution outcome: a valid matching proof returns true",
      payload:
        validPayload,
      strategy:
        successStrategy,
    },
    {
      name: "rejection",
      expectation:
        "Intended real-execution outcome: a valid proof with a non-matching strategy returns false",
      payload:
        validPayload,
      strategy:
        rejectionStrategy,
    },
    {
      name: "invalid-proof",
      expectation:
        "Intended real-execution outcome: TxLINE rejects the deliberately corrupted proof",
      payload:
        invalidProofPayload,
      strategy:
        successStrategy,
    },
  ];

  const transactionResults = [];

  for (
    const transactionCase
    of transactionCases
  ) {
    const build =
      buildUnsignedSettleKickTransaction({
        payer:
          payerAddress,
        payload:
          transactionCase.payload,
        strategy:
          transactionCase.strategy,
        recentBlockhash,
      });

    const caseDirectory =
      path.join(
        transactionsDirectory,
        transactionCase.name,
      );

    const transactionManifest =
      await writeUnsignedTransactionBundle(
        build,
        caseDirectory,
      );

    transactionResults.push({
      name:
        transactionCase.name,
      expectation:
        transactionCase.expectation,
      manifest:
        relativePath(
          outputRoot,
          path.join(
            caseDirectory,
            transactionManifest
              .files.manifest,
          ),
        ),
      instructionSha256:
        transactionManifest
          .instruction.dataSha256,
      messageSha256:
        transactionManifest
          .message.sha256,
      transactionSha256:
        transactionManifest
          .transaction.sha256,
      signed:
        transactionManifest
          .transaction.signed,
      broadcastReady:
        transactionManifest
          .transaction
          .broadcastReady,
      signaturesAreZero:
        transactionManifest
          .transaction
          .signaturesAreZero,
    });
  }

  const reportWithoutIntegrity = {
    version: 1,
    phase:
      "phase-1-cpi-feasibility",
    sourceMode:
      "synthetic-mock",

    truthLabels: {
      txlineVerified: false,
      realHistoricalProof: false,
      realTxlineApiResponse: false,
      devnetInspection:
        "live read-only RPC",
      transactionsSigned: false,
      transactionsSent: false,
      devnetTransactionConfirmed:
        false,
    },

    security: {
      privateKeyRead: false,
      walletSignatureRequested:
        false,
      transactionSigned: false,
      transactionSent: false,
      credentialsStored: false,
      credentialsPrinted: false,
    },

    input: {
      fixture:
        relativePath(
          process.cwd(),
          resolvedFixturePath,
        ),
      fixtureId,
      seq:
        normalizedSeq,
      statKeys:
        normalizedStatKeys,
      fixtureSha256:
        sha256Json(
          proofFixture,
        ),
    },

    capture: {
      directory:
        relativePath(
          outputRoot,
          captureDirectory,
        ),
      manifest:
        relativePath(
          outputRoot,
          path.join(
            captureDirectory,
            "proof-capture-manifest.json",
          ),
        ),
      selectedSeq:
        captureManifest
          .request.seq,
      mockRequestCount:
        mock.calls.length,
      mockRequests:
        mock.calls,
    },

    readiness: {
      report:
        relativePath(
          outputRoot,
          readinessPath,
        ),
      rpcUrl,
      slot:
        readinessReport
          .cluster.slot,
      checks:
        readinessReport.checks,
    },

    transactions:
      transactionResults,
  };

  const pipelineManifest = {
    ...reportWithoutIntegrity,
    integrity: {
      manifestSha256:
        sha256Json(
          reportWithoutIntegrity,
        ),
    },
  };

  const manifestPath =
    path.join(
      outputRoot,
      "phase1-pipeline-manifest.json",
    );

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      pipelineManifest,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    manifest:
      pipelineManifest,
    manifestPath,
  };
}

function usage() {
  return [
    "Usage:",
    "  npm run phase1:pipeline -- \\",
    "    --fixture <proof-fixture.json> \\",
    "    --stat-keys <comma-separated> \\",
    "    --payer <public-key> \\",
    "    --output-dir <directory> \\",
    "    [--seq <integer>] \\",
    "    [--rpc-url <devnet-rpc-url>] \\",
    "    [--recent-blockhash <blockhash>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    seq: 42,
  };

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const argument =
      argv[index];

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
      argument === "--fixture"
    ) {
      options.fixturePath =
        value;
      index += 1;
      continue;
    }

    if (
      argument === "--stat-keys"
    ) {
      options.statKeys =
        value;
      index += 1;
      continue;
    }

    if (
      argument === "--payer"
    ) {
      options.payer =
        value;
      index += 1;
      continue;
    }

    if (
      argument === "--output-dir"
    ) {
      options.outputDirectory =
        value;
      index += 1;
      continue;
    }

    if (
      argument === "--seq"
    ) {
      options.seq =
        Number(value);
      index += 1;
      continue;
    }

    if (
      argument === "--rpc-url"
    ) {
      options.rpcUrl =
        value;
      index += 1;
      continue;
    }

    if (
      argument === "--recent-blockhash"
    ) {
      options.recentBlockhash =
        value;
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
  const options =
    parseArguments(
      process.argv.slice(2),
    );

  if (options.help) {
    console.log(usage());
    return;
  }

  for (
    const field of [
      "fixturePath",
      "statKeys",
      "payer",
      "outputDirectory",
    ]
  ) {
    if (!options[field]) {
      throw new Error(
        `Missing required option: ${field}.\n\n${usage()}`,
      );
    }
  }

  const rpcUrl =
    options.rpcUrl ??
    SOLANA_DEVNET_RPC_URL;

  const connection =
    new Connection(
      rpcUrl,
      "confirmed",
    );

  const result =
    await runPhase1Pipeline({
      fixturePath:
        options.fixturePath,
      outputDirectory:
        options.outputDirectory,
      payer:
        options.payer,
      statKeys:
        options.statKeys,
      seq:
        options.seq,
      connection,
      rpcUrl,
      recentBlockhash:
        options.recentBlockhash ??
        PLACEHOLDER_RECENT_BLOCKHASH,
    });

  console.log(
    JSON.stringify(
      {
        manifestPath:
          result.manifestPath,
        sourceMode:
          result.manifest
            .sourceMode,
        truthLabels:
          result.manifest
            .truthLabels,
        readiness:
          result.manifest
            .readiness,
        transactions:
          result.manifest
            .transactions,
      },
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
      `Phase 1 pipeline failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}
