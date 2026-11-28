<script setup lang="ts">
import { computed, watch } from "vue";
import {
  ArrowRightLeft,
  CircleMinus,
  ClipboardCheck,
  LoaderCircle,
  MapPin,
  PackagePlus,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert
} from "@lucide/vue";
import ChoiceChips from "./form/ChoiceChips.vue";
import ModalFrame from "./form/ModalFrame.vue";
import WhereField from "./form/WhereField.vue";
import QuantityInput from "./QuantityInput.vue";
import { formatQuantity } from "../utils/format";
import type { InventoryItem, Location } from "../types/api";

type OperationType = "consume" | "discard" | "transfer" | "adjust";
type OperationForm = {
  quantity: number;
  targetQuantity: number;
  toLocationId: string;
  toStoragePlaceId: string;
  reason: string;
};

const props = defineProps<{
  open: boolean;
  item: InventoryItem | null;
  operationType: OperationType;
  form: OperationForm;
  availableTransferLocations: Location[];
  submitting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "submit"): void;
  (event: "select-operation", type: OperationType): void;
  (event: "edit-info"): void;
  (event: "restock"): void;
  (event: "storage-place-created"): void;
}>();

const operationTitle = computed(() => {
  const labels: Record<OperationType, string> = {
    consume: "消耗库存",
    discard: "丢弃库存",
    transfer: "转移库存",
    adjust: "盘点调整"
  };
  return labels[props.operationType];
});

const targetStoragePlaces = computed(
  () => props.availableTransferLocations.find((location) => location.id === props.form.toLocationId)?.storagePlaces || []
);

watch(
  () => props.form.toLocationId,
  () => {
    if (
      props.form.toStoragePlaceId &&
      !targetStoragePlaces.value.some((place) => place.id === props.form.toStoragePlaceId)
    ) {
      props.form.toStoragePlaceId = "";
    }
  }
);

const submitDisabled = computed(() => {
  return props.submitting ||
    (props.operationType === "transfer" && (!props.availableTransferLocations.length || !props.form.toLocationId));
});

const halfQuantity = computed(() => {
  if (!props.item) return 0.01;
  return Math.max(0.01, Number((props.item.quantity / 2).toFixed(2)));
});

const discardReasons = ["过期", "变质", "破损", "送人"];

watch(
  () => [props.open, props.operationType, props.availableTransferLocations.map((location) => location.id).join(",")] as const,
  () => {
    if (!props.open || props.operationType !== "transfer" || props.form.toLocationId) return;
    if (props.availableTransferLocations.length === 1) {
      props.form.toLocationId = props.availableTransferLocations[0].id;
    }
  }
);

function setQuantity(quantity: number) {
  props.form.quantity = quantity;
}

function clearStock() {
  props.form.targetQuantity = 0;
  if (!props.form.reason) props.form.reason = "盘点清零";
}

</script>

