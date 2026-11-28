import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../packages/ui/src/utils/api', () => ({ request: vi.fn() }));
import { request } from '../../packages/ui/src/utils/api';
import { useAppContext } from '../../packages/ui/src/composables/useAppContext';
const app = useAppContext();
const deferred = () => { let resolve!: (v: any) => void; let reject!: (e: unknown) => void; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
beforeEach(() => { vi.mocked(request).mockReset(); app.selectedFamilyId.value = 'family'; app.dashboard.value = null; });
it('latest inventory response wins when filters change quickly', async () => {
  const old = deferred(), latest = deferred(); vi.mocked(request).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const a = app.loadDashboard({search:'旧'}), b = app.loadDashboard({search:'新'});
  latest.resolve({inventory: [{name:'新'}]}); await b; old.resolve({inventory:[{name:'旧'}]}); await a;
  expect(app.dashboard.value?.inventory[0].name).toBe('新');
});
it('retains inventory if refreshing fails', async () => {
  const retained = {inventory: [{name:'保留'}]} as any; app.dashboard.value = retained;
  vi.mocked(request).mockRejectedValueOnce(new Error('断线')); await expect(app.loadDashboard()).rejects.toThrow('断线');
  expect(app.dashboard.value?.inventory[0].name).toBe('保留'); expect(app.refreshing.value).toBe(false);
});
it('rejects a late response belonging to the previous family', async () => {
  const old = deferred(); vi.mocked(request).mockReturnValueOnce(old.promise);
  const job = app.loadDashboard(); app.selectedFamilyId.value = 'another'; old.resolve({inventory:[{name:'旧家庭'}]}); await job;
  expect(app.dashboard.value).toBeNull();
});
it('history errors are visible and do not erase the previous results', async () => {
  app.inventoryHistory.value = [{name:'历史'}] as any; vi.mocked(request).mockRejectedValueOnce(new Error('重试'));
  await app.loadInventoryHistory(); expect(app.inventoryHistory.value[0].name).toBe('历史'); expect(app.historyError.value).toBe('重试'); expect(app.historyPending.value).toBe(false);
});
