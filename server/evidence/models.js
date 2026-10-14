import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getEvidenceModel } from "../../src/evidence-models.js";

// Only fixed names from the authored manifest can enter this filesystem lookup.
export function resolveEvidenceModel(clueId) {
  return getEvidenceModel(clueId, (filename) =>
    existsSync(
      fileURLToPath(
        new URL(`../../public/models/${filename}.glb`, import.meta.url),
      ),
    ),
  );
}

// Retain previously issued cached model URLs when a formal asset replaces a sample.
export function evidenceModelFilenames(clueId) {
  const fallback = getEvidenceModel(clueId);
  const formal = getEvidenceModel(clueId, () => true);
  return [...new Set([fallback?.filename, formal?.filename].filter(Boolean))];
}

export function modelFileExists(filename) {
  return existsSync(
    fileURLToPath(
      new URL(`../../public/models/${filename}.glb`, import.meta.url),
    ),
  );
}
