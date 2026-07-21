#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
DATA_DIR="${STORAGE_DIR:-.data}"
VENV_DIR="${OCR_VENV_DIR:-${DATA_DIR}/ocr-venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install -r "${SCRIPT_DIR}/requirements.txt"
"${VENV_DIR}/bin/python" "${SCRIPT_DIR}/worker.py" --check

printf 'OCR runtime installed at %s\n' "${VENV_DIR}"
