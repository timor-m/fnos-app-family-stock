<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Camera, LoaderCircle, PackagePlus, Pencil, TriangleAlert } from "@lucide/vue";
import ChannelField from "./form/ChannelField.vue";
import ChoiceChips from "./form/ChoiceChips.vue";
import DateField from "./form/DateField.vue";
import ExpiryDateField from "./form/ExpiryDateField.vue";
import FormField from "./form/FormField.vue";
import ModalFrame from "./form/ModalFrame.vue";
import PriceInput from "./form/PriceInput.vue";
import UnitField from "./form/UnitField.vue";
import WhereField from "./form/WhereField.vue";
import QuantityInput from "./QuantityInput.vue";
import type { Category, Location } from "../types/api";

type ManualIntakeForm = {
  productId?: string;
  name: string;
  brand: string;
  categoryId: string;
  locationId: string;
  storagePlaceId: string;
  quantity: number;
  unit: string;
  specification: string;
  purchasedAt: string;
  expirationDate: string;
  unitPrice: string;
  channel: string;
  lowStockThreshold: string;
};

const props = defineProps<{
  open: boolean;
  form: ManualIntakeForm;
  categories: Category[];
  locations: Location[];
  submitting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  "switch-photo": [];
  "storage-place-created": [];
}>();

const intakeNameInput = ref<HTMLInputElement | null>(null);
const extraOpen = ref(false);

const selectedCategory = computed(
  () => props.categories.find((category) => category.id === props.form.categoryId) || null
);
const categoryOptions = computed(() => props.categories.map((category) => ({ value: category.id, label: category.name })));

function extraHasValue() {
  const form = props.form;
  return Boolean(form.brand || form.specification || form.unitPrice || form.channel || form.lowStockThreshold);
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    extraOpen.value = extraHasValue();
    await nextTick();
    intakeNameInput.value?.focus();
  }
);

function onExtraToggle(event: Event) {
  extraOpen.value = (event.target as HTMLDetailsElement).open;
}
</script>

<template>
  <ModalFrame
    :open="open"
    title="文字录入"
    description="名称、数量、放到哪"
    title-id="intake-title"
    @close="emit('close')"
  >
    <form class="intake-form" @submit.prevent="emit('submit')">
      <div class="intake-mode-switch" role="tablist" aria-label="录入方式">
        <button class="active" type="button" role="tab" aria-selected="true">
          <Pencil :size="16" />
          文字录入
        </button>
        <button type="button" role="tab" aria-selected="false" @click="emit('switch-photo')">
          <Camera :size="16" />
          拍照录入
        </button>
      </div>

      <div v-if="form.productId" class="restock-banner">
        <span>同款补货：沿用已有商品，只新增这一批库存</span>
        <button type="button" class="inline-link-btn" @click="form.productId = ''">改为新建商品</button>
      </div>

      <div class="form-grid">
        <FormField label="商品名称" required span>
          <input ref="intakeNameInput" v-model.trim="form.name" required maxlength="80" placeholder="例如：布洛芬缓释胶囊 / 净水器滤芯" />
        </FormField>

        <div class="field span-2">
          <span>品类 <em>*</em></span>
          <ChoiceChips v-model="form.categoryId" :options="categoryOptions" aria-label="品类" />
        </div>

        <WhereField
          :locations="locations"
          :location-id="form.locationId"
          :place-id="form.storagePlaceId"
          @update:location-id="form.locationId = $event"
          @update:place-id="form.storagePlaceId = $event"
          @created="emit('storage-place-created')"
        />

        <div class="quantity-unit-row">
          <FormField label="数量" required>
            <QuantityInput v-model="form.quantity" required :min="0.01" />
          </FormField>
          <UnitField v-model="form.unit" required />
        </div>

        <ExpiryDateField
          v-if="selectedCategory?.fields.expirationEnabled"
          v-model="form.expirationDate"
          :base-date="form.purchasedAt"
          span
        />

        <details class="extra-fields" :open="extraOpen" @toggle="onExtraToggle">
          <summary>{{ extraOpen ? "收起补充信息" : "补充品牌和价格（可跳过）" }}</summary>
          <div class="form-grid">
            <FormField label="品牌">
              <input v-model.trim="form.brand" maxlength="50" placeholder="选填" />
            </FormField>
            <FormField label="规格">
              <input v-model.trim="form.specification" maxlength="40" placeholder="例如：20粒装" />
            </FormField>
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
          </div>
        </details>
      </div>

      <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

      <footer class="modal-footer">
        <button class="cancel-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="submit" :disabled="submitting || !form.categoryId || !form.locationId">
          <LoaderCircle v-if="submitting" class="spin" :size="18" />
          <PackagePlus v-else :size="18" />
          {{ submitting ? "正在保存" : "确认入库" }}
        </button>
      </footer>
    </form>
  </ModalFrame>
</template>
