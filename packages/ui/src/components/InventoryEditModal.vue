<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "@lucide/vue";
import ChannelField from "./form/ChannelField.vue";
import ChoiceChips from "./form/ChoiceChips.vue";
import DateField from "./form/DateField.vue";
import ExpiryDateField from "./form/ExpiryDateField.vue";
import FormField from "./form/FormField.vue";
import ModalFrame from "./form/ModalFrame.vue";
import PriceInput from "./form/PriceInput.vue";
import ShelfLifeField from "./form/ShelfLifeField.vue";
import WhereField from "./form/WhereField.vue";
import UnitField from "./form/UnitField.vue";
import { formatQuantity } from "../utils/format";
import type { Category, InventoryItem, StoragePlace } from "../types/api";

type InventoryEditForm = {
  name: string;
  brand: string;
  categoryId: string;
  storagePlaceId: string;
  specification: string;
  ingredients: string;
  unit: string;
  purchasedAt: string;
  productionDate: string;
  shelfLifeValue: string;
  shelfLifeUnit: string;
  expirationDate: string;
  unitPrice: string;
  channel: string;
  lowStockThreshold: string;
};

const props = defineProps<{
  open: boolean;
  item: InventoryItem | null;
  form: InventoryEditForm;
  categories: Category[];
  storagePlaces?: StoragePlace[];
  submitting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  "storage-place-created": [];
}>();

const purchaseOpen = ref(false);
const selectedCategory = computed(
  () => props.categories.find((category) => category.id === props.form.categoryId) || null
);
const categoryOptions = computed(() => props.categories.map((category) => ({ value: category.id, label: category.name })));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    purchaseOpen.value = Boolean(
      props.form.unitPrice ||
      props.form.channel ||
      props.form.lowStockThreshold ||
      props.form.ingredients ||
      props.form.productionDate ||
      props.form.shelfLifeValue
    );
  }
);

function onPurchaseToggle(event: Event) {
  purchaseOpen.value = (event.target as HTMLDetailsElement).open;
}
</script>

<template>
  <ModalFrame
    :open="open && !!item"
    title="编辑库存信息"
    description="改信息，不改数量"
    title-id="edit-inventory-title"
    panel-class="inventory-edit-modal"
    @close="emit('close')"
  >
    <form v-if="item" class="inventory-edit-form" @submit.prevent="emit('submit')">
      <div class="inventory-edit-source">
        <div class="inventory-edit-cover">
          <img v-if="item.coverImageUrl" :src="item.coverImageUrl" :alt="item.name" loading="lazy" />
          <span v-else>{{ item.name.slice(0, 1) }}</span>
        </div>
        <div>
          <strong>{{ item.name }}</strong>
          <span>
            {{ item.storagePlaceName ? `${item.locationName}·${item.storagePlaceName}` : item.locationName }}
            · 当前 {{ formatQuantity(item.quantity) }}{{ item.unit }}
          </span>
        </div>
      </div>

      <div class="form-grid">
        <FormField label="商品名称" required span>
          <input v-model.trim="form.name" required maxlength="80" placeholder="例如：布洛芬缓释胶囊" />
        </FormField>

        <div class="field span-2">
          <span>品类 <em>*</em></span>
          <ChoiceChips v-model="form.categoryId" :options="categoryOptions" aria-label="品类" />
        </div>

        <FormField label="品牌">
          <input v-model.trim="form.brand" maxlength="50" placeholder="选填" />
        </FormField>
        <FormField label="规格">
          <input v-model.trim="form.specification" maxlength="80" placeholder="例如：20粒装" />
        </FormField>
        <UnitField v-model="form.unit" required span />
        <WhereField
          :locations="[{ id: item.locationId, name: item.locationName, storagePlaces: storagePlaces || [] }]"
          :location-id="item.locationId"
          :place-id="form.storagePlaceId"
          lock-location
          @update:place-id="form.storagePlaceId = $event"
          @created="emit('storage-place-created')"
        />

        <ExpiryDateField
          v-if="selectedCategory?.fields.expirationEnabled"
          v-model="form.expirationDate"
          :base-date="form.productionDate || form.purchasedAt"
          span
        />

        <details class="extra-fields" :open="purchaseOpen" @toggle="onPurchaseToggle">
          <summary>{{ purchaseOpen ? "收起补充信息" : "补充购买和生产信息（可跳过）" }}</summary>
          <div class="form-grid">
            <template v-if="selectedCategory?.fields.expirationEnabled">
              <FormField label="生产日期">
                <DateField v-model="form.productionDate" aria-label="生产日期" />
              </FormField>
              <ShelfLifeField v-model="form.shelfLifeValue" v-model:unit="form.shelfLifeUnit" />
            </template>
            <FormField label="购买日期">
              <DateField v-model="form.purchasedAt" aria-label="购买日期" />
            </FormField>
            <FormField label="单价">
              <PriceInput v-model="form.unitPrice" />
            </FormField>
            <ChannelField v-model="form.channel" span />
            <FormField label="低库存提醒" span>
              <input v-model="form.lowStockThreshold" min="0" step="0.01" type="number" inputmode="decimal" placeholder="少于此数量时提醒补货" />
            </FormField>
            <FormField label="配料表 / 标签信息" span>
              <textarea v-model.trim="form.ingredients" maxlength="2000" rows="4" placeholder="可修正识别出的配料表"></textarea>
            </FormField>
          </div>
        </details>
      </div>

      <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

      <footer class="modal-footer">
        <button class="cancel-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="submit" :disabled="submitting || !form.categoryId">
          <LoaderCircle v-if="submitting" class="spin" :size="18" />
          <CheckCircle2 v-else :size="18" />
          {{ submitting ? "正在保存" : "保存修改" }}
        </button>
      </footer>
    </form>
  </ModalFrame>
</template>
