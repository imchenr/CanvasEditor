import React, { useSyncExternalStore } from 'react';
import { Form, Input, InputNumber, ColorPicker, Slider, Empty } from 'antd';
import {
  editorState, subscribe, getVersion, bump, getSelected, panelHistory,
} from '../editor/store';
import { elBBox, measureText, clamp } from '../editor/engine';
import type { EditorElement } from '../editor/types';

/* 单字段更新：同一字段连续编辑只入撤销栈一次 */
function useField() {
  return (key: string, fn: (el: EditorElement) => void) => {
    panelHistory(key);
    const els = getSelected();
    els.forEach(fn);
    bump();
  };
}

interface NumFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumField({ label, value, onChange, min, max, step }: NumFieldProps) {
  return (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <InputNumber
        style={{ width: '100%' }}
        size="small"
        value={value}
        min={min} max={max} step={step}
        onChange={(v) => v != null && onChange(v)}
      />
    </Form.Item>
  );
}

export default function PropsPanel() {
  useSyncExternalStore(subscribe, getVersion);
  const field = useField();
  const els = getSelected();

  if (els.length !== 1) {
    return (
      <div className="props-panel">
        <div className="panel-title-row">
          <div className="panel-title">属性</div>
        </div>
        <div className="panel-body">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={els.length > 1 ? '已选中 ' + els.length + ' 个元素，可用顶部按钮对齐编排' : '选中画布元素后在这里调样式与尺寸'}
          />
        </div>
      </div>
    );
  }

  const el = els[0];
  const b = elBBox(el);
  const k = (name: string) => el.id + ':' + name;

  return (
    <div className="props-panel">
      <div className="panel-title-row">
        <div className="panel-title">属性</div>
      </div>
      <div className="panel-body">
        <Form layout="vertical" size="small" labelCol={{ style: { fontSize: 11 } }}>
          <Form.Item label="名称" style={{ marginBottom: 8 }}>
            <Input size="small" value={el.name}
              onChange={(e) => field(k('name'), (x) => { x.name = e.target.value; })} />
          </Form.Item>

          <div className="row2">
            <NumField label="X" value={Math.round(el.x)}
              onChange={(v) => field(k('x'), (x) => { x.x = v; })} />
            <NumField label="Y" value={Math.round(el.y)}
              onChange={(v) => field(k('y'), (x) => { x.y = v; })} />
          </div>

          <div className="row2">
            <NumField label="宽" value={Math.round(b.w)}
              onChange={(v) => field(k('w'), (x) => {
                const nw = Math.max(1, v);
                if (x.type === 'text') {
                  x.fontSize = Math.max(6, (x.fontSize || 16) * (nw / measureText(x.text || '', x.fontSize || 16, x.fontWeight, x.letterSpacing).w));
                } else x.w = nw;
              })} />
            <NumField label="高" value={Math.round(b.h)}
              onChange={(v) => field(k('h'), (x) => {
                const nh = Math.max(1, v);
                if (x.type === 'text') {
                  x.fontSize = Math.max(6, (x.fontSize || 16) * (nh / elBBox(x).h));
                } else x.h = nh;
              })} />
          </div>

          <div className="row2">
            <NumField label="旋转°" value={el.rot || 0} min={-360} max={360}
              onChange={(v) => field(k('rot'), (x) => { x.rot = v || 0; })} />
            <Form.Item label="透明度" style={{ marginBottom: 8 }}>
              <Slider
                min={0} max={1} step={0.05}
                value={el.opacity}
                style={{ margin: '2px 6px 0 0' }}
                onChange={(v) => field(k('opacity'), (x) => { x.opacity = clamp(v, 0, 1); })}
              />
            </Form.Item>
          </div>

          <div className="row2">
            <Form.Item label="填充" style={{ marginBottom: 8 }}>
              <ColorPicker
                size="small"
                value={el.fill === 'none' ? '#ffffff' : el.fill}
                onChange={(c) => field(k('fill'), (x) => { x.fill = c.toHexString(); })}
              />
            </Form.Item>
            <Form.Item label="描边" style={{ marginBottom: 8 }}>
              <ColorPicker
                size="small"
                value={el.stroke === 'none' ? '#ffffff' : el.stroke}
                onChange={(c) => field(k('stroke'), (x) => { x.stroke = c.toHexString(); x.strokeWidth = x.strokeWidth || 1; })}
              />
            </Form.Item>
          </div>

          <NumField label="描边宽" value={el.strokeWidth} min={0} step={1}
            onChange={(v) => field(k('strokeWidth'), (x) => { x.strokeWidth = Math.max(0, v); })} />

          {el.type === 'text' && (
            <>
              <Form.Item label="文本内容" style={{ marginBottom: 8 }}>
                <Input.TextArea
                  rows={3}
                  value={el.text}
                  onChange={(e) => field(k('text'), (x) => {
                    x.text = e.target.value;
                    const m = measureText(x.text || '', x.fontSize || 16, x.fontWeight, x.letterSpacing);
                    x.w = m.w; x.h = m.h;
                  })}
                />
              </Form.Item>
              <NumField label="字号" value={el.fontSize || 16} min={6}
                onChange={(v) => field(k('fontSize'), (x) => {
                  x.fontSize = Math.max(6, v);
                  const m = measureText(x.text || '', x.fontSize || 16, x.fontWeight, x.letterSpacing);
                  x.w = m.w; x.h = m.h;
                })} />
            </>
          )}
        </Form>
      </div>
    </div>
  );
}
