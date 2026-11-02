/* 跨页面加载验证 localStorage 持久化恢复：
 * 同一 Chrome profile（--user-data-dir）两次加载：
 *   第一次：导入 SVG → 等防抖落盘
 *   第二次：直接读画板元素数量，验证自动恢复
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'dist/index.html', 'utf8');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'ce-profile-'));

const run = (page) => execSync(
  `"${chrome}" --headless --disable-gpu --no-sandbox --user-data-dir="${profile}" ` +
  `--dump-dom --virtual-time-budget=8000 http://127.0.0.1:4173/${page}`,
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
);

/* 第一次：导入素材并等待落盘 */
const step1 = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
window.canvasEditor.importSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">' +
  '<rect x="10" y="10" width="80" height="50" fill="red"/></svg>');
await sleep(700);
const pre = document.createElement('pre');
pre.id = '__R__';
pre.textContent = '\\nP1_START\\n' + (localStorage.getItem('canvasEditorBoard.v1') ? 'SAVED' : 'NOT_SAVED') + '\\nP1_END\\n';
document.body.appendChild(pre);
`;
writeFileSync(root + 'dist/test-persist1.html',
  html.replace('</body>', '<script type="module">' + step1 + '</script>\n</body>'));

const out1 = run('test-persist1.html');
const m1 = out1.match(/P1_START\n([\s\S]*?)P1_END/);
console.log('第一次加载（写入）:', m1 ? m1[1].trim() : 'no result');

/* 第二次：全新加载，验证画板自动恢复 */
const step2 = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
const els = window.canvasEditor.getElements();
const pre = document.createElement('pre');
pre.id = '__R__';
pre.textContent = '\\nP2_START\\n' + els.length + ' elements: ' +
  els.map((e) => e.type + '@' + e.x + ',' + e.y).join(' | ') + '\\nP2_END\\n';
document.body.appendChild(pre);
`;
writeFileSync(root + 'dist/test-persist2.html',
  html.replace('</body>', '<script type="module">' + step2 + '</script>\n</body>'));

const out2 = run('test-persist2.html');
const m2 = out2.match(/P2_START\n([\s\S]*?)P2_END/);
console.log('第二次加载（恢复）:', m2 ? m2[1].trim() : 'no result');

const ok = m1 && m1[1].includes('SAVED') && m2 && m2[1].trim().startsWith('1 elements');
console.log(ok ? '\nPERSIST PASS' : '\nPERSIST FAIL');
process.exit(ok ? 0 : 1);
