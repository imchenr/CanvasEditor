/* ============================================================
 * 编辑器公共类型定义
 * ============================================================ */

/** SVG 变换矩阵（2x3） */
export type Mat = [number, number, number, number, number, number];

/** 尺寸 */
export interface Size {
  w: number;
  h: number;
}

/** 工具类型 */
export type ToolType = 'select' | 'pan' | 'rect' | 'ellipse' | 'text' | 'image';

/** 元素类型 */
export type ElementType = 'rect' | 'ellipse' | 'text' | 'image' | 'path';

/** 画布元素（扁平结构：形状共有字段必有，类型专属字段可选） */
export interface EditorElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  visible: boolean;
  /** 所属图层分组 */
  groupId?: string | null;

  /* ---- text 专属 ---- */
  text?: string;
  fontSize?: number;
  /** 字重（如 '600'），导入 SVG 时保留，用于测量与渲染 */
  fontWeight?: string;
  /** 字距 px，导入 SVG 时保留 */
  letterSpacing?: number;

  /* ---- image 专属 ---- */
  src?: string;

  /* ---- path 专属 ---- */
  d?: string;
  /** 导入时的 2x3 变换矩阵 */
  mat?: number[];
  /** 导入时路径自身的局部 bbox */
  bwx?: number;
  bwy?: number;
  bw?: number;
  bh?: number;

  /* ---- rect 圆角 ---- */
  rx?: number;
  ry?: number;
}

/** 图层分组节点（目录树，可嵌套） */
export interface GroupNode {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  visible: boolean;
}

/** 尺寸框 */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 拖动吸附起点 */
export interface SnapOrigin {
  id: string;
  x: number;
  y: number;
}

/** 对齐参考线 */
export interface SnapGuide {
  axis: 'v' | 'h';
  pos: number;
  from: number;
  to: number;
}

/** 智能吸附结果 */
export interface SnapResult {
  dx: number;
  dy: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: SnapGuide[];
}

/** SVG 导入叶子（展开 g/use 后的图形节点 + 累积矩阵） */
export interface SvgLeaf {
  node: Element;
  matrix: Mat;
  tag: string;
}

/** CSS 规则（导入 SVG 的 <style> 解析产物） */
export interface CssRule {
  sel: string;
  props: Record<string, string>;
}

/** 元素工厂签名 */
export type ElementFactory = (
  type: ElementType,
  x: number,
  y: number,
  extra?: Partial<EditorElement>
) => EditorElement;

/** 编辑器全局状态 */
export interface EditorState {
  elements: EditorElement[];
  selectedIds: string[];
  tool: ToolType;
  zoom: number;
  panX: number;
  panY: number;
  snap: boolean;
  showGrid: boolean;
  canvasColor: string;
  counter: number;
  copyBuffer: EditorElement[];
  spaceDown: boolean;
  /** 导入 SVG 带来的渐变/图案定义（字符串） */
  extraDefs: string[];
  /** 图层分组树 */
  groups: GroupNode[];
  stageSize: { w: number; h: number };
  editingId: string | null;
  /** 图片工具落点（内部使用） */
  _pendingImageAt?: { x: number; y: number } | null;
}

/** 暴露给测试 / 集成的全局 API */
export interface CanvasEditorApi {
  importSvg: (svgText: string, sourceName?: string) => void;
  importJson: (text: string) => void;
  importImage: (dataUrl: string, at?: { x: number; y: number } | null) => void;
  exportSvgString: () => string;
  getElements: () => EditorElement[];
  getGroups: () => GroupNode[];
  createGroup: (parentId?: string | null) => GroupNode;
  moveElementToGroup: (elId: string, gid: string | null) => void;
  setGroupVisible: (id: string, visible: boolean) => void;
  deleteGroup: (id: string) => void;
  getSelected: () => EditorElement[];
  findEl: (id: string) => EditorElement | undefined;
  openTextEditor: (id: string) => void;
  isEditing: () => boolean;
}

declare global {
  interface Window {
    canvasEditor?: CanvasEditorApi;
  }
}