<template>
  <ModalFrame :busy="submitting"
    :open="open && !!item"
    :title="operationTitle"
    :description="item ? `${item.name} · 当前 ${formatQuantity(item.quantity)}${item.unit}` : ''"
    title-id="operation-title"
    panel-class="operation-modal"
    @close="emit('close')"
  >
    <form v-if="item" class="intake-form" @submit.prevent="emit('submit')">
        <div class="operation-segments" role="tablist" aria-label="库存操作">
          <button
            :class="{ active: operationType === 'consume' }"
            type="button"
            role="tab"
            @click="emit('select-operation', 'consume')"
          >
            <CircleMinus :size="17" />消耗
          </button>
          <button
            :class="{ active: operationType === 'discard' }"
            type="button"
            role="tab"
            @click="emit('select-operation', 'discard')"
          >
            <Trash2 :size="17" />丢弃
          </button>
          <button
            :class="{ active: operationType === 'transfer' }"
            type="button"
            role="tab"
            @click="emit('select-operation', 'transfer')"
          >
            <ArrowRightLeft :size="17" />转移
          </button>
          <button
            :class="{ active: operationType === 'adjust' }"
            type="button"
            role="tab"
            @click="emit('select-operation', 'adjust')"
          >
            <ClipboardCheck :size="17" />盘点
          </button>
        </div>

        <div class="operation-summary">
          <div class="item-symbol">
            <img v-if="item.coverImageUrl" :src="item.coverImageUrl" :alt="item.name" loading="lazy" />
            <template v-else>{{ item.name.slice(0, 1) }}</template>
          </div>
          <div>
            <strong>{{ item.name }}</strong>
            <span>
              {{ item.storagePlaceName ? `${item.locationName}·${item.storagePlaceName}` : item.locationName }} · {{ item.categoryName }}
            </span>
          </div>
          <strong>{{ formatQuantity(item.quantity) }} {{ item.unit }}</strong>
          <div class="operation-summary-actions">
            <button class="edit-info-button" type="button" @click="emit('restock')">
              <PackagePlus :size="15" />
              同款补货
            </button>
            <button class="edit-info-button" type="button" @click="emit('edit-info')">
              <Pencil :size="15" />
              编辑信息
            </button>
          </div>
        </div>

        <div class="form-grid operation-fields">
          <div v-if="operationType !== 'adjust'" class="field span-2">
            <span>操作数量 <em>*</em></span>
            <QuantityInput v-model="form.quantity" required :min="0.01" :max="item.quantity" />
            <div class="choice-chips">
              <button type="button" :class="{ active: form.quantity === 1 }" @click="setQuantity(1)">1{{ item.unit }}</button>
              <button
                v-if="item.quantity > 1"
                type="button"
                :class="{ active: form.quantity === halfQuantity }"
                @click="setQuantity(halfQuantity)"
              >
                一半
              </button>
              <button type="button" :class="{ active: form.quantity === item.quantity }" @click="setQuantity(item.quantity)">
                全部
              </button>
            </div>
          </div>

          <div v-else class="field span-2">
            <span>盘点后数量 <em>*</em></span>
            <QuantityInput v-model="form.targetQuantity" required :min="0" />
            <div class="choice-chips">
              <button type="button" :class="{ active: form.targetQuantity === 0 }" @click="clearStock">清零并记下原因</button>
            </div>
          </div>

          <WhereField
            v-if="operationType === 'transfer' && availableTransferLocations.length"
            label="搬到哪里"
            :locations="availableTransferLocations"
            :location-id="form.toLocationId"
            :place-id="form.toStoragePlaceId"
            @update:location-id="form.toLocationId = $event"
            @update:place-id="form.toStoragePlaceId = $event"
            @created="emit('storage-place-created')"
          />

          <div class="field span-2">
            <span>
              原因或备注
              <em v-if="operationType === 'discard' || operationType === 'adjust'">*</em>
            </span>
            <ChoiceChips
              v-if="operationType === 'discard'"
              v-model="form.reason"
              :options="discardReasons"
              aria-label="丢弃原因"
            />
            <textarea
              v-model.trim="form.reason"
              :required="operationType === 'discard' || operationType === 'adjust'"
              maxlength="200"
              rows="2"
              :placeholder="operationType === 'consume' ? '选填，可留空' : operationType === 'discard' ? '点选原因，或自己写一句' : '记录本次盘点原因'"
            ></textarea>
          </div>
        </div>

        <p v-if="operationType === 'transfer' && !availableTransferLocations.length" class="form-warning">
          <MapPin :size="16" />请先在“我的”中新增另一个房屋地点
        </p>
        <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

        <footer class="modal-footer">
          <button class="cancel-button" type="button" @click="emit('close')">取消</button>
          <button class="primary-button" type="submit" :disabled="submitDisabled">
            <LoaderCircle v-if="submitting" class="spin" :size="18" />
            <RotateCcw v-else-if="operationType === 'adjust'" :size="18" />
            <ArrowRightLeft v-else-if="operationType === 'transfer'" :size="18" />
            <CircleMinus v-else :size="18" />
            {{ submitting ? "正在处理" : operationTitle }}
          </button>
        </footer>
      </form>
  </ModalFrame>
</template>
