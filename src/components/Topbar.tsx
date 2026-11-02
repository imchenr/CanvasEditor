import React, { useSyncExternalStore, useState } from 'react';
import { App as AntApp, Dropdown, Modal } from 'antd';
import {
  UndoOutlined, RedoOutlined, DeleteOutlined,
  AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined,
  VerticalAlignTopOutlined, VerticalAlignMiddleOutlined, VerticalAlignBottomOutlined,
  FolderOpenOutlined, DownloadOutlined, CopyOutlined, SnippetsOutlined, BlockOutlined,
  ClearOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import {
  editorState, subscribe, getVersion, undo, redo, deleteSelected,
  copySelected, pasteClipboard, alignSelected, exportSvgString, clearAll,
} from '../editor/store';
import { downloadBlob } from '../editor/engine';
import type { ReactNode } from 'react';

interface TopBtnProps {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  onClick?: () => void;
  title?: string;
  primary?: boolean;
}

/* 横排按钮：icon + label + 快捷键小字 */
function TopBtn({ icon, label, hotkey, onClick, title, primary }: TopBtnProps) {
  return (
    <button
      type="button"
      className={'top-btn' + (primary ? ' primary' : '')}
      onClick={onClick}
      title={title || (label + (hotkey ? ' (' + hotkey + ')' : ''))}
    >
      <span className="top-icon">{icon}</span>
      <span className="top-label">{label}</span>
      {hotkey ? <kbd className="top-key">{hotkey}</kbd> : null}
    </button>
  );
}

/* 快捷键说明（帮助 dialog 内容） */
function ShortcutHelp() {
  const groups: { title: string; lines: ReactNode[] }[] = [
    {
      title: '工具切换',
      lines: ['V 选择 · H 抓手 · R 矩形 · O 椭圆 · T 文本 · I 图片'],
    },
    {
      title: '编辑',
      lines: [
        'Ctrl+Z 撤销 · Ctrl+Y 重做',
        'Ctrl+C 复制 · Ctrl+V 粘贴 · Ctrl+D 副本',
        'Del / Backspace 删除 · Ctrl+A 全选',
      ],
    },
    {
      title: '画布',
      lines: [
        '空格+拖动平移 · 滚轮缩放',
        '方向键微调（Shift 加速 10px）· Ctrl+S 导出 SVG',
      ],
    },
    {
      title: '操作技巧',
      lines: ['双击文本原位编辑 · 选择工具空白拖动框选 · Shift 加选 / 追加选择 · Esc 取消选择'],
    },
  ];
  return (
    <div className="shortcut-help">
      {groups.map((g) => (
        <div key={g.title} className="shortcut-group">
          <div className="shortcut-group-title">{g.title}</div>
          {g.lines.map((l, i) => <div key={i} className="shortcut-line">{l}</div>)}
        </div>
      ))}
    </div>
  );
}

interface TopbarProps {
  onOpenFile: () => void;
  onExportPng: () => void;
  onExportJson: () => void;
}

export default function Topbar({ onOpenFile, onExportPng, onExportJson }: TopbarProps) {
  useSyncExternalStore(subscribe, getVersion);
  const { modal } = AntApp.useApp();
  const [helpOpen, setHelpOpen] = useState(false);

  const exportSvgNow = () => {
    downloadBlob('画板.svg', new Blob([exportSvgString()], { type: 'image/svg+xml;charset=utf-8' }));
  };

  /* 新建：清空画板，需确认 */
  const onNewBoard = () => {
    modal.confirm({
      title: '新建画板',
      content: '将清空画板上的所有元素与分组（可通过 Ctrl+Z 撤销），确定继续？',
      okText: '确定',
      cancelText: '取消',
      onOk: clearAll,
    });
  };

  return (
    <div className="topbar">
      <div className="brand">自由画板</div>

      <div className="top-group">
        <div className="top-group-title">编辑</div>
        <div className="top-group-btns">
          <TopBtn icon={<UndoOutlined />} label="撤销" hotkey="Ctrl+Z" onClick={undo} />
          <TopBtn icon={<RedoOutlined />} label="重做" hotkey="Ctrl+Y" onClick={redo} />
          <TopBtn icon={<DeleteOutlined />} label="删除" hotkey="Del" onClick={deleteSelected} />
          <TopBtn icon={<CopyOutlined />} label="复制" hotkey="Ctrl+C" onClick={copySelected} />
          <TopBtn icon={<SnippetsOutlined />} label="粘贴" hotkey="Ctrl+V" onClick={pasteClipboard} />
          <TopBtn icon={<BlockOutlined />} label="副本" hotkey="Ctrl+D" onClick={() => { copySelected(); pasteClipboard(); }} />
        </div>
      </div>

      <div className="top-group">
        <div className="top-group-title">对齐</div>
        <div className="top-group-btns">
          <TopBtn icon={<AlignLeftOutlined />} label="左对齐" onClick={() => alignSelected('left')} />
          <TopBtn icon={<AlignCenterOutlined />} label="水平居中" onClick={() => alignSelected('center-h')} />
          <TopBtn icon={<AlignRightOutlined />} label="右对齐" onClick={() => alignSelected('right')} />
          <TopBtn icon={<VerticalAlignTopOutlined />} label="顶对齐" onClick={() => alignSelected('top')} />
          <TopBtn icon={<VerticalAlignMiddleOutlined />} label="垂直居中" onClick={() => alignSelected('middle')} />
          <TopBtn icon={<VerticalAlignBottomOutlined />} label="底对齐" onClick={() => alignSelected('bottom')} />
        </div>
      </div>

      <div className="top-group">
        <div className="top-group-title">帮助</div>
        <div className="top-group-btns">
          <TopBtn icon={<QuestionCircleOutlined />} label="快捷键" onClick={() => setHelpOpen(true)} />
        </div>
      </div>

      <div className="top-grow" />

      <div className="top-group">
        <div className="top-group-btns">
          <TopBtn icon={<ClearOutlined />} label="新建" onClick={onNewBoard} title="清空画板所有元素" />
          <TopBtn icon={<FolderOpenOutlined />} label="导入" onClick={onOpenFile} title="导入 SVG / JSON / 图片" />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'svg', label: '导出 SVG' },
                { key: 'png', label: '导出 PNG（2x）' },
                { key: 'json', label: '导出 JSON' },
              ],
              onClick: ({ key }) => {
                if (key === 'svg') exportSvgNow();
                if (key === 'png') onExportPng();
                if (key === 'json') onExportJson();
              },
            }}
          >
            <div className="top-dd-wrap">
              <TopBtn icon={<DownloadOutlined />} label="导出" title="导出 SVG / PNG / JSON" primary />
            </div>
          </Dropdown>
        </div>
      </div>

      {/* 快捷键说明 dialog */}
      <Modal
        open={helpOpen}
        title="快捷键说明"
        onOk={() => setHelpOpen(false)}
        onCancel={() => setHelpOpen(false)}
        okText="知道了"
        cancelButtonProps={{ style: { display: 'none' } }}
        width={520}
      >
        <ShortcutHelp />
      </Modal>
    </div>
  );
}
