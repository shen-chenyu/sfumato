'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Download,
  Upload,
  FileJson,
  RotateCcw,
  Undo2,
  Trash2,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  describeMath,
  toMathCard,
  toSVG,
  polynomial,
} from '../public/portrait.mjs';
import type { Recipe, Portrait } from '../public/portrait.mjs';
import {
  moveControlPoint,
  validateConstruction,
} from '../public/construct-engine.mjs';
import { registerConstructionTools } from '../lib/construction-tools';
import './construction.css';

type Language = 'en' | 'zh-CN';
type Edit = { recipe: Recipe; limit: number; excluded: number[] };
type Selection = { id: number; segment: number } | null;
type Operation =
  | {
      id: number;
      type: 'create';
      image: { data: Uint8ClampedArray; width: number; height: number };
    }
  | { id: number; type: 'redraw'; recipe: Recipe };
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const sample = `${base}/portrait.png`;
const path = (p: number[][]) =>
  `M${p[0].join(' ')} C${p
    .slice(1)
    .map((v) => v.join(' '))
    .join(' ')}`;
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function equation(values: number[]) {
  return values
    .map(
      (n, i) =>
        `${i ? (n < 0 ? ' − ' : ' + ') : n < 0 ? '−' : ''}${Math.abs(Number(n.toFixed(3)))}${['', 't', 't²', 't³'][i]}`,
    )
    .join('');
}
function effective(edit: Edit): Recipe {
  return {
    ...edit.recipe,
    construction: {
      ...edit.recipe.construction,
      curves: edit.recipe.construction.curves
        .slice(0, edit.limit)
        .filter((c) => !edit.excluded.includes(c.id)),
    },
  };
}
const errors: Record<string, [string, string]> = {
  image: [
    '无法读取图片，请使用 JPG、PNG、WebP 或 AVIF。',
    'Cannot decode the image. Use JPG, PNG, WebP or AVIF.',
  ],
  size: [
    '请选择小于 20 MB、5000 万像素以内的图片。',
    'Choose an image below 20 MB and 50 megapixels.',
  ],
  canvas: ['浏览器无法打开画布。', 'This browser could not open a canvas.'],
  worker: [
    '计算中断，请重新打开图片或恢复构造。',
    'Computation was interrupted. Reopen the image or reset the construction.',
  ],
  recipe: [
    '无法读取配方。请选择本项目导出的 JSON 文件（小于 4 MB）。',
    'Cannot read the recipe. Choose a Sfumato JSON export below 4 MB.',
  ],
  export: [
    '无法保存图片，请先保存 SVG，或稍后重试。',
    'Could not save the image. Save the SVG or try again.',
  ],
};

