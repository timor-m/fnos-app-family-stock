#!/usr/bin/env python3
"""Single-process RapidOCR/OpenVINO worker using NDJSON over stdin/stdout."""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
import tempfile
from pathlib import Path
from typing import Any

ENGINE_NAME = "rapidocr-openvino"
MODEL_VERSION = "PP-OCRv4-mobile"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def load_engine():
    from rapidocr_openvino import RapidOCR

    return RapidOCR()


def runtime_check() -> int:
    try:
        import openvino
        import rapidocr_openvino

        emit(
            {
                "ok": True,
                "engine": ENGINE_NAME,
                "modelVersion": MODEL_VERSION,
                "rapidocrVersion": getattr(rapidocr_openvino, "__version__", "unknown"),
                "openvinoVersion": getattr(openvino, "__version__", "unknown"),
                "pythonVersion": sys.version.split()[0],
            }
        )
        return 0
    except Exception as error:  # Runtime diagnostics must remain available without dependencies.
        emit(
            {
                "ok": False,
                "errorCode": "OCR_RUNTIME_UNAVAILABLE",
                "errorMessage": str(error),
                "pythonVersion": sys.version.split()[0],
            }
        )
        return 2


def normalize_result(result: Any, start_index: int = 0, variant: str | None = None) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    if not result:
        return lines

    for index, item in enumerate(result):
        if not item or len(item) < 3:
            continue
        box, text, confidence = item[0], item[1], item[2]
        if hasattr(box, "tolist"):
            box = box.tolist()
        line = {
            "id": f"line_{start_index + index + 1}",
            "text": str(text),
            "confidence": float(confidence),
            "box": box,
        }
        if variant:
            line["variant"] = variant
        lines.append(line)
    return lines


def dedupe_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for line in lines:
        text = str(line.get("text", "")).strip()
        key = "".join(character.lower() for character in text if character.isalnum())
        if not key:
            continue
        previous = best.get(key)
        if previous is None:
            best[key] = line
            order.append(key)
        elif float(line.get("confidence", 0)) > float(previous.get("confidence", 0)):
            best[key] = line
    return [best[key] for key in order]


def date_image_variants(image_path: Path, temp_dir: Path) -> list[tuple[str, Path]]:
    """Create lightweight variants that help dot-matrix / low-contrast date codes.

    RapidOCR handles regular package text well. Production dates are often tiny,
    reflective, or printed as pale dot-matrix codes, so we add a few CPU-cheap
    enhanced copies only for the date image role.
    """
    variants: list[tuple[str, Path]] = [("original", image_path)]
    try:
        import cv2

        image = cv2.imread(str(image_path))
        if image is None:
            return variants

        height, width = image.shape[:2]
        scale = 3 if max(height, width) < 1400 else 2
        enlarged = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)

        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        contrast = clahe.apply(gray)
        sharpened = cv2.addWeighted(contrast, 1.7, cv2.GaussianBlur(contrast, (0, 0), 1.2), -0.7, 0)
        _, otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adaptive = cv2.adaptiveThreshold(
            sharpened,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            7,
        )
        inverted = cv2.bitwise_not(adaptive)

        generated = [
            ("date_contrast", contrast),
            ("date_sharpen", sharpened),
            ("date_binary", otsu),
            ("date_adaptive_invert", inverted),
        ]
        for label, data in generated:
            path = temp_dir / f"{label}.png"
            if cv2.imwrite(str(path), data):
                variants.append((label, path))
    except Exception as error:
        print(f"OCR date preprocessing skipped: {error}", file=sys.stderr, flush=True)
    return variants


def recognize_image(engine: Any, image_path: Path, image_role: str | None) -> tuple[list[dict[str, Any]], Any]:
    if image_role != "date":
        result, engine_elapsed = engine(str(image_path))
        return normalize_result(result), engine_elapsed

    all_lines: list[dict[str, Any]] = []
    elapsed_parts: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="family-stock-ocr-") as temp_name:
        variants = date_image_variants(image_path, Path(temp_name))
        for label, variant_path in variants:
            started = time.perf_counter()
            result, engine_elapsed = engine(str(variant_path))
            elapsed_parts.append(
                {
                    "variant": label,
                    "engineElapsed": engine_elapsed,
                    "elapsedMs": round((time.perf_counter() - started) * 1000),
                }
            )
            all_lines.extend(normalize_result(result, len(all_lines), label))

    return dedupe_lines(all_lines), {"variants": elapsed_parts}


def run_daemon() -> int:
    try:
        engine = load_engine()
    except Exception as error:
        emit(
            {
                "type": "ready",
                "ok": False,
                "errorCode": "OCR_RUNTIME_UNAVAILABLE",
                "errorMessage": str(error),
            }
        )
        return 2

    emit(
        {
            "type": "ready",
            "ok": True,
            "engine": ENGINE_NAME,
            "modelVersion": MODEL_VERSION,
        }
    )

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            image_path = Path(request["imagePath"])
            image_role = str(request.get("imageRole") or "")
            if not image_path.is_file():
                raise FileNotFoundError(f"Image does not exist: {image_path}")

            started = time.perf_counter()
            lines, engine_elapsed = recognize_image(engine, image_path, image_role)
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            emit(
                {
                    "id": request_id,
                    "ok": True,
                    "engine": ENGINE_NAME,
                    "modelVersion": MODEL_VERSION,
                    "lines": lines,
                    "elapsedMs": elapsed_ms,
                    "engineElapsed": engine_elapsed,
                }
            )
        except Exception as error:
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "errorCode": "OCR_INFERENCE_FAILED",
                    "errorMessage": str(error),
                }
            )

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    return runtime_check() if args.check else run_daemon()


if __name__ == "__main__":
    raise SystemExit(main())
