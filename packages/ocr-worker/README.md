# OCR Worker

The worker runs PP-OCRv4 mobile through RapidOCR with the OpenVINO CPU backend.
It is a single long-lived Python process controlled by the Nitro server through
newline-delimited JSON.

Development setup:

```bash
sh packages/ocr-worker/setup-runtime.sh
```

The virtual environment is stored in `.data/ocr-venv` and is intentionally not
bundled in the application package. On fnOS, run the packaged setup script with
`STORAGE_DIR=/var/apps/fnos-app-family-stock/var/data` after a compatible
Python 3.9-3.12 runtime is available.

The target Intel J4105 device must be validated before release. Development on
Apple Silicon does not verify x86 instruction compatibility or J4105 latency.
