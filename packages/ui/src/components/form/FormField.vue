<script setup lang="ts">
defineProps<{
  label: string;
  required?: boolean;
  span?: boolean;
}>();
</script>

<template>
  <label class="field" :class="{ 'span-2': span }">
    <span>{{ label }} <em v-if="required">*</em></span>
    <slot />
  </label>
</template>
