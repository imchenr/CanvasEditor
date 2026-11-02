/* ============================================================
 * 编辑器状态 store：可变状态 + version 订阅
 * （命令式逻辑，React 通过
 *   useSyncExternalStore(subscribe, getVersion) 感知变更）
 * ============================================================ */
import {
  clamp, measureText, elBBox, contentBBox, exportSvgString as buildSvgString,
  parseCssRules, collectSvgLeaves, convertLeaf, svgRootSize, computeSmartSnap, downloadBlob,
} from './engine';
import type {
  BBox, CssRule, EditorElement, EditorState, ElementType, GroupNode, SnapOrigin, SnapResult, SvgLeaf, ToolType,
} from './types';

export const editorState: EditorState = {
  elements: [],
  selectedIds: [],
  tool: 'select',
  zoom: 1,
  panX: 0,
  panY: 0,
  snap: true,
  showGrid: true,
  canvasColor: '#ffffff',
  counter: 0,
  copyBuffer: [],
  spaceDown: false,
  extraDefs: [],      // 导入 SVG 带来的渐变/图案定义（字符串）
  groups: [],         // 图层分组树：{id, name, parentId, collapsed, visible}
  stageSize: { w: 800, h: 600 },
  editingId: null,
};

const history: { undo: string[]; redo: string[] } = { undo: [], redo: [] };
let version = 0;
const listeners = new Set<() => void>();

export function bump(): void { version++; listeners.forEach((l) => l()); }
export function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
export function getVersion(): number { return version; }

/* ---------------- 通知（由 App 注入 antd message） ---------------- */
let notifier: (msg: string) => void = (msg) => console.log('[canvas]', msg);
let errorNotifier: (msg: string) => void = (msg) => console.error('[canvas]', msg);
export function setNotifier(fn: (msg: string) => void, errFn?: (msg: string) => void): void {
  notifier = fn; errorNotifier = errFn || fn;
}

/* ---------------- 工具 ---------------- */
export const uid = (): string => 'e' + (++editorState.counter) + '_' + Math.random().toString(36).slice(2, 7);
export const snapVal = (v: number): number =>
  (editorState.snap ? Math.round(v / 20) * 20 : Math.round(v));
export const findEl = (id: string): EditorElement | undefined =>
  editorState.elements.find((e) => e.id === id);
export const getSelected = (): EditorElement[] =>
  editorState.elements.filter((e) => editorState.selectedIds.includes(e.id));

