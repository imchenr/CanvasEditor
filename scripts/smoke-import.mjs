/* 专项冒烟：真实 SVG（code-comment-review-flow.svg）导入验证
 * 覆盖：1) 文本锚点（text-anchor / dominant-baseline）换算
 *       2) path bbox 测量（隐藏 svg 容器）→ 选框手柄对齐
 *       3) 导入素材归入以文件名命名的图层目录
 * 用法：node scripts/smoke-import.mjs [port]（默认 4173） */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const port = process.argv[2] || '4173';
const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'dist/index.html', 'utf8');
const svgText = readFileSync(root + 'scripts/fixtures/code-comment-review-flow.svg', 'utf8');
// 该文件的期望叶子数：34 text + 26 path + 13 rect + 2 circle = 75
const EXPECT_TOTAL = 75;

const asserts = `
const results = [];
function assert(name, cond, detail) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || '')));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);

const api = window.canvasEditor;
assert('测试 API 就绪', !!api);

/* ---- 导入真实 SVG ---- */
api.importSvg(${JSON.stringify(svgText)}, 'code-comment-review-flow.svg');
await sleep(500);

const els = api.getElements();
assert('导入元素数 ' + ${EXPECT_TOTAL}, els.length === ${EXPECT_TOTAL}, 'got ' + els.length +
  ': ' + JSON.stringify(els.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {})));

/* ---- 需求 2：导入素材归入一个目录 ---- */
const groups = api.getGroups();
assert('创建 1 个图层目录', groups.length === 1, 'got ' + groups.length);
assert('目录以文件名命名', groups.length === 1 && groups[0].name === 'code-comment-review-flow',
  groups.map((g) => g.name).join(','));
assert('全部元素归入该目录', groups.length === 1 && els.every((e) => e.groupId === groups[0].id),
  'ungrouped=' + els.filter((e) => e.groupId !== (groups[0] || {}).id).length);

/* ---- 需求 3：菱形 path bbox 与渲染几何一致 ---- */
const diamond = els.find((e) => e.type === 'path' && e.d && e.d.startsWith('M700 500'));
assert('菱形识别为 path', !!diamond);
if (diamond) {
  assert('菱形 bbox x≈580', Math.abs(diamond.x - 580) < 1, 'x=' + diamond.x);
  assert('菱形 bbox y≈500', Math.abs(diamond.y - 500) < 1, 'y=' + diamond.y);
  assert('菱形 bbox w≈240', Math.abs(diamond.w - 240) < 1, 'w=' + diamond.w);
  assert('菱形 bbox h≈120', Math.abs(diamond.h - 120) < 1, 'h=' + diamond.h);
  // 渲染几何 vs 元素 bbox（选框/手柄依据 elBBox）
  // 注意：getBoundingClientRect 是视口坐标，需先减去 stage svg 自身偏移再除 pan/zoom
  const g = document.querySelector('g[data-id="' + diamond.id + '"] path');
  assert('菱形渲染节点存在', !!g);
  if (g) {
    const r = g.getBoundingClientRect();
    const svg = document.querySelector('.stage-svg');
    const sr = svg.getBoundingClientRect();
    const mt = svg.querySelector('g[transform]').getAttribute('transform')
      .match(/translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)/);
    const panX = +mt[1], panY = +mt[2], zoom = +mt[3];
    const wx = (r.left - sr.left - panX) / zoom, wy = (r.top - sr.top - panY) / zoom;
    const ww = r.width / zoom, wh = r.height / zoom;
    assert('菱形渲染位置=bbox 位置（手柄对齐）',
      Math.abs(wx - diamond.x) < 3 && Math.abs(wy - diamond.y) < 3, 'dx=' + (wx - diamond.x) + ' dy=' + (wy - diamond.y));
    assert('菱形渲染尺寸=bbox 尺寸',
      Math.abs(ww - diamond.w) < 3 && Math.abs(wh - diamond.h) < 3, 'dw=' + (ww - diamond.w) + ' dh=' + (wh - diamond.h));
  }
}

/* ---- 需求 1：文本锚点换算 ---- */
// 居中标签：text-anchor:middle + dominant-baseline:middle + weight 600
const label = els.find((e) => e.type === 'text' && e.text === '解析结构化评论');
assert('居中标签已导入', !!label);
if (label) {
  assert('标签字号 28', label.fontSize === 28, 'fs=' + label.fontSize);
  assert('标签字重 600', label.fontWeight === '600', 'w=' + label.fontWeight);
  assert('标签水平居中（中心 x≈700）', Math.abs(label.x + label.w / 2 - 700) < 3,
    'cx=' + (label.x + label.w / 2));
  assert('标签垂直居中（y≈220-0.7fs）', Math.abs(label.y - (220 - 0.7 * 28)) < 2, 'y=' + label.y);
  // 渲染几何：文本中心应贴近矩形中心 (700,220)（同样需减 svg 自身偏移）
  const g = document.querySelector('g[data-id="' + label.id + '"] text');
  const svgEl = document.querySelector('.stage-svg');
  if (g) {
    const sr = svgEl.getBoundingClientRect();
    const mt = svgEl.querySelector('g[transform]').getAttribute('transform').match(/translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)/);
    const panX = +mt[1], panY = +mt[2], zoom = +mt[3];
    const r = g.getBoundingClientRect();
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const wx = (cx - sr.left - panX) / zoom, wy = (cy - sr.top - panY) / zoom;
    assert('标签渲染中心≈(700,220)',
      Math.abs(wx - 700) < 8 && Math.abs(wy - 220) < 8, 'cx=' + wx + ' cy=' + wy);
  }
}
// 左对齐步骤文本：无 anchor（start）+ alphabetic + letter-spacing 2px + weight 700
const step = els.find((e) => e.type === 'text' && e.text === '解析与定位');
assert('步骤文本已导入', !!step);
if (step) {
  assert('步骤字距 2px', Math.abs((step.letterSpacing || 0) - 2) < 0.01, 'ls=' + step.letterSpacing);
  assert('步骤字重 700', step.fontWeight === '700', 'w=' + step.fontWeight);
  assert('步骤左对齐（x≈92）', Math.abs(step.x - 92) < 2, 'x=' + step.x);
  assert('步骤基线换算（y≈102-20）', Math.abs(step.y - 82) < 2, 'y=' + step.y);
}
// 底部说明：属性 text-anchor=middle（无 CSS），基线默认
const footer = els.find((e) => e.type === 'text' && e.text === '结构化评论定位 → 确定性重试 → 证据过滤');
assert('底部说明已导入', !!footer);
if (footer) {
  assert('底部说明水平居中（中心 x≈700）', Math.abs(footer.x + footer.w / 2 - 700) < 3,
    'cx=' + (footer.x + footer.w / 2));
  assert('底部说明基线换算（y≈2112-20）', Math.abs(footer.y - 2092) < 2, 'y=' + footer.y);
}

/* ---- 多行 decision-label 是两个独立 text，均应居中 ---- */
const d1 = els.find((e) => e.type === 'text' && e.text === '是否只有一个');
const d2 = els.find((e) => e.type === 'text' && e.text === '唯一匹配？');
assert('两行决策文本独立导入', !!d1 && !!d2);
if (d1 && d2) {
  assert('决策文本行1居中', Math.abs(d1.x + d1.w / 2 - 700) < 3);
  assert('决策文本行2居中', Math.abs(d2.x + d2.w / 2 - 700) < 3);
}

/* ---- localStorage 持久化（含分组） ---- */
await sleep(700);
let saved = null;
try { saved = JSON.parse(localStorage.getItem('canvasEditorBoard.v1') || 'null'); } catch (_) {}
assert('画板（含目录）已存 localStorage',
  !!saved && Array.isArray(saved.elements) && saved.elements.length === ${EXPECT_TOTAL} &&
  Array.isArray(saved.groups) && saved.groups.length === 1,
  saved ? 'elements=' + saved.elements.length + ' groups=' + (saved.groups || []).length : 'null');

document.title = 'DONE';
const pre = document.createElement('pre');
pre.id = '__RESULT__';
pre.textContent = '\\nSMOKE_START\\n' + results.join('\\n') + '\\nSMOKE_END\\n';
document.body.appendChild(pre);
`;

const testHtml = html.replace('</body>', '<script type="module">' + asserts + '</script>\n</body>');
writeFileSync(root + 'dist/test-import.html', testHtml);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let out = '';
try {
  out = execSync(
    `"${chrome}" --headless --disable-gpu --no-sandbox --dump-dom --virtual-time-budget=15000 http://127.0.0.1:${port}/test-import.html`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
} catch (e) {
  console.error('chrome failed:', e.message);
  process.exit(2);
}

const m = out.match(/SMOKE_START\n([\s\S]*?)SMOKE_END/);
if (!m) {
  console.error('未捕获断言结果（页面可能未执行脚本）');
  process.exit(2);
}
console.log(m[1].trim());
const fails = m[1].split('\n').filter((l) => l.startsWith('FAIL'));
console.log(`\n${fails.length === 0 ? 'ALL PASS' : fails.length + ' FAILED'}`);
process.exit(fails.length === 0 ? 0 : 1);
