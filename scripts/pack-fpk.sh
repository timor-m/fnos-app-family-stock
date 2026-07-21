#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/.fnos-build/package"
DIST_DIR="${ROOT_DIR}/dist"

FNPACK_BIN="${ROOT_DIR}/tools/fnpack"

if [ ! -x "${FNPACK_BIN}" ]; then
  if command -v fnpack >/dev/null 2>&1; then
    FNPACK_BIN="$(command -v fnpack)"
  else
    echo "fnpack is not installed."
    echo "You can place a local binary at tools/fnpack, then rerun: npm run pack:fpk"
    exit 1
  fi
fi

mkdir -p "${DIST_DIR}"
APP_NAME="$(sed -n 's/^appname=//p' "${PACKAGE_DIR}/manifest" | head -n 1)"

if [ -z "${APP_NAME}" ]; then
  echo "Unable to read appname from manifest."
  exit 1
fi

rm -f "${ROOT_DIR}/${APP_NAME}.fpk" "${DIST_DIR}/${APP_NAME}.fpk"
(
  cd "${ROOT_DIR}"
  "${FNPACK_BIN}" build --directory "${PACKAGE_DIR}"
)

if [ ! -f "${ROOT_DIR}/${APP_NAME}.fpk" ]; then
  echo "fnpack did not generate ${APP_NAME}.fpk."
  exit 1
fi

mv "${ROOT_DIR}/${APP_NAME}.fpk" "${DIST_DIR}/${APP_NAME}.fpk"
echo "Generated: ${DIST_DIR}/${APP_NAME}.fpk"
