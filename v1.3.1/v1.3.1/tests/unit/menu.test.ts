import { describe, expect, it } from 'vitest';
import { appDisplayName, buildMenuTemplate, type MenuItemTemplate } from '../../electron/menu';

/** 展平含子菜单的菜单树，便于逐项校验。 */
function flatten(items: MenuItemTemplate[]): MenuItemTemplate[] {
  return items.flatMap((item) => [item, ...(item.submenu ? flatten(item.submenu) : [])]);
}

const latin = /[A-Za-z]/;

/** Electron 默认菜单在 Windows / Linux 下的内置角色全集，用于确认行为未被改动。 */
const baseRoles = [
  'quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll',
  'reload', 'forceReload', 'toggleDevTools',
  'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen',
  'minimize', 'zoom', 'close',
] as const;

const cases = [
  { name: 'Windows/Linux', isMac: false, top: ['文件', '编辑', '视图', '窗口'] },
  { name: 'macOS', isMac: true, top: [appDisplayName, '文件', '编辑', '视图', '窗口'] },
];

describe('应用菜单中文化', () => {
  it.each(cases)('$name：顶层菜单为中文且顺序稳定', ({ isMac, top }) => {
    expect(buildMenuTemplate(isMac).map((item) => item.label)).toEqual(top);
  });

  it.each(cases)('$name：所有可见标签均为中文，不含拉丁字母', ({ isMac }) => {
    const labels = flatten(buildMenuTemplate(isMac)).filter((item) => item.type !== 'separator');
    expect(labels.length).toBeGreaterThan(0);
    for (const item of labels) {
      expect(item.label ?? '').not.toMatch(latin);
      expect((item.label ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it.each(cases)('$name：role 与 Electron 默认菜单一致，行为未被改动', ({ isMac }) => {
    const roles = flatten(buildMenuTemplate(isMac)).map((item) => item.role).filter((role): role is NonNullable<typeof role> => !!role);
    const expected = isMac ? [...baseRoles, 'about', 'hide', 'hideOthers', 'unhide'] : [...baseRoles];
    expect([...new Set(roles)].sort()).toEqual([...new Set(expected)].sort());
  });

  it.each(cases)('$name：叶子菜单项一律绑定内置 role，不存在死菜单', ({ isMac }) => {
    for (const item of flatten(buildMenuTemplate(isMac))) {
      if (item.submenu || item.type === 'separator') continue;
      expect(item.role).toBeTruthy();
    }
  });

  it('分组以分隔线表达，且不携带文本', () => {
    const separators = flatten(buildMenuTemplate(false)).filter((item) => item.type === 'separator');
    expect(separators.length).toBe(4);
    for (const item of separators) expect(item.label).toBeUndefined();
  });
});
