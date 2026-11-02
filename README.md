# 自由画板 · Canvas Editor

一个基于 **React 19 + TypeScript + Ant Design + Vite** 的 SVG 矢量画板编辑器。支持矩形、椭圆、文本、图片等元素的绘制与排版，图层分组管理、智能吸附对齐，以及 SVG / PNG / JSON 的导入导出。数据保存在浏览器本地，开箱即用。

## ✨ 功能特性

- **矢量绘制**：矩形（含圆角）、椭圆、文本、图片，自由拖拽、缩放、旋转、调整层级
- **图层分组**：目录树式图层面板，支持创建 / 嵌套 / 折叠 / 显隐 / 重命名 / 删除分组
- **智能吸附**：拖动时自动吸附对齐，显示参考线（20px 阈值，可开关）
- **对齐排版**：左 / 右 / 水平居中 / 顶 / 底 / 垂直居中
- **导入导出**：导入 SVG（展开 `g`/`use`、解析 `<style>`、保留渐变）· JSON · 图片；导出 SVG / PNG（2x）/ JSON
- **画布控制**：缩放、平移、网格显示、背景色切换（白 / 浅灰 / 深色 / 透明）
- **历史记录**：撤销 / 重做，本地自动保存（localStorage 防抖，刷新自动恢复）
- **完整快捷键**：内置帮助弹窗，常用操作一键直达

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://127.0.0.1:5173）
npm run dev

# 类型检查
npm run typecheck

# 构建生产版本
npm run build

# 预览构建产物（默认 http://127.0.0.1:4173）
npm run preview
```

## ⌨️ 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 选择 / 抓手 / 矩形 / 椭圆 / 文本 / 图片 | `V` / `H` / `R` / `O` / `T` / `I` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 复制 / 粘贴 / 副本 | `Ctrl+C` / `Ctrl+V` / `Ctrl+D` |
| 删除 / 全选 | `Del` / `Ctrl+A` |
| 平移 / 缩放 | 空格+拖动 / 滚轮 |
| 方向键微调（Shift 加速 10px） | `↑↓←→` |
| 导出 SVG | `Ctrl+S` |

## 📁 项目结构

```
canvas-editor/
├── src/
│   ├── main.tsx              # 应用入口
│   ├── App.tsx               # 布局骨架 + 全局键盘/导入导出接线
│   ├── index.css             # 全局样式
│   ├── editor/
│   │   ├── types.ts          # 公共类型定义
│   │   ├── engine.ts         # SVG 渲染 / 导入解析 / 导出工具
│   │   └── store.ts          # 全局状态（自实现发布订阅 store）
│   └── components/
│       ├── Topbar.tsx        # 顶部菜单（编辑 / 对齐 / 导入导出）
│       ├── ToolRail.tsx      # 左侧工具栏（6 个绘制工具）
│       ├── CanvasStage.tsx   # 画布舞台（缩放 / 平移 / 交互）
│       ├── LayerPanel.tsx    # 图层分组面板
│       ├── PropsPanel.tsx    # 属性面板
│       └── StatusBar.tsx     # 底部状态栏
└── scripts/                  # 冒烟测试 / 导入测试脚本
```

## 🧪 测试

项目提供基于无头 Chrome 的冒烟测试脚本（需先 `npm run build && npm run preview`）：

```bash
# 冒烟测试（断言 UI 结构与测试 API）
npm run smoke

# 导入测试（SVG / JSON 导入链路）
npm run smoke:import
```

测试通过 `window.canvasEditor` 暴露的全局 API 驱动（见 `src/editor/types.ts` 的 `CanvasEditorApi`），支持程序化导入导出、元素 / 分组操作，便于集成与自动化。

## 🧱 技术栈

- **React 19** + **TypeScript**（严格模式）
- **Ant Design 6** + `@ant-design/icons`
- **Vite 8** 构建工具
- 自实现轻量状态管理（发布订阅 + `useSyncExternalStore`），无额外状态库
