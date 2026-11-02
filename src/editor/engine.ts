/* ============================================================
 * 画板引擎（纯函数，无 React 依赖）
 * 测量 / bbox / 矩阵 / CSS 解析 / SVG 导入解析 /
 * 智能吸附 / 导出序列化
 * ============================================================ */
import type {
  BBox, CssRule, EditorElement, ElementFactory, Mat, Size, SnapGuide, SnapOrigin, SnapResult, SvgLeaf,
} from './types';

export type { Mat };

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/* ---------------- 文本测量 ---------------- */
let _measureCtx: CanvasRenderingContext2D | null = null;

export function measureText(text: string, fontSize: number, weight?: string, letterSpacing?: number): Size {
  const lines = (text || '').split('\n');
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  const ls = letterSpacing || 0;
  _measureCtx!.font = (weight || '400') + ' ' + fontSize + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  let maxW = 10;
  lines.forEach((l) => {
    const s = l || ' ';
    // letter-spacing 手动按字符数累加（不依赖 canvas letterSpacing 新 API）
    maxW = Math.max(maxW, _measureCtx!.measureText(s).width + Math.max(0, s.length - 1) * ls);
  });
  return { w: Math.ceil(maxW), h: Math.ceil(lines.length * fontSize * 1.25) };
}

export function elBBox(el: EditorElement): BBox {
  if (el.type === 'text') {
    const m = measureText(el.text || '', el.fontSize || 16, el.fontWeight, el.letterSpacing);
    return { x: el.x, y: el.y, w: m.w, h: m.h };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/* ---------------- SVG 变换矩阵 ---------------- */

export function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMat(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function matScale(m: Mat): { sx: number; sy: number; rot: number } {
  return {
    sx: Math.hypot(m[0], m[1]) || 1,
    sy: Math.hypot(m[2], m[3]) || 1,
    rot: Math.atan2(m[1], m[0]) * 180 / Math.PI,
  };
}

export function parseTransform(str: string | null): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  if (!str) return m;
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = [1, 0, 0, 1, 0, 0];
    if (match[1] === 'translate') t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
    else if (match[1] === 'scale') {
      const sx = args[0] != null ? args[0] : 1;
      const sy = args[1] != null ? args[1] : sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (match[1] === 'rotate') {
      const a = (args[0] || 0) * Math.PI / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      t = [cos, sin, -sin, cos, 0, 0];
      if (args.length >= 3) {
        t = matMul([1, 0, 0, 1, args[1], args[2]], matMul(t, [1, 0, 0, 1, -args[1], -args[2]]));
      }
    } else if (match[1] === 'matrix') {
      t = [args[0] || 1, args[1] || 0, args[2] || 0, args[3] || 1, args[4] || 0, args[5] || 0];
    }
    m = matMul(m, t);
  }
  return m;
}

/* ---------------- SVG 样式（CSS 规则 + 内联 style） ---------------- */
export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  (css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel: string, body: string) => {
    const props: Record<string, string> = {};
    body.split(';').forEach((pair) => {
      const i = pair.indexOf(':');
      if (i > 0) props[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
    });
    sel.split(',').forEach((s) => rules.push({ sel: s.trim(), props }));
    return '';
  });
  return rules;
}

interface ResolvedStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  opacity: number | null;
  fontSize: number | null;
  hidden: boolean;
  /* 文本排版（导入 SVG 用） */
  textAlign: string | null;
  dominantBaseline: string | null;
  fontWeight: string | null;
  letterSpacing: number | null;
}

function cssMatches(node: Element, sel: string): boolean {
  if (sel === '*') return true;
  const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?$/.exec(sel.trim());
  if (!m) return false;
  const [, tag, cls] = m;
  if (tag && tag.toLowerCase() !== node.nodeName.toLowerCase()) return false;
  if (cls && !(node.getAttribute('class') || '').split(/\s+/).includes(cls)) return false;
  return !!tag || !!cls;
}

