export type OcrLine = {
  id: string;
  text: string;
  confidence: number;
  box?: number[][];
};

export type ParsedFieldCandidate = {
  fieldKey: string;
  value: string | number | { value: number; unit: "day" | "month" | "year" };
  confidence: number;
  evidence: {
    imageId: string;
    lineIds: string[];
    sourceText: string;
    ocrConfidence: number;
  };
};

const chineseDigits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function parseChineseNumber(value: string) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  if (value === "十") {
    return 10;
  }

  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? chineseDigits[tens] : 1) * 10 + (ones ? chineseDigits[ones] : 0);
  }

  let result = 0;
  for (const character of value) {
    if (!(character in chineseDigits)) {
      return null;
    }
    result = result * 10 + chineseDigits[character];
  }
  return result;
}

function normalizeDate(yearValue: string, monthValue: string, dayValue: string) {
  let year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);

  if (yearValue.length === 2) {
    year += year >= 70 ? 1900 : 2000;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findDate(text: string) {
  const separated = text.match(/(20\d{2}|\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/);
  if (separated) {
    return normalizeDate(separated[1], separated[2], separated[3]);
  }

  const compact = text.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) {
    return normalizeDate(compact[1], compact[2], compact[3]);
  }

  return null;
}

function candidate(
  fieldKey: string,
  value: ParsedFieldCandidate["value"],
  imageId: string,
  line: OcrLine,
  confidenceMultiplier = 1
): ParsedFieldCandidate {
  const confidence = Math.max(0, Math.min(1, line.confidence * confidenceMultiplier));
  return {
    fieldKey,
    value,
    confidence,
    evidence: {
      imageId,
      lineIds: [line.id],
      sourceText: line.text,
      ocrConfidence: line.confidence
    }
  };
}

function cleanProductName(value: string) {
  return value
    .replace(/(保质期|生产日期|制造日期|产品标准号|产品类别|委托商|生产商|配料表|营养成分表)[：:].*$/i, "")
    .replace(/[，,。；;]+$/g, "")
    .trim()
    .slice(0, 80);
}

export function calculateExpirationDate(
  dateValue: string,
  shelfLife: { value: number; unit: "day" | "month" | "year" }
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (shelfLife.unit === "day") {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + shelfLife.value);
    return date.toISOString().slice(0, 10);
  }

  const totalMonths =
    shelfLife.unit === "month"
      ? year * 12 + (month - 1) + shelfLife.value
      : (year + shelfLife.value) * 12 + (month - 1);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(day, lastDay)));
  return date.toISOString().slice(0, 10);
}

export function parseOcrLines(
  imageId: string,
  lines: OcrLine[],
  options: { expirationEnabled?: boolean; imageRole?: string } = {}
) {
  const candidates: ParsedFieldCandidate[] = [];
  const expirationEnabled = options.expirationEnabled !== false;

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }

    const productNameMatch = text.match(/(?:产品名称|品名|商品名称)[：:]\s*(.+)$/i);
    if (productNameMatch) {
      const name = cleanProductName(productNameMatch[1]);
      if (name && !/^(见瓶体|见包装|详见包装)$/i.test(name)) {
        candidates.push(candidate("name", name, imageId, line, 0.98));
      }
    }

    if (expirationEnabled) {
      const date = findDate(text);
      if (date) {
        if (/(生产日期|制造日期|生产日|MFG|MFD)/i.test(text)) {
          candidates.push(candidate("productionDate", date, imageId, line));
        } else if (/(有效期至|保质期至|限用日期|失效日期|到期|EXP)/i.test(text)) {
          candidates.push(candidate("expirationDate", date, imageId, line));
        } else if (options.imageRole === "date") {
          candidates.push(candidate("productionDate", date, imageId, line, 0.82));
        }
      }

      const shelfLifeMatch = text.match(
        /保质期[为:]?\s*([零〇一二两三四五六七八九十\d]+)\s*(天|日|个?月|年)/i
      );
      if (shelfLifeMatch) {
        const value = parseChineseNumber(shelfLifeMatch[1]);
        const rawUnit = shelfLifeMatch[2];
        if (value && value > 0) {
          const unit = rawUnit.includes("月") ? "month" : rawUnit.includes("年") ? "year" : "day";
          candidates.push(candidate("shelfLife", { value, unit }, imageId, line));
        }
      }
    }

    const specificationMatch = text.match(
      /(?:净含量|净重|规格)[：:]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:kg|g|mg|ml|mL|L|升|克|千克|毫升|片|粒|袋|盒|瓶)(?:\s*[x×*]\s*\d+\s*(?:袋|盒|瓶|包|支|片))?)/i
    );
    if (specificationMatch) {
      candidates.push(candidate("specification", specificationMatch[1].replace(/\s+/g, ""), imageId, line));
    }
  }

  const bestByField = new Map<string, ParsedFieldCandidate>();
  for (const current of candidates) {
    const previous = bestByField.get(current.fieldKey);
    if (!previous || current.confidence > previous.confidence) {
      bestByField.set(current.fieldKey, current);
    }
  }

  const productionDate = bestByField.get("productionDate");
  const shelfLife = bestByField.get("shelfLife");
  if (productionDate && shelfLife && !bestByField.has("expirationDate")) {
    const computedValue = calculateExpirationDate(
      productionDate.value as string,
      shelfLife.value as { value: number; unit: "day" | "month" | "year" }
    );
    bestByField.set("expirationDate", {
      fieldKey: "expirationDate",
      value: computedValue,
      confidence: Math.min(productionDate.confidence, shelfLife.confidence) * 0.9,
      evidence: {
        imageId,
        lineIds: [...productionDate.evidence.lineIds, ...shelfLife.evidence.lineIds],
        sourceText: `${productionDate.evidence.sourceText}；${shelfLife.evidence.sourceText}`,
        ocrConfidence: Math.min(
          productionDate.evidence.ocrConfidence,
          shelfLife.evidence.ocrConfidence
        )
      }
    });
  }

  return [...bestByField.values()];
}
