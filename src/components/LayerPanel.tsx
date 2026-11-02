import React, { useSyncExternalStore, useState } from 'react';
import { Button, Tooltip, Tag, Modal, Input, Empty, Space } from 'antd';
import {
  EyeOutlined, EyeInvisibleOutlined,
  ToTopOutlined, ArrowUpOutlined, ArrowDownOutlined, VerticalAlignBottomOutlined,
  FolderAddOutlined, FolderOutlined, FolderOpenOutlined,
  CaretRightOutlined, DeleteOutlined,
} from '@ant-design/icons';
import {
  editorState, subscribe, getVersion, bump, pushHistory, reorder,
  effectiveVisible, groupElementsRecursive,
  createGroup, renameGroup, toggleGroupCollapse, setGroupVisible, deleteGroup,
  moveElementToGroup, moveGroupToGroup, selectGroupElements,
} from '../editor/store';
import type { EditorElement, GroupNode } from '../editor/types';

const TYPE_TAG: Record<string, string> = { rect: '矩', ellipse: '椭', text: '文', image: '图', path: '径' };
const TYPE_COLOR: Record<string, string> = { rect: 'geekblue', ellipse: 'orange', text: 'green', image: 'purple', path: 'cyan' };

interface RenameState { kind: 'element' | 'group'; id: string; name: string }
interface DropTargetState { kind: 'group' | 'element' | 'root'; id?: string }

interface DragPayload { kind: 'element' | 'group'; id: string }

/* ============================================================
 * 图层面板（树形）：
 *  - 分组（目录）可嵌套、折叠、整体显隐、重命名、删除（子上移一级）
 *  - 元素/分组行可拖拽：拖到分组行上=编入该组，拖到列表空白处=回到根目录
 *  - 层级顺序（置顶/上移/下移/置底）仍按画布 z 序（elements 数组），
 *    分组树是组织目录，不改变 z 序
 * ============================================================ */
