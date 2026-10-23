import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Manager } from '../src/core/manager';

function freshManager(): Manager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-test-'));
  const manager = new Manager(dir, () => {});
  manager.init();
  return manager;
}

describe('模块信息可编辑', () => {
  it('改名 / 改 ID / 改设备顺序都会落盘', () => {
    const manager = freshManager();
    const created = manager.createModule({ moduleId: 12, towerName: '旧塔', devices: ['ground', 'ice', 'lock'] });
    const updated = manager.updateModule(created.id, {
      towerName: '新塔',
      moduleId: 34,
      devices: ['ice', 'ground', 'lock'],
    });
    expect(updated?.towerName).toBe('新塔');
    expect(updated?.moduleId).toBe(34);
    expect(updated?.devices).toEqual(['ice', 'ground', 'lock']);
    expect(manager.getModule(created.id)?.moduleId).toBe(34);
  });

  it('拒绝重复的模块 ID', () => {
    const manager = freshManager();
    manager.createModule({ moduleId: 12, towerName: 'A' });
    const b = manager.createModule({ moduleId: 13, towerName: 'B' });
    expect(() => manager.updateModule(b.id, { moduleId: 12 })).toThrow(/已被/);
    expect(() => manager.createModule({ moduleId: 12, towerName: 'C' })).toThrow(/已被/);
  });

  it('切到 MG400 时清掉 MG500 专属设备与该设备状态', () => {
    const manager = freshManager();
    const created = manager.createModule({
      protocol: 'mg500',
      moduleId: 40,
      devices: ['ground', 'ground2', 'ice', 'lock', 'phase1', 'phase2', 'phase3'],
    });
    const updated = manager.updateModule(created.id, { protocol: 'mg400' });
    expect(updated?.protocol).toBe('mg400');
    expect(updated?.devices).not.toContain('ground2');
    expect(updated?.devices).not.toContain('phase3');
    expect(updated?.states.ground2).toBeUndefined();
    expect(updated?.phaseCount).toBe(2);
  });

  it('新增设备会按初始态补齐状态', () => {
    const manager = freshManager();
    const created = manager.createModule({ moduleId: 50, devices: ['ground', 'ice', 'lock'] });
    const updated = manager.updateModule(created.id, { devices: ['ground', 'ice', 'lock', 'phase1', 'phase2'] });
    expect(updated?.states.phase1).toBe('open');
    expect(updated?.states.phase2).toBe('open');
    expect(updated?.phaseCount).toBe(2);
  });
});
