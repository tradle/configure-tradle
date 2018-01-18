#!/bin/bash

set -euo pipefail
IFS=$'\n\t'
export AWS_DEFAULT_OUTPUT="json"

source ./scripts/load-env.sh

files=(
  "conf/style.json"
  "conf/bot.json"
  "conf/models-pack.json"
  "conf/terms-and-conditions.md"
)

tmp=$(mktemp)

for key in ${files[@]}
do
  echo "downloading $key"
  {
    eval $s3 get-object \
    --bucket "$bucket" \
    --key "$key" \
    "$tmp" >/dev/null 2>&1 && \
    cat "$tmp" | jq . > "./$key"
  } || echo "$key not found"
done

echo "done!"
rm -f $tmp
