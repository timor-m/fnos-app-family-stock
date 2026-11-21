<script setup lang="ts">
import { LoaderCircle, Plus, TriangleAlert } from "@lucide/vue";
import ChoiceChips from "./form/ChoiceChips.vue";
import FormField from "./form/FormField.vue";
import ModalFrame from "./form/ModalFrame.vue";
import type { Family } from "../types/api";

type MemberForm = {
  familyId: string;
  userId: string;
  displayName: string;
  role: string;
};

defineProps<{
  open: boolean;
  family: Family | null;
  form: MemberForm;
  submitting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();
</script>

<template>
  <ModalFrame
    :open="open && !!family"
    title="添加成员"
    :description="family ? `加入到“${family.name}”` : ''"
    title-id="member-title"
    compact
    @close="emit('close')"
  >
    <form v-if="family" class="intake-form" @submit.prevent="emit('submit')">
      <div class="form-grid">
        <FormField label="用户 ID" required span>
          <input v-model.trim="form.userId" required maxlength="80" placeholder="飞牛用户 ID" />
        </FormField>
        <FormField label="成员昵称" span>
          <input v-model.trim="form.displayName" maxlength="50" placeholder="不填则使用用户 ID" />
        </FormField>
        <div class="field span-2">
          <span>角色</span>
          <ChoiceChips
            v-model="form.role"
            :options="[{ value: 'member', label: '成员' }, { value: 'admin', label: '管理员' }]"
            aria-label="角色"
          />
        </div>
      </div>

      <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

      <footer class="modal-footer">
        <button class="cancel-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="spin" :size="18" />
          <Plus v-else :size="18" />
          {{ submitting ? "正在添加" : "加入分组" }}
        </button>
      </footer>
    </form>
  </ModalFrame>
</template>
