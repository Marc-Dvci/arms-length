#!/bin/sh
# Arm's Length release gate for Bitbucket Pipelines.
# Asks the paired Jira site for the independence verdict of the commit being deployed and
# stops the step unless every work item it ships is PASS.
#
# Repository variables: ARMS_LENGTH_URL (the endpoint shown in the Arm's Length settings in Jira)
# and ARMS_LENGTH_SECRET (secured; the pairing secret). Needs sh, curl and openssl.
set -eu

: "${ARMS_LENGTH_URL:?Set ARMS_LENGTH_URL to the endpoint shown in the Arms Length settings in Jira}"
: "${ARMS_LENGTH_SECRET:?Set ARMS_LENGTH_SECRET as a secured repository variable}"

environment="${1:-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-production}}"
repository="${BITBUCKET_REPO_FULL_NAME:-${BITBUCKET_WORKSPACE:-}/${BITBUCKET_REPO_SLUG:-}}"
case "$repository" in
  */*) [ "${repository%%/*}" ] && [ "${repository#*/}" ] || { echo "Set BITBUCKET_REPO_FULL_NAME to workspace/repository."; exit 1; } ;;
  *) echo "Set BITBUCKET_REPO_FULL_NAME to workspace/repository."; exit 1 ;;
esac
# Pipeline variables are data. Refuse characters that could change the JSON body.
case "$repository$environment${BITBUCKET_COMMIT:-}${BITBUCKET_BUILD_NUMBER:-}${BITBUCKET_STEP_TRIGGERER_UUID:-}" in
  *[!a-zA-Z0-9_./:{}-]*) echo "Invalid release gate input; release stopped."; exit 1 ;;
esac
body=$(printf '{"op":"deploy-gate","repo":"%s","commit":"%s","environment":"%s","build":"%s","triggeredBy":"%s"}' \
  "$repository" "${BITBUCKET_COMMIT:?BITBUCKET_COMMIT is not set}" "$environment" \
  "${BITBUCKET_BUILD_NUMBER:-}" "${BITBUCKET_STEP_TRIGGERER_UUID:-}")
t=$(date +%s)
mac=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "$ARMS_LENGTH_SECRET" | sed 's/^.*= //')

response=$(curl -sS --max-time 60 -X POST "$ARMS_LENGTH_URL" \
  -H 'Content-Type: application/json' \
  -H "x-arms-length-signature: t=$t,v1=$mac" \
  --data "$body") || { echo "Arm's Length could not be reached; release stopped."; exit 1; }

message=$(printf '%s' "$response" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
echo "${message:-$response}"
case "$response" in
  *'"allow":true'*) exit 0 ;;
  *) exit 1 ;;
esac