export function resolveStyle(node: Element, rules: CssRule[]): ResolvedStyle {
  // 优先级：表现属性 < CSS 规则 < 内联 style（贴合 SVG 层叠）
  const style: ResolvedStyle = {
    fill: null, stroke: null, strokeWidth: null, opacity: null, fontSize: null, hidden: false,
    textAlign: null, dominantBaseline: null, fontWeight: null, letterSpacing: null,
  };
  const applyProps = (props: Record<string, string>) => {
    if (props.fill != null) style.fill = props.fill;
    if (props.stroke != null) style.stroke = props.stroke;
    if (props['stroke-width'] != null) style.strokeWidth = parseFloat(props['stroke-width']);
    if (props.opacity != null) style.opacity = parseFloat(props.opacity);
    if (props['fill-opacity'] != null) style.opacity = parseFloat(props['fill-opacity']);
    if (props['font-size'] != null) style.fontSize = parseFloat(props['font-size']);
    if (props['text-anchor'] != null) style.textAlign = props['text-anchor'];
    if (props['dominant-baseline'] != null) style.dominantBaseline = props['dominant-baseline'];
    if (props['font-weight'] != null) style.fontWeight = props['font-weight'];
    if (props['letter-spacing'] != null) {
      const v = parseFloat(props['letter-spacing']);
      if (!Number.isNaN(v)) style.letterSpacing = v;
    }
    if (props.display === 'none' || props.visibility === 'hidden') style.hidden = true;
  };
  if (node.getAttribute('fill') != null) style.fill = node.getAttribute('fill');
  if (node.getAttribute('stroke') != null) style.stroke = node.getAttribute('stroke');
  if (node.getAttribute('stroke-width') != null) style.strokeWidth = parseFloat(node.getAttribute('stroke-width')!);
  if (node.getAttribute('opacity') != null) style.opacity = parseFloat(node.getAttribute('opacity')!);
  if (node.getAttribute('font-size') != null) style.fontSize = parseFloat(node.getAttribute('font-size')!);
  if (node.getAttribute('text-anchor') != null) style.textAlign = node.getAttribute('text-anchor');
  if (node.getAttribute('dominant-baseline') != null) style.dominantBaseline = node.getAttribute('dominant-baseline');
  if (node.getAttribute('font-weight') != null) style.fontWeight = node.getAttribute('font-weight');
  if (node.getAttribute('letter-spacing') != null) {
    const v = parseFloat(node.getAttribute('letter-spacing')!);
    if (!Number.isNaN(v)) style.letterSpacing = v;
  }
  rules.forEach((r) => { if (cssMatches(node, r.sel)) applyProps(r.props); });
  const inline = node.getAttribute('style');
  if (inline) {
    const props: Record<string, string> = {};
    inline.split(';').forEach((pair) => {
      const i = pair.indexOf(':');
      if (i > 0) props[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
    });
    applyProps(props);
  }
  return style;
}

/* ---------------- 路径 bbox 测量 ---------------- */
// 常驻隐藏 <svg> 测量容器：path 直接挂 body 不渲染，getBBox 会静默返回全 0
let _measureSvg: SVGSVGElement | null = null;

export function measurePathBBox(d: string): BBox | null {
  try {
    if (!_measureSvg) {
      _measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      _measureSvg.setAttribute('style',
        'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:visible;pointer-events:none');
      document.body.appendChild(_measureSvg);
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    _measureSvg.appendChild(p);
    const b = p.getBBox();
    p.remove();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch (_) {
    return null;
  }
}

/* ---------------- SVG 叶子收集（展开 g/use，累积矩阵） ---------------- */
export const SVG_SKIP_TAGS = new Set([
  'defs', 'title', 'desc', 'metadata', 'style', 'clippath', 'mask', 'filter',
  'lineargradient', 'radialgradient', 'pattern', 'symbol', 'marker', 'script',
]);

export function collectSvgLeaves(
  node: Element, m: Mat, out: SvgLeaf[], flags: { skipped: number }, doc: Document, depth = 0
): void {
  for (const child of Array.from(node.children)) {
    const c = child as SVGElement;
    const tag = c.nodeName.toLowerCase();
    if (SVG_SKIP_TAGS.has(tag)) continue;
    const cm = matMul(m, parseTransform(c.getAttribute('transform')));

    if (tag === 'use') {
      const href = c.getAttribute('href') || c.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      const refId = href.replace(/^#/, '');
      const target = refId ? doc.getElementById(refId) : null;
      if (!target || depth > 3) { flags.skipped++; continue; }
      const useM = matMul(cm, parseTransform(
        'translate(' + (parseFloat(c.getAttribute('x') || '0') || 0) + ',' + (parseFloat(c.getAttribute('y') || '0') || 0) + ')'
      ));
      const tTag = target.nodeName.toLowerCase();
      if (tTag === 'g' || tTag === 'svg') {
        collectSvgLeaves(target, useM, out, flags, doc, depth + 1);
      } else {
        out.push({ node: target, matrix: useM, tag: tTag });
      }
      continue;
    }
    if (tag === 'g' || tag === 'a' || tag === 'svg') {
      collectSvgLeaves(c, cm, out, flags, doc, depth);
    } else {
      out.push({ node: c, matrix: cm, tag });
    }
  }
}

export function svgRootSize(svgText: string): { w: number; h: number } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  let w = parseFloat(root.getAttribute('width') || '');
  let h = parseFloat(root.getAttribute('height') || '');
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean).map(Number);
  if ((!w || !h) && vb.length === 4) { w = vb[2]; h = vb[3]; }
  if (!w || !h) { w = 300; h = 150; }
  return { w, h };
}

/* ---------------- 叶子 → 可编辑元素 ---------------- */
export function convertLeaf(
  leaf: SvgLeaf, rules: CssRule[], rewriteUrls: (v: string) => string, make: ElementFactory
): EditorElement | null {
  const node = leaf.node;
  const tag = leaf.tag;
  const m = leaf.matrix;
  const style = resolveStyle(node, rules);
  if (style.hidden) return null;

  const attr = (n: string): number => parseFloat(node.getAttribute(n) || '0');
  let fill = style.fill != null ? style.fill : '#000000';
  let stroke = style.stroke != null ? style.stroke : 'none';
  let sw = style.strokeWidth != null ? style.strokeWidth : (attr('stroke-width') || 0);
  fill = rewriteUrls(fill);
  stroke = rewriteUrls(stroke);

  const { sx, sy, rot } = matScale(m);
  const opacity = style.opacity != null ? style.opacity : 1;
  const finish = (el: EditorElement): EditorElement => {
    el.opacity = opacity;
    if (Math.abs(rot) > 0.01 && el.type !== 'path') el.rot = rot;
    return el;
  };

  // ---- path / line / polyline / polygon → path 类型（原生可编辑） ----
  if (tag === 'path' || tag === 'line' || tag === 'polyline' || tag === 'polygon') {
    let d = '';
    if (tag === 'path') d = node.getAttribute('d') || '';
    else if (tag === 'line') {
      d = 'M ' + attr('x1') + ' ' + attr('y1') + ' L ' + attr('x2') + ' ' + attr('y2');
      if (style.fill == null && node.getAttribute('fill') == null) fill = 'none';
    } else {
      const pts = (node.getAttribute('points') || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      d = '';
      for (let i = 0; i + 1 < pts.length; i += 2) d += (i ? ' L ' : 'M ') + pts[i] + ' ' + pts[i + 1];
      if (tag === 'polygon') d += ' Z';
      else if (style.fill == null && node.getAttribute('fill') == null) fill = 'none';
    }
    if (!d) return null;
    const bboxL = measurePathBBox(d);
    if (!bboxL) return null;
    const corners = [
      applyMat(m, bboxL.x, bboxL.y), applyMat(m, bboxL.x + bboxL.w, bboxL.y),
      applyMat(m, bboxL.x, bboxL.y + bboxL.h), applyMat(m, bboxL.x + bboxL.w, bboxL.y + bboxL.h),
    ];
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const bwx = Math.min.apply(null, xs), bwy = Math.min.apply(null, ys);
    const bw = Math.max.apply(null, xs) - bwx || 1, bh = Math.max.apply(null, ys) - bwy || 1;
    return finish(make('path', bwx, bwy, {
      w: bw, h: bh, d, mat: m.slice(), bwx, bwy, bw, bh,
      fill, stroke, strokeWidth: sw,
    }));
  }

  if (tag === 'rect') {
    const x = attr('x'), y = attr('y'), w = attr('width'), h = attr('height');
    const p1 = applyMat(m, x, y), p2 = applyMat(m, x + w, y + h);
    const extra: Partial<EditorElement> = {
      w: Math.abs(p2.x - p1.x) || 1, h: Math.abs(p2.y - p1.y) || 1,
      fill, stroke, strokeWidth: sw,
    };
    const rx = parseFloat(node.getAttribute('rx') || '0');
    const ry = parseFloat(node.getAttribute('ry') || '0') || rx;
    if (rx) { extra.rx = rx * sx; extra.ry = ry * sy; }
    return finish(make('rect', Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), extra));
  }
  if (tag === 'circle') {
    const r = attr('r');
    const c = applyMat(m, attr('cx'), attr('cy'));
    return finish(make('ellipse', c.x - r * sx, c.y - r * sy, {
      w: r * 2 * sx, h: r * 2 * sy, fill, stroke, strokeWidth: sw,
    }));
  }
  if (tag === 'ellipse') {
    const rx = attr('rx'), ry = attr('ry');
    const c = applyMat(m, attr('cx'), attr('cy'));
    return finish(make('ellipse', c.x - rx * sx, c.y - ry * sy, {
      w: rx * 2 * sx, h: ry * 2 * sy, fill, stroke, strokeWidth: sw,
    }));
  }
  if (tag === 'text') {
    const baseFs = (style.fontSize != null ? style.fontSize : attr('font-size') || 16);
    const s = (sx + sy) / 2 || 1;
    const fs = baseFs * s;
    const content = node.textContent || '文本';
    const weight = style.fontWeight != null ? String(style.fontWeight) : '400';
    const ls = style.letterSpacing != null ? style.letterSpacing : 0;
    const tm = measureText(content, fs, weight, ls);

    // 水平锚点：text-anchor（start/middle/end）→ 编辑器为左上锚点（源坐标系换算）
    const anchor = style.textAlign || 'start';
    let ox = 0;
    if (anchor === 'middle') ox = -(tm.w / s) / 2;
    else if (anchor === 'end') ox = -(tm.w / s);

    // 垂直锚点：dominant-baseline → 编辑器首行基线位于 el.y + fontSize
    // em 盒：顶 = 基线 - 0.8fs，底 = 基线 + 0.2fs
    const baseline = style.dominantBaseline || 'auto';
    let oy = -baseFs; // alphabetic（默认）：基线 = y → 顶 = y - fs
    if (baseline === 'middle' || baseline === 'central') oy = -0.7 * baseFs;         // 中心 = y → 基线 = y + 0.3fs
    else if (baseline === 'hanging' || baseline === 'text-before-edge') oy = -0.2 * baseFs; // 顶 = y → 基线 = y + 0.8fs
    else if (baseline === 'text-after-edge' || baseline === 'ideographic') oy = -1.2 * baseFs; // 底 = y → 基线 = y - 0.2fs

    const p = applyMat(m, attr('x') + ox, attr('y') + oy);
    return finish(make('text', p.x, p.y, {
      text: content, fontSize: fs, fontWeight: weight, letterSpacing: ls * s,
      fill, w: tm.w, h: tm.h,
    }));
  }
  if (tag === 'image') {
    const href = node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    const x = attr('x'), y = attr('y'), w = attr('width') || 120, h = attr('height') || 80;
    const p1 = applyMat(m, x, y), p2 = applyMat(m, x + w, y + h);
    return finish(make('image', Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), {
      w: Math.abs(p2.x - p1.x) || 120, h: Math.abs(p2.y - p1.y) || 80, src: href,
    }));
  }
  return null;
}

/* ---------------- 智能对齐吸附 ---------------- */
// origins: [{id,x,y}]（拖动起止集）；elements: 全部元素（用于找 origins 的当前 bbox）
export function computeSmartSnap(
  elements: EditorElement[], origins: SnapOrigin[], dx: number, dy: number, zoom: number
): SnapResult {
  const T = 6 / zoom; // 阈值按缩放换算 ≈ 6 屏幕像素
  const exclude = origins.map((o) => o.id);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const targets = elements.filter((e) => e.visible && !exclude.includes(e.id));
  const result: SnapResult = { dx, dy, snappedX: false, snappedY: false, guides: [] };
  if (!targets.length) return result;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  origins.forEach((o) => {
    const el = byId.get(o.id);
    if (!el) return;
    const b = elBBox(el);
    const x = o.x + dx, y = o.y + dy;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + b.w); maxY = Math.max(maxY, y + b.h);
  });
  if (minX === Infinity) return result;
  const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const edgesX = [box.x, box.x + box.w / 2, box.x + box.w];
  const edgesY = [box.y, box.y + box.h / 2, box.y + box.h];

  let bestX: { adjust: number } | null = null;
  let bestY: { adjust: number } | null = null;
  const candsX: number[] = [];
  const candsY: number[] = [];
  targets.forEach((t) => {
    const b = elBBox(t);
    const tX = [b.x, b.x + b.w / 2, b.x + b.w];
    const tY = [b.y, b.y + b.h / 2, b.y + b.h];
    edgesX.forEach((mx) => tX.forEach((tx) => {
      const diff = tx - mx;
      if (Math.abs(diff) <= T) candsX.push(diff);
    }));
    edgesY.forEach((my) => tY.forEach((ty) => {
      const diff = ty - my;
      if (Math.abs(diff) <= T) candsY.push(diff);
    }));
  });
  if (candsX.length) {
    bestX = { adjust: candsX.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) };
  }
  if (candsY.length) {
    bestY = { adjust: candsY.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) };
  }

  if (bestX) {
    result.dx = dx + bestX.adjust;
    result.snappedX = true;
    const snappedX = edgesX.map((v) => v + bestX!.adjust);
    targets.forEach((t) => {
      const b = elBBox(t);
      [b.x, b.x + b.w / 2, b.x + b.w].forEach((tx) => {
        snappedX.forEach((sx) => {
          if (Math.abs(tx - sx) < 0.5) {
            result.guides.push({
              axis: 'v', pos: tx,
              from: Math.min(box.y, b.y), to: Math.max(box.y + box.h, b.y + b.h),
            });
          }
        });
      });
    });
  }
  if (bestY) {
    result.dy = dy + bestY.adjust;
    result.snappedY = true;
    const snappedY = edgesY.map((v) => v + bestY!.adjust);
    targets.forEach((t) => {
      const b = elBBox(t);
      [b.y, b.y + b.h / 2, b.y + b.h].forEach((ty) => {
        snappedY.forEach((sy) => {
          if (Math.abs(ty - sy) < 0.5) {
            result.guides.push({
              axis: 'h', pos: ty,
              from: Math.min(box.x, b.x), to: Math.max(box.x + box.w, b.x + b.w),
            });
          }
        });
      });
    });
  }

  const seen = new Set<string>();
  result.guides = result.guides.filter((g: SnapGuide) => {
    const k = g.axis + ':' + Math.round(g.pos * 2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return result;
}

/* ---------------- 导出（命令式 DOM 构造，保证与旧版序列化一致） ---------------- */
function buildElementNode(el: EditorElement): SVGGElement | null {
  const NS = 'http://www.w3.org/2000/svg';
  const bbox = elBBox(el);
  const group = document.createElementNS(NS, 'g') as SVGGElement;
  if (el.rot) {
    group.setAttribute('transform', 'rotate(' + el.rot + ' ' + (el.x + bbox.w / 2) + ' ' + (el.y + bbox.h / 2) + ')');
  }

  let node: SVGElement;
  if (el.type === 'rect') {
    node = document.createElementNS(NS, 'rect');
    node.setAttribute('x', String(el.x)); node.setAttribute('y', String(el.y));
    node.setAttribute('width', String(Math.max(1, el.w))); node.setAttribute('height', String(Math.max(1, el.h)));
    if (el.rx) {
      node.setAttribute('rx', String(el.rx));
      node.setAttribute('ry', String(el.ry || el.rx));
    }
  } else if (el.type === 'path' && el.d) {
    node = document.createElementNS(NS, 'path');
    node.setAttribute('d', el.d);
    const sx = el.w / (el.bw || 1), sy = el.h / (el.bh || 1);
    const mat = el.mat ? el.mat.join(' ') : '1 0 0 1 0 0';
    node.setAttribute('transform',
      'translate(' + el.x + ' ' + el.y + ') scale(' + sx + ' ' + sy + ') translate(' +
      (-(el.bwx || 0)) + ' ' + (-(el.bwy || 0)) + ') matrix(' + mat + ')');
  } else if (el.type === 'ellipse') {
    node = document.createElementNS(NS, 'ellipse');
    node.setAttribute('cx', String(el.x + el.w / 2)); node.setAttribute('cy', String(el.y + el.h / 2));
    node.setAttribute('rx', String(Math.max(1, el.w / 2))); node.setAttribute('ry', String(Math.max(1, el.h / 2)));
  } else if (el.type === 'text') {
    node = document.createElementNS(NS, 'text');
    node.setAttribute('x', String(el.x));
    node.setAttribute('y', String(el.y + (el.fontSize || 16)));
    node.setAttribute('font-size', String(el.fontSize || 16));
    node.setAttribute('font-family', 'PingFang SC, Microsoft YaHei, sans-serif');
    if (el.fontWeight && el.fontWeight !== '400') {
      node.setAttribute('font-weight', el.fontWeight);
    }
    if (el.letterSpacing) {
      node.setAttribute('letter-spacing', el.letterSpacing + 'px');
    }
    (el.text || '').split('\n').forEach((line, i) => {
      const tspan = document.createElementNS(NS, 'tspan');
      tspan.setAttribute('x', String(el.x));
      if (i > 0) tspan.setAttribute('dy', String((el.fontSize || 16) * 1.25));
      tspan.textContent = line || ' ';
      node.appendChild(tspan);
    });
  } else if (el.type === 'image' && el.src) {
    node = document.createElementNS(NS, 'image');
    node.setAttribute('x', String(el.x)); node.setAttribute('y', String(el.y));
    node.setAttribute('width', String(Math.max(1, el.w))); node.setAttribute('height', String(Math.max(1, el.h)));
    node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', el.src);
    node.setAttribute('href', el.src);
    node.setAttribute('preserveAspectRatio', 'none');
  } else {
    return null;
  }

  node.setAttribute('fill', el.fill);
  if (el.stroke && el.stroke !== 'none' && el.strokeWidth > 0) {
    node.setAttribute('stroke', el.stroke);
    node.setAttribute('stroke-width', String(el.strokeWidth));
  }
  node.setAttribute('opacity', String(el.opacity));
  group.appendChild(node);
  return group;
}

export function contentBBox(elements: EditorElement[], pad?: number): BBox {
  const p = pad == null ? 40 : pad;
  const els = elements.filter((e) => e.visible);
  if (!els.length) return { x: 0, y: 0, w: 800, h: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  els.forEach((el) => {
    const b = elBBox(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  });
  return { x: minX - p, y: minY - p, w: maxX - minX + p * 2, h: maxY - minY + p * 2 };
}

export function exportSvgString(elements: EditorElement[], canvasColor: string, extraDefs: string[]): string {
  const box = contentBBox(elements, 40);
  const serializer = new XMLSerializer();
  const bg = canvasColor !== 'transparent'
    ? '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="' + canvasColor + '"/>'
    : '';
  const body = elements.filter((e) => e.visible).map((el) => {
    const node = buildElementNode(el);
    return node ? serializer.serializeToString(node) : '';
  }).join('\n');
  const defsStr = (extraDefs && extraDefs.length) ? '<defs>' + extraDefs.join('') + '</defs>\n' : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '" ' +
    'width="' + Math.round(box.w) + '" height="' + Math.round(box.h) + '">\n' +
    defsStr + bg + '\n' + body + '\n</svg>';
}

/* ---------------- 下载 ---------------- */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
