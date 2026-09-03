#!/bin/sh
set -eu

mkdir -p "${DATA_DIR}"

for file in control.json winners.json; do
  if [ ! -f "${DATA_DIR}/${file}" ]; then
    cp "/app/data-seed/${file}" "${DATA_DIR}/${file}"
  fi
done

exec "$@"