export default function LayerPanel() {
  useSyncExternalStore(subscribe, getVersion);
  const state = editorState;
  const [rename, setRename] = useState<RenameState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

  const isSelected = (id: string) => state.selectedIds.includes(id);

  const parseDrag = (e: React.DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload; } catch (_) { return null; }
  };
  const handleDrop = (e: React.DragEvent, targetGid: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const data = parseDrag(e);
    setDropTarget(null);
    if (!data) return;
    if (data.kind === 'element') moveElementToGroup(data.id, targetGid);
    else if (data.kind === 'group') moveGroupToGroup(data.id, targetGid);
  };

  const toggleVisible = (e: React.MouseEvent, el: EditorElement) => {
    e.stopPropagation();
    pushHistory();
    el.visible = !el.visible;
    bump();
  };

  const commitRename = () => {
    if (!rename) return;
    if (rename.kind === 'group') {
      renameGroup(rename.id, rename.name);
    } else if (rename.name && rename.name !== findElName(rename.id)) {
      pushHistory();
      const el = state.elements.find((x) => x.id === rename.id);
      if (el) el.name = rename.name;
      bump();
    }
    setRename(null);
  };

  function findElName(id: string): string {
    const el = state.elements.find((x) => x.id === id);
    return el ? el.name : '';
  }

  /* ---------- 元素行 ---------- */
  const renderElementRow = (el: EditorElement, depth: number) => {
    const dropHint = dropTarget && dropTarget.kind === 'element' && dropTarget.id === el.id;
    return (
      <div
        key={el.id}
        className={'layer-item'
          + (depth > 0 ? ' nested' : '')
          + (isSelected(el.id) ? ' selected' : '')
          + (!effectiveVisible(el) ? ' dimmed' : '')
          + (dropHint ? ' drop-hint' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'element', id: el.id }))}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropTarget({ kind: 'element', id: el.id });
        }}
        onDragLeave={() => setDropTarget((t) => (t && t.kind === 'element' && t.id === el.id ? null : t))}
        onDrop={(e) => handleDrop(e, el.groupId || null)}
        onClick={(e) => {
          if (e.shiftKey) {
            state.selectedIds = state.selectedIds.includes(el.id)
              ? state.selectedIds.filter((i) => i !== el.id)
              : state.selectedIds.concat(el.id);
          } else {
            state.selectedIds = [el.id];
          }
          bump();
        }}
        onDoubleClick={() => setRename({ kind: 'element', id: el.id, name: el.name })}
      >
        <Tag color={TYPE_COLOR[el.type] || 'default'} style={{ marginRight: 4, fontSize: 10, lineHeight: '16px' }}>
          {TYPE_TAG[el.type] || '?'}
        </Tag>
        <span className="name" title={el.name}>{el.name}</span>
        <span className="eye" onClick={(e) => toggleVisible(e, el)}>
          {el.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
        </span>
      </div>
    );
  };

  /* ---------- 分组行 ---------- */
  const renderGroupRow = (g: GroupNode, depth: number) => {
    const descendants = groupElementsRecursive(g.id);
    const hasSelected = descendants.some((e) => isSelected(e.id));
    const gVisible = g.visible !== false;
    const dropHint = dropTarget && dropTarget.kind === 'group' && dropTarget.id === g.id;
    return (
      <div
        key={g.id}
        className={'layer-item layer-group'
          + (depth > 0 ? ' nested' : '')
          + (hasSelected ? ' selected' : '')
          + (dropHint ? ' drop-hint' : '')}
        style={{ paddingLeft: 4 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'group', id: g.id }))}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropTarget({ kind: 'group', id: g.id });
        }}
        onDragLeave={() => setDropTarget((t) => (t && t.kind === 'group' && t.id === g.id ? null : t))}
        onDrop={(e) => handleDrop(e, g.id)}
        onClick={(e) => selectGroupElements(g.id, e.shiftKey)}
        onDoubleClick={() => setRename({ kind: 'group', id: g.id, name: g.name })}
      >
        <span className="caret" onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(g.id); }} title={g.collapsed ? '展开' : '折叠'}>
          <CaretRightOutlined rotate={g.collapsed ? 0 : 90} />
        </span>
        <span className="gicon">{g.collapsed ? <FolderOutlined /> : <FolderOpenOutlined />}</span>
        <span className="name" title={g.name}>{g.name}</span>
        <span className="gcount">{descendants.length}</span>
        <span className="gdel" onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }} title="删除分组（内容上移一级）">
          <DeleteOutlined />
        </span>
        <span className="eye" onClick={(e) => { e.stopPropagation(); setGroupVisible(g.id, !gVisible); }} title="整组显隐">
          {gVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
        </span>
      </div>
    );
  };

  /* ---------- 递归渲染层级（分组在前、元素在后，元素按 z 序倒序=顶层在前） ---------- */
  const renderLevel = (parentId: string | null, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    state.groups
      .filter((g) => (g.parentId || null) === parentId)
      .forEach((g) => {
        out.push(renderGroupRow(g, depth));
        if (!g.collapsed) out.push(...renderLevel(g.id, depth + 1));
      });
    [...state.elements]
      .reverse()
      .filter((e) => (e.groupId || null) === parentId)
      .forEach((el) => out.push(renderElementRow(el, depth)));
    return out;
  };

  const isEmpty = state.elements.length === 0 && state.groups.length === 0;

  return (
    <div className="layer-panel">
      <div className="panel-title-row">
        <div className="panel-title">图层</div>
        <Space size={0}>
          <Tooltip title="新建分组">
            <Button size="small" type="text" icon={<FolderAddOutlined />} onClick={() => createGroup(null)} />
          </Tooltip>
          <Tooltip title="置顶">
            <Button size="small" type="text" icon={<ToTopOutlined />} onClick={() => reorder('front')} />
          </Tooltip>
          <Tooltip title="上移一层">
            <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => reorder('up')} />
          </Tooltip>
          <Tooltip title="下移一层">
            <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => reorder('down')} />
          </Tooltip>
          <Tooltip title="置底">
            <Button size="small" type="text" icon={<VerticalAlignBottomOutlined />} onClick={() => reorder('back')} />
          </Tooltip>
        </Space>
      </div>

      <div
        className={'layer-list' + (dropTarget && dropTarget.kind === 'root' ? ' drag-root' : '')}
        onDragOver={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setDropTarget({ kind: 'root' });
          }
        }}
        onDragLeave={() => setDropTarget((t) => (t && t.kind === 'root' ? null : t))}
        onDrop={(e) => {
          if (e.target === e.currentTarget) handleDrop(e, null);
        }}
      >
        {isEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无元素" />}
        {renderLevel(null, 0)}
      </div>

      <div className="layer-droptip">拖动图层到分组上编入 · 拖到空白处回到根目录</div>

      <Modal
        title={rename && rename.kind === 'group' ? '重命名分组' : '重命名图层'}
        open={!!rename}
        onOk={commitRename}
        onCancel={() => setRename(null)}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={rename ? rename.name : ''}
          onChange={(e) => setRename(rename ? { ...rename, name: e.target.value } : null)}
          onPressEnter={commitRename}
          placeholder={rename && rename.kind === 'group' ? '分组名称' : '图层名称'}
        />
      </Modal>
    </div>
  );
}
