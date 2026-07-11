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
  buildReplayBundle,
  writeReplayBundle,
} from "./replay-v2-proof.mjs";

export const TXLINE_DEVNET_API_ORIGIN =
  "https://txline-dev.txodds.com";

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

function requireNonEmptyString(value, pathName) {
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

function requirePositiveInteger(value, pathName) {
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

function optionalInteger(record, names) {
  for (const name of names) {
    const value = record[name];

    if (Number.isSafeInteger(value)) {
      return value;
    }
  }

  return null;
}

function optionalString(record, names) {
  for (const name of names) {
    const value = record[name];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function redactCredential(value) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    return null;
  }

  return {
    present: true,
    length: value.length,
    sha256Prefix:
      createHash("sha256")
        .update(value)
        .digest("hex")
        .slice(0, 12),
  };
}

async function parseJsonResponse(
  response,
  operation,
) {
  const text = await response.text();

  let body;

  try {
    body =
      text.length === 0
        ? null
        : JSON.parse(text);
  } catch {
    throw new Error(
      `${operation} returned non-JSON HTTP ${response.status}`,
    );
  }

  if (!response.ok) {
    const message =
      body?.message ??
      body?.error ??
      `HTTP ${response.status}`;

    throw new Error(
      `${operation} failed: ${message}`,
    );
  }

  return body;
}

export function parseStatKeys(value) {
  const rawValues =
    Array.isArray(value)
      ? value
      : requireNonEmptyString(
          value,
          "statKeys",
        ).split(",");

  const keys = rawValues.map(
    (entry, index) => {
      const number =
        typeof entry === "number"
          ? entry
          : Number(
              String(entry).trim(),
            );

      return requirePositiveInteger(
        number,
        `statKeys[${index}]`,
      );
    },
  );

  if (keys.length === 0) {
    throw new TypeError(
      "statKeys: expected at least one key",
    );
  }

  if (
    new Set(keys).size !==
    keys.length
  ) {
    throw new TypeError(
      "statKeys: duplicate keys are not allowed",
    );
  }

  return keys;
}

export async function startGuestSession({
  fetchImpl = fetch,
  apiOrigin =
    TXLINE_DEVNET_API_ORIGIN,
}) {
  const origin =
    requireNonEmptyString(
      apiOrigin,
      "apiOrigin",
    ).replace(/\/+$/, "");

  const response =
    await fetchImpl(
      `${origin}/auth/guest/start`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      },
    );

  const body =
    requireObject(
      await parseJsonResponse(
        response,
        "guest authentication",
      ),
      "guest authentication response",
    );

  return requireNonEmptyString(
    body.token,
    "guest authentication response.token",
  );
}

export function authenticatedHeaders({
  jwt,
  apiToken,
}) {
  return {
    Accept: "application/json",
    Authorization:
      `Bearer ${requireNonEmptyString(
        jwt,
        "jwt",
      )}`,
    "X-Api-Token":
      requireNonEmptyString(
        apiToken,
        "apiToken",
      ),
  };
}

export async function fetchHistoricalScores({
  fixtureId,
  jwt,
  apiToken,
  fetchImpl = fetch,
  apiOrigin =
    TXLINE_DEVNET_API_ORIGIN,
}) {
  const normalizedFixtureId =
    requirePositiveInteger(
      fixtureId,
      "fixtureId",
    );

  const origin =
    requireNonEmptyString(
      apiOrigin,
      "apiOrigin",
    ).replace(/\/+$/, "");

  const response =
    await fetchImpl(
      `${origin}/api/scores/historical/${normalizedFixtureId}`,
      {
        method: "GET",
        headers:
          authenticatedHeaders({
            jwt,
            apiToken,
          }),
      },
    );

  const body =
    await parseJsonResponse(
      response,
      "historical scores request",
    );

  if (!Array.isArray(body)) {
    throw new TypeError(
      "historical scores response: expected an array",
    );
  }

  return body;
}

export function selectFinalizedScoreRecord(
  recordsValue,
) {
  if (!Array.isArray(recordsValue)) {
    throw new TypeError(
      "records: expected an array",
    );
  }

  const candidates =
    recordsValue
      .map((entry, index) => {
        const record =
          requireObject(
            entry,
            `records[${index}]`,
          );

        const action =
          optionalString(
            record,
            ["action", "Action"],
          );

        const statusId =
          optionalInteger(
            record,
            ["statusId", "StatusId"],
          );

        const period =
          optionalInteger(
            record,
            ["period", "Period"],
          );

        const seq =
          optionalInteger(
            record,
            ["seq", "Seq"],
          );

        const fixtureId =
          optionalInteger(
            record,
            ["fixtureId", "FixtureId"],
          );

        return {
          record,
          action,
          statusId,
          period,
          seq,
          fixtureId,
        };
      })
      .filter((candidate) => {
        return (
          candidate.action
            ?.toLowerCase() ===
            "game_finalised" &&
          candidate.statusId === 100 &&
          candidate.period === 100 &&
          Number.isSafeInteger(
            candidate.seq,
          ) &&
          candidate.seq >= 1
        );
      })
      .sort(
        (left, right) =>
          right.seq - left.seq,
      );

  if (candidates.length === 0) {
    throw new Error(
      "No finalized score record with action=game_finalised, statusId=100, period=100, and seq>=1 was found",
    );
  }

  return candidates[0];
}

export async function fetchV2StatValidation({
  fixtureId,
  seq,
  statKeys,
  jwt,
  apiToken,
  fetchImpl = fetch,
  apiOrigin =
    TXLINE_DEVNET_API_ORIGIN,
}) {
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

  const normalizedStatKeys =
    parseStatKeys(statKeys);

  const origin =
    requireNonEmptyString(
      apiOrigin,
      "apiOrigin",
    ).replace(/\/+$/, "");

  const url = new URL(
    `${origin}/api/scores/stat-validation`,
  );

  url.searchParams.set(
    "fixtureId",
    String(normalizedFixtureId),
  );

  url.searchParams.set(
    "seq",
    String(normalizedSeq),
  );

  url.searchParams.set(
    "statKeys",
    normalizedStatKeys.join(","),
  );

  const response =
    await fetchImpl(
      url,
      {
        method: "GET",
        headers:
          authenticatedHeaders({
            jwt,
            apiToken,
          }),
      },
    );

  return requireObject(
    await parseJsonResponse(
      response,
      "V2 stat-validation request",
    ),
    "V2 stat-validation response",
  );
}

export function buildProofRequestPlan({
  fixtureId,
  statKeys,
  apiOrigin =
    TXLINE_DEVNET_API_ORIGIN,
  apiToken,
  guestJwt,
}) {
  const normalizedFixtureId =
    requirePositiveInteger(
      fixtureId,
      "fixtureId",
    );

  const normalizedStatKeys =
    parseStatKeys(statKeys);

  const origin =
    requireNonEmptyString(
      apiOrigin,
      "apiOrigin",
    ).replace(/\/+$/, "");

  return {
    version: 1,
    network: "devnet",
    apiOrigin: origin,

    security: {
      dryRun: true,
      privateKeyRead: false,
      walletSignatureRequested: false,
      transactionBuilt: false,
      transactionSent: false,
      credentialsPrinted: false,
    },

    credentials: {
      apiToken:
        redactCredential(apiToken),
      guestJwt:
        redactCredential(guestJwt),
      guestJwtWillBeCreated:
        !guestJwt,
    },

    requests: [
      {
        method: "POST",
        path: "/auth/guest/start",
        conditional:
          Boolean(guestJwt),
        skippedWhenGuestJwtProvided:
          true,
      },
      {
        method: "GET",
        path:
          `/api/scores/historical/${normalizedFixtureId}`,
      },
      {
        method: "GET",
        path:
          "/api/scores/stat-validation",
        query: {
          fixtureId:
            normalizedFixtureId,
          seq:
            "selected finalized record seq",
          statKeys:
            normalizedStatKeys.join(","),
        },
      },
    ],
  };
}

export async function captureV2Proof({
  fixtureId,
  statKeys,
  apiToken,
  guestJwt,
  fetchImpl = fetch,
  apiOrigin =
    TXLINE_DEVNET_API_ORIGIN,
  outputDirectory,
}) {
  const normalizedFixtureId =
    requirePositiveInteger(
      fixtureId,
      "fixtureId",
    );

  const normalizedStatKeys =
    parseStatKeys(statKeys);

  const token =
    requireNonEmptyString(
      apiToken,
      "apiToken",
    );

  const jwt =
    guestJwt
      ? requireNonEmptyString(
          guestJwt,
          "guestJwt",
        )
      : await startGuestSession({
          fetchImpl,
          apiOrigin,
        });

  const historical =
    await fetchHistoricalScores({
      fixtureId:
        normalizedFixtureId,
      jwt,
      apiToken: token,
      fetchImpl,
      apiOrigin,
    });

  const selected =
    selectFinalizedScoreRecord(
      historical,
    );

  if (
    selected.fixtureId !== null &&
    selected.fixtureId !==
      normalizedFixtureId
  ) {
    throw new Error(
      "Selected finalized record fixture ID does not match the requested fixture",
    );
  }

  const proof =
    await fetchV2StatValidation({
      fixtureId:
        normalizedFixtureId,
      seq: selected.seq,
      statKeys:
        normalizedStatKeys,
      jwt,
      apiToken: token,
      fetchImpl,
      apiOrigin,
    });

  const bundle =
    buildReplayBundle(proof);

  const outputDir =
    path.resolve(
      outputDirectory,
    );

  await mkdir(
    outputDir,
    {
      recursive: true,
    },
  );

  const files = {
    historical:
      "historical-scores.raw.json",
    selectedFinalRecord:
      "selected-final-record.json",
    statValidation:
      "stat-validation.raw.json",
    captureManifest:
      "proof-capture-manifest.json",
  };

  await writeFile(
    path.join(
      outputDir,
      files.historical,
    ),
    `${JSON.stringify(
      historical,
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    path.join(
      outputDir,
      files.selectedFinalRecord,
    ),
    `${JSON.stringify(
      selected.record,
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    path.join(
      outputDir,
      files.statValidation,
    ),
    `${JSON.stringify(
      proof,
      null,
      2,
    )}\n`,
    "utf8",
  );

  const replayManifest =
    await writeReplayBundle(
      bundle,
      outputDir,
    );

  const manifest = {
    version: 1,
    network: "devnet",
    apiOrigin:
      apiOrigin.replace(/\/+$/, ""),

    security: {
      credentialsStored: false,
      credentialsPrinted: false,
      privateKeyRead: false,
      walletSignatureRequested: false,
      transactionBuilt: false,
      transactionSent: false,
    },

    request: {
      fixtureId:
        normalizedFixtureId,
      seq: selected.seq,
      statKeys:
        normalizedStatKeys,
    },

    finalRecord: {
      action:
        selected.action,
      statusId:
        selected.statusId,
      period:
        selected.period,
      fixtureId:
        selected.fixtureId,
      seq:
        selected.seq,
    },

    integrity: {
      historicalSha256:
        sha256Json(historical),
      selectedFinalRecordSha256:
        sha256Json(
          selected.record,
        ),
      statValidationSha256:
        sha256Json(proof),
    },

    replay: {
      manifest:
        replayManifest.files
          .manifest,
      epochDay:
        replayManifest.epochDay,
      programId:
        replayManifest.programId,
    },

    files,
  };

  await writeFile(
    path.join(
      outputDir,
      files.captureManifest,
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
    "  npm run txline:fetch-proof -- \\",
    "    --fixture-id <integer> \\",
    "    --stat-keys <comma-separated> \\",
    "    --output-dir <directory> \\",
    "    [--dry-run]",
    "",
    "Environment:",
    "  TXLINE_API_ORIGIN",
    "  TXLINE_API_TOKEN",
    "  TXLINE_GUEST_JWT (optional)",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};

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

    if (
      argument === "--dry-run"
    ) {
      options.dryRun = true;
      continue;
    }

    const value =
      argv[index + 1];

    if (
      argument === "--fixture-id"
    ) {
      options.fixtureId =
        Number(value);
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
      argument === "--output-dir"
    ) {
      options.outputDirectory =
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

  if (!options.fixtureId) {
    throw new Error(
      `Missing --fixture-id.\n\n${usage()}`,
    );
  }

  if (!options.statKeys) {
    throw new Error(
      `Missing --stat-keys.\n\n${usage()}`,
    );
  }

  const apiOrigin =
    process.env
      .TXLINE_API_ORIGIN ??
    TXLINE_DEVNET_API_ORIGIN;

  const apiToken =
    process.env
      .TXLINE_API_TOKEN;

  const guestJwt =
    process.env
      .TXLINE_GUEST_JWT;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        buildProofRequestPlan({
          fixtureId:
            options.fixtureId,
          statKeys:
            options.statKeys,
          apiOrigin,
          apiToken,
          guestJwt,
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (
    !options.outputDirectory
  ) {
    throw new Error(
      `Missing --output-dir.\n\n${usage()}`,
    );
  }

  const manifest =
    await captureV2Proof({
      fixtureId:
        options.fixtureId,
      statKeys:
        options.statKeys,
      apiToken,
      guestJwt,
      apiOrigin,
      outputDirectory:
        options.outputDirectory,
    });

  console.log(
    JSON.stringify(
      manifest,
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
      `TxLINE proof capture failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}
