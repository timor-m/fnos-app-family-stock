<script setup lang="ts">
import { computed, ref } from "vue";
import { LoaderCircle } from "@lucide/vue";
import { request } from "../../utils/api";
import FormSelect from "./FormSelect.vue";

type Place = { id: string; name: string };
type WhereLocation = { id: string; name: string; storagePlaces?: Place[] };

const props = withDefaults(defineProps<{
  locations: WhereLocation[];
  locationId: string;
  placeId: string;
  lockLocation?: boolean;
  label?: string;
}>(), {
  lockLocation: false,
  label: "放在哪里"
});

const emit = defineEmits<{
  "update:locationId": [value: string];
  "update:placeId": [value: string];
  created: [];
}>();

const suggestions = ["冰箱", "药箱", "橱柜", "阳台"];
const creating = ref(false);
const customName = ref("");
const saving = ref("");
const error = ref("");

const activeLocation = computed(
  () => props.locations.find((location) => location.id === props.locationId) || props.locations[0] || null
);
const places = computed(() => activeLocation.value?.storagePlaces || []);
const optionCount = computed(() =>
  props.locations.reduce((sum, location) => sum + 1 + (location.storagePlaces?.length || 0), 0)
);
const useChips = computed(() => props.locations.length > 0 && props.locations.length <= 8 && optionCount.value <= 12);

const choices = computed(() => {
  const locations = props.lockLocation && activeLocation.value ? [activeLocation.value] : props.locations;
  return locations.flatMap((location) => {
    const placeChoices = (location.storagePlaces || []).map((place) => ({
      key: `place:${place.id}`,
      locationId: location.id,
      placeId: place.id,
      label: locations.length > 1 ? `${location.name} · ${place.name}` : place.name
    }));
    const wholeLocation = {
      key: `loc:${location.id}`,
      locationId: location.id,
      placeId: "",
      label: placeChoices.length ? location.name : `就放在${location.name}`
    };
    return [wholeLocation, ...placeChoices];
  });
});

const selectedKey = computed(() => (props.placeId ? `place:${props.placeId}` : `loc:${props.locationId}`));

function choose(locationId: string, placeId: string) {
  creating.value = false;
  error.value = "";
  if (locationId !== props.locationId) emit("update:locationId", locationId);
  if (placeId !== props.placeId) emit("update:placeId", placeId);
}

async function createPlace(name: string) {
  const nextName = name.trim();
  const locationId = activeLocation.value?.id || "";
  if (!nextName || !locationId || saving.value) return;
  saving.value = nextName;
  error.value = "";
  try {
    const result = await request<{ storagePlaceId: string }>(`locations/${locationId}/storage-places`, {
      method: "POST",
      body: JSON.stringify({ name: nextName })
    });
    if (locationId !== props.locationId) emit("update:locationId", locationId);
    emit("update:placeId", result.storagePlaceId);
    customName.value = "";
    creating.value = false;
    emit("created");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "创建位置失败";
  } finally {
    saving.value = "";
  }
}
</script>

<template>
  <div class="field span-2">
    <span>{{ label }}</span>

    <div v-if="useChips" class="choice-chips" role="listbox" :aria-label="label">
      <button
        v-for="choice in choices"
        :key="choice.key"
        type="button"
        role="option"
        :class="{ active: selectedKey === choice.key }"
        :aria-selected="selectedKey === choice.key"
        @click="choose(choice.locationId, choice.placeId)"
      >
        {{ choice.label }}
      </button>
      <button v-if="places.length" type="button" :class="{ active: creating }" @click="creating = !creating">
        新位置
      </button>
    </div>

    <template v-else-if="locations.length">
      <FormSelect
        v-if="!lockLocation && locations.length > 1"
        :model-value="locationId"
        :options="locations.map((location) => ({ value: location.id, label: location.name }))"
        aria-label="存放地点"
        @update:model-value="choose($event, '')"
      />
      <FormSelect
        :model-value="placeId"
        :options="[{ value: '', label: '不具体到某个位置' }, ...places.map((place) => ({ value: place.id, label: place.name }))]"
        aria-label="具体位置"
        @update:model-value="emit('update:placeId', $event)"
      />
      <button type="button" class="choice-more" :class="{ active: creating }" @click="creating = !creating">
        {{ creating ? "取消新建" : "新建具体位置" }}
      </button>
    </template>

    <p v-if="useChips && !places.length && activeLocation" class="where-note">
      先放在{{ activeLocation.name }}。点一下就记下常用位置：
    </p>
    <div v-if="!places.length && activeLocation" class="choice-chips">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion"
        type="button"
        :disabled="!!saving"
        @click="createPlace(suggestion)"
      >
        <LoaderCircle v-if="saving === suggestion" class="spin" :size="13" />
        {{ suggestion }}
      </button>
      <button type="button" :class="{ active: creating }" @click="creating = !creating">自己写</button>
    </div>

    <div v-if="creating" class="inline-place-creator">
      <input
        v-model.trim="customName"
        maxlength="50"
        :placeholder="activeLocation ? `加到${activeLocation.name}，例如：客厅药箱` : '例如：客厅药箱'"
        aria-label="新位置名称"
        @keydown.enter.prevent="createPlace(customName)"
      />
      <button type="button" class="quick-action-btn finish" :disabled="!!saving || !customName" @click="createPlace(customName)">
        <LoaderCircle v-if="saving && saving === customName" class="spin" :size="13" />
        记下
      </button>
      <button type="button" class="quick-action-btn" :disabled="!!saving" @click="creating = false">取消</button>
    </div>
    <small v-if="error" class="inline-field-error">{{ error }}</small>
  </div>
</template>
