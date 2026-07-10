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
  buildExactEqualityStrategy,
  normalizeV2Proof,
  validateStrategyCoverage,
} from "./normalize-v2-proof.mjs";

const I32_MAX = 0x7fff_ffff;

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

function sha256(value) {
  const canonicalJson = JSON.stringify(
    canonicalize(value),
  );

  return createHash("sha256")
    .update(canonicalJson)
    .digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function unwrapApiResponse(rawInput) {
  if (
    rawInput !== null &&
    typeof rawInput === "object" &&
    !Array.isArray(rawInput) &&
    rawInput.summary === undefined &&
    rawInput.data !== null &&
    typeof rawInput.data === "object" &&
    !Array.isArray(rawInput.data)
  ) {
    return rawInput.data;
  }

  return rawInput;
}

function buildRejectionStrategy(
  successStrategy,
  payload,
) {
  const strategy = clone(successStrategy);
  const actualValue = payload.stats[0].stat.value;

  const rejectedThreshold =
    actualValue === I32_MAX
      ? actualValue - 1
      : actualValue + 1;

  strategy
    .discretePredicates[0]
    .single
    .predicate
    .threshold = rejectedThreshold;

  validateStrategyCoverage(
    strategy,
    payload.stats.length,
  );

  return strategy;
}

function buildInvalidProofPayload(payload) {
  const invalidPayload = clone(payload);

  invalidPayload.eventStatRoot[0] =
    invalidPayload.eventStatRoot[0] ^ 0xff;

  return invalidPayload;
}

export function buildReplayBundle(rawInput) {
  const rawResponse = unwrapApiResponse(rawInput);
  const normalized = normalizeV2Proof(rawResponse);

  const successStrategy =
    buildExactEqualityStrategy(normalized.payload);

  const rejectionStrategy =
    buildRejectionStrategy(
      successStrategy,
      normalized.payload,
    );

  const invalidProofPayload =
    buildInvalidProofPayload(normalized.payload);

  return {
    version: 1,
    network: normalized.network,
    apiBase: normalized.apiBase,
    programId: normalized.programId,
    epochDay: normalized.epochDay,
    pdaSeeds: normalized.pdaSeeds,

    expectations: {
      validPayloadWithSuccessStrategy: true,
      validPayloadWithRejectionStrategy: false,
      invalidProofPayload: "transaction rejection",
    },

    payload: normalized.payload,

    strategies: {
      success: successStrategy,
      rejection: rejectionStrategy,
    },

    mutations: {
      invalidProofPayload,
      mutation:
        "eventStatRoot[0] XOR 255",
    },

    integrity: {
      rawResponseSha256: sha256(rawResponse),
      validPayloadSha256:
        sha256(normalized.payload),
      successStrategySha256:
        sha256(successStrategy),
      rejectionStrategySha256:
        sha256(rejectionStrategy),
      invalidProofPayloadSha256:
        sha256(invalidProofPayload),
    },
  };
}

export async function writeReplayBundle(
  bundle,
  outputDirectory,
) {
  const outputDir = path.resolve(outputDirectory);

  await mkdir(outputDir, {
    recursive: true,
  });

  const files = {
    validPayload: "payload.valid.json",
    successStrategy: "strategy.success.json",
    rejectionStrategy:
      "strategy.rejection.json",
    invalidProofPayload:
      "payload.invalid-proof.json",
    manifest: "replay-manifest.json",
  };

  const documents = {
    [files.validPayload]: bundle.payload,
    [files.successStrategy]:
      bundle.strategies.success,
    [files.rejectionStrategy]:
      bundle.strategies.rejection,
    [files.invalidProofPayload]:
      bundle.mutations.invalidProofPayload,
  };

  for (const [filename, document] of
    Object.entries(documents)) {
    await writeFile(
      path.join(outputDir, filename),
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
  }

  const manifest = {
    version: bundle.version,
    network: bundle.network,
    apiBase: bundle.apiBase,
    programId: bundle.programId,
    epochDay: bundle.epochDay,
    pdaSeeds: bundle.pdaSeeds,
    expectations: bundle.expectations,
    mutation: bundle.mutations.mutation,
    integrity: bundle.integrity,
    files,
  };

  await writeFile(
    path.join(outputDir, files.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

function usage() {
  return [
    "Usage:",
    "  npm run txline:replay -- \\",
    "    --input <raw-proof.json> \\",
    "    --output-dir <directory>",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (
      argument === "--help" ||
      argument === "-h"
    ) {
      options.help = true;
      continue;
    }

    if (argument === "--input") {
      options.input = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--output-dir") {
      options.outputDir = argv[index + 1];
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

  if (!options.input) {
    throw new Error(
      `Missing --input argument.\n\n${usage()}`,
    );
  }

  const inputPath = path.resolve(options.input);

  const outputDirectory = path.resolve(
    options.outputDir ??
      path.join(
        "replay-output",
        path.basename(
          inputPath,
          path.extname(inputPath),
        ),
      ),
  );

  const rawText = await readFile(
    inputPath,
    "utf8",
  );

  const rawInput = JSON.parse(rawText);
  const bundle = buildReplayBundle(rawInput);

  const manifest = await writeReplayBundle(
    bundle,
    outputDirectory,
  );

  console.log(
    JSON.stringify(
      {
        input: inputPath,
        outputDirectory,
        epochDay: manifest.epochDay,
        statCount: bundle.payload.stats.length,
        expectations: manifest.expectations,
        files: manifest.files,
      },
      null,
      2,
    ),
  );
}

const currentFile = fileURLToPath(import.meta.url);

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile;

if (isMain) {
  main().catch((error) => {
    console.error(
      `TxLINE replay preparation failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}