export function selectionBBox(): BBox | null {
  const els = getSelected();
  if (!els.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  els.forEach((el) => {
    const b = elBBox(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ---------------- 历史快照（含分组树） ---------------- */
export function pushHistory(): void {
  history.undo.push(JSON.stringify({ elements: editorState.elements, groups: editorState.groups }));
  if (history.undo.length > 60) history.undo.shift();
  history.redo = [];
}

function applySnapshot(json: string): void {
  const snap = JSON.parse(json) as { elements?: EditorElement[]; groups?: GroupNode[] } | EditorElement[];
  // 兼容旧格式（纯元素数组）
  editorState.elements = Array.isArray(snap) ? snap : (snap.elements || []);
  editorState.groups = Array.isArray(snap) ? [] : (snap.groups || []);
  editorState.selectedIds = editorState.selectedIds.filter((id) => findEl(id));
  bump();
}

export function undo(): void {
  if (!history.undo.length) return;
  history.redo.push(JSON.stringify({ elements: editorState.elements, groups: editorState.groups }));
  applySnapshot(history.undo.pop()!);
}

export function redo(): void {
  if (!history.redo.length) return;
  history.undo.push(JSON.stringify({ elements: editorState.elements, groups: editorState.groups }));
  applySnapshot(history.redo.pop()!);
}

/* ---------------- 图层分组树 ---------------- */
let groupNameCounter = 0;

export function findGroup(id: string): GroupNode | null {
  return editorState.groups.find((g) => g.id === id) || null;
}

// 某分组下的全部元素（递归子孙）
export function groupElementsRecursive(gid: string): EditorElement[] {
  const out: EditorElement[] = [];
  const walk = (id: string) => {
    editorState.groups.filter((g) => (g.parentId || null) === id).forEach((g) => walk(g.id));
    editorState.elements.filter((e) => (e.groupId || null) === id).forEach((e) => out.push(e));
  };
  walk(gid);
  return out;
}

// 元素的有效可见性：自身可见 && 所有祖先分组可见
export function effectiveVisible(el: EditorElement): boolean {
  if (!el.visible) return false;
  let g: GroupNode | null = el.groupId ? findGroup(el.groupId) : null;
  while (g) {
    if (g.visible === false) return false;
    g = g.parentId ? findGroup(g.parentId) : null;
  }
  return true;
}

// targetId 是否位于 gid 的子树内（用于禁止把分组移入自己的子孙）
export function isDescendantGroup(gid: string, targetId: string): boolean {
  let g: GroupNode | null = findGroup(targetId);
  while (g) {
    if (g.id === gid) return true;
    g = g.parentId ? findGroup(g.parentId) : null;
  }
  return false;
}

export function createGroup(parentId?: string | null): GroupNode {
  pushHistory();
  groupNameCounter += 1;
  const g: GroupNode = {
    id: uid(),
    name: '分组 ' + groupNameCounter,
    parentId: parentId || null,
    collapsed: false,
    visible: true,
  };
  editorState.groups.push(g);
  bump();
  return g;
}

export function renameGroup(id: string, name: string): void {
  if (!name) return;
  const g = findGroup(id);
  if (!g || g.name === name) return;
  pushHistory();
  g.name = name;
  bump();
}

export function toggleGroupCollapse(id: string): void {
  const g = findGroup(id);
  if (!g) return;
  g.collapsed = !g.collapsed;
  bump();
}

export function setGroupVisible(id: string, visible: boolean): void {
  const g = findGroup(id);
  if (!g) return;
  pushHistory();
  g.visible = visible;
  bump();
}

export function deleteGroup(id: string): void {
  const g = findGroup(id);
  if (!g) return;
  pushHistory();
  const pid = g.parentId || null;
  // 子分组与子元素上移一级，不丢内容
  editorState.groups.forEach((x) => { if ((x.parentId || null) === id) x.parentId = pid; });
  editorState.elements.forEach((e) => { if ((e.groupId || null) === id) e.groupId = pid; });
  editorState.groups = editorState.groups.filter((x) => x.id !== id);
  bump();
}

export function moveElementToGroup(elId: string, gid: string | null): void {
  const el = findEl(elId);
  if (!el || (el.groupId || null) === (gid || null)) return;
  pushHistory();
  el.groupId = gid || null;
  const g = gid ? findGroup(gid) : null;
  if (g) g.collapsed = false; // 落点分组自动展开，避免“拖进去就消失”
  bump();
}

export function moveGroupToGroup(gid: string, targetId: string | null): void {
  if (gid === targetId) return;
  if (targetId && isDescendantGroup(gid, targetId)) return;
  const g = findGroup(gid);
  if (!g || (g.parentId || null) === (targetId || null)) return;
  pushHistory();
  g.parentId = targetId || null;
  const t = targetId ? findGroup(targetId) : null;
  if (t) t.collapsed = false;
  bump();
}

// 点击分组行 → 选中其全部（递归）可见元素；shift 为切换语义
export function selectGroupElements(gid: string, additive: boolean): void {
  const els = groupElementsRecursive(gid);
  const ids = els.map((e) => e.id);
  if (additive) {
    const allSel = ids.length > 0 && ids.every((id) => editorState.selectedIds.includes(id));
    editorState.selectedIds = allSel
      ? editorState.selectedIds.filter((id) => !ids.includes(id))
      : Array.from(new Set(editorState.selectedIds.concat(ids)));
  } else {
    editorState.selectedIds = ids;
  }
  bump();
}

// 供外部 / 测试 API 读取分组树的稳定引用
export const getGroupsBridge = (): GroupNode[] => editorState.groups;

/* ---------------- 元素工厂 ---------------- */
const nameCounters: Record<string, number> = {};

export function createElement(type: ElementType, x: number, y: number, extra?: Partial<EditorElement>): EditorElement {
  const base: EditorElement = {
    id: uid(), type, name: '', x, y, w: 120, h: 80, rot: 0,
    fill: '#2563eb', stroke: '#1e293b', strokeWidth: 1, opacity: 1, visible: true,
    groupId: null,
  };
  nameCounters[type] = (nameCounters[type] || 0) + 1;
  const names: Record<string, string> = { rect: '矩形', ellipse: '椭圆', text: '文本', image: '图片', path: '路径' };
  base.name = (names[type] || '元素') + ' ' + nameCounters[type];

  if (type === 'ellipse') base.fill = '#f97316';
  if (type === 'text') {
    base.fill = '#1e293b'; base.stroke = 'none'; base.strokeWidth = 0;
    base.text = '双击编辑文本'; base.fontSize = 24; base.w = 200; base.h = 30;
  }
  if (type === 'image') { base.stroke = 'none'; base.strokeWidth = 0; base.fill = 'none'; }
  return Object.assign(base, extra || {});
}

/* ---------------- 智能吸附（包装给交互层） ---------------- */
export function smartSnap(origins: SnapOrigin[], dx: number, dy: number): SnapResult {
  return computeSmartSnap(editorState.elements.filter(effectiveVisible), origins, dx, dy, editorState.zoom);
}

/* ---------------- 对齐编排 ---------------- */
export function alignSelected(kind: 'left' | 'right' | 'center-h' | 'top' | 'bottom' | 'middle'): void {
  const els = getSelected();
  if (els.length < 2) return;
  pushHistory();
  const box = selectionBBox()!;
  els.forEach((el) => {
    const b = elBBox(el);
    if (kind === 'left') el.x = box.x;
    if (kind === 'right') el.x = box.x + box.w - b.w;
    if (kind === 'center-h') el.x = box.x + (box.w - b.w) / 2;
    if (kind === 'top') el.y = box.y;
    if (kind === 'bottom') el.y = box.y + box.h - b.h;
    if (kind === 'middle') el.y = box.y + (box.h - b.h) / 2;
  });
  bump();
}

/* ---------------- 层级 ---------------- */
export function reorder(kind: 'front' | 'back' | 'up' | 'down'): void {
  const els = getSelected();
  if (!els.length) return;
  pushHistory();
  els.forEach((el) => {
    const i = editorState.elements.indexOf(el);
    editorState.elements.splice(i, 1);
    if (kind === 'front') editorState.elements.push(el);
    else if (kind === 'back') editorState.elements.unshift(el);
    else if (kind === 'up') editorState.elements.splice(Math.min(editorState.elements.length, i + 1), 0, el);
    else editorState.elements.splice(Math.max(0, i - 1), 0, el);
  });
  bump();
}

/* ---------------- 删除 / 复制 ---------------- */
export function deleteSelected(): void {
  if (!editorState.selectedIds.length) return;
  pushHistory();
  editorState.elements = editorState.elements.filter((e) => !editorState.selectedIds.includes(e.id));
  editorState.selectedIds = [];
  bump();
}

export function copySelected(): void {
  editorState.copyBuffer = getSelected().map((e) => JSON.parse(JSON.stringify(e)) as EditorElement);
}

export function pasteClipboard(): void {
  if (!editorState.copyBuffer.length) return;
  pushHistory();
  const ids: string[] = [];
  editorState.copyBuffer.forEach((src) => {
    const el = JSON.parse(JSON.stringify(src)) as EditorElement;
    el.id = uid();
    el.x += 20; el.y += 20;
    editorState.elements.push(el);
    ids.push(el.id);
  });
  editorState.selectedIds = ids;
  bump();
}

/* ---------------- 缩放 ---------------- */
export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - editorState.panX) / editorState.zoom, y: (sy - editorState.panY) / editorState.zoom };
}

export function worldToScreen(x: number, y: number): { x: number; y: number } {
  return { x: x * editorState.zoom + editorState.panX, y: y * editorState.zoom + editorState.panY };
}

export function zoomTo(z: number, cx?: number, cy?: number): void {
  const { stageSize } = editorState;
  const sx = cx == null ? stageSize.w / 2 : cx;
  const sy = cy == null ? stageSize.h / 2 : cy;
  const before = screenToWorld(sx, sy);
  editorState.zoom = clamp(z, 0.1, 8);
  const after = screenToWorld(sx, sy);
  editorState.panX += (after.x - before.x) * editorState.zoom;
  editorState.panY += (after.y - before.y) * editorState.zoom;
  bump();
}

export function zoomFit(): void {
  const els = editorState.elements.filter(effectiveVisible);
  if (!els.length) { editorState.panX = 0; editorState.panY = 0; editorState.zoom = 1; bump(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  els.forEach((el) => {
    const b = elBBox(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  });
  const rect = editorState.stageSize;
  const pad = 60;
  const z = clamp(Math.min((rect.w - pad * 2) / (maxX - minX), (rect.h - pad * 2) / (maxY - minY)), 0.1, 8);
  editorState.zoom = z;
  editorState.panX = (rect.w - (maxX - minX) * z) / 2 - minX * z;
  editorState.panY = (rect.h - (maxY - minY) * z) / 2 - minY * z;
  bump();
}

/* ---------------- 工具切换 ---------------- */
export function setTool(t: ToolType): void {
  editorState.tool = t;
  bump();
}

/* ---------------- 导出 ---------------- */
export function exportSvgString(): string {
  return buildSvgString(editorState.elements.filter(effectiveVisible), editorState.canvasColor, editorState.extraDefs);
}
export { contentBBox };

export function exportPng(): void {
  const str = exportSvgString();
  const box = contentBBox(editorState.elements.filter(effectiveVisible), 40);
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = box.w * scale; canvas.height = box.h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    if (editorState.canvasColor !== 'transparent') {
      ctx.fillStyle = editorState.canvasColor;
      ctx.fillRect(0, 0, box.w, box.h);
    }
    ctx.drawImage(img, 0, 0, box.w, box.h);
    canvas.toBlob((blob) => { if (blob) downloadBlob('画板.png', blob); }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
}

export function exportJson(): void {
  const data = JSON.stringify({
    version: 2, canvasColor: editorState.canvasColor,
    elements: editorState.elements, groups: editorState.groups, extraDefs: editorState.extraDefs,
  }, null, 2);
  downloadBlob('画板.json', new Blob([data], { type: 'application/json' }));
}

/* ---------------- 导入 ---------------- */
let pendingImageAt: { x: number; y: number } | null = null;
export function setPendingImageAt(p: { x: number; y: number } | null): void { pendingImageAt = p; }

export function importImage(
  dataUrl: string,
  at?: { x: number; y: number } | null,
  opts?: { size?: { w: number; h: number } }
): void {
  pushHistory();
  const img = new Image();
  img.onload = () => {
    const ow = (opts && opts.size && opts.size.w) || img.naturalWidth || 300;
    const oh = (opts && opts.size && opts.size.h) || img.naturalHeight || 150;
    const maxW = 480;
    const scale = ow > maxW ? maxW / ow : 1;
    const el = createElement('image', at ? snapVal(at.x) : 100, at ? snapVal(at.y) : 100, {
      w: ow * scale, h: oh * scale, src: dataUrl,
    });
    editorState.elements.push(el);
    editorState.selectedIds = [el.id];
    bump();
    if (!at) zoomFit();
  };
  img.onerror = () => errorNotifier('图片 / SVG 加载失败');
  img.src = dataUrl;
  setTool('select');
}

export function importSvg(svgText: string, sourceName?: string): void {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) { errorNotifier('不是有效的 SVG 文件'); return; }
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') { errorNotifier('不是有效的 SVG 文件'); return; }

  // 1. CSS 规则
  const rules: CssRule[] = [];
  root.querySelectorAll('style').forEach((s) => rules.push(...parseCssRules(s.textContent || '')));

  // 2. 渐变/图案定义 → 注册进画板 defs 并重写 id
  const idMap: Record<string, string> = {};
  const defClones: Element[] = [];
  root.querySelectorAll('linearGradient, radialGradient, pattern').forEach((n) => {
    const oldId = n.getAttribute('id');
    const newId = 'imp_' + (oldId || 'd') + '_' + Math.random().toString(36).slice(2, 6);
    if (oldId) idMap[oldId] = newId;
    const clone = n.cloneNode(true) as Element;
    clone.setAttribute('id', newId);
    defClones.push(clone);
  });
  const rewriteUrls = (v: string): string => String(v == null ? '' : v).replace(
    /url\(["']?#([^)"']+)["']?\)/g, (_mm, id: string) => 'url(#' + (idMap[id] || id) + ')'
  );

  // 3. 收集叶子并逐个转换为可编辑元素
  const leaves: SvgLeaf[] = [];
  const flags = { skipped: 0 };
  collectSvgLeaves(root, [1, 0, 0, 1, 0, 0], leaves, flags, doc, 0);

  const converted: EditorElement[] = [];
  for (const leaf of leaves) {
    const el = convertLeaf(leaf, rules, rewriteUrls, createElement);
    if (el) converted.push(el);
    else flags.skipped++;
  }

  // 4. 全部无法转换（极罕见）→ 整体图片兜底
  if (!converted.length) {
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    importImage(src, null, { size: svgRootSize(svgText) });
    notifier('该 SVG 无可转换图形，已整体嵌入为图片');
    return;
  }

  pushHistory();
  const serializer = new XMLSerializer();
  defClones.forEach((n) => {
    editorState.extraDefs.push(serializer.serializeToString(n));
  });

  // 5. 导入素材归入一个图层目录（以文件名命名；单元素不值得套目录）
  let gid: string | null = null;
  let groupName = '';
  if (converted.length > 1) {
    groupNameCounter += 1;
    const base = (sourceName || '').replace(/\.[^.]+$/, '').trim();
    groupName = base || '导入 SVG ' + groupNameCounter;
    const g: GroupNode = {
      id: uid(),
      name: groupName,
      parentId: null,
      collapsed: false,
      visible: true,
    };
    editorState.groups.push(g);
    gid = g.id;
  }
  converted.forEach((el) => {
    el.groupId = gid;
    editorState.elements.push(el);
  });
  bump();
  zoomFit();
  notifier('已导入 ' + converted.length + ' 个可编辑元素' +
    (gid ? '，已归入目录「' + groupName + '」' : '') +
    (flags.skipped ? '（' + flags.skipped + ' 个暂不支持的节点已跳过）' : ''));
}

interface JsonArchiveV2 {
  canvasColor?: string;
  elements?: EditorElement[];
  groups?: GroupNode[];
  extraDefs?: string[];
}

export function importJson(text: string): void {
  try {
    const data = JSON.parse(text) as JsonArchiveV2 | EditorElement[];
    const els = Array.isArray(data) ? data : data.elements;
    if (!Array.isArray(els)) throw new Error('bad json');
    pushHistory();
    // 分组树随存档导入（id 全部重映射，避免与画布现有 id 冲突）
    const gidMap: Record<string, string> = {};
    const groups = (!Array.isArray(data) && Array.isArray(data.groups)) ? data.groups : [];
    groups.forEach((g) => { gidMap[g.id] = uid(); });
    groups.forEach((g) => {
      editorState.groups.push({
        id: gidMap[g.id],
        name: g.name || '分组',
        parentId: (g.parentId && gidMap[g.parentId]) || null,
        collapsed: !!g.collapsed,
        visible: g.visible !== false,
      });
    });
    els.forEach((src) => {
      const el = Object.assign(createElement(src.type || 'rect', src.x || 0, src.y || 0), src);
      el.id = uid();
      el.groupId = (src.groupId && gidMap[src.groupId]) || null;
      editorState.elements.push(el);
    });
    if (!Array.isArray(data) && data.canvasColor) editorState.canvasColor = data.canvasColor;
    if (!Array.isArray(data) && Array.isArray(data.extraDefs)) {
      data.extraDefs.forEach((s) => editorState.extraDefs.push(s));
    }
    bump();
    zoomFit();
  } catch (err) {
    errorNotifier('JSON 导入失败：' + (err as Error).message);
  }
}

/* ---------------- 属性面板编辑（同一编辑会话只入栈一次） ---------------- */
let panelKey: string | null = null;
export function panelHistory(key: string): void {
  if (panelKey !== key) {
    pushHistory();
    panelKey = key;
  }
}
export function resetPanelHistory(): void { panelKey = null; }

/* ---------------- localStorage 持久化 ---------------- */
const LS_KEY = 'canvasEditorBoard.v1';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// 防抖保存：任何 bump（拖动/缩放/编辑）后 300ms 落盘
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version: 1,
        elements: editorState.elements,
        groups: editorState.groups,
        extraDefs: editorState.extraDefs,
        canvasColor: editorState.canvasColor,
        zoom: editorState.zoom,
        panX: editorState.panX,
        panY: editorState.panY,
      }));
    } catch (_) { /* 存储满等异常静默 */ }
  }, 300);
}

