import React, { useEffect, useRef } from 'react';
import { App as AntApp, Layout } from 'antd';
import Topbar from './components/Topbar';
import ToolRail from './components/ToolRail';
import StatusBar from './components/StatusBar';
import LayerPanel from './components/LayerPanel';
import PropsPanel from './components/PropsPanel';
import CanvasStage, { stageBridge } from './components/CanvasStage';
import {
  editorState, bump, subscribe, getVersion, setTool, setNotifier, resetPanelHistory,
  undo, redo, copySelected, pasteClipboard, deleteSelected, pushHistory, getSelected,
  importSvg, importJson, importImage, exportSvgString, exportPng, exportJson,
  findEl, loadBoard, scheduleSave,
  createGroup, moveElementToGroup, setGroupVisible, deleteGroup, getGroupsBridge,
} from './editor/store';
import { downloadBlob } from './editor/engine';
import type { CanvasEditorApi, ToolType } from './editor/types';

const { Header, Sider, Content, Footer } = Layout;

function useEditorVersion(): number {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribe(force), []);
  return getVersion();
}

export default function App() {
  return (
    <AntApp>
      <EditorShell />
    </AntApp>
  );
}

function EditorShell() {
  const { message } = AntApp.useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  /* ---------- 全局禁用右键菜单 ---------- */
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', onCtx);
    return () => window.removeEventListener('contextmenu', onCtx);
  }, []);

  /* ---------- 通知注入 ---------- */
  useEffect(() => {
    setNotifier((msg) => message.info(msg), (msg) => message.error(msg));
  }, [message]);

  /* ---------- 启动：恢复上次画板（localStorage）+ 订阅防抖保存 ---------- */
  useEffect(() => {
    loadBoard();
    bump();
    return subscribe(scheduleSave);
  }, []);

  /* ---------- 文件导入 ---------- */
  const openFile = () => fileInputRef.current && fileInputRef.current.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) importJson(String(reader.result));
      else if (name.endsWith('.svg')) importSvg(String(reader.result), file.name);
      else importImage(String(reader.result));
    };
    if (file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.svg')) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const onImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importImage(String(reader.result), editorState._pendingImageAt || null);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  /* ---------- 全局键盘 ---------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (stageBridge.isEditing()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { editorState.spaceDown = true; bump(); e.preventDefault(); return; }

      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (meta && e.key.toLowerCase() === 'c') { copySelected(); return; }
      if (meta && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); copySelected(); pasteClipboard(); return; }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        editorState.selectedIds = editorState.elements.map((el) => el.id);
        bump(); return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        downloadBlob('画板.svg', new Blob([exportSvgString()], { type: 'image/svg+xml;charset=utf-8' }));
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') { editorState.selectedIds = []; setTool('select'); return; }

      const map: Record<string, ToolType> = { v: 'select', h: 'pan', r: 'rect', o: 'ellipse', t: 'text', i: 'image' };
      const k = e.key.toLowerCase();
      if (map[k] && !meta) { setTool(map[k]); resetPanelHistory(); return; }

      // 方向键微调
      const step = e.shiftKey ? 10 : 1;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      if (deltas[e.key] && editorState.selectedIds.length) {
        e.preventDefault();
        pushHistory();
        getSelected().forEach((el) => { el.x += deltas[e.key][0]; el.y += deltas[e.key][1]; });
        bump();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { editorState.spaceDown = false; bump(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* ---------- 测试 / 集成 API ---------- */
  useEffect(() => {
    const api: CanvasEditorApi = {
      importSvg, importJson, importImage,
      exportSvgString,
      getElements: () => editorState.elements,
      getGroups: getGroupsBridge,
      createGroup, moveElementToGroup, setGroupVisible, deleteGroup,
      getSelected,
      findEl,
      openTextEditor: (id) => stageBridge.openTextEditor(id),
      isEditing: () => stageBridge.isEditing(),
    };
    window.canvasEditor = api;
  }, []);

  const version = useEditorVersion();

  return (
    <Layout className="app-shell">
      {/* 顶部菜单：编辑 / 对齐 / 导入导出（快捷键贴按钮旁边），primary 背景 */}
      <Header className="app-header">
        <Topbar
          onOpenFile={openFile}
          onExportPng={exportPng}
          onExportJson={exportJson}
        />
      </Header>

      <Layout>
        {/* 左侧仅 6 个工具按钮（icon 上 / label 下 / 快捷键徽标），与图层栏之间有分割线 */}
        <Sider width={68} theme="light" className="rail-sider">
          <ToolRail />
        </Sider>

        <Sider width={216} theme="light" className="side-panel left">
          <LayerPanel />
        </Sider>

        <Content className="stage-wrap-outer">
          <CanvasStage
            onPickImage={(world) => {
              editorState._pendingImageAt = world;
              imageInputRef.current && imageInputRef.current.click();
            }}
          />
        </Content>

        <Sider width={244} theme="light" className="side-panel right">
          <PropsPanel />
        </Sider>
      </Layout>

      {/* 底部状态栏：左元素统计，右下角背景画布选项 + 缩放控件 */}
      <Footer className="statusbar-wrap">
        <StatusBar />
      </Footer>

      {/* 隐藏文件选择器 */}
      <input
        ref={fileInputRef} type="file" hidden
        accept=".svg,.json,.png,.jpg,.jpeg,.gif,.webp"
        onChange={onFileChange}
      />
      <input
        ref={imageInputRef} type="file" hidden
        accept="image/*"
        onChange={onImageChange}
      />
      <span hidden>{version}</span>
    </Layout>
  );
}
