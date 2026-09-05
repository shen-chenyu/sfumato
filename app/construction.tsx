'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { registerConstructionTools } from '../lib/construction-tools';
import {
  ArrowDownToLine,
  ArrowLeft,
  FileJson,
  RotateCcw,
  Trash2,
  Upload,
  Move,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  moveControlPoint,
  polynomial,
  validateConstruction,
} from '../public/construct-engine.mjs';
import './construction.css';
type Segment = {
  controls: number[][];
  tones: number[][];
  maxError?: number;
  rmsError?: number;
  samples?: number;
  edited?: boolean;
};
type Curve = {
  id: number;
  segments: Segment[];
  score?: number;
  sourceLength?: number;
};
type Model = {
  version: string;
  size: number;
  tolerance?: number;
  curves: Curve[];
  anchors: { x: number; y: number; value: number }[];
  description?: string;
};
type Stats = {
  curves: number;
  segments: number;
  scalarParameters: number;
  constraints: number;
  iterations: number;
  residual: number;
  converged: boolean;
};
const base = process.env.NEXT_PUBLIC_BASE_PATH || '',
  sample = `${base}/portrait.png`;
const path = (p: number[][]) =>
  `M${p[0].join(' ')} C${p
    .slice(1)
    .map((v) => v.join(' '))
    .join(' ')}`;
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function equation(p: number[]) {
  return p
    .map(
      (v, i) =>
        `${i ? (v < 0 ? ' − ' : ' + ') : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}${i === 1 ? 't' : i === 2 ? 't²' : i === 3 ? 't³' : ''}`,
    )
    .join('');
}
export default function Construction() {
  const [source, setSource] = useState<string | null>(sample),
    [name, setName] = useState('NASA · Eileen Collins'),
    [model, setModel] = useState<Model | null>(null),
    [budget, setBudget] = useState(40),
    [excluded, setExcluded] = useState<number[]>([]),
    [selected, setSelected] = useState<{ id: number; segment: number } | null>(
      null,
    ),
    [view, setView] = useState('construction'),
    [stats, setStats] = useState<Stats | null>(null),
    [busy, setBusy] = useState(true),
    [solving, setSolving] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null),
    recipeInput = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    original = useRef<HTMLCanvasElement | null>(null),
    baseline = useRef<Model | null>(null),
    objectUrl = useRef<string | null>(null),
    drag = useRef<{ id: number; segment: number; handle: number } | null>(null),
    lastPixels = useRef<Uint8ClampedArray | null>(null);
  useEffect(() => {
    if (!source) return;
    let canceled = false;
    const worker = new Worker(`${base}/construct.worker.mjs`, {
        type: 'module',
      }),
      img = new window.Image();
    // Replacing the input starts a new external numerical job.
    // oxlint-disable-next-line react/react-compiler
    setBusy(true);
    setError('');
    setStats(null);
    setSelected(null);
    worker.onmessage = ({ data }) => {
      if (canceled) return;
      if (data.type === 'error') {
        setError(data.message);
        setBusy(false);
        return;
      }
      baseline.current = data.model;
      setModel(data.model);
      setBudget(Math.min(40, data.model.curves.length));
      setExcluded([]);
      setSelected(
        data.model.curves.length
          ? { id: data.model.curves[0].id, segment: 0 }
          : null,
      );
      setBusy(false);
      worker.terminate();
    };
    worker.onerror = () => {
      if (!canceled) {
        setError('构造计算中断，请重新载入照片。');
        setBusy(false);
      }
    };
    img.onload = () => {
      if (canceled) return;
      if (img.naturalWidth * img.naturalHeight > 50000000) {
        setError('请使用小于 5000 万像素的照片。');
        setBusy(false);
        return;
      }
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('浏览器无法打开画布。');
        setBusy(false);
        return;
      }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 160, 160);
      const scale = 160 / Math.max(img.naturalWidth, img.naturalHeight),
        w = img.naturalWidth * scale,
        h = img.naturalHeight * scale;
      ctx.drawImage(img, (160 - w) / 2, (160 - h) / 2, w, h);
      original.current = c;
      const pixels = ctx.getImageData(0, 0, 160, 160).data;
      worker.postMessage({ type: 'construct', pixels }, [pixels.buffer]);
    };
    img.onerror = () => {
      if (!canceled) {
        setError('无法读取照片，请换成 JPG、PNG 或 WebP。');
        setBusy(false);
      }
    };
    img.src = source;
    return () => {
      canceled = true;
      worker.terminate();
    };
  }, [source, revision]);
  useEffect(() => {
    if (!model) return;
    let canceled = false;
    const worker = new Worker(`${base}/construct.worker.mjs`, {
      type: 'module',
    });
    // Solver results follow editable constraints, not the source photograph.
    // oxlint-disable-next-line react/react-compiler
    setSolving(true);
    setError('');
    worker.onmessage = ({ data }) => {
      if (canceled) return;
      setSolving(false);
      if (data.type === 'error') {
        setError(data.message);
        return;
      }
      lastPixels.current = data.pixels;
      setStats(data.stats);
      worker.terminate();
    };
    worker.onerror = () => {
      if (!canceled) {
        setSolving(false);
        setError('明暗求解中断，请点击恢复构造重试。');
      }
    };
    const timer = setTimeout(
      () =>
        worker.postMessage({
          type: 'render',
          model,
          settings: { budget, excluded },
        }),
      65,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
      worker.terminate();
    };
  }, [model, budget, excluded]);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, c.width, c.height);
    if (view === 'original' && original.current) {
      ctx.drawImage(original.current, 0, 0, c.width, c.height);
      return;
    }
    if (!lastPixels.current) return;
    const buffer = document.createElement('canvas');
    buffer.width = buffer.height = 160;
    buffer
      .getContext('2d')
      ?.putImageData(
        new ImageData(new Uint8ClampedArray(lastPixels.current), 160, 160),
        0,
        0,
      );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buffer, 0, 0, c.width, c.height);
  }, [stats, view]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const active =
      model?.curves.slice(0, budget).filter((c) => !excluded.includes(c.id)) ??
      [],
    curve = active.find((c) => c.id === selected?.id),
    segment = curve?.segments[selected?.segment ?? 0],
    coeff = segment ? polynomial(segment.controls) : null;
  const upload = (file?: File) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(
        file.type,
      ) ||
      file.size > 20 * 1024 * 1024
    ) {
      setError('请选择小于 20 MB 的 JPG、PNG、WebP 或 AVIF。');
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setName(file.name);
    setView('construction');
    setSource(objectUrl.current);
  };
  const importRecipe = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw Error('配方超过 4 MB。');
      const m = validateConstruction(JSON.parse(await file.text())) as Model;
      setSource(null);
      original.current = null;
      baseline.current = structuredClone(m);
      setModel(m);
      setBudget(m.curves.length);
      setExcluded([]);
      setSelected(m.curves.length ? { id: m.curves[0].id, segment: 0 } : null);
      setName('从数学配方重建');
      setView('construction');
      setBusy(false);
      setMessage('已读取配方，无需原照片。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取这份配方。');
    }
  };
  const movePoint = (
    id: number,
    index: number,
    handle: number,
    x: number,
    y: number,
  ) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    setModel((m) => (m ? moveControlPoint(m, id, index, handle, x, y) : m));
  };
  const reset = () => {
    if (!baseline.current) {
      setRevision((n) => n + 1);
      return;
    }
    setModel(structuredClone(baseline.current));
    setExcluded([]);
    setError('');
    setMessage('已恢复最初的曲线和明暗约束。');
  };
  const exportModel = () => {
    if (!model) return;
    const kept = { ...model, curves: active };
    save(
      new Blob([JSON.stringify(kept, null, 2)], { type: 'application/json' }),
      'sfumato-construction.json',
    );
    setMessage('构造已保存。可以重新导入，不需要照片。');
  };
  const exportImage = () => {
    if (!lastPixels.current) return;
    const c = document.createElement('canvas'),
      small = document.createElement('canvas');
    small.width = small.height = 160;
    small
      .getContext('2d')
      ?.putImageData(
        new ImageData(new Uint8ClampedArray(lastPixels.current), 160, 160),
        0,
        0,
      );
    c.width = c.height = 2000;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, 2000, 2000);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 160, 160, 1680, 1680);
    c.toBlob((b) => b && save(b, 'sfumato-mathematical-portrait.png'));
  };
  const svgExport = () => {
    const curves = active
      .map((c) =>
        c.segments.map((s) => `<path d="${path(s.controls)}"/>`).join(''),
      )
      .join('');
    save(
      new Blob(
        [
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 180 180"><title>Sfumato — image boundary construction</title><rect x="-10" y="-10" width="180" height="180" fill="#faf9f5"/><g fill="none" stroke="#344c31" stroke-width=".35">${curves}</g></svg>`,
        ],
        { type: 'image/svg+xml' },
      ),
      'sfumato-curves.svg',
    );
  };
  const toolState = useRef({
    ready: false,
    curves: [] as { id: number; segments: number }[],
    selected: null as { id: number; segment: number } | null,
  });
  useLayoutEffect(() => {
    toolState.current = {
      ready: !!model && !busy && !solving,
      curves: active.map((c) => ({ id: c.id, segments: c.segments.length })),
      selected,
    };
  });
  useEffect(
    () =>
      registerConstructionTools(
        () => structuredClone(toolState.current),
        (id, segment) =>
          flushSync(() => {
            setSelected({ id, segment });
            setView('construction');
          }),
      ),
    [],
  );
  return (
    <main className="construction-app" lang="zh-CN">
      <header className="construction-header">
        <a href={base || '/'} className="wordmark">
          sfumato<span>.</span>
        </a>
        <div>
          <span className="edition-label">本地实验 / 02</span>
          <a href={`${base}/strokes/`}>
            <ArrowLeft size={14} />
            笔触实验
          </a>
        </div>
      </header>
      <div className="construction-intro">
        <div>
          <span className="eyebrow">一幅可以拆开的数学肖像</span>
          <h1>照片退场，曲线留下。</h1>
        </div>
        <p>
          选择一条线，看看它的方程。
          <br />
          移动一个控制点，让明暗重新生长。
        </p>
      </div>
      <div className="construction-workspace">
        <aside className="construction-controls">
          <section>
            <h2>从一张照片开始</h2>
            <p className="input-name">{name}</p>
            <Button
              variant="outline"
              onClick={() => imageInput.current?.click()}
            >
              <Upload size={15} />
              换一张照片
            </Button>
            <input
              className="sr-only"
              ref={imageInput}
              aria-label="选择照片"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="secondary-actions">
              <button onClick={() => recipeInput.current?.click()}>
                导入数学配方
              </button>
              {source !== sample && (
                <button
                  onClick={() => {
                    setSource(sample);
                    setName('NASA · Eileen Collins');
                    setView('construction');
                  }}
                >
                  恢复示例
                </button>
              )}
            </div>
            <input
              className="sr-only"
              ref={recipeInput}
              type="file"
              accept=".json,application/json"
              aria-label="导入数学构造配方"
              onChange={(e) => {
                void importRecipe(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </section>
          <section>
            <div className="control-title">
              <h2>保留多少条边界？</h2>
              <strong>
                {active.length}
                <small> / {model?.curves.length ?? '—'}</small>
              </strong>
            </div>
            <Slider
              aria-label="保留的边界数量"
              value={[budget]}
              min={0}
              max={Math.max(1, model?.curves.length ?? 80)}
              step={1}
              disabled={!model || busy}
              onValueChange={(v) => setBudget(Array.isArray(v) ? v[0] : v)}
            />
            <div className="budget-presets">
              {[0, 10, 30].map((n) => (
                <button
                  disabled={!model || busy}
                  key={n}
                  onClick={() =>
                    setBudget(Math.min(n, model?.curves.length ?? 0))
                  }
                >
                  {n === 0 ? '只剩明暗锚点' : `${n} 条线`}
                </button>
              ))}
              <button
                disabled={!model || busy}
                onClick={() => setBudget(model?.curves.length ?? 0)}
              >
                全部
              </button>
            </div>
            <p className="explain-small">
              一条边界可由多段三次曲线组成。减少边界，看哪些特征最先消失。
            </p>
          </section>
          <section className="curve-editor">
            <div className="control-title">
              <h2>拆开一条曲线</h2>
              <Move size={16} />
            </div>
            <label className="field-label" htmlFor="curve-select">
              选择边界
            </label>
            <select
              id="curve-select"
              value={curve?.id ?? ''}
              disabled={!active.length || busy}
              onChange={(e) =>
                setSelected({ id: Number(e.target.value), segment: 0 })
              }
            >
              <option value="" disabled>
                在画面中点选，或从这里选择
              </option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  边界 {c.id + 1} · {c.segments.length} 段
                </option>
              ))}
            </select>
            {segment && curve && (
              <>
                <label className="field-label" htmlFor="segment-select">
                  三次曲线段
                </label>
                <select
                  id="segment-select"
                  value={selected?.segment ?? 0}
                  onChange={(e) =>
                    setSelected({
                      id: curve.id,
                      segment: Number(e.target.value),
                    })
                  }
                >
                  {curve.segments.map((_, i) => (
                    <option key={i} value={i}>
                      第 {i + 1} 段 / 共 {curve.segments.length} 段
                    </option>
                  ))}
                </select>
                <p className="explain-small">
                  拖动图上的四个点，或修改下面的坐标。坐标范围为 0–159。
                </p>
                <div className="point-inputs">
                  {segment.controls.map((p, i) => (
                    <div key={i}>
                      <span>P{i}</span>
                      {p.map((v, k) => (
                        <label key={k}>
                          <span className="sr-only">
                            控制点 {i} 的 {k ? 'y' : 'x'} 坐标
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={159}
                            step={0.5}
                            value={Number(v.toFixed(2))}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              movePoint(
                                curve.id,
                                selected?.segment ?? 0,
                                i,
                                k ? p[0] : next,
                                k ? next : p[1],
                              );
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="remove-curve"
                  onClick={() => {
                    setExcluded((a) => [...a, curve.id]);
                    setSelected(null);
                    setMessage(
                      `已移除边界 ${curve.id + 1}；其余约束重新决定明暗。`,
                    );
                  }}
                >
                  <Trash2 size={14} />
                  移除整条边界
                </Button>
              </>
            )}
            {!segment && (
              <p className="explain-small">
                选择一条边界，查看它的控制点与方程。
              </p>
            )}
          </section>
          <div className="restore-controls">
            <Button
              variant="ghost"
              disabled={!excluded.length || busy}
              onClick={() => setExcluded([])}
            >
              <Undo2 size={14} />
              恢复删线
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              <RotateCcw size={14} />
              恢复构造
            </Button>
          </div>
          <p className="local-note">
            照片留在本机。
            <br />
            没有图像生成模型，也没有发布。
          </p>
        </aside>
        <section
          className="construction-result"
          aria-label="数学肖像与曲线构造"
        >
          <div className="construction-toolbar">
            <span>
              {busy
                ? '提取边界与拟合曲线…'
                : solving
                  ? '重新求解明暗…'
                  : '由曲线与明暗约束重建'}
            </span>
            <Tabs value={view} onValueChange={(v) => setView(String(v))}>
              <TabsList>
                <TabsTrigger value="construction">构造</TabsTrigger>
                <TabsTrigger value="portrait">肖像</TabsTrigger>
                <TabsTrigger value="curves">曲线</TabsTrigger>
                <TabsTrigger value="original" disabled={!source}>
                  原图
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className={`construction-paper view-${view}`}>
            <canvas
              ref={canvas}
              width={800}
              height={800}
              aria-label="由数学构造重建的肖像"
            />
            {view !== 'original' && view !== 'portrait' && (
              <svg
                viewBox="0 0 160 160"
                className="construction-overlay"
                aria-label="可编辑的三次曲线"
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  const r = e.currentTarget.getBoundingClientRect(),
                    d = drag.current;
                  movePoint(
                    d.id,
                    d.segment,
                    d.handle,
                    ((e.clientX - r.left) / r.width) * 160,
                    ((e.clientY - r.top) / r.height) * 160,
                  );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                {active.map((c) =>
                  c.segments.map((s, i) => (
                    <path
                      key={`${c.id}-${i}`}
                      d={path(s.controls)}
                      className={
                        selected?.id === c.id && selected.segment === i
                          ? 'selected-curve'
                          : 'boundary-curve'
                      }
                      // SVG paths cannot be replaced by HTML buttons.
                      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                      role="button"
                      tabIndex={
                        selected?.id === c.id && selected.segment === i ? 0 : -1
                      }
                      aria-label={`边界 ${c.id + 1} 第 ${i + 1} 段`}
                      onClick={() => setSelected({ id: c.id, segment: i })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected({ id: c.id, segment: i });
                        }
                      }}
                    />
                  )),
                )}
                {segment && curve && (
                  <g className="curve-handles">
                    <path
                      d={`M${segment.controls.map((p) => p.join(' ')).join(' L')}`}
                    />
                    {segment.controls.map((p, i) => (
                      <g key={i}>
                        <circle
                          cx={p[0]}
                          cy={p[1]}
                          r={1.35}
                          // SVG handles share their actions with the numeric inputs.
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                          role="button"
                          tabIndex={0}
                          aria-label={`控制点 ${i}，用方向键移动`}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            drag.current = {
                              id: curve.id,
                              segment: selected?.segment ?? 0,
                              handle: i,
                            };
                          }}
                          onKeyDown={(e) => {
                            const delta: Record<string, number[]> = {
                              ArrowLeft: [-1, 0],
                              ArrowRight: [1, 0],
                              ArrowUp: [0, -1],
                              ArrowDown: [0, 1],
                            };
                            if (delta[e.key]) {
                              e.preventDefault();
                              const [dx, dy] = delta[e.key];
                              movePoint(
                                curve.id,
                                selected?.segment ?? 0,
                                i,
                                p[0] + dx,
                                p[1] + dy,
                              );
                            }
                          }}
                        />
                        <text x={p[0] + 2} y={p[1] - 2}>
                          P{i}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
              </svg>
            )}
            {busy && (
              <div className="construct-loading">
                <span className="loading-dot" />
                <strong>寻找可以留下的边界</strong>
                <span>测量明暗 · 拟合曲线 · 求解构造</span>
              </div>
            )}
          </div>
          {error && (
            <div className="construction-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError('');
                  if (!model) setRevision((n) => n + 1);
                }}
              >
                关闭 / 重试
              </button>
            </div>
          )}
          <div className="construction-measures">
            <div>
              <strong>{stats?.curves ?? '—'}</strong>
              <span>边界</span>
            </div>
            <div>
              <strong>{stats?.segments ?? '—'}</strong>
              <span>三次曲线段</span>
            </div>
            <div>
              <strong>{stats?.scalarParameters.toLocaleString() ?? '—'}</strong>
              <span>几何与明暗数值</span>
            </div>
            <p>
              每次重画只读取这些参数，
              <br />
              不再读取原照片。
            </p>
          </div>
          <div className="equation-panel">
            <div>
              <span className="eyebrow">这段曲线的真实方程</span>
              <span>0 ≤ t ≤ 1</span>
            </div>
            {coeff ? (
              <>
                <code>x(t) = {equation(coeff[0])}</code>
                <code>y(t) = {equation(coeff[1])}</code>
                <p>系数显示至小数点后三位；数学配方保留完整数值精度。</p>
                <p>
                  {segment?.edited
                    ? '这段曲线已被你修改，画面正由新的几何约束生成。'
                    : source && Number.isFinite(segment?.maxError)
                      ? `原始采样点的最大参数对应误差：${segment?.maxError?.toFixed(3)} 像素（在 160 × 160 分析网格上）。`
                      : '选择来自配方的曲线；原图拟合误差未重新验证。'}
                </p>
              </>
            ) : (
              <p>点选一段曲线，查看它的具体系数。</p>
            )}
          </div>
          <div className="construction-export">
            <Button
              variant="outline"
              disabled={!model || busy || solving}
              onClick={exportModel}
            >
              <FileJson size={16} />
              保存数学配方
            </Button>
            <Button
              variant="ghost"
              disabled={!model || busy || solving}
              onClick={svgExport}
            >
              曲线 SVG
            </Button>
            <Button disabled={!stats || busy || solving} onClick={exportImage}>
              <ArrowDownToLine size={16} />
              保存肖像
            </Button>
          </div>
          <details className="construction-explanation">
            <summary>这幅画究竟是怎么构造的？</summary>
            <p>
              算法沿图像中的明暗边界追踪曲线，再用三次 Bézier
              方程逼近。每段曲线保存两侧各三个明暗样本，另外保留 64
              个粗略明暗锚点。其余位置通过离散 Laplace
              方程求解，形成连续过渡。移动控制点时，明暗样本跟随曲线移动。
            </p>
            <p>
              目前找到的是图像边界，尚未识别出眼睑、鼻梁等人体部位；也没有恢复三维解剖结构。曲线变少不保证更美，参数数量也不等于文件压缩率。导出的
              2000 像素图片来自 160 像素分析网格，不会凭空增加细节。
            </p>
            <p>
              数值求解：
              {stats
                ? `${stats.iterations} 次迭代，最大离散调和残差 ${stats.residual.toExponential(2)}。${stats.converged ? '已达到停止阈值。' : '尚未达到停止阈值，当前为近似解。'}`
                : '等待构造。'}
            </p>
            <p>
              示例：NASA 的 Eileen Collins 公开领域照片。
              <a
                href="https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut"
                target="_blank"
                rel="noreferrer"
              >
                图片来源 ↗
              </a>
            </p>
          </details>
        </section>
      </div>
      {message && <output className="toast">{message}</output>}
    </main>
  );
}