// 启动时恢复上次画板；返回是否有内容
export function loadBoard(): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as {
      version?: number;
      elements?: EditorElement[];
      groups?: GroupNode[];
      extraDefs?: string[];
      canvasColor?: string;
      zoom?: number;
      panX?: number;
      panY?: number;
    };
    if (!data || data.version !== 1 || !Array.isArray(data.elements)) return false;
    editorState.elements = data.elements;
    editorState.groups = Array.isArray(data.groups) ? data.groups : [];
    editorState.extraDefs = Array.isArray(data.extraDefs) ? data.extraDefs : [];
    if (typeof data.canvasColor === 'string') editorState.canvasColor = data.canvasColor;
    if (typeof data.zoom === 'number') editorState.zoom = clamp(data.zoom, 0.1, 8);
    if (typeof data.panX === 'number') editorState.panX = data.panX;
    if (typeof data.panY === 'number') editorState.panY = data.panY;
    return editorState.elements.length > 0 || editorState.groups.length > 0;
  } catch (_) {
    return false;
  }
}

/* ---------------- 新建：清空画板（可撤销） ---------------- */
export function clearAll(): void {
  pushHistory();
  editorState.elements = [];
  editorState.groups = [];
  editorState.selectedIds = [];
  editorState.extraDefs = [];
  bump();
}
