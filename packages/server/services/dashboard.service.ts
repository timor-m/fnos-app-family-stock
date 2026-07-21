import { getDatabase } from "../database/client";
import { getFamilyRole } from "../utils/access-control";
import type { RequestUser } from "../utils/request-user";
import { getAppConfig } from "../utils/runtime-config";

type SummaryRow = {
  productCount: number;
  totalQuantity: number;
  expiringCount: number;
  expiredCount: number;
  lowStockCount: number;
  pendingCount: number;
};

type InventoryRow = {
  batchId: string;
  productId: string;
  name: string;
  brand: string | null;
  specification: string | null;
  ingredients: string | null;
  coverImageId: string | null;
  categoryName: string;
  categoryKey: string;
  categoryId: string;
  quantity: number;
  unit: string;
  locationId: string;
  locationName: string;
  purchasedAt: string | null;
  productionDate: string | null;
  shelfLifeValue: number | null;
  shelfLifeUnit: string | null;
  expirationDate: string | null;
  unitPrice: number | null;
  channel: string | null;
  lowStockThreshold: number | null;
  daysRemaining: number | null;
  stockedByUserId: string | null;
  stockedByName: string | null;
  stockedAt: string | null;
  createdAt: string;
};

type LowStockRow = {
  productId: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  threshold: number;
};

type DashboardOptions = {
  inventoryLimit?: number;
  inventoryOffset?: number;
  search?: string;
};

function clampPageLimit(value: number | undefined) {
  if (!Number.isFinite(value || 0)) return 20;
  return Math.max(1, Math.min(20, Math.floor(value || 20)));
}

function clampPageOffset(value: number | undefined) {
  if (!Number.isFinite(value || 0)) return 0;
  return Math.max(0, Math.floor(value || 0));
}

function matchesInventorySearch(row: InventoryRow & { coverImageUrl: string | null }, search: string) {
  if (!search) return true;
  return [row.name, row.brand, row.specification, row.categoryName, row.locationName]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(search));
}

export function getDashboard(user: RequestUser, familyId: string, locationId?: string, options: DashboardOptions = {}) {
  const db = getDatabase();
  const gatewayPrefix = getAppConfig().gatewayPrefix.replace(/\/$/, "");
  const inventoryLimit = clampPageLimit(options.inventoryLimit);
  const inventoryOffset = clampPageOffset(options.inventoryOffset);
  const search = (options.search || "").trim().toLowerCase();
  if (!getFamilyRole(user, familyId)) {
    return {
      summary: {
        productCount: 0,
        totalQuantity: 0,
        expiringCount: 0,
        expiredCount: 0,
        lowStockCount: 0,
        pendingCount: 0
      },
      expiring: [],
      lowStock: [],
      recent: [],
      inventory: [],
      inventoryCount: 0,
      inventoryOffset,
      inventoryLimit,
      inventoryHasMore: false
    };
  }
  const locationFilter = locationId ? "AND b.location_id = ?" : "";
  const locationParams = locationId ? [familyId, locationId] : [familyId];

  const inventoryRows = db.prepare(`
    SELECT
      b.id AS batchId,
      p.id AS productId,
      p.name,
      p.brand,
      p.specification,
      p.ingredients,
      p.cover_image_id AS coverImageId,
      c.name AS categoryName,
      c.system_key AS categoryKey,
      c.id AS categoryId,
      b.current_quantity AS quantity,
      b.unit,
      l.id AS locationId,
      l.name AS locationName,
      b.purchased_at AS purchasedAt,
      b.production_date AS productionDate,
      b.shelf_life_value AS shelfLifeValue,
      b.shelf_life_unit AS shelfLifeUnit,
      b.expiration_date AS expirationDate,
      b.unit_price AS unitPrice,
      b.channel,
      p.low_stock_threshold AS lowStockThreshold,
      CASE
        WHEN b.expiration_date IS NULL THEN NULL
        ELSE CAST(julianday(date(b.expiration_date)) - julianday(date('now', 'localtime')) AS INTEGER)
      END AS daysRemaining,
      entry_tx.operator_user_id AS stockedByUserId,
      entry_user.display_name AS stockedByName,
      entry_tx.occurred_at AS stockedAt,
      b.created_at AS createdAt
    FROM inventory_batches b
    JOIN products p ON p.id = b.product_id
    JOIN category_templates c ON c.id = p.category_id
    JOIN locations l ON l.id = b.location_id
    LEFT JOIN inventory_transactions entry_tx
      ON entry_tx.id = (
        SELECT it.id
        FROM inventory_transactions it
        WHERE it.batch_id = b.id
          AND it.transaction_type IN ('stock_in', 'transfer_in')
        ORDER BY it.occurred_at
        LIMIT 1
      )
    LEFT JOIN users entry_user ON entry_user.id = entry_tx.operator_user_id
    WHERE p.family_id = ?
      AND p.deleted_at IS NULL
      AND b.status = 'active'
      ${locationFilter}
    ORDER BY
      CASE WHEN b.expiration_date IS NULL THEN 1 ELSE 0 END,
      b.expiration_date,
      b.created_at DESC
  `).all(...locationParams) as InventoryRow[];

  const inventory = inventoryRows.map((row) => ({
    ...row,
    coverImageUrl: row.coverImageId ? `${gatewayPrefix}/api/media/${row.coverImageId}?variant=thumb` : null
  }));
  const searchedInventory = inventory.filter((row) => matchesInventorySearch(row, search));
  const inventoryPage = searchedInventory.slice(inventoryOffset, inventoryOffset + inventoryLimit);
  const productIds = new Set(inventory.map((row) => row.productId));
  const expiring = inventory.filter(
    (row) => row.daysRemaining !== null && row.daysRemaining >= 0 && row.daysRemaining <= 30
  );
  const expired = inventory.filter((row) => row.daysRemaining !== null && row.daysRemaining < 0);

  const lowStockRows = db.prepare(`
    SELECT
      p.id AS productId,
      p.name,
      p.brand,
      COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.current_quantity ELSE 0 END), 0) AS quantity,
      p.default_unit AS unit,
      p.low_stock_threshold AS threshold
    FROM products p
    LEFT JOIN inventory_batches b ON b.product_id = p.id
    WHERE p.family_id = ?
      AND p.deleted_at IS NULL
      AND p.low_stock_threshold IS NOT NULL
    GROUP BY p.id
    HAVING quantity <= threshold
    ORDER BY quantity ASC, p.name
    LIMIT 8
  `).all(familyId) as LowStockRow[];

  const pendingRow = db.prepare(`
    SELECT COUNT(*) AS pendingCount
    FROM intake_drafts
    WHERE family_id = ?
      AND status IN ('queued', 'ocr_processing', 'rule_parsing', 'ai_processing', 'needs_review', 'failed')
  `).get(familyId) as Pick<SummaryRow, "pendingCount">;

  const summary: SummaryRow = {
    productCount: productIds.size,
    totalQuantity: inventory.reduce((total, row) => total + Number(row.quantity), 0),
    expiringCount: expiring.length,
    expiredCount: expired.length,
    lowStockCount: lowStockRows.length,
    pendingCount: Number(pendingRow.pendingCount)
  };

  return {
    summary,
    expiring: [...expired, ...expiring].slice(0, 8),
    lowStock: lowStockRows.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      threshold: Number(row.threshold)
    })),
    recent: [...inventory]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
    inventory: inventoryPage,
    inventoryCount: searchedInventory.length,
    inventoryOffset,
    inventoryLimit,
    inventoryHasMore: inventoryOffset + inventoryPage.length < searchedInventory.length
  };
}
