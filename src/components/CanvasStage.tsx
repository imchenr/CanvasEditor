import React, { useRef, useState, useEffect, useSyncExternalStore } from 'react';
import {
  editorState, bump, subscribe, getVersion, findEl, getSelected, snapVal,
  pushHistory, smartSnap, createElement, setPendingImageAt, effectiveVisible,
} from '../editor/store';
import { elBBox, measureText, clamp } from '../editor/engine';
import type { EditorElement, SnapGuide } from '../editor/types';

/* ---------------- 拖动会话类型 ---------------- */
interface PanDrag { mode: 'pan'; sx: number; sy: number; px: number; py: number }
interface MoveDrag {
  mode: 'move'; startWorld: { x: number; y: number }; historyPushed: boolean;
  origins: { id: string; x: number; y: number }[];
}
interface CreateDrag { mode: 'create'; id: string; startWorld: { x: number; y: number } }
interface ResizeDrag {
  mode: 'resize'; handle: string; startWorld: { x: number; y: number };
  historyPushed: boolean; startBBox: { x: number; y: number; w: number; h: number };
  startEl: EditorElement;
}
interface MarqueeDrag {
  mode: 'marquee'; startWorld: { x: number; y: number }; additive: boolean;
}
type DragSession = PanDrag | MoveDrag | CreateDrag | ResizeDrag | MarqueeDrag;

