#!/usr/bin/env bash
# Cascade-tree mirror check (R.16.1 §L8).
#
# The cascade engine + registry + types live in two real trees +
# one symlink:
#   - src/shared/cascade/      (CRA-side; canonical for client code)
#   - shared/cascade/          (root-level real tree; canonical for
#                               cloud functions — symlinked into
#                               `functions/src/shared/cascade/` so
#                               the `rootDir: src` constraint still
#                               lets functions import it via
#                               `./shared/cascade/...`)
#   - functions/src/shared/cascade/  (symlink → ../../shared/cascade)
#
# `loaders.ts` is intentionally NOT byte-identical between the trees:
# the CRA side imports the modular `firebase` SDK and the root side
# imports `firebase-admin`. The `FIELD_PATHS_BY_LEVEL` constant (the
# only logic shared between them) IS checked for parity at the end
# of this script.
#
# Drift between the trees has been a known foot-gun for months (audit
# §E.4). This script is a hard fail in CI to keep them aligned. It
# also diffs the per-level field-path map between the CRA loader and
# the admin loader (the only file that's deliberately *not* identical
# but whose `FIELD_PATHS_BY_LEVEL` constant must stay in sync).
#
# Exits non-zero on any drift; prints a side-by-side diff for the
# offending file. Run from repo root.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

red='\033[0;31m'
green='\033[0;32m'
nc='\033[0m'

fail=0

# --- Files that must be byte-identical across trees ----------------

mirrored_files=(
  "types.ts"
  "registry.ts"
  "resolveCascadedField.ts"
  "index.ts"
)

for filename in "${mirrored_files[@]}"; do
  cra="src/shared/cascade/${filename}"
  root="shared/cascade/${filename}"

  if ! diff -q "${cra}" "${root}" >/dev/null 2>&1; then
    echo -e "${red}✗ DRIFT:${nc} ${cra} ↔ ${root}"
    diff "${cra}" "${root}" || true
    fail=1
  fi
done

# Symlink-integrity check: functions/src/shared should resolve to
# the root-level shared/ directory. Re-asserting the topology here
# makes a corrupted clone (where the symlink is missing or wrong)
# obvious in CI rather than failing later with mysterious import
# errors.
expected="${repo_root}/shared/cascade"
resolved="$(cd functions/src/shared/cascade 2>/dev/null && pwd -P || true)"
if [[ "${resolved}" != "${expected}" ]]; then
  echo -e "${red}✗ TOPOLOGY:${nc} functions/src/shared/cascade does not resolve"
  echo "         to shared/cascade (expected functions/src/shared symlink → ../../shared)."
  echo "         Resolved: ${resolved:-<missing>}"
  echo "         Expected: ${expected}"
  fail=1
fi

# --- Loader field-path map parity -----------------------------------
# The two loaders themselves are NOT byte-identical (different SDKs),
# but the FIELD_PATHS_BY_LEVEL constant must match. Extract the const
# block from both files (everything between the marker comments) and
# diff just that chunk.

extract_field_paths() {
  # Print only the key-value lines inside FIELD_PATHS_BY_LEVEL. We
  # strip comments (// ...), trailing commas, and whitespace, so the
  # admin loader and CRA loader can use different prose without
  # tripping the diff. The PATHS themselves (right-hand side of `:`)
  # are what must match.
  awk '
    /^const FIELD_PATHS_BY_LEVEL/ { capture=1; next }
    capture && /^};$/ { capture=0 }
    capture {
      # Drop full-line comments
      if ($0 ~ /^[[:space:]]*\/\//) next
      # Drop blank lines
      if ($0 ~ /^[[:space:]]*$/) next
      # Strip trailing comments
      sub(/[[:space:]]*\/\/.*$/, "")
      # Trim leading + trailing whitespace, normalize commas
      gsub(/^[[:space:]]+/, "")
      gsub(/[[:space:]]+$/, "")
      print
    }
  ' "$1"
}

cra_paths="$(extract_field_paths src/shared/cascade/loaders.ts)"
fn_paths="$(extract_field_paths functions/src/shared/cascade/loaders.ts)"

if [[ "${cra_paths}" != "${fn_paths}" ]]; then
  echo -e "${red}✗ DRIFT:${nc} FIELD_PATHS_BY_LEVEL constant differs between"
  echo "         src/shared/cascade/loaders.ts and"
  echo "         functions/src/shared/cascade/loaders.ts"
  diff <(echo "${cra_paths}") <(echo "${fn_paths}") || true
  fail=1
fi

# --- Result ---------------------------------------------------------

if [[ "${fail}" -eq 0 ]]; then
  echo -e "${green}✓ Cascade trees are in lockstep.${nc}"
  exit 0
fi

echo
echo -e "${red}Cascade tree drift detected.${nc} Either re-run the mirror copy"
echo "(see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L8) or update all"
echo "trees together as one commit."
exit 1
