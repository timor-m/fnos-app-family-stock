<script setup lang="ts">
import { computed, ref } from "vue";
import ChoiceChips from "./ChoiceChips.vue";

const props = defineProps<{
  modelValue: string;
  span?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const suggestions = ["京东", "淘宝", "拼多多", "超市", "药店"];
const custom = ref(false);
const suggested = computed(() => suggestions.includes(props.modelValue));
const showInput = computed(() => custom.value || (props.modelValue !== "" && !suggested.value));

function chooseCustom() {
  custom.value = true;
  if (suggested.value) emit("update:modelValue", "");
}
</script>

<template>
  <div class="field" :class="{ 'span-2': span }">
    <span>购买渠道</span>
    <div class="choice-row">
      <ChoiceChips
        :model-value="suggested ? modelValue : ''"
        :options="suggestions"
        aria-label="常用购买渠道"
        @update:model-value="custom = false; emit('update:modelValue', $event)"
      />
      <button type="button" class="choice-more" :class="{ active: showInput }" @click="chooseCustom">其他</button>
    </div>
    <input
      v-if="showInput"
      :value="modelValue"
      maxlength="50"
      aria-label="购买渠道"
      placeholder="输入其他来源"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.trim())"
    />
  </div>
</template>
