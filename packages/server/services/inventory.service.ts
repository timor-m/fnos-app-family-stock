import { createError } from "h3";
import { getDatabase } from "../database/client";
import { getFamilyRole } from "../utils/access-control";
import { createId } from "../utils/identifier";
import type { RequestUser } from "../utils/request-user";

export type ManualStockInInput = {
  productId?: string | null;
  familyId: string;
  locationId: string;
  storagePlaceId?: string | null;
  categoryId: string;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  specification?: string | null;
  ingredients?: string | null;
  quantity: number;
  unit: string;
  purchasedAt?: string | null;
  productionDate?: string | null;
  shelfLifeValue?: number | null;
  shelfLifeUnit?: "day" | "month" | "year" | null;
  expirationDate?: string | null;
  unitPrice?: number | null;
  channel?: string | null;
  lowStockThreshold?: number | null;
  coverImageId?: string | null;
};

export type InventoryBatchUpdateInput = {
  categoryId: string;
  storagePlaceId?: string | null;
  name: string;
  brand?: string | null;
  specification?: string | null;
  ingredients?: string | null;
  unit: string;
  purchasedAt?: string | null;
  productionDate?: string | null;
  shelfLifeValue?: number | null;
  shelfLifeUnit?: "day" | "month" | "year" | null;
  expirationDate?: string | null;
  unitPrice?: number | null;
  channel?: string | null;
  lowStockThreshold?: number | null;
};

export type StockOperationInput =
  | {
      operationType: "consume" | "discard";
      quantity: number;
      reason: string | null;
    }
  | {
      operationType: "transfer";
      quantity: number;
      toLocationId: string;
      toStoragePlaceId?: string | null;
      reason: string | null;
    }
  | {
      operationType: "adjust";
      targetQuantity: number;
      reason: string;
    };

type BatchOperationRow = {
  batchId: string;
  productId: string;
  familyId: string;
  locationId: string;
  storagePlaceId: string | null;
  currentQuantity: number;
  unit: string;
  purchasedAt: string | null;
  productionDate: string | null;
  shelfLifeValue: number | null;
  shelfLifeUnit: string | null;
  expirationDate: string | null;
  unitPrice: number | null;
  channel: string | null;
  status: string;
};

type InventoryHistoryRow = {
  transactionId: string;
  transactionType: string;
  initialQuantity: number;
  unit: string;
  reason: string | null;
  finalizedAt: string;
  operatorUserId: string;
  operatorName: string | null;
  batchId: string;
  batchStatus: string;
  currentQuantity: number;
  productId: string;
  name: string;
  brand: string | null;
  categoryName: string;
  categoryKey: string;
  fromLocationId: string | null;
  fromLocationName: string | null;
  toLocationId: string | null;
  toLocationName: string | null;
  expirationDate: string | null;
  unitPrice: number | null;
  channel: string | null;
};

