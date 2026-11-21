<script setup lang="ts">
import { computed, ref } from "vue";
import ChoiceChips from "./ChoiceChips.vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  required?: boolean;
  span?: boolean;
}>(), {
  required: false,
  span: false
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const suggestions = ["盒", "瓶", "袋", "个", "支", "件", "包"];
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
    <span>单位 <em v-if="required">*</em></span>
    <div class="choice-row">
      <ChoiceChips
        :model-value="suggested ? modelValue : ''"
        :options="suggestions"
        aria-label="常用单位"
        @update:model-value="custom = false; emit('update:modelValue', $event)"
      />
      <button type="button" class="choice-more" :class="{ active: showInput }" @click="chooseCustom">其他</button>
    </div>
    <input
      v-if="showInput"
      :value="modelValue"
      :required="required"
      maxlength="12"
      aria-label="单位"
      placeholder="输入单位，例如：箱"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.trim())"
    />
  </div>
</template>
