import { reasoningLabels, reasoningLevels, type ReasoningLevel } from '../../electron/ai-providers';
import type { CredentialsStatus } from '../core/vision';

/** 接口设置的可写字段：**密钥不写 localStorage**，落盘一律走主进程私有配置。 */
export type SettingsPatch = { endpoint?: string; apiKey?: string; model?: string; effort?: ReasoningLevel; ai?: boolean };

type Props = {
  aiEnabled: boolean;
  aiReady: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  effort: ReasoningLevel;
  modelOptions: string[];
  localCredentials: CredentialsStatus | null;
  connection: { ok: boolean; message: string } | null;
  keyNote: string;
  onSave(next: SettingsPatch): void;
  onTestConnection(): void;
  onClose(): void;
};

/**
 * 接口设置面板：**没有厂商下拉**（由地址自动识别）。
 * 密钥可在界面手填（只存内存、不落盘），留空时由主进程用本机私有配置补齐。
 */
export function SettingsPanel({ aiEnabled, aiReady, endpoint, apiKey, model, effort, modelOptions, localCredentials, connection, keyNote, onSave, onTestConnection, onClose }: Props) {
  return <div className="settings-panel" role="dialog" aria-label="接口设置">
    <div className="settings-head"><h3>接口设置（可选增强）</h3><button onClick={onClose}>关闭</button></div>
    <p className="settings-note">默认关闭 AI 增强，不接接口也能完成本地识别、拆分与生成。地址只需填到 /v1 一级，厂商由地址自动识别、无需选择；密钥填入即自动常驻本机、无需手动保存，留空时用本机已存的那把，清空即从本机撤销（该文件不进仓库、不进构建产物）。</p>
    <label className="ai-switch"><input type="checkbox" aria-label="启用AI增强" checked={aiEnabled} onChange={(event) => onSave({ ai: event.target.checked })} />启用 AI 增强（接入后一键生成以 AI 依次推理为主，本地作兜底）</label>
    <p className={`settings-note route-note${aiReady ? ' ai-ready' : ''}`} role="status" aria-label="生成主路径">当前生成主路径：<strong>{aiReady ? 'AI 逐段依次推理（某段未通过时回退本地规则）' : '本地规则引擎'}</strong>。开启并接入 AI 后，一键生成按钮会显示为「AI 依次推理」，选集生成同样改走逐段依次推理。</p>
    <label>url（接口地址）<input aria-label="接口地址" value={endpoint} onChange={(event) => onSave({ endpoint: event.target.value })} placeholder="https://…/v1" /></label>
    <label>key（密钥）<input type="password" aria-label="密钥" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => onSave({ apiKey: event.target.value })} placeholder={localCredentials?.configured ? '••••••••••（本机已保存，留空即用它）' : '填入后自动常驻本机，无需手动保存'} /></label>
    {/*
      模型项在 url 与 key 就绪前不渲染 —— 还没法接入时先摆一个模型名只会造成误解。
      「就绪」= 地址非空 且（手填了密钥 或 本机已配置密钥）。
    */}
    {endpoint.trim() !== '' && (apiKey.trim() !== '' || localCredentials?.configured === true) && <label>模型{modelOptions.length
      ? <select aria-label="模型" value={model} onChange={(event) => onSave({ model: event.target.value })}>{modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      : <input aria-label="模型" value={model} onChange={(event) => onSave({ model: event.target.value })} placeholder="接入后自动列出，也可手填" />}</label>}
    <label>思考强度<select aria-label="思考强度" value={effort} onChange={(event) => onSave({ effort: event.target.value as ReasoningLevel })}>{reasoningLevels.map((level) => <option key={level} value={level}>{reasoningLabels[level]}</option>)}</select></label>
    <div className="settings-actions"><button onClick={onTestConnection}>接入并拉取模型</button>{connection && <span className={connection.ok ? 'ok' : 'fail'}>{connection.message}</span>}</div>
    <p className="settings-note" role="status" aria-label="本机密钥状态">本机密钥：{localCredentials === null
      ? '正在检查本机配置…'
      : localCredentials.configured
        ? '已存本机，输入框留空即用它；改填自动覆盖，清空即撤销。'
        : '未存本机，填入后自动写入，无需手动保存。'}{keyNote ? ` ${keyNote}` : ''}</p>
  </div>;
}
