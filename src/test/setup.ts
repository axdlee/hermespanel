import { vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock Tauri API
const mockInvoke = vi.fn();

// 设置全局 mock
(globalThis as Record<string, unknown>).window = {
  __TAURI_INTERNALS__: {
    invoke: mockInvoke,
  },
};

// 重置每个测试前的 mock
beforeEach(() => {
  mockInvoke.mockReset();
});

// 导出 mock 以便测试使用
export { mockInvoke };
