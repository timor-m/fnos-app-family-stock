<script setup lang="ts">
defineProps<{ overview?: boolean }>();
</script>
<template>
  <div class="page-skeleton" role="status" aria-label="正在加载内容" aria-busy="true">
    <div v-if="overview" class="skeleton-metrics" aria-hidden="true"><div v-for="n in 4" :key="n" class="skeleton-block" /></div>
    <div class="skeleton-list" aria-hidden="true"><div v-for="n in 6" :key="n" class="skeleton-row"><i class="skeleton-block" /><div><span class="skeleton-block" /><span class="skeleton-block" /></div></div></div>
  </div>
</template>
