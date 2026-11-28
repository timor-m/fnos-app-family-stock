import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import ModalFrame from '../../packages/ui/src/components/form/ModalFrame.vue';
import FormSelect from '../../packages/ui/src/components/form/FormSelect.vue';
import PageSkeleton from '../../packages/ui/src/components/PageSkeleton.vue';
import { useConfirm } from '../../packages/ui/src/composables/useConfirm';

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''; document.body.style.overflow = ''; });
const key = (value: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

describe('shared overlays', () => {
  it('locks scroll, focuses the dialog and restores trigger focus on close', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    document.body.style.overflow = 'auto';
    const w = mount(ModalFrame, { props: { open: true, title: '编辑' }, attachTo: document.body }); wrappers.push(w);
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    await w.setProps({ open: false });
    expect(document.body.style.overflow).toBe('auto'); expect(document.activeElement).toBe(trigger);
  });
  it('does not dismiss a busy form using Escape or backdrop', async () => {
    const w = mount(ModalFrame, { props: { open: true, title: '保存', busy: true }, attachTo: document.body }); wrappers.push(w);
    await nextTick(); key('Escape'); (document.querySelector('.modal-backdrop') as HTMLElement).click();
    expect(w.emitted('close')).toBeUndefined();
  });
  it('closes only the nested picker and keeps the form locked', async () => {
    const w = mount(ModalFrame, { props: { open: true, title: '表单' }, slots: { default: defineComponent({ components: { FormSelect }, template: '<FormSelect model-value="a" :options="[{value: \'a\', label: \'选项\'}]" />' }) }, attachTo: document.body }); wrappers.push(w);
    await nextTick(); (document.querySelector('.form-select-trigger') as HTMLElement).click(); await nextTick();
    expect(document.querySelector('[role="listbox"]')).not.toBeNull(); key('Escape'); await nextTick();
    expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(w.emitted('close')).toBeUndefined();
    expect(document.body.style.overflow).toBe('hidden'); key('Escape'); expect(w.emitted('close')).toHaveLength(1);
  });
  it('keeps keyboard focus inside and releases scroll on unmount', async () => {
    const w = mount(ModalFrame, { props: { open: true, title: '编辑' }, slots: { default: '<button id="last">保存</button>' }, attachTo: document.body });
    await nextTick(); (document.querySelector('#last') as HTMLElement).focus(); key('Tab');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭');
    w.unmount(); expect(document.body.style.overflow).toBe('');
  });
});

it('settles replaced and unmounted confirmation promises', async () => {
  let feedback: ReturnType<typeof useConfirm>;
  const w = mount(defineComponent({ setup() { feedback = useConfirm(); return () => null; } }));
  const first = feedback!.askConfirm({ title: '一', message: '一' });
  const second = feedback!.askConfirm({ title: '二', message: '二' });
  expect(await first).toBe(false); w.unmount(); expect(await second).toBe(false);
});

it('renders six content skeleton rows with a single accessible loading status', () => {
  const w = mount(PageSkeleton); wrappers.push(w);
  expect(w.findAll('.skeleton-row')).toHaveLength(6); expect(w.get('[role="status"]').attributes('aria-busy')).toBe('true');
});
