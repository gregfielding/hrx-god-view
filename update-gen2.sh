#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-central1}"

echo "Listing Gen2 Cloud Functions in region: $REGION"

# Try modern flags first; fall back to older CLI syntax.
if functions=$(gcloud functions list --gen2 --region="$REGION" --format='value(name)' 2>/dev/null) && [[ -n "$functions" ]]; then
  :
else
  functions=$(gcloud functions list --v2 --regions="$REGION" --format='value(name)' 2>/dev/null || true)
fi

if [[ -z "${functions:-}" ]]; then
  echo "No Gen2 functions found in $REGION (or gcloud too old)."
  exit 0
fi

echo "Functions to update:"
printf ' - %s\n' $functions
echo

# Pick the right flag for deploy once
if gcloud functions deploy --help 2>/dev/null | grep -q -- '--gen2'; then
  GEN2_FLAG=--gen2
else
  GEN2_FLAG=--v2
fi

# Update JUST the service config (no code/image build)
for f in $functions; do
  echo "Updating: $f"
  gcloud functions deploy "$f" \
    "$GEN2_FLAG" \
    --region="$REGION" \
    --no-source \
    --max-instances=2 \
    --min-instances=0 \
    --timeout=30s \
    --memory=512Mi \
    --quiet || echo "⚠️  Failed to update $f (continuing)"
done

echo "Done."