function optionalText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function validateDate(value: string | null, fieldName: string) {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName}格式无效`
    });
  }
}

export function parseManualStockInInput(body: Record<string, unknown>): ManualStockInInput {
  const name = optionalText(body.name);
  const familyId = optionalText(body.familyId);
  const locationId = optionalText(body.locationId);
  const categoryId = optionalText(body.categoryId);
  const unit = optionalText(body.unit);
  const quantity = Number(body.quantity);
  const unitPrice = body.unitPrice === "" || body.unitPrice === null || body.unitPrice === undefined
    ? null
    : Number(body.unitPrice);
  const lowStockThreshold =
    body.lowStockThreshold === "" || body.lowStockThreshold === null || body.lowStockThreshold === undefined
      ? null
      : Number(body.lowStockThreshold);
  const purchasedAt = optionalText(body.purchasedAt);
  const productionDate = optionalText(body.productionDate);
  const expirationDate = optionalText(body.expirationDate);
  const shelfLifeValue =
    body.shelfLifeValue === "" || body.shelfLifeValue === null || body.shelfLifeValue === undefined
      ? null
      : Number(body.shelfLifeValue);
  const shelfLifeUnit = optionalText(body.shelfLifeUnit);

  if (!name || !familyId || !locationId || !categoryId || !unit) {
    throw createError({
      statusCode: 400,
      statusMessage: "商品名称、家庭、地点、品类和单位不能为空"
    });
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "入库数量必须大于 0"
    });
  }

  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "商品价格格式无效"
    });
  }

  if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "低库存阈值格式无效"
    });
  }

  validateDate(purchasedAt, "购买日期");
  validateDate(productionDate, "生产日期");
  validateDate(expirationDate, "到期日期");
  if (shelfLifeValue !== null && (!Number.isInteger(shelfLifeValue) || shelfLifeValue <= 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "保质期数值格式无效"
    });
  }
  if (shelfLifeValue !== null && !["day", "month", "year"].includes(shelfLifeUnit || "")) {
    throw createError({
      statusCode: 400,
      statusMessage: "保质期单位无效"
    });
  }

  return {
    productId: optionalText(body.productId),
    familyId,
    locationId,
    storagePlaceId: optionalText(body.storagePlaceId),
    categoryId,
    name,
    brand: optionalText(body.brand),
    barcode: optionalText(body.barcode),
    specification: optionalText(body.specification),
    ingredients: optionalText(body.ingredients),
    quantity,
    unit,
    purchasedAt,
    productionDate,
    shelfLifeValue,
    shelfLifeUnit: shelfLifeUnit as "day" | "month" | "year" | null,
    expirationDate,
    unitPrice,
    channel: optionalText(body.channel),
    lowStockThreshold,
    coverImageId: optionalText(body.coverImageId)
  };
}

export function parseInventoryBatchUpdateInput(body: Record<string, unknown>): InventoryBatchUpdateInput {
  const name = optionalText(body.name);
  const categoryId = optionalText(body.categoryId);
  const unit = optionalText(body.unit);
  const unitPrice = body.unitPrice === "" || body.unitPrice === null || body.unitPrice === undefined
    ? null
    : Number(body.unitPrice);
  const lowStockThreshold =
    body.lowStockThreshold === "" || body.lowStockThreshold === null || body.lowStockThreshold === undefined
      ? null
      : Number(body.lowStockThreshold);
  const purchasedAt = optionalText(body.purchasedAt);
  const productionDate = optionalText(body.productionDate);
  const expirationDate = optionalText(body.expirationDate);
  const shelfLifeValue =
    body.shelfLifeValue === "" || body.shelfLifeValue === null || body.shelfLifeValue === undefined
      ? null
      : Number(body.shelfLifeValue);
  const shelfLifeUnit = optionalText(body.shelfLifeUnit);

  if (!name || !categoryId || !unit) {
    throw createError({
      statusCode: 400,
      statusMessage: "商品名称、品类和单位不能为空"
    });
  }

  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "商品价格格式无效"
    });
  }

  if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "低库存阈值格式无效"
    });
  }

  validateDate(purchasedAt, "购买日期");
  validateDate(productionDate, "生产日期");
  validateDate(expirationDate, "到期日期");
  if (shelfLifeValue !== null && (!Number.isInteger(shelfLifeValue) || shelfLifeValue <= 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "保质期数值格式无效"
    });
  }
  if (shelfLifeValue !== null && !["day", "month", "year"].includes(shelfLifeUnit || "")) {
    throw createError({
      statusCode: 400,
      statusMessage: "保质期单位无效"
    });
  }

  return {
    categoryId,
    storagePlaceId: optionalText(body.storagePlaceId),
    name,
    brand: optionalText(body.brand),
    specification: optionalText(body.specification),
    ingredients: optionalText(body.ingredients),
    unit,
    purchasedAt,
    productionDate,
    shelfLifeValue,
    shelfLifeUnit: shelfLifeUnit as "day" | "month" | "year" | null,
    expirationDate,
    unitPrice,
    channel: optionalText(body.channel),
    lowStockThreshold
  };
}

export function createManualStockIn(
  input: ManualStockInInput,
  user: RequestUser,
  options: { manageTransaction?: boolean } = {}
) {
  const db = getDatabase();
  const manageTransaction = options.manageTransaction !== false;
  const location = db.prepare(`
    SELECT 1
    FROM locations
    WHERE id = ? AND family_id = ?
  `).get(input.locationId, input.familyId);
  const category = db.prepare("SELECT 1 FROM category_templates WHERE id = ?").get(input.categoryId);

  if (!getFamilyRole(user, input.familyId) || !location || !category) {
    throw createError({
      statusCode: 404,
      statusMessage: "家庭、地点或品类不存在"
    });
  }

  let storagePlaceId: string | null = input.storagePlaceId ?? null;
  if (storagePlaceId) {
    const place = db.prepare(`
      SELECT 1
      FROM storage_places
      WHERE id = ? AND location_id = ?
    `).get(storagePlaceId, input.locationId);
    if (!place) {
      storagePlaceId = null;
    }
  }

  let existingProductId: string | null = null;
  if (input.productId) {
    const existing = db.prepare(`
      SELECT id
      FROM products
      WHERE id = ? AND family_id = ? AND deleted_at IS NULL
    `).get(input.productId, input.familyId) as { id: string } | undefined;
    if (existing) {
      existingProductId = existing.id;
    }
  } else if (input.barcode) {
    const existingByBarcode = db.prepare(`
      SELECT id
      FROM products
      WHERE family_id = ? AND barcode = ? AND deleted_at IS NULL
    `).get(input.familyId, input.barcode) as { id: string } | undefined;
    if (existingByBarcode) {
      existingProductId = existingByBarcode.id;
    }
  }

  const productId = existingProductId || createId("product");
  const batchId = createId("batch");
  const transactionId = createId("txn");

  if (manageTransaction) {
    db.exec("BEGIN IMMEDIATE");
  }
  try {
    if (existingProductId) {
      db.prepare(`
        UPDATE products
        SET category_id = ?,
            name = ?,
            brand = COALESCE(?, brand),
            barcode = COALESCE(?, barcode),
            specification = COALESCE(?, specification),
            ingredients = COALESCE(?, ingredients),
            default_unit = ?,
            low_stock_threshold = COALESCE(?, low_stock_threshold),
            cover_image_id = COALESCE(?, cover_image_id),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        input.categoryId,
        input.name,
        input.brand ?? null,
        input.barcode ?? null,
        input.specification ?? null,
        input.ingredients ?? null,
        input.unit,
        input.lowStockThreshold ?? null,
        input.coverImageId ?? null,
        productId
      );
    } else {
      db.prepare(`
        INSERT INTO products (
          id, family_id, category_id, name, brand, barcode,
          specification, ingredients, default_unit, low_stock_threshold, cover_image_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        input.familyId,
        input.categoryId,
        input.name,
        input.brand ?? null,
        input.barcode ?? null,
        input.specification ?? null,
        input.ingredients ?? null,
        input.unit,
        input.lowStockThreshold ?? null,
        input.coverImageId ?? null
      );
    }

    db.prepare(`
      INSERT INTO inventory_batches (
        id, product_id, location_id, storage_place_id, current_quantity, unit,
        purchased_at, production_date, shelf_life_value, shelf_life_unit,
        expiration_date, unit_price, channel
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      productId,
      input.locationId,
      storagePlaceId,
      input.quantity,
      input.unit,
      input.purchasedAt ?? null,
      input.productionDate ?? null,
      input.shelfLifeValue ?? null,
      input.shelfLifeUnit ?? null,
      input.expirationDate ?? null,
      input.unitPrice ?? null,
      input.channel ?? null
    );

    db.prepare(`
      INSERT INTO inventory_transactions (
        id, family_id, product_id, batch_id, transaction_type,
        quantity, unit, to_location_id, operator_user_id
      )
      VALUES (?, ?, ?, ?, 'stock_in', ?, ?, ?, ?)
    `).run(
      transactionId,
      input.familyId,
      productId,
      batchId,
      input.quantity,
      input.unit,
      input.locationId,
      user.id
    );
    if (manageTransaction) {
      db.exec("COMMIT");
    }
  } catch (error) {
    if (manageTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }

  return {
    productId,
    batchId,
    transactionId
  };
}

export function updateInventoryBatchInfo(batchId: string, input: InventoryBatchUpdateInput, user: RequestUser) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");

  try {
    const batch = db.prepare(`
      SELECT
        b.id AS batchId,
        b.product_id AS productId,
        b.location_id AS locationId,
        p.family_id AS familyId,
        b.status
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      JOIN family_members fm
        ON fm.family_id = p.family_id AND fm.user_id = ?
      WHERE b.id = ?
        AND p.deleted_at IS NULL
    `).get(user.id, batchId) as { batchId: string; productId: string; locationId: string; familyId: string; status: string } | undefined;

    if (!batch) {
      throw createError({
        statusCode: 404,
        statusMessage: "库存批次不存在"
      });
    }

    if (batch.status !== "active") {
      throw createError({
        statusCode: 409,
        statusMessage: "历史物品不能编辑库存信息"
      });
    }

    const category = db.prepare("SELECT 1 FROM category_templates WHERE id = ?").get(input.categoryId);
    if (!category) {
      throw createError({
        statusCode: 404,
        statusMessage: "品类不存在"
      });
    }

    let storagePlaceId: string | null = input.storagePlaceId ?? null;
    if (storagePlaceId) {
      const place = db.prepare(`
        SELECT 1
        FROM storage_places
        WHERE id = ? AND location_id = ?
      `).get(storagePlaceId, batch.locationId);
      if (!place) {
        storagePlaceId = null;
      }
    }

    db.prepare(`
      UPDATE products
      SET category_id = ?,
          name = ?,
          brand = ?,
          specification = ?,
          ingredients = ?,
          default_unit = ?,
          low_stock_threshold = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      input.categoryId,
      input.name,
      input.brand ?? null,
      input.specification ?? null,
      input.ingredients ?? null,
      input.unit,
      input.lowStockThreshold ?? null,
      batch.productId
    );

    db.prepare(`
      UPDATE inventory_batches
      SET storage_place_id = ?,
          unit = ?,
          purchased_at = ?,
          production_date = ?,
          shelf_life_value = ?,
          shelf_life_unit = ?,
          expiration_date = ?,
          unit_price = ?,
          channel = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      storagePlaceId,
      input.unit,
      input.purchasedAt ?? null,
      input.productionDate ?? null,
      input.shelfLifeValue ?? null,
      input.shelfLifeUnit ?? null,
      input.expirationDate ?? null,
      input.unitPrice ?? null,
      input.channel ?? null,
      batch.batchId
    );

    db.exec("COMMIT");
    return {
      batchId: batch.batchId,
      productId: batch.productId
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function parseStockOperationInput(body: Record<string, unknown>): StockOperationInput {
  const operationType = optionalText(body.operationType);
  const reason = optionalText(body.reason);

  if (!operationType || !["consume", "discard", "transfer", "adjust"].includes(operationType)) {
    throw createError({
      statusCode: 400,
      statusMessage: "库存操作类型无效"
    });
  }

  if (operationType === "adjust") {
    const targetQuantity = Number(body.targetQuantity);
    if (!Number.isFinite(targetQuantity) || targetQuantity < 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "盘点后的库存不能小于 0"
      });
    }
    if (!reason) {
      throw createError({
        statusCode: 400,
        statusMessage: "盘点调整必须填写原因"
      });
    }
    return {
      operationType,
      targetQuantity,
      reason
    };
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "操作数量必须大于 0"
    });
  }

  if (operationType === "transfer") {
    const toLocationId = optionalText(body.toLocationId);
    if (!toLocationId) {
      throw createError({
        statusCode: 400,
        statusMessage: "请选择目标地点"
      });
    }
    return {
      operationType,
      quantity,
      toLocationId,
      toStoragePlaceId: optionalText(body.toStoragePlaceId),
      reason
    };
  }

  if (operationType === "discard" && !reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "丢弃操作必须填写原因"
    });
  }

  return {
    operationType,
    quantity,
    reason
  };
}

