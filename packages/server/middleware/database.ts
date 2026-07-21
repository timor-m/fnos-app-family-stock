import { defineEventHandler } from "h3";
import { getDatabase } from "../database/client";
import { ocrJobRunner } from "../services/ocr-job-runner.service";
import { aiJobRunner } from "../services/ai-job-runner.service";

export default defineEventHandler(() => {
  getDatabase();
  ocrJobRunner.start();
  aiJobRunner.start();
});