/* ---------------- 场景元素渲染（JSX 版 renderElement） ---------------- */
function ElementNode({ el, editing }: { el: EditorElement; editing: boolean }) {
  const bbox = elBBox(el);
  const rot = el.rot
    ? `rotate(${el.rot} ${el.x + bbox.w / 2} ${el.y + bbox.h / 2})`
    : null;

  let shape: React.ReactElement<{ fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }>;
  if (el.type === 'rect') {
    shape = (
      <rect
        x={el.x} y={el.y}
        width={Math.max(1, el.w)} height={Math.max(1, el.h)}
        rx={el.rx || undefined} ry={(el.ry || el.rx) || undefined}
      />
    );
  } else if (el.type === 'path') {
    // d 在自身局部坐标系：bbox → 当前 x/y/w/h 映射 + 原始矩阵，无损缩放
    const sx = el.w / (el.bw || 1), sy = el.h / (el.bh || 1);
    const mat = el.mat ? el.mat.join(' ') : '1 0 0 1 0 0';
    shape = (
      <path
        d={el.d}
        transform={`translate(${el.x} ${el.y}) scale(${sx} ${sy}) translate(${-(el.bwx || 0)} ${-(el.bwy || 0)}) matrix(${mat})`}
      />
    );
  } else if (el.type === 'ellipse') {
    shape = (
      <ellipse
        cx={el.x + el.w / 2} cy={el.y + el.h / 2}
        rx={Math.max(1, el.w / 2)} ry={Math.max(1, el.h / 2)}
      />
    );
  } else if (el.type === 'text') {
    shape = (
      <text
        x={el.x} y={el.y + (el.fontSize || 16)}
        fontSize={el.fontSize}
        fontFamily="PingFang SC, Microsoft YaHei, sans-serif"
        fontWeight={el.fontWeight && el.fontWeight !== '400' ? el.fontWeight : undefined}
        letterSpacing={el.letterSpacing ? el.letterSpacing + 'px' : undefined}
      >
        {(el.text || '').split('\n').map((line, i) => (
          <tspan key={i} x={el.x} dy={i > 0 ? (el.fontSize || 16) * 1.25 : undefined}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    );
  } else if (el.type === 'image') {
    shape = (
      <image
        x={el.x} y={el.y}
        width={Math.max(1, el.w)} height={Math.max(1, el.h)}
        href={el.src} xlinkHref={el.src}
        preserveAspectRatio="none"
      />
    );
  } else {
    return null;
  }

  const common = {
    fill: el.fill,
    stroke: el.stroke && el.stroke !== 'none' && el.strokeWidth > 0 ? el.stroke : undefined,
    strokeWidth: el.stroke && el.stroke !== 'none' && el.strokeWidth > 0 ? el.strokeWidth : undefined,
    opacity: el.opacity,
  };

  return (
    <g data-id={el.id} transform={rot || undefined} visibility={editing ? 'hidden' : undefined}>
      {React.cloneElement(shape, common)}
      {/* 透明命中层：整个 bbox（含文字字间空隙）都可抓取拖动 */}
      <rect
        x={bbox.x} y={bbox.y}
        width={Math.max(1, bbox.w)} height={Math.max(1, bbox.h)}
        fill="none" pointerEvents="all"
      />
    </g>
  );
}

/* ---------------- 编辑器桥（供 App 组装测试 API） ---------------- */
export const stageBridge = {
  openTextEditor: (_id: string) => {},
  isEditing: (): boolean => false,
  commitTextEdit: () => {},
};

/* ============================================================ */
export default function CanvasStage({ onPickImage }: { onPickImage?: (world: { x: number; y: number }) => void }) {
  useSyncExternalStore(subscribe, getVersion);
  const state = editorState;

  const stageRef = useRef<SVGSVGElement | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const lastDownHitIdRef = useRef<string | null>(null);
  const guidesRef = useRef<SnapGuide[]>([]);
  const guardRef = useRef(false); // Esc 取消后阻止 blur 提交
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const viewTransform = `translate(${state.panX} ${state.panY}) scale(${state.zoom})`;

  /* ---------- stage 尺寸跟踪 ---------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      state.stageSize = { w: r.width, h: r.height };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- 滚轮缩放（原生监听，passive:false 才能 preventDefault） ---------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = evt.clientX - rect.left, sy = evt.clientY - rect.top;
      const before = {
        x: (sx - state.panX) / state.zoom,
        y: (sy - state.panY) / state.zoom,
      };
      const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
      state.zoom = clamp(state.zoom * factor, 0.1, 8);
      const after = {
        x: (sx - state.panX) / state.zoom,
        y: (sy - state.panY) / state.zoom,
      };
      state.panX += (after.x - before.x) * state.zoom;
      state.panY += (after.y - before.y) * state.zoom;
      bump();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- 就地文本编辑 ---------- */
  function openTextEditor(el: EditorElement) {
    if (editing) commitTextEdit();
    guardRef.current = false;
    state.editingId = el.id;
    setEditing({ id: el.id, value: el.text || '' });
    bump();
  }
  stageBridge.openTextEditor = (id: string) => {
    const el = findEl(id);
    if (el && el.type === 'text') openTextEditor(el);
  };
  stageBridge.isEditing = () => !!editing;

  useEffect(() => {
    if (!editing) return;
    const el = findEl(editing.id);
    const te = textEditorRef.current;
    if (!el || !te) return;
    // 与文字同位同字号（就地编辑观感）
    const fs = (el.fontSize || 16) * state.zoom;
    const b = elBBox(el);
    te.style.left = (state.panX + el.x * state.zoom - 1) + 'px';
    te.style.top = (state.panY + el.y * state.zoom - fs * 0.12) + 'px';
    te.style.width = Math.max(60, b.w * state.zoom + 8) + 'px';
    te.style.height = Math.max(fs * 1.25 + 4, b.h * state.zoom + 6) + 'px';
    te.style.fontSize = fs + 'px';
    te.style.lineHeight = (fs * 1.25) + 'px';
    te.style.color = el.fill === 'none' ? '#1e293b' : el.fill;
    te.focus();
    te.setSelectionRange(te.value.length, te.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing && editing.id]);

  function commitTextEdit() {
    if (!editing) return;
    const el = findEl(editing.id);
    if (el && el.text !== editing.value) {
      pushHistory();
      el.text = editing.value;
      const m = measureText(el.text || '', el.fontSize || 16, el.fontWeight, el.letterSpacing);
      el.w = m.w; el.h = m.h;
    }
    state.editingId = null;
    setEditing(null);
    bump();
  }
  stageBridge.commitTextEdit = commitTextEdit;

  function cancelTextEdit() {
    if (!editing) return;
    guardRef.current = true;
    state.editingId = null;
    setEditing(null);
    bump();
  }

  /* ---------- 坐标 ---------- */
  function pointerWorld(evt: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left - state.panX) / state.zoom,
      y: (evt.clientY - rect.top - state.panY) / state.zoom,
    };
  }

  /* ---------- 指针交互 ---------- */
  function onPointerDown(evt: React.PointerEvent) {
    // 正在编辑文字时点击其他位置 → 先提交
    if (editing) commitTextEdit();

    if (evt.button === 1 || state.spaceDown || state.tool === 'pan') {
      dragRef.current = { mode: 'pan', sx: evt.clientX, sy: evt.clientY, px: state.panX, py: state.panY };
      try { stageRef.current!.setPointerCapture(evt.pointerId); } catch (_) { /* noop */ }
      return;
    }
    if (evt.button !== 0) return;

    const world = pointerWorld(evt);

    // 缩放手柄
    const handle = (evt.target as HTMLElement).dataset && (evt.target as HTMLElement).dataset.handle;
    if (handle && getSelected().length === 1) {
      const el = getSelected()[0];
      const b = elBBox(el);
      dragRef.current = {
        mode: 'resize', handle, startWorld: world, historyPushed: false,
        startBBox: { ...b }, startEl: JSON.parse(JSON.stringify(el)) as EditorElement,
      };
      try { stageRef.current!.setPointerCapture(evt.pointerId); } catch (_) { /* noop */ }
      return;
    }

    // 元素命中：tspan 等嵌套节点无 data-id，向上找祖先
    const target = evt.target as Element;
    const hitNode = target.closest ? target.closest('[data-id]') : null;
    const hitId = hitNode && (hitNode as HTMLElement).dataset ? (hitNode as HTMLElement).dataset.id || null : null;
    lastDownHitIdRef.current = hitId;

    if (state.tool === 'select') {
      if (hitId) {
        if (evt.shiftKey) {
          state.selectedIds = state.selectedIds.includes(hitId)
            ? state.selectedIds.filter((i) => i !== hitId)
            : state.selectedIds.concat(hitId);
        } else if (!state.selectedIds.includes(hitId)) {
          state.selectedIds = [hitId];
        }
        bump();
        dragRef.current = {
          mode: 'move', startWorld: world, historyPushed: false,
          origins: getSelected().map((el) => ({ id: el.id, x: el.x, y: el.y })),
        };
        try { stageRef.current!.setPointerCapture(evt.pointerId); } catch (_) { /* noop */ }
      } else {
        // 空白处按下 → 框选（shift 为追加语义）
        if (!evt.shiftKey) state.selectedIds = [];
        bump();
        dragRef.current = { mode: 'marquee', startWorld: world, additive: evt.shiftKey };
        setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
        try { stageRef.current!.setPointerCapture(evt.pointerId); } catch (_) { /* noop */ }
      }
      return;
    }

    // 创建类工具
    if (state.tool === 'rect' || state.tool === 'ellipse') {
      pushHistory();
      const el = createElement(state.tool, snapVal(world.x), snapVal(world.y), { w: 1, h: 1 });
      state.elements.push(el);
      state.selectedIds = [el.id];
      dragRef.current = { mode: 'create', id: el.id, startWorld: world };
      bump();
      try { stageRef.current!.setPointerCapture(evt.pointerId); } catch (_) { /* noop */ }
      return;
    }

    if (state.tool === 'text') {
      pushHistory();
      const el = createElement('text', snapVal(world.x), snapVal(world.y), { text: '新文本' });
      const m = measureText('新文本', el.fontSize || 24);
      el.w = m.w; el.h = m.h;
      state.elements.push(el);
      state.selectedIds = [el.id];
      state.tool = 'select';
      bump();
      openTextEditor(el);
      return;
    }

    if (state.tool === 'image') {
      setPendingImageAt(world);
      onPickImage && onPickImage(world);
    }
  }

  function onPointerMove(evt: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const world = pointerWorld(evt);

    if (drag.mode === 'pan') {
      state.panX = drag.px + (evt.clientX - drag.sx);
      state.panY = drag.py + (evt.clientY - drag.sy);
      bump();
      return;
    }

    if (drag.mode === 'marquee') {
      // 选区矩形（世界坐标 → 屏幕坐标渲染）
      const x1 = Math.min(drag.startWorld.x, world.x), y1 = Math.min(drag.startWorld.y, world.y);
      const x2 = Math.max(drag.startWorld.x, world.x), y2 = Math.max(drag.startWorld.y, world.y);
      setMarquee({
        x: x1 * state.zoom + state.panX, y: y1 * state.zoom + state.panY,
        w: (x2 - x1) * state.zoom, h: (y2 - y1) * state.zoom,
      });
      return;
    }

    if (drag.mode === 'move') {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      if (!drag.historyPushed && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        pushHistory();
        drag.historyPushed = true;
      }
      // 智能对齐吸附优先，未命中的轴回落到网格吸附
      const snapRes = smartSnap(drag.origins, dx, dy);
      guidesRef.current = snapRes.guides;
      drag.origins.forEach((o) => {
        const el = findEl(o.id);
        if (!el) return;
        el.x = snapRes.snappedX ? Math.round(o.x + snapRes.dx) : snapVal(o.x + snapRes.dx);
        el.y = snapRes.snappedY ? Math.round(o.y + snapRes.dy) : snapVal(o.y + snapRes.dy);
      });
      bump();
      return;
    }

    if (drag.mode === 'create') {
      const el = findEl(drag.id);
      if (!el) return;
      const x1 = Math.min(drag.startWorld.x, world.x), x2 = Math.max(drag.startWorld.x, world.x);
      const y1 = Math.min(drag.startWorld.y, world.y), y2 = Math.max(drag.startWorld.y, world.y);
      el.x = snapVal(x1); el.y = snapVal(y1);
      el.w = Math.max(1, snapVal(x2 - x1)); el.h = Math.max(1, snapVal(y2 - y1));
      bump();
      return;
    }

    if (drag.mode === 'resize') {
      const sel = getSelected();
      if (!sel.length) return;
      const el = findEl(sel[0].id);
      if (!el) return;
      if (!drag.historyPushed) {
        pushHistory();
        drag.historyPushed = true;
      }
      const b = { ...drag.startBBox };
      let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      const h = drag.handle;
      if (h.includes('w')) x1 = world.x;
      if (h.includes('e')) x2 = world.x;
      if (h.includes('n')) y1 = world.y;
      if (h.includes('s')) y2 = world.y;

      const nx = Math.min(x1, x2), ny = Math.min(y1, y2);
      const nw = Math.max(1, Math.abs(x2 - x1)), nh = Math.max(1, Math.abs(y2 - y1));

      if (el.type === 'text') {
        const factor = Math.max(0.1, nh / Math.max(1, b.h));
        el.fontSize = Math.max(6, drag.startEl.fontSize! * factor);
        const m = measureText(el.text || '', el.fontSize || 16, el.fontWeight, el.letterSpacing);
        el.x = nx; el.y = ny; el.w = m.w; el.h = m.h;
      } else {
        el.x = nx; el.y = ny; el.w = nw; el.h = nh;
      }
      bump();
    }
  }

  function onPointerUp(evt: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag && drag.mode === 'create') {
      const el = findEl(drag.id);
      if (el && (el.w < 3 || el.h < 3)) { el.w = 160; el.h = 100; }
      state.tool = 'select';
    }
    if (drag && drag.mode === 'marquee') {
      // 抬起时按选区批量选中（bbox 相交即入选）
      const m = marquee;
      if (m && (m.w > 2 || m.h > 2)) {
        // 屏幕坐标 → 世界坐标
        const wx1 = (m.x - state.panX) / state.zoom, wy1 = (m.y - state.panY) / state.zoom;
        const wx2 = wx1 + m.w / state.zoom, wy2 = wy1 + m.h / state.zoom;
        const hits = state.elements.filter((e) => {
          if (!effectiveVisible(e)) return false;
          const b = elBBox(e);
          return !(b.x + b.w < wx1 || b.x > wx2 || b.y + b.h < wy1 || b.y > wy2);
        }).map((e) => e.id);
        state.selectedIds = drag.additive
          ? Array.from(new Set(state.selectedIds.concat(hits)))
          : hits;
      }
      setMarquee(null);
      bump();
    }
    dragRef.current = null;
    guidesRef.current = [];
    try { stageRef.current!.releasePointerCapture(evt.pointerId); } catch (_) { /* noop */ }
    bump();
  }

  // 双击文本进入编辑：指针捕获会重定向 click/dblclick 目标，必须按坐标命中解析
  function onDoubleClick(evt: React.MouseEvent) {
    let id: string | null = null;
    const hitEl = document.elementFromPoint(evt.clientX, evt.clientY);
    const hitNode = hitEl && (hitEl as Element).closest ? (hitEl as Element).closest('[data-id]') : null;
    id = hitNode && (hitNode as HTMLElement).dataset ? (hitNode as HTMLElement).dataset.id || null : lastDownHitIdRef.current;
    if (!id) return;
    const el = findEl(id);
    if (el && el.type === 'text') openTextEditor(el);
  }

  /* ---------- overlay（参考线 + 选中框 + 手柄 + 框选矩形） ---------- */
  const overlayChildren: React.ReactNode[] = [];
  guidesRef.current.forEach((gd, i) => {
    if (gd.axis === 'v') {
      const x = gd.pos * state.zoom + state.panX;
      const y1 = gd.from * state.zoom + state.panY;
      const y2 = gd.to * state.zoom + state.panY;
      overlayChildren.push(
        <line key={'g' + i} x1={x} x2={x} y1={y1} y2={y2}
          stroke="#f97316" strokeWidth={1.5} pointerEvents="none" />
      );
    } else {
      const y = gd.pos * state.zoom + state.panY;
      const x1 = gd.from * state.zoom + state.panX;
      const x2 = gd.to * state.zoom + state.panX;
      overlayChildren.push(
        <line key={'g' + i} x1={x1} x2={x2} y1={y} y2={y}
          stroke="#f97316" strokeWidth={1.5} pointerEvents="none" />
      );
    }
  });

  const selEls = getSelected();
  if (selEls.length) {
    selEls.forEach((el) => {
      const b = elBBox(el);
      overlayChildren.push(
        <rect key={'s' + el.id}
          x={b.x * state.zoom + state.panX} y={b.y * state.zoom + state.panY}
          width={b.w * state.zoom} height={b.h * state.zoom}
          fill="none" stroke="#2563eb" strokeWidth={1.5}
          strokeDasharray={selEls.length > 1 ? '4 3' : undefined} />
      );
    });
    if (selEls.length === 1) {
      const b = elBBox(selEls[0]);
      const px = b.x * state.zoom + state.panX;
      const py = b.y * state.zoom + state.panY;
      const w = b.w * state.zoom, h = b.h * state.zoom;
      const handles: [string, number, number][] = [
        ['nw', px, py], ['n', px + w / 2, py], ['ne', px + w, py],
        ['e', px + w, py + h / 2], ['se', px + w, py + h],
        ['s', px + w / 2, py + h], ['sw', px, py + h], ['w', px, py + h / 2],
      ];
      handles.forEach(([name, hx, hy]) => {
        overlayChildren.push(
          <rect key={'h' + name} data-handle={name}
            x={hx - 5} y={hy - 5} width={10} height={10}
            fill="#ffffff" stroke="#2563eb" strokeWidth={1.5}
            style={{ cursor: name + '-resize' }} />
        );
      });
    }
  }

  // 框选矩形（屏幕坐标，蓝色虚线 + 淡蓝填充）
  if (marquee && (marquee.w > 0 || marquee.h > 0)) {
    overlayChildren.push(
      <rect key="marquee"
        x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
        fill="rgba(37, 99, 235, .08)" stroke="#2563eb" strokeWidth={1}
        strokeDasharray="4 3" pointerEvents="none" />
    );
  }

  const defsHtml =
    '<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">' +
    '<path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e3e8f0" stroke-width="1" /></pattern>' +
    state.extraDefs.join('');

  const stageClass = 'stage-svg tool-' + (state.spaceDown ? 'pan' : state.tool)
    + (dragRef.current && dragRef.current.mode === 'pan' ? ' panning' : '');

  return (
    <div className="stage-wrap">
      <svg
        ref={stageRef}
        className={stageClass}
        style={{ background: state.canvasColor === 'transparent' ? '#ffffff' : state.canvasColor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <defs dangerouslySetInnerHTML={{ __html: defsHtml }} />
        <rect
          x={-20000} y={-20000} width={60000} height={60000}
          fill="url(#grid)" transform={viewTransform}
          style={{ display: state.showGrid ? '' : 'none' }}
        />
        <g transform={viewTransform}>
          {state.elements.filter((e) => effectiveVisible(e)).map((el) => (
            <ElementNode key={el.id} el={el} editing={state.editingId === el.id} />
          ))}
        </g>
        <g id="overlay">{overlayChildren}</g>
      </svg>

      {editing && (
        <textarea
          ref={textEditorRef}
          className="text-editor"
          value={editing.value}
          onChange={(e) => setEditing({ id: editing.id, value: e.target.value })}
          onBlur={() => { if (guardRef.current) { guardRef.current = false; return; } commitTextEdit(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); return; }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitTextEdit(); }
          }}
        />
      )}
    </div>
  );
}
