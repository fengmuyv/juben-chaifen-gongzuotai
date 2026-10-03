import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { parseScript } from '../core/parser';
import { useWorkbench } from '../store';

/**
 * 原剧本面板：原文编辑区 + 正文识别结果。
 *
 * 单独成组件并 `memo` 化：本面板渲染「整本」识别结果（可达数千节点）。
 * 只要传入的均为基本类型（集场次/节拍数、文件名、版本号、原文），
 * 逐键编辑导演板字段时这里的 props 全不变，React 直接跳过整棵子树的 diff。
 */
function parseScriptForPreview(text: string) {
  return parseScript(text).beats.map((beat) => ({ kind: beat.dialogue?.kind ?? 'action', text: beat.text }));
}

type Props = {
  projectId: string;
  sceneCount: number;
  beatCount: number;
  filename: string;
  scriptId: string;
  sourceText: string;
  onMessage(message: string): void;
};

export const SourcePane = memo(function SourcePane({ projectId, sceneCount, beatCount, filename, scriptId, sourceText, onMessage }: Props) {
  /** 编辑区非受控：整本正文可达数万字，逐键把整串 value 回传受控组件会拖慢输入。 */
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dirty, setDirty] = useState(false);
  /** 折叠态不渲染内容：整本识别结果可达数千节点，常驻 DOM 会拖慢每一次重渲染的 diff。 */
  const [showRecognized, setShowRecognized] = useState(false);
  // 换项目（project.id 变）或原稿版本变化：丢弃未保存编辑，并把编辑区回填为最新原文。
  useEffect(() => {
    setDirty(false);
    if (textarea.current) textarea.current.value = sourceText;
  }, [projectId, scriptId, sourceText]);
  const recognized = useMemo(() => sourceText ? parseScriptForPreview(sourceText) : [], [sourceText]);
  const readDraft = () => textarea.current?.value ?? sourceText;
  return (
    <section className="pane source-pane">
      <div className="pane-title"><h2>原剧本</h2><span>{sceneCount} 场 · {beatCount} 节拍</span></div>
      <div className="source-meta">{filename} · 版本 {scriptId}</div>
      <textarea ref={textarea} aria-label="原剧本编辑区" defaultValue={sourceText} onChange={() => setDirty(true)} spellCheck={false} />
      <div className="source-footer">
        <span>编辑后生成新原稿版本；导演板需重新规划。</span>
        <button disabled={!dirty} onClick={() => {
          useWorkbench.getState().updateScript(readDraft());
          setDirty(false);
          onMessage('新原稿版本已保存；请重新规划');
        }}>保存原稿版本</button>
      </div>
      <details className="recognition-panel" open={showRecognized} onToggle={(event) => setShowRecognized(event.currentTarget.open)}>
        <summary>正文识别结果（{recognized.length} 条）</summary>
        {showRecognized && <>
          <div className="recognition-list">{recognized.map((item, index) => <div key={`${item.kind}-${index}`}><span>{item.kind === 'scene' ? '场次' : item.kind === 'dialogue' ? '台词' : item.kind === 'inner' ? '内心OS' : item.kind === 'narration' ? '旁白' : '动作'}</span><p>{item.text}</p></div>)}</div>
          <button onClick={() => {
            if (dirty) useWorkbench.getState().updateScript(readDraft());
            useWorkbench.getState().replan();
            setDirty(false);
            onMessage('已按当前正文识别结果重新规划分镜');
          }}>应用识别并重新规划</button>
        </>}
      </details>
    </section>
  );
});
