import React, { useSyncExternalStore } from 'react';
import {
  SelectOutlined, DragOutlined, BorderOutlined, FontSizeOutlined, PictureOutlined,
} from '@ant-design/icons';
import { editorState, subscribe, getVersion, setTool } from '../editor/store';
import type { ReactNode } from 'react';

/* 椭圆图标：描边风格椭圆环，与 antd outlined 图标视觉一致 */
const EllipseIcon = () => (
  <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="none" aria-hidden="true">
    <ellipse cx="512" cy="512" rx="400" ry="250" stroke="currentColor" strokeWidth="76" />
  </svg>
);

interface ToolDef {
  value: 'select' | 'pan' | 'rect' | 'ellipse' | 'text' | 'image';
  label: string;
  icon: ReactNode;
  key: string;
}

const TOOLS: ToolDef[] = [
  { value: 'select', label: '选择', icon: <SelectOutlined />, key: 'V' },
  { value: 'pan', label: '抓手', icon: <DragOutlined />, key: 'H' },
  { value: 'rect', label: '矩形', icon: <BorderOutlined />, key: 'R' },
  { value: 'ellipse', label: '椭圆', icon: <EllipseIcon />, key: 'O' },
  { value: 'text', label: '文本', icon: <FontSizeOutlined />, key: 'T' },
  { value: 'image', label: '图片', icon: <PictureOutlined />, key: 'I' },
];

interface RailBtnProps {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  active: boolean;
  onClick: () => void;
  title: string;
}

/* 竖排按钮：icon 在上、label 在下，快捷键小徽标在右上角 */
function RailBtn({ icon, label, hotkey, active, onClick, title }: RailBtnProps) {
  return (
    <button
      type="button"
      className={'rail-btn' + (active ? ' active' : '')}
      onClick={onClick}
      title={title}
    >
      <span className="rail-icon">{icon}</span>
      <span className="rail-label">{label}</span>
      {hotkey ? <span className="rail-key">{hotkey}</span> : null}
    </button>
  );
}

/* 左侧工具栏：仅 6 个绘制/选择工具，其余功能在顶部菜单 */
export default function ToolRail() {
  useSyncExternalStore(subscribe, getVersion);
  const state = editorState;

  return (
    <div className="tool-rail">
      <div className="rail-brand">工具</div>
      <div className="rail-section">
        {TOOLS.map((t) => (
          <RailBtn
            key={t.value}
            icon={t.icon}
            label={t.label}
            hotkey={t.key}
            active={state.tool === t.value}
            title={t.label + ' (' + t.key + ')'}
            onClick={() => setTool(t.value)}
          />
        ))}
      </div>
    </div>
  );
}
