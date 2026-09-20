import { describe, it, expect } from 'vitest';

describe('Milestone 1 Scaffolding & Toolchain', () => {
  it('verifies Vitest test environment is functional', () => {
    expect(1 + 1).toBe(2);
  });

  it('verifies DOM environment is simulated via happy-dom', () => {
    const el = document.createElement('div');
    el.id = 'test-node';
    el.textContent = 'XOKJ';
    document.body.appendChild(el);

    const found = document.getElementById('test-node');
    expect(found).not.toBeNull();
    expect(found?.textContent).toBe('XOKJ');
    document.body.removeChild(el);
  });
});
