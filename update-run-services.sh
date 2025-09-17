#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-central1}"

echo "==> Listing Cloud Run services in region: $REGION"
services=$(gcloud run services list \
  --platform=managed \
  --region="$REGION" \
  --format='value(metadata.name)')

if [[ -z "${services:-}" ]]; then
  echo "No Cloud Run services found in $REGION."
  exit 0
fi

echo "==> Found $(echo "$services" | wc -w | xargs) services"
echo

UPDATED=()
SKIPPED=()

for s in $services; do
  # Only update services that have a READY revision we can reuse
  ready_rev=$(gcloud run services describe "$s" \
    --platform=managed \
    --region="$REGION" \
    --format='value(status.latestReadyRevisionName)') || ready_rev=""

  if [[ -z "${ready_rev}" ]]; then
    echo "⚠️  Skipping $s (no latestReadyRevisionName / not READY)"
    SKIPPED+=("$s")
    continue
  fi

  echo "Updating $s (current ready rev: $ready_rev)..."
  if gcloud run services update "$s" \
      --platform=managed \
      --region="$REGION" \
      --max-instances=2 \
      --min-instances=0 \
      --concurrency=80 \
      --cpu=1 \
      --memory=512Mi \
      --timeout=30s \
      --quiet; then
    UPDATED+=("$s")
  else
    echo "⚠️  Failed to update $s (leaving as-is)"
    SKIPPED+=("$s")
  fi
done

echo
echo "==> Summary"
echo "Updated  : ${#UPDATED[@]}"
for x in "${UPDATED[@]}"; do echo "  - $x"; done
echo "Skipped  : ${#SKIPPED[@]}"
for x in "${SKIPPED[@]}"; do echo "  - $x"; done
echo "Done."
