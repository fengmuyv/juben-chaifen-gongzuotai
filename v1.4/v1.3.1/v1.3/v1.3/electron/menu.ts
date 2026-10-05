/**
 * 应用菜单正本：界面语言一律中文。
 *
 * 设计约束：
 * - 只替换 `label`，`role` 原样沿用 Electron 内置角色，加速键、行为与默认菜单完全一致，不改动任何功能。
 * - 独立成模块，不引用 `electron` 运行时，便于单元测试直接校验「标签语言」与「role 完整性」。
 * - 叶子项一律绑定内置 role，不出现点了没反应的死菜单。
 */

export type MenuRole =
  | 'about' | 'hide' | 'hideOthers' | 'unhide' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'
  | 'reload' | 'forceReload' | 'toggleDevTools'
  | 'resetZoom' | 'zoomIn' | 'zoomOut' | 'togglefullscreen'
  | 'minimize' | 'zoom' | 'close';

export type MenuItemTemplate = {
  label?: string;
  role?: MenuRole;
  type?: 'separator';
  submenu?: MenuItemTemplate[];
};

/** 每次调用返回新实例，避免多个菜单位共享同一对象。 */
const separator = (): MenuItemTemplate => ({ type: 'separator' });

/** 应用名称：用于 macOS 应用菜单的文案，避免出现 package.json 的英文 name。 */
export const appDisplayName = '剧本拆分工作台';

/**
 * 中文菜单模板。`isMac` 仅影响 macOS 专属的应用菜单与「文件」条目，
 * Windows / Linux 保持与 Electron 默认菜单相同的条目结构。
 */
export function buildMenuTemplate(isMac: boolean): MenuItemTemplate[] {
  return [
    ...(isMac ? [{
      label: appDisplayName,
      submenu: [
        { role: 'about', label: `关于${appDisplayName}` },
        separator(),
        { role: 'hide', label: `隐藏${appDisplayName}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        separator(),
        { role: 'quit', label: `退出${appDisplayName}` },
      ] as MenuItemTemplate[],
    }] : []),
    {
      label: '文件',
      submenu: isMac ? [{ role: 'close', label: '关闭窗口' }] : [{ role: 'quit', label: '退出' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        separator(),
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        separator(),
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        separator(),
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        separator(),
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
  ];
}