export function applyStockOperation(batchId: string, input: StockOperationInput, user: RequestUser) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");

  try {
    const batch = db.prepare(`
      SELECT
        b.id AS batchId,
        b.product_id AS productId,
        p.family_id AS familyId,
        b.location_id AS locationId,
        b.storage_place_id AS storagePlaceId,
        b.current_quantity AS currentQuantity,
        b.unit,
        b.purchased_at AS purchasedAt,
        b.production_date AS productionDate,
        b.shelf_life_value AS shelfLifeValue,
        b.shelf_life_unit AS shelfLifeUnit,
        b.expiration_date AS expirationDate,
        b.unit_price AS unitPrice,
        b.channel,
        b.status
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      JOIN family_members fm
        ON fm.family_id = p.family_id AND fm.user_id = ?
      WHERE b.id = ?
    `).get(user.id, batchId) as BatchOperationRow | undefined;

    if (!batch) {
      throw createError({
        statusCode: 404,
        statusMessage: "库存批次不存在"
      });
    }
    if (batch.status !== "active" || Number(batch.currentQuantity) <= 0) {
      throw createError({
        statusCode: 409,
        statusMessage: "该库存批次已经处理完毕"
      });
    }

    const currentQuantity = Number(batch.currentQuantity);
    let resultingQuantity = currentQuantity;
    let destinationBatchId: string | null = null;
    const transactionIds: string[] = [];

    if (input.operationType === "adjust") {
      const difference = input.targetQuantity - currentQuantity;
      if (difference === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: "盘点数量没有变化"
        });
      }

      resultingQuantity = input.targetQuantity;
      db.prepare(`
        UPDATE inventory_batches
        SET current_quantity = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(resultingQuantity, resultingQuantity === 0 ? "depleted" : "active", batch.batchId);

      const transactionId = createId("txn");
      db.prepare(`
        INSERT INTO inventory_transactions (
          id, family_id, product_id, batch_id, transaction_type,
          quantity, unit, from_location_id, reason, operator_user_id
        )
        VALUES (?, ?, ?, ?, 'adjust', ?, ?, ?, ?, ?)
      `).run(
        transactionId,
        batch.familyId,
        batch.productId,
        batch.batchId,
        difference,
        batch.unit,
        batch.locationId,
        input.reason,
        user.id
      );
      transactionIds.push(transactionId);
    } else {
      if (input.quantity > currentQuantity) {
        throw createError({
          statusCode: 409,
          statusMessage: `操作数量不能超过当前库存 ${currentQuantity}${batch.unit}`
        });
      }

      resultingQuantity = currentQuantity - input.quantity;
      const depletedStatus =
        input.operationType === "discard" && resultingQuantity === 0 ? "discarded" : resultingQuantity === 0 ? "depleted" : "active";
      db.prepare(`
        UPDATE inventory_batches
        SET current_quantity = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(resultingQuantity, depletedStatus, batch.batchId);

      if (input.operationType === "transfer") {
        if (input.toLocationId === batch.locationId) {
          throw createError({
            statusCode: 400,
            statusMessage: "目标地点不能与当前地点相同"
          });
        }

        const destination = db.prepare(`
          SELECT 1
          FROM locations
          WHERE id = ? AND family_id = ?
        `).get(input.toLocationId, batch.familyId);
        if (!destination) {
          throw createError({
            statusCode: 404,
            statusMessage: "目标地点不存在"
          });
        }

        let toStoragePlaceId: string | null = input.toStoragePlaceId ?? null;
        if (toStoragePlaceId) {
          const place = db.prepare(`
            SELECT 1
            FROM storage_places
            WHERE id = ? AND location_id = ?
          `).get(toStoragePlaceId, input.toLocationId);
          if (!place) {
            toStoragePlaceId = null;
          }
        }

        destinationBatchId = createId("batch");
        db.prepare(`
          INSERT INTO inventory_batches (
            id, product_id, location_id, storage_place_id, current_quantity, unit,
            purchased_at, production_date, shelf_life_value, shelf_life_unit,
            expiration_date, unit_price, channel, status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(
          destinationBatchId,
          batch.productId,
          input.toLocationId,
          toStoragePlaceId,
          input.quantity,
          batch.unit,
          batch.purchasedAt,
          batch.productionDate,
          batch.shelfLifeValue,
          batch.shelfLifeUnit,
          batch.expirationDate,
          batch.unitPrice,
          batch.channel
        );

        const outTransactionId = createId("txn");
        const inTransactionId = createId("txn");
        db.prepare(`
          INSERT INTO inventory_transactions (
            id, family_id, product_id, batch_id, transaction_type,
            quantity, unit, from_location_id, to_location_id, reason, operator_user_id
          )
          VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, ?)
        `).run(
          outTransactionId,
          batch.familyId,
          batch.productId,
          batch.batchId,
          input.quantity,
          batch.unit,
          batch.locationId,
          input.toLocationId,
          input.reason,
          user.id
        );
        db.prepare(`
          INSERT INTO inventory_transactions (
            id, family_id, product_id, batch_id, transaction_type,
            quantity, unit, from_location_id, to_location_id, reason, operator_user_id
          )
          VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, ?, ?)
        `).run(
          inTransactionId,
          batch.familyId,
          batch.productId,
          destinationBatchId,
          input.quantity,
          batch.unit,
          batch.locationId,
          input.toLocationId,
          input.reason,
          user.id
        );
        transactionIds.push(outTransactionId, inTransactionId);
      } else {
        const transactionId = createId("txn");
        db.prepare(`
          INSERT INTO inventory_transactions (
            id, family_id, product_id, batch_id, transaction_type,
            quantity, unit, from_location_id, reason, operator_user_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          transactionId,
          batch.familyId,
          batch.productId,
          batch.batchId,
          input.operationType,
          input.quantity,
          batch.unit,
          batch.locationId,
          input.reason,
          user.id
        );
        transactionIds.push(transactionId);
      }
    }

    db.exec("COMMIT");
    return {
      batchId,
      currentQuantity: resultingQuantity,
      destinationBatchId,
      transactionIds
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getInventoryHistory(user: RequestUser, familyId: string, locationId?: string) {
  const db = getDatabase();
  if (!getFamilyRole(user, familyId)) {
    return [];
  }

  const locationFilter = locationId ? "AND b.location_id = ?" : "";
  const rows = db.prepare(`
    SELECT
      tx.id AS transactionId,
      tx.transaction_type AS transactionType,
      COALESCE(entry.initial_quantity, tx.quantity, 0) AS initialQuantity,
      b.unit,
      tx.reason,
      tx.occurred_at AS finalizedAt,
      tx.operator_user_id AS operatorUserId,
      operator.display_name AS operatorName,
      b.id AS batchId,
      b.status AS batchStatus,
      b.current_quantity AS currentQuantity,
      p.id AS productId,
      p.name,
      p.brand,
      c.name AS categoryName,
      c.system_key AS categoryKey,
      tx.from_location_id AS fromLocationId,
      from_location.name AS fromLocationName,
      tx.to_location_id AS toLocationId,
      to_location.name AS toLocationName,
      b.expiration_date AS expirationDate,
      b.unit_price AS unitPrice,
      b.channel
    FROM inventory_batches b
    JOIN products p ON p.id = b.product_id
    JOIN category_templates c ON c.id = p.category_id
    LEFT JOIN inventory_transactions tx
      ON tx.id = (
        SELECT terminal.id
        FROM inventory_transactions terminal
        WHERE terminal.batch_id = b.id
          AND terminal.transaction_type IN ('consume', 'discard', 'transfer_out', 'adjust')
        ORDER BY terminal.occurred_at DESC, terminal.created_at DESC
        LIMIT 1
      )
    LEFT JOIN (
      SELECT
        batch_id,
        SUM(CASE
          WHEN transaction_type IN ('stock_in', 'transfer_in') THEN quantity
          ELSE 0
        END) AS initial_quantity
      FROM inventory_transactions
      GROUP BY batch_id
    ) entry ON entry.batch_id = b.id
    LEFT JOIN locations from_location ON from_location.id = tx.from_location_id
    LEFT JOIN locations to_location ON to_location.id = tx.to_location_id
    LEFT JOIN users operator ON operator.id = tx.operator_user_id
    WHERE p.family_id = ?
      AND p.deleted_at IS NULL
      AND b.status IN ('depleted', 'discarded')
      AND tx.id IS NOT NULL
      ${locationFilter}
    ORDER BY tx.occurred_at DESC, tx.created_at DESC
  `).all(...(locationId ? [familyId, locationId] : [familyId])) as InventoryHistoryRow[];

  return rows.map((row) => ({
    ...row,
    initialQuantity: Number(row.initialQuantity),
    currentQuantity: Number(row.currentQuantity),
    unitPrice: row.unitPrice === null ? null : Number(row.unitPrice)
  }));
}