export default function Construction() {
  const [language, setLanguage] = useState<Language>('zh-CN');
  const t = (zh: string, en: string) => (language === 'zh-CN' ? zh : en);
  const [source, setSource] = useState<string | null>(sample);
  const [name, setName] = useState('NASA · Eileen Collins');
  const [result, setResult] = useState<Portrait | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [view, setView] = useState('curves');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [decoding, setDecoding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const editRef = useRef<Edit | null>(null),
    baseline = useRef<Edit | null>(null);
  const history = useRef<Edit[]>([]),
    sequence = useRef(0);
  const objectUrl = useRef<string | null>(null),
    dragging = useRef<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null),
    recipeInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy = decoding || operation !== null;
  const ready = !!result && !busy && !error;
  const displayRecipe = useMemo(
    () => (result ? { ...result.recipe, language } : null),
    [result, language],
  );
  const math = useMemo(
    () => (displayRecipe ? describeMath(displayRecipe) : null),
    [displayRecipe],
  );
  const active = edit ? effective(edit).construction.curves : [];
  const curve = active.find((c) => c.id === selected?.id);
  const segment = curve?.segments[selected?.segment ?? 0];
  const coefficients = segment ? polynomial(segment.controls) : null;

  const loadSource = useCallback((url: string, label: string) => {
    const id = ++sequence.current;
    setOperation(null);
    setDecoding(true);
    setError('');
    setSource(url);
    setName(label);
    setResult(null);
    setEdit(null);
    editRef.current = null;
    baseline.current = null;
    history.current = [];
    setUndoCount(0);
    setSelected(null);
    const image = new window.Image();
    image.onload = () => {
      if (sequence.current !== id) return;
      if (image.naturalWidth * image.naturalHeight > 50_000_000) {
        setError('size');
        setDecoding(false);
        return;
      }
      try {
        const buffer = document.createElement('canvas');
        buffer.width = image.naturalWidth;
        buffer.height = image.naturalHeight;
        const ctx = buffer.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw Error('canvas');
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, buffer.width, buffer.height).data;
        setOperation({
          id,
          type: 'create',
          image: { data, width: buffer.width, height: buffer.height },
        });
        setDecoding(false);
      } catch {
        setError('canvas');
        setDecoding(false);
      }
    };
    image.onerror = () => {
      if (sequence.current === id) {
        setError('image');
        setDecoding(false);
      }
    };
    image.src = url;
  }, []);

  useEffect(() => {
    // Restore the browser-only language preference after hydration.
    try {
      const saved = localStorage.getItem('sfumato-language');
      // oxlint-disable-next-line react/react-compiler
      if (saved === 'en' || saved === 'zh-CN') setLanguage(saved);
    } catch {
      /* Storage is optional. */
    }
    loadSource(sample, 'NASA · Eileen Collins');
    const lifecycle = sequence,
      currentUrl = objectUrl;
    return () => {
      lifecycle.current++;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, [loadSource]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === 'zh-CN'
        ? 'Sfumato · 多少数学，能描绘你？'
        : 'Sfumato · How much math describes you?';
    try {
      localStorage.setItem('sfumato-language', language);
    } catch {
      /* Storage is optional. */
    }
  }, [language]);
  useEffect(() => {
    if (!operation) return;
    let worker: Worker | undefined;
    let canceled = false;
    // Create the worker after the debounce, so dragging does not spawn idle workers.
    const timer = setTimeout(
      () => {
        try {
          worker = new Worker(`${base}/portrait.worker.mjs`, {
            type: 'module',
          });
          worker.onmessage = ({ data }) => {
            if (canceled || data.id !== sequence.current) return;
            if (data.type === 'error') {
              setError('worker');
              setOperation(null);
              worker?.terminate();
              return;
            }
            const next = data.result as Portrait;
            setResult(next);
            setOperation(null);
            if (operation.type === 'create') {
              const initial = {
                recipe: next.recipe,
                limit: next.recipe.construction.curves.length,
                excluded: [],
              };
              baseline.current = structuredClone(initial);
              editRef.current = initial;
              setEdit(initial);
              setSelected(
                next.math.example
                  ? {
                      id: next.math.example.curveId,
                      segment: next.math.example.segment,
                    }
                  : null,
              );
            }
            setSelected((previous) =>
              next.recipe.construction.curves.some(
                (c) => c.id === previous?.id && c.segments[previous.segment],
              )
                ? previous
                : next.math.example
                  ? {
                      id: next.math.example.curveId,
                      segment: next.math.example.segment,
                    }
                  : null,
            );
            worker?.terminate();
          };
          worker.onerror = () => {
            if (!canceled && operation.id === sequence.current) {
              setError('worker');
              setOperation(null);
            }
            worker?.terminate();
          };
          worker.postMessage(
            operation,
            operation.type === 'create' ? [operation.image.data.buffer] : [],
          );
        } catch {
          if (!canceled) {
            setError('worker');
            setOperation(null);
          }
        }
      },
      operation.type === 'create' ? 0 : 90,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [operation]);
  useEffect(() => {
    if (!result || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    ctx?.putImageData(
      new ImageData(new Uint8ClampedArray(result.image.data), 160, 160),
      0,
      0,
    );
  }, [result, view]);

  const remember = () => {
    if (editRef.current) {
      history.current.push(structuredClone(editRef.current));
      if (history.current.length > 25) history.current.shift();
      setUndoCount(history.current.length);
    }
  };
  const apply = (next: Edit, record = true) => {
    if (record) remember();
    editRef.current = next;
    setEdit(next);
    setError('');
    setOperation({
      id: ++sequence.current,
      type: 'redraw',
      recipe: effective(next),
    });
  };
  const move = (handle: number, x: number, y: number, record = true) => {
    const current = editRef.current;
    if (!current || !selected || !Number.isFinite(x) || !Number.isFinite(y))
      return;
    const construction = moveControlPoint(
      current.recipe.construction,
      selected.id,
      selected.segment,
      handle,
      x,
      y,
    );
    apply({ ...current, recipe: { ...current.recipe, construction } }, record);
  };
  const upload = (file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('size');
      return;
    }
    if (
      !/^image\/(jpeg|png|webp|avif)$/.test(file.type) &&
      !(file.type === '' && /\.(jpe?g|png|webp|avif)$/i.test(file.name))
    ) {
      setError('image');
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    loadSource(objectUrl.current, file.name);
  };
  const importRecipe = async (file?: File) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('recipe');
      return;
    }
    const id = ++sequence.current;
    setOperation(null);
    setDecoding(true);
    setError('');
    try {
      const input = JSON.parse(await file.text());
      if (id !== sequence.current) return;
      const recipe = (
        input?.version === 'sfumato-recipe-1'
          ? input
          : {
              version: 'sfumato-recipe-1',
              construction: validateConstruction(input),
              render: { iterations: 500, tolerance: 1e-5 },
              language,
            }
      ) as Recipe;
      describeMath(recipe); // Validate before replacing the current working construction.
      const initial = {
        recipe,
        limit: recipe.construction.curves.length,
        excluded: [],
      };
      baseline.current = structuredClone(initial);
      editRef.current = initial;
      setEdit(initial);
      history.current = [];
      setUndoCount(0);
      setSource(null);
      setName(file.name);
      setResult(null);
      setSelected(
        recipe.construction.curves.length
          ? { id: recipe.construction.curves[0].id, segment: 0 }
          : null,
      );
      if (view === 'original') setView('curves');
      setOperation({ type: 'redraw', id, recipe });
    } catch {
      if (id === sequence.current) setError('recipe');
    } finally {
      if (id === sequence.current) setDecoding(false);
    }
  };
  const exportCard = async (format: 'svg' | 'png') => {
    if (!ready || !displayRecipe) return;
    const svg = toMathCard(displayRecipe);
    if (format === 'svg') {
      save(
        new Blob([svg], { type: 'image/svg+xml' }),
        'sfumato-math-portrait.svg',
      );
      return;
    }
    setExporting(true);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new window.Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      const buffer = document.createElement('canvas');
      buffer.width = 1120;
      buffer.height = 688;
      const ctx = buffer.getContext('2d');
      if (!ctx) throw Error('canvas');
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        buffer.toBlob(resolve),
      );
      if (!blob) throw Error('export');
      save(blob, 'sfumato-math-portrait.png');
    } catch {
      setError('export');
    } finally {
      URL.revokeObjectURL(url);
      setExporting(false);
    }
  };
  const toolState = useRef({
    ready: false,
    curves: [] as { id: number; segments: number }[],
    selected: null as Selection,
  });
  useLayoutEffect(() => {
    toolState.current = {
      ready,
      curves: active.map((c) => ({ id: c.id, segments: c.segments.length })),
      selected,
    };
  });
  useEffect(
    () =>
      registerConstructionTools(
        () => structuredClone(toolState.current),
        (id, index) => {
          setSelected({ id, segment: index });
          setView('curves');
          setEditing(true);
        },
      ),
    [],
  );

  return (
    <main className="construction-app" lang={language}>
      <header className="construction-header">
        <a href={base || '/'} className="wordmark">
          sfumato<span>.</span>
        </a>
        <div className="header-actions">
          <span className="local-badge">
            {t('本地计算 · 无图像 AI', 'Local computation · no image AI')}
          </span>
          <fieldset className="language-switch" aria-label="Language / 语言">
            <button
              aria-pressed={language === 'zh-CN'}
              onClick={() => setLanguage('zh-CN')}
            >
              中文
            </button>
            <button
              aria-pressed={language === 'en'}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
          </fieldset>
        </div>
      </header>
      <div className="construction-intro">
        <h1>{t('多少数学，能描绘你？', 'How much math describes you?')}</h1>
        <p>
          {t(
            '一张照片，一份可以拆开、修改、重画的数学自画像。',
            'A photograph becomes a mathematical self-portrait you can inspect, edit and redraw.',
          )}
        </p>
      </div>
      <div className="construction-workspace">
        <aside className="construction-controls">
          <section className="source-controls">
            <h2>{t('从一张照片开始', 'Start with a photograph')}</h2>
            <p className="input-name" title={name}>
              {name}
            </p>
            <Button
              className="primary-action"
              onClick={() => imageInput.current?.click()}
            >
              <Upload size={16} />
              {t('选择照片', 'Choose photograph')}
            </Button>
            <input
              hidden
              ref={imageInput}
              type="file"
              aria-label={t('选择照片', 'Choose photograph')}
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <p className="control-note">
              JPG / PNG / WebP / AVIF · {t('最大 20 MB', 'up to 20 MB')}
            </p>
            <div className="secondary-actions">
              <button onClick={() => recipeInput.current?.click()}>
                {t('导入配方', 'Import recipe')}
              </button>
              <button
                onClick={() => loadSource(sample, 'NASA · Eileen Collins')}
              >
                {t('使用示例', 'Use example')}
              </button>
            </div>
            <input
              hidden
              ref={recipeInput}
              type="file"
              aria-label={t('导入数学配方', 'Import mathematical recipe')}
              accept=".json,application/json"
              onChange={(e) => {
                void importRecipe(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </section>
          <details
            className="edit-details"
            open={editing}
            onToggle={(e) => setEditing(e.currentTarget.open)}
          >
            <summary>{t('编辑数学构造', 'Edit the construction')}</summary>
            <div className="editor-content">
              <label className="field-label">
                {t('保留的边界', 'Boundary budget')}{' '}
                <b>
                  {active.length} /{' '}
                  {edit?.recipe.construction.curves.length ?? 0}
                </b>
              </label>
              <Slider
                min={0}
                max={Math.max(1, edit?.recipe.construction.curves.length ?? 1)}
                step={1}
                value={[edit?.limit ?? 0]}
                disabled={!edit || decoding}
                aria-label={t('保留的边界数量', 'Boundary budget')}
                onValueChange={(value) => {
                  if (editRef.current)
                    apply({
                      ...editRef.current,
                      limit: Array.isArray(value) ? value[0] : value,
                    });
                }}
              />
              <p className="control-note">
                {t(
                  '一条边界可包含多段三次曲线。',
                  'One boundary can contain multiple cubic segments.',
                )}
              </p>
              <label className="field-label" htmlFor="curve-select">
                {t('选择边界', 'Select boundary')}
              </label>
              <select
                id="curve-select"
                value={curve?.id ?? ''}
                disabled={!active.length}
                onChange={(e) => {
                  setSelected({ id: Number(e.target.value), segment: 0 });
                  setView('curves');
                }}
              >
                <option value="" disabled>
                  {t('选择一条曲线', 'Choose a curve')}
                </option>
                {active.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t('边界', 'Boundary')} {c.id + 1} · {c.segments.length}{' '}
                    {t('段', 'segments')}
                  </option>
                ))}
              </select>
              {curve && segment && (
                <>
                  <label className="field-label" htmlFor="segment-select">
                    {t('选择曲线段', 'Select segment')}
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
                      <option value={i} key={i}>
                        {i + 1} / {curve.segments.length}
                      </option>
                    ))}
                  </select>
                  <div className="point-inputs">
                    {segment.controls.map((point, handle) => (
                      <div key={handle}>
                        <span>P{handle}</span>
                        {point.map((n, axis) => (
                          <input
                            key={axis}
                            type="number"
                            min={0}
                            max={159}
                            step={0.1}
                            value={Number(n.toFixed(2))}
                            aria-label={`P${handle} ${axis === 0 ? 'x' : 'y'}`}
                            onChange={(e) => {
                              if (e.target.value === '') return;
                              const v = e.target.valueAsNumber;
                              move(
                                handle,
                                axis === 0 ? v : point[0],
                                axis === 1 ? v : point[1],
                              );
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="control-note">
                    {t(
                      '拖动控制点，或用数值输入调整。',
                      'Drag a control point or edit its coordinates.',
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    className="remove-curve"
                    onClick={() => {
                      if (editRef.current)
                        apply({
                          ...editRef.current,
                          excluded: [...editRef.current.excluded, curve.id],
                        });
                      setSelected(null);
                    }}
                  >
                    <Trash2 size={15} />
                    {t('移除这条边界', 'Remove boundary')}
                  </Button>
                </>
              )}
              <div className="restore-controls">
                <Button
                  variant="ghost"
                  disabled={!undoCount}
                  onClick={() => {
                    const previous = history.current.pop();
                    if (previous) apply(previous, false);
                    setUndoCount(history.current.length);
                  }}
                >
                  <Undo2 size={15} />
                  {t('撤销', 'Undo')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!edit}
                  onClick={() => {
                    if (baseline.current)
                      apply(structuredClone(baseline.current));
                  }}
                >
                  <RotateCcw size={15} />
                  {t('恢复构造', 'Reset')}
                </Button>
              </div>
            </div>
          </details>
          <p className="local-note">
            {t(
              '照片只在当前设备处理。配方不保存原照片，但包含描绘它的曲线与明暗信息。',
              'Photos are processed on this device. Recipes omit the source photo, but contain the curves and tones that depict it.',
            )}
          </p>
          <a className="legacy-link" href={`${base}/strokes/`}>
            {t('笔触实验 ↗', 'Stroke study ↗')}
          </a>
        </aside>
        <section
          className="construction-result"
          aria-label={t('数学自画像', 'Mathematical self-portrait')}
          aria-busy={busy}
        >
          <div className="construction-toolbar">
            <Tabs value={view} onValueChange={(v) => setView(String(v))}>
              <TabsList>
                <TabsTrigger value="curves">
                  {t('数学自画像', 'Math portrait')}
                </TabsTrigger>
                <TabsTrigger value="tone">
                  {t('明暗重建', 'Tonal portrait')}
                </TabsTrigger>
                <TabsTrigger value="original" disabled={!source}>
                  {t('原图', 'Original')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <output>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="spin" />
                  {t('正在构造…', 'Constructing…')}
                </>
              ) : result ? (
                t('构造完成', 'Ready')
              ) : (
                ''
              )}
            </output>
          </div>
          {error && (
            <div className="construction-error" role="alert">
              {errors[error]?.[language === 'zh-CN' ? 0 : 1] ?? error}
              <button
                onClick={() => {
                  if (editRef.current) apply(editRef.current, false);
                  else loadSource(source || sample, name);
                }}
              >
                {t('重试', 'Retry')}
              </button>
            </div>
          )}
          <div className="portrait-layout">
            <div className={`construction-paper view-${view}`}>
              {/* Local photo URLs are decoded directly without a remote optimizer. */}
              {view === 'original' && source ? (
                // oxlint-disable-next-line next/no-img-element
                <img
                  src={source}
                  alt={t('原始照片', 'Original photograph')}
                  className="original-photo"
                />
              ) : (
                <>
                  <canvas
                    ref={canvas}
                    width={160}
                    height={160}
                    aria-label={t('明暗重建图', 'Reconstructed tonal portrait')}
                  />
                  {view === 'curves' && (
                    <svg
                      className="construction-overlay"
                      viewBox="0 0 160 160"
                      aria-label={t(
                        '曲线构造，可在编辑区选择曲线',
                        'Curve construction; select a curve in the editor',
                      )}
                      onPointerMove={(e) => {
                        if (dragging.current === null) return;
                        const bounds = e.currentTarget.getBoundingClientRect();
                        move(
                          dragging.current,
                          ((e.clientX - bounds.left) / bounds.width) * 160,
                          ((e.clientY - bounds.top) / bounds.height) * 160,
                          false,
                        );
                      }}
                      onPointerUp={(e) => {
                        dragging.current = null;
                        if (e.currentTarget.hasPointerCapture(e.pointerId))
                          e.currentTarget.releasePointerCapture(e.pointerId);
                      }}
                      onPointerCancel={() => {
                        dragging.current = null;
                      }}
                    >
                      {active.map((c) =>
                        c.segments.map((s, index) => (
                          <path
                            key={`${c.id}-${index}`}
                            d={path(s.controls)}
                            className={
                              selected?.id === c.id &&
                              selected.segment === index
                                ? 'selected-curve'
                                : 'boundary-curve'
                            }
                            onClick={() => {
                              setSelected({ id: c.id, segment: index });
                              setEditing(true);
                            }}
                          />
                        )),
                      )}
                      {editing && segment && (
                        <g className="curve-handles">
                          <path
                            d={`M${segment.controls.map((p) => p.join(' ')).join(' L')}`}
                          />
                          {segment.controls.map((point, handle) => (
                            <circle
                              key={handle}
                              cx={point[0]}
                              cy={point[1]}
                              r="1.45"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                remember();
                                dragging.current = handle;
                                e.currentTarget.ownerSVGElement?.setPointerCapture(
                                  e.pointerId,
                                );
                              }}
                            />
                          ))}
                        </g>
                      )}
                    </svg>
                  )}
                </>
              )}
              {!result && (
                <div className="paper-placeholder">
                  {busy ? (
                    <LoaderCircle className="spin" size={26} />
                  ) : (
                    t('选择图片，开始构造', 'Choose an image to begin')
                  )}
                </div>
              )}
            </div>
            <aside className="math-facts">
              <span className="eyebrow">
                {t('数学画像评分 · 0–100', 'MATHEMATICAL PROFILE · 0–100')}
              </span>
              <div className="profile-scores">
                {[
                  {
                    label: t('数学复杂度', 'Mathematical complexity'),
                    value: math?.scores.complexity.value,
                    note: t(
                      '当前曲线段数的对数指数',
                      'Logarithmic index of cubic segment count',
                    ),
                  },
                  {
                    label: t('构图对称度', 'Composition symmetry'),
                    value: math?.scores.symmetry.value,
                    note: t(
                      '边界与其左右镜像的重合程度',
                      'Overlap of the boundaries with their horizontal reflection',
                    ),
                  },
                  {
                    label: t('明暗丰富度', 'Tonal richness'),
                    value: math?.scores.tone.value,
                    note: t(
                      '64 个明暗锚点的灰度分布熵',
                      'Grayscale distribution entropy of the 64 tone anchors',
                    ),
                  },
                ].map(({ label, value, note }) => (
                  <div className="profile-score" key={label} title={note}>
                    <span>{label}</span>
                    <div className="score-value">
                      <strong>{value == null ? '—' : value.toFixed(1)}</strong>
                      <small>/ 100</small>
                    </div>
                    {value == null ? (
                      <span className="score-unavailable">
                        {t('暂无数据', 'Unavailable')}
                      </span>
                    ) : (
                      <meter
                        min={0}
                        max={100}
                        value={value}
                        aria-label={label}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="math-numbers">
                <div>
                  <strong>{math?.cubicSegments.toLocaleString() ?? '—'}</strong>
                  <span>{t('段三次曲线', 'cubic curve segments')}</span>
                </div>
                <div>
                  <strong>{math?.toneAnchors ?? '—'}</strong>
                  <span>{t('个明暗锚点', 'tone anchors')}</span>
                </div>
                <div>
                  <strong>{math?.storedScalars.toLocaleString() ?? '—'}</strong>
                  <span>
                    {t('个几何与明暗数值', 'geometry and tone values')}
                  </span>
                </div>
              </div>
              <p className="control-note">
                {t(
                  '评分针对这张图。姿态、背景和裁剪会改变结果。',
                  'Scores describe this image. Pose, background and cropping affect the result.',
                )}
              </p>
            </aside>
          </div>
          <details className="profile-method">
            <summary>
              {t('分数如何计算？', 'How are scores calculated?')}
            </summary>
            <p>
              {t(
                '数学复杂度：100 × ln(1 + 曲线段数) / ln(3001)。固定对数尺度，0 段为 0 分，3000 段为 100 分。',
                'Complexity: 100 × ln(1 + segments) / ln(3001). A fixed logarithmic scale: 0 segments gives 0; 3,000 gives 100.',
              )}
            </p>
            <p>
              {t(
                '构图对称度：将曲线放在 64×64 网格上并轻度平滑，比较它与围绕画面中轴的左右镜像；完全重合为 100 分。没有可见曲线时不评分。',
                'Symmetry: place curves on a 64×64 grid, smooth slightly, and compare with their reflection around the image centre. Full overlap gives 100; no visible curves means no score.',
              )}
            </p>
            <p>
              {t(
                '明暗丰富度：64 个明暗锚点分入 16 档灰度，计算 Shannon 熵 H，分数为 100 × H / 4。单一灰度为 0 分，各档均匀分布为 100 分。',
                'Tonal richness: distribute the 64 anchors across 16 grayscale bins and compute Shannon entropy H. Score = 100 × H / 4. One tone gives 0; a uniform distribution across bins gives 100.',
              )}
            </p>
            <p>
              {t(
                '这是一组图像构造指标，不是人群百分位或颜值结论；复杂度越高表示描述更繁复，并不表示更好看。',
                'These are image-construction indices, not population percentiles or attractiveness judgments. Higher complexity means a more elaborate description.',
              )}
            </p>
            <small>Sfumato profile v1</small>
          </details>
          <div className="equation-panel">
            <div>
              <span>
                {t('蓝色曲线的真实方程', 'The equation of the blue curve')}
              </span>
              <small>0 ≤ t ≤ 1</small>
            </div>
            {coefficients ? (
              <>
                <code>x(t) = {equation(coefficients[0])}</code>
                <code>y(t) = {equation(coefficients[1])}</code>
                <p>
                  {t(
                    '显示系数保留三位小数，配方保存完整精度。',
                    'Display coefficients are rounded; the recipe keeps full precision.',
                  )}
                </p>
              </>
            ) : (
              <p>
                {t(
                  '没有选中的曲线；可在编辑区选择，或使用另一张照片。',
                  'No selected curve. Choose one in the editor, or use another photograph.',
                )}
              </p>
            )}
          </div>
          <div className="construction-export">
            <Button
              className="primary-action"
              disabled={!ready || exporting}
              onClick={() => {
                void exportCard('png');
              }}
            >
              <Download size={16} />
              {exporting
                ? t('正在保存…', 'Saving…')
                : t('保存数学自画像', 'Save math portrait')}
            </Button>
            <Button
              variant="outline"
              disabled={!ready}
              onClick={() => {
                void exportCard('svg');
              }}
            >
              {t('卡片 SVG', 'Card SVG')}
            </Button>
            <Button
              variant="ghost"
              disabled={!ready || !displayRecipe}
              onClick={() => {
                if (displayRecipe)
                  save(
                    new Blob([JSON.stringify(displayRecipe, null, 2)], {
                      type: 'application/json',
                    }),
                    'sfumato-recipe.json',
                  );
              }}
            >
              <FileJson size={15} />
              {t('数学配方', 'Recipe JSON')}
            </Button>
          </div>
          <details className="construction-explanation">
            <summary>
              {t(
                '原理、更多导出与说明',
                'How it works, more exports and notes',
              )}
            </summary>
            <p>
              {t(
                '算法提取图像明暗边界，用三次 Bézier 曲线拟合，再由曲线两侧采样和 64 个锚点求解明暗。配方可以交给 JavaScript 包直接重画。',
                'The algorithm fits cubic Bézier curves to brightness boundaries, then reconstructs tone from samples beside them and 64 anchors. The recipe redraws directly with the JavaScript package.',
              )}
            </p>
            <p>
              {t(
                '它是二维图像构造，不识别解剖结构。明暗求解在 160×160 网格上进行，放大不会恢复额外细节。数值数量不是独立自由度或文件压缩率。',
                'This is a 2D image construction, not anatomical reconstruction. Tone is solved on a 160×160 grid; enlargement adds no detail. Stored counts are neither independent degrees of freedom nor a file compression ratio.',
              )}
            </p>
            {result && (
              <p>
                {result.stats.iterations}{' '}
                {t(
                  '次迭代 · 最大调和残差',
                  'iterations · maximum harmonic residual',
                )}{' '}
                {result.stats.residual.toExponential(2)} ·{' '}
                {result.stats.converged
                  ? t('达到停止阈值', 'stopping threshold reached')
                  : t(
                      '当前为近似解，未达到停止阈值',
                      'approximate result; stopping threshold not reached',
                    )}
              </p>
            )}
            <div className="extra-exports">
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() => {
                  if (displayRecipe)
                    save(
                      new Blob([toSVG(displayRecipe)], {
                        type: 'image/svg+xml',
                      }),
                      'sfumato-curves.svg',
                    );
                }}
              >
                {t('曲线 SVG', 'Curve SVG')}
              </Button>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() => {
                  if (!result) return;
                  const buffer = document.createElement('canvas');
                  buffer.width = buffer.height = 160;
                  buffer
                    .getContext('2d')
                    ?.putImageData(
                      new ImageData(
                        new Uint8ClampedArray(result.image.data),
                        160,
                        160,
                      ),
                      0,
                      0,
                    );
                  buffer.toBlob((blob) => {
                    if (blob) save(blob, 'sfumato-portrait-160.png');
                  });
                }}
              >
                {t('明暗 PNG · 160px', 'Tonal PNG · 160px')}
              </Button>
            </div>
            <p>
              {t(
                '示例：NASA / Eileen Collins，公开领域照片。',
                'Example: NASA / Eileen Collins, public-domain photograph.',
              )}{' '}
              <a
                href="https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut"
                target="_blank"
                rel="noreferrer"
              >
                {t('来源 ↗', 'Source ↗')}
              </a>
            </p>
          </details>
        </section>
      </div>
    </main>
  );
}
