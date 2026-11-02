import React, { useSyncExternalStore } from 'react';
import { Button, Radio, Tooltip } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons';
import { editorState, bump, subscribe, getVersion, zoomTo, zoomFit } from '../editor/store';

/* 底部状态栏：左侧元素统计 + 网格/吸附，右侧画布背景色（radio）+ 缩放控件 */
export default function StatusBar() {
  useSyncExternalStore(subscribe, getVersion);
  const s = editorState;

  return (
    <div className="statusbar">
      <span>{s.elements.length} 个元素</span>
      <span className="sep">|</span>

      {/* ---- 网格 / 吸附开关 ---- */}
      <label className="bar-check">
        <input
          type="checkbox"
          checked={s.showGrid}
          onChange={(e) => { s.showGrid = e.target.checked; bump(); }}
        />
        网格
      </label>
      <label className="bar-check">
        <input
          type="checkbox"
          checked={s.snap}
          onChange={(e) => { s.snap = e.target.checked; bump(); }}
        />
        吸附 20px
      </label>

      <span className="grow" />

      {/* ---- 右侧：画布背景色（radio）+ 缩放控件 ---- */}
      <span className="bar-label">画布</span>
      <Radio.Group
        size="small"
        optionType="button"
        buttonStyle="solid"
        value={s.canvasColor}
        onChange={(e) => { s.canvasColor = e.target.value; bump(); }}
        options={[
          { value: '#ffffff', label: '白色' },
          { value: '#f8fafc', label: '浅灰' },
          { value: '#111827', label: '深色' },
          { value: 'transparent', label: '透明' },
        ]}
      />
      <span className="sep">|</span>
      <Tooltip title="缩小">
        <Button size="small" type="text" icon={<ZoomOutOutlined />} onClick={() => zoomTo(s.zoom / 1.2)} />
      </Tooltip>
      <span className="zoom-num">{Math.round(s.zoom * 100)}%</span>
      <Tooltip title="放大">
        <Button size="small" type="text" icon={<ZoomInOutlined />} onClick={() => zoomTo(s.zoom * 1.2)} />
      </Tooltip>
      <Tooltip title="适应内容">
        <Button size="small" type="text" icon={<ExpandOutlined />} onClick={() => zoomFit()} />
      </Tooltip>
    </div>
  );
}
