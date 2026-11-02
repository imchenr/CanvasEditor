/* 冒烟测试：生成 dist/test-smoke.html（在 index.html 基础上追加断言脚本），
 * 用无头 Chrome --dump-dom 跑断言并回收结果。
 * 用法：node scripts/smoke.mjs [port]（默认 4173，需先 npm run build + vite preview） */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const port = process.argv[2] || '4173';
const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'dist/index.html', 'utf8');

const asserts = `
const results = [];
function assert(name, cond, detail) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || '')));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);

const api = window.canvasEditor;
assert('测试 API 就绪', !!api);

/* ---- 6. 初始无素材 ---- */
assert('默认打开无初始素材', api.getElements().length === 0, 'got ' + api.getElements().length);

/* ---- 4. 品牌：自由画板，无 React 徽标 ---- */
const brand = document.querySelector('.brand');
assert('品牌为「自由画板」', brand && brand.textContent.trim() === '自由画板', brand && brand.textContent.trim());
assert('React 徽标已移除', !document.querySelector('.brand .ver'));

/* ---- 1. 图层/属性标题浅灰背景同步 ---- */
const layerTitle = document.querySelector('.layer-panel .panel-title-row');
const propsTitle = document.querySelector('.props-panel .panel-title-row');
const layerBg = layerTitle ? getComputedStyle(layerTitle).backgroundColor : 'null';
const propsBg = propsTitle ? getComputedStyle(propsTitle).backgroundColor : 'null';
assert('图层标题浅灰背景', layerBg === 'rgb(241, 245, 249)', layerBg);
assert('属性标题同步浅灰背景', propsBg === 'rgb(241, 245, 249)', propsBg);

/* ---- 2/3. 底栏：画布背景 radio + 无平移提示 ---- */
const bar = document.querySelector('.statusbar');
const barText = bar ? bar.textContent : '';
assert('底栏存在', !!bar);
const radios = bar ? bar.querySelectorAll('.ant-radio-button-wrapper') : [];
assert('画布背景色 radio 4 项（白/浅灰/深/透）', radios.length === 4, 'got ' + radios.length);
assert('底栏无「空格+拖动」提示', !barText.includes('空格'), barText);
assert('底栏无 Select 下拉', !(bar && bar.querySelector('.ant-select')));
assert('网格/吸附开关保留', barText.includes('网格') && barText.includes('吸附'));

/* ---- 5. 缩放按钮无边框 ---- */
const zoomBtns = bar ? [...bar.querySelectorAll('button')] : [];
assert('缩放按钮 3 个无边框（text 型）',
  zoomBtns.length === 3 && zoomBtns.every((b) => {
    const s = getComputedStyle(b);
    return s.borderColor === 'rgba(0, 0, 0, 0)' || s.borderColor === 'transparent';
  }),
  zoomBtns.map((b) => getComputedStyle(b).borderColor).join(','));

/* ---- 7/8/9. 顶栏：新建按钮 + 帮助组 + 单行 + 导出 primary ---- */
const tbtns = [...document.querySelectorAll('.top-btn')];
const newBtn = tbtns.find((b) => b.textContent.includes('新建'));
const helpBtn = tbtns.find((b) => b.textContent.includes('快捷键'));
assert('新建按钮存在', !!newBtn);
assert('帮助组「快捷键」按钮存在', !!helpBtn);
const topbar = document.querySelector('.topbar');
assert('顶栏单行不换行（<55px）', topbar && topbar.clientHeight < 55, topbar ? 'h=' + topbar.clientHeight : '');
const expBtn = tbtns.find((b) => b.textContent.includes('导出'));
assert('导出按钮 primary 样式', expBtn && expBtn.classList.contains('primary') && getComputedStyle(expBtn).backgroundColor === 'rgb(255, 255, 255)');

/* ---- 9. 快捷键 dialog ---- */
helpBtn.click();
await sleep(200);
let helpModal = document.querySelector('.ant-modal');
assert('点击「快捷键」弹出 dialog', !!helpModal);
assert('dialog 含快捷键内容', helpModal && helpModal.textContent.includes('Ctrl+Z') && helpModal.textContent.includes('滚轮缩放'));
const helpOk = helpModal ? [...helpModal.querySelectorAll('.ant-modal-footer button')].find((b) => b.textContent.replace(/\s+/g, '').includes('知道了')) : null;
if (helpOk) helpOk.click();
await sleep(500);
assert('dialog 可关闭', !document.querySelector('.ant-modal .ant-modal-content') || !document.querySelector('.ant-modal-mask'),
  'modal count=' + document.querySelectorAll('.ant-modal').length);

/* ---- 回归：SVG 导入 4 元素（rect/ellipse/path/text） ---- */
api.importSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 450">' +
  '<rect x="100" y="100" width="200" height="100" fill="#2563eb"/>' +
  '<ellipse cx="520" cy="150" rx="90" ry="70" fill="#f97316"/>' +
  '<path d="M100 300 L300 300 L200 400 Z" fill="#16a34a"/>' +
  '<text x="100" y="60" font-size="24" fill="#1e293b">标题文本</text>' +
  '</svg>'
);
await sleep(400);
const els = api.getElements();
assert('SVG 导入 4 个原生元素', els.length === 4, 'got ' + els.length + ': ' + els.map((e) => e.type).join(','));

/* ---- 回归：框选（rect+ellipse 恰好 2 个，text/path 不入选） ---- */
const svg = document.querySelector('.stage-svg');
const sceneG = svg.querySelector('g[transform]');
const mt = sceneG.getAttribute('transform').match(/translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)/);
const panX = +mt[1], panY = +mt[2], zoom = +mt[3];
const rect0 = svg.getBoundingClientRect();
const ev = (type, sx, sy) => new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1,
  clientX: rect0.left + sx, clientY: rect0.top + sy,
});
const p1 = { x: 90 * zoom + panX, y: 90 * zoom + panY };
const p2 = { x: 620 * zoom + panX, y: 260 * zoom + panY };
svg.dispatchEvent(ev('pointerdown', p1.x, p1.y));
await sleep(60);
svg.dispatchEvent(ev('pointermove', (p1.x + p2.x) / 2, (p1.y + p2.y) / 2));
svg.dispatchEvent(ev('pointermove', p2.x, p2.y));
await sleep(60);
assert('拖动中渲染框选矩形', !!svg.querySelector('#overlay rect'));
svg.dispatchEvent(ev('pointerup', p2.x, p2.y));
await sleep(150);
const selTypes = api.getSelected().map((e) => e.type).sort().join(',');
assert('框选命中 rect+ellipse（2 个）', selTypes === 'ellipse,rect', 'got ' + selTypes);

/* ---- 7. localStorage 持久化 ---- */
await sleep(700); // 防抖 300ms
let saved = null;
try { saved = JSON.parse(localStorage.getItem('canvasEditorBoard.v1') || 'null'); } catch (_) {}
assert('画板状态已存 localStorage', !!saved && Array.isArray(saved.elements) && saved.elements.length === 4,
  saved ? 'elements=' + saved.elements.length : 'null');

/* ---- 回归：双击文本就地编辑 ---- */
const textEl = api.getElements().find((e) => e.type === 'text');
api.openTextEditor(textEl.id);
await sleep(120);
const te = document.querySelector('.text-editor');
assert('就地编辑 textarea 渲染', !!te);
if (te) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(te, '持久化回归文本');
  te.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(60);
  te.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(120);
}
assert('编辑提交后退出', !api.isEditing());
assert('文本已更新', (api.findEl(textEl.id) || {}).text === '持久化回归文本');

/* ---- 8. 新建：confirm 确认后清空 ---- */
newBtn.click();
await sleep(400);
const confirmModal = document.querySelector('.ant-modal-confirm');
assert('点击「新建」弹出 confirm', !!confirmModal);
assert('confirm 提示清空警告', confirmModal && confirmModal.textContent.includes('清空'));
const confirmBtns = confirmModal ? [...confirmModal.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
// antd 按钮会在两字中文间插空格（"确 定"），比较时去空白
// 注意：模板字符串内正则的反斜杠需要双写
const btnText = (b) => b.textContent.replace(/\\s+/g, '');
const okBtn = confirmModal ? [...confirmModal.querySelectorAll('button')].find((b) => btnText(b).includes('确定')) : null;
assert('confirm 确定 按钮', !!okBtn, 'buttons=' + confirmBtns.join('/'));
if (okBtn) {
  okBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  okBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  okBtn.click();
}
await sleep(400);
assert('确认后画板清空', api.getElements().length === 0,
  'got ' + api.getElements().length + ' buttons=' + confirmBtns.join('/'));
await sleep(600);
// 注意：virtual-time 环境下 CSS transition 永不完成，antd motion 停在退出中状态，
// DOM 不会卸载（真实浏览器正常关闭）。以「退出动画类已挂载」作为关闭依据。
const confirmLeaving = !!document.querySelector(
  '.ant-modal-confirm.ant-zoom-leave, .ant-modal-confirm .ant-zoom-leave, .ant-modal-confirm-leave'
);
assert('confirm 已进入关闭流程', confirmLeaving || !document.querySelector('.ant-modal-confirm'),
  'confirm count=' + document.querySelectorAll('.ant-modal-confirm').length);

/* ---- 无 vite 错误浮层 ---- */
assert('无 vite 错误浮层', !document.querySelector('vite-error-overlay'));

document.title = 'DONE';
const pre = document.createElement('pre');
pre.id = '__RESULT__';
pre.textContent = '\\nSMOKE_START\\n' + results.join('\\n') + '\\nSMOKE_END\\n';
document.body.appendChild(pre);
`;

const testHtml = html.replace('</body>', '<script type="module">' + asserts + '</script>\n</body>');
writeFileSync(root + 'dist/test-smoke.html', testHtml);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let out = '';
try {
  out = execSync(
    `"${chrome}" --headless --disable-gpu --no-sandbox --dump-dom --virtual-time-budget=15000 http://127.0.0.1:${port}/test-smoke.html`,
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
