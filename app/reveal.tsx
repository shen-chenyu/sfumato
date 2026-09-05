'use client';
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { registerRevealTools } from '../lib/reveal-tools';
import {
  ArrowDownToLine,
  ArrowRight,
  Minus,
  Plus,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { initialRound, revealReducer } from '../public/reveal-state.mjs';
import './reveal.css';
type Model = {
  version: string;
  size: number;
  curves: { id: number; segments: unknown[] }[];
  anchors: unknown[];
};
type Frame = {
  count: number;
  pixels: Uint8ClampedArray;
  stats: {
    curves: number;
    segments: number;
    scalarParameters: number;
    converged: boolean;
  };
};
type Round = {
  phase: string;
  total: number;
  requested: number;
  displayed: number;
  stopAt: number | null;
  finishReason: string | null;
  epoch: number;
  frame: Frame | null;
};
const reducer = (s: Round, a: Parameters<typeof revealReducer>[1]) =>
  revealReducer(s, a) as Round;
const base = process.env.NEXT_PUBLIC_BASE_PATH || '',
  sample = `${base}/portrait.png`;
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function frameCanvas(pixels: Uint8ClampedArray) {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  c.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), 160, 160),
    0,
    0,
  );
  return c;
}
export default function Reveal() {
  const [round, dispatch] = useReducer(reducer, initialRound() as Round),
    [source, setSource] = useState(sample),
    [model, setModel] = useState<Model | null>(null),
    [automatic, setAutomatic] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLInputElement>(null),
    objectUrl = useRef<string | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Honor the browser's animation preference after hydration.
    // oxlint-disable-next-line react/react-compiler
    setAutomatic(!media.matches);
  }, []);
  useEffect(() => {
    let canceled = false;
    const worker = new Worker(`${base}/construct.worker.mjs`, {
        type: 'module',
      }),
      img = new window.Image();
    // A new source resets the external image-analysis job and round together.
    // oxlint-disable-next-line react/react-compiler
    dispatch({ type: 'loading' });
    // oxlint-disable-next-line react/react-compiler
    setError('');
    worker.onmessage = ({ data }) => {
      if (canceled) return;
      if (data.type === 'error') {
        setError(data.message);
        return;
      }
      setModel(data.model);
      dispatch({ type: 'prepared', total: data.model.curves.length });
      worker.terminate();
    };
    worker.onerror = () => {
      if (!canceled) setError('这次没能准备好画面。请重试，或换一张照片。');
    };
    img.onload = () => {
      if (canceled) return;
      if (img.naturalWidth * img.naturalHeight > 50000000) {
        setError('请使用小于 5000 万像素的照片。');
        return;
      }
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('浏览器无法打开画布。');
        return;
      }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 160, 160);
      const factor = 160 / Math.max(img.naturalWidth, img.naturalHeight),
        w = img.naturalWidth * factor,
        h = img.naturalHeight * factor;
      ctx.drawImage(img, (160 - w) / 2, (160 - h) / 2, w, h);
      const pixels = ctx.getImageData(0, 0, 160, 160).data;
      worker.postMessage(
        { type: 'construct', settings: { reveal: true }, pixels },
        [pixels.buffer],
      );
    };
    img.onerror = () => {
      if (!canceled) setError('无法读取这张照片，请换成 JPG、PNG 或 WebP。');
    };
    img.src = source;
    return () => {
      canceled = true;
      worker.terminate();
    };
  }, [source, revision]);
  useEffect(() => {
    if (
      !model ||
      !['playing', 'result', 'trim'].includes(round.phase) ||
      round.frame?.count === round.requested
    )
      return;
    let canceled = false;
    const worker = new Worker(`${base}/construct.worker.mjs`, {
        type: 'module',
      }),
      count = round.requested,
      epoch = round.epoch;
    worker.onmessage = ({ data }) => {
      if (canceled) return;
      if (data.type === 'error') {
        setError(data.message);
        return;
      }
      dispatch({
        type: 'frame',
        epoch,
        frame: { count, pixels: data.pixels, stats: data.stats },
      });
      worker.terminate();
    };
    worker.onerror = () => {
      if (!canceled) setError('显影暂时中断，请重试。');
    };
    worker.postMessage({ type: 'render', model, settings: { budget: count } });
    return () => {
      canceled = true;
      worker.terminate();
    };
  }, [model, round.requested, round.epoch, round.phase, round.frame?.count]);
  useEffect(() => {
    if (
      round.phase !== 'playing' ||
      !automatic ||
      !round.frame ||
      round.displayed !== round.requested ||
      error
    )
      return;
    const t = setTimeout(() => dispatch({ type: 'advance' }), 700);
    return () => clearTimeout(t);
  }, [round, automatic, error]);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, c.width, c.height);
    if (round.frame) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(frameCanvas(round.frame.pixels), 64, 64, 672, 672);
    }
  }, [round.frame]);
  useEffect(() => {
    const stop = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        round.phase === 'playing' &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest('button,input,a,select,textarea')
        )
      ) {
        e.preventDefault();
        dispatch({ type: 'stop' });
      }
    };
    window.addEventListener('keydown', stop);
    return () => window.removeEventListener('keydown', stop);
  }, [round.phase]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const finished = ['result', 'trim'].includes(round.phase),
    playing = round.phase === 'playing',
    pending = round.requested !== round.displayed || !round.frame;
  const upload = (file?: File) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(
        file.type,
      ) ||
      file.size > 20 * 1024 * 1024
    ) {
      setError('请选择小于 20 MB 的 JPG、PNG、WebP 或 AVIF 照片。');
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setSource(objectUrl.current);
  };
  const saveMoment = () => {
    if (!round.frame) return;
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1420;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frameCanvas(round.frame.pixels), 100, 100, 1000, 1000);
    ctx.fillStyle = '#344c3d';
    ctx.font = 'italic 48px Georgia';
    ctx.fillText('sfumato.', 100, 1200);
    ctx.font = '28px sans-serif';
    ctx.fillText(`我留下了 ${round.displayed} 条边界`, 100, 1270);
    ctx.fillStyle = '#7b876f';
    ctx.font = '20px sans-serif';
    ctx.fillText(
      `${round.frame.stats.segments} 段三次曲线 · 64 个明暗锚点`,
      100,
      1315,
    );
    c.toBlob((b) => b && download(b, 'sfumato-my-moment.png'));
  };
  const saveRecipe = () => {
    if (!model || !round.frame) return;
    download(
      new Blob(
        [
          JSON.stringify(
            { ...model, curves: model.curves.slice(0, round.displayed) },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'sfumato-my-moment.json',
    );
  };
  const toolState = useRef({
    phase: 'loading',
    shown: 0,
    total: 0,
    canStart: false,
    canStop: false,
  });
  useLayoutEffect(() => {
    toolState.current = {
      phase: round.phase,
      shown: round.displayed,
      total: round.total,
      canStart:
        !error &&
        ['ready', 'result', 'trim'].includes(round.phase) &&
        round.total > 0,
      canStop: !error && playing && !!round.frame,
    };
  });
  useEffect(
    () =>
      registerRevealTools(
        () => ({ ...toolState.current }),
        () => flushSync(() => dispatch({ type: 'start' })),
        () => flushSync(() => dispatch({ type: 'stop' })),
      ),
    [],
  );
  return (
    <main className="reveal-app" lang="zh-CN">
      <header className="reveal-header">
        <a className="wordmark" href={base || '/'}>
          sfumato<span>.</span>
        </a>
        <a href={`${base}/construct/`}>
          拆开数学构造 <ArrowRight size={15} />
        </a>
      </header>
      <section className="reveal-stage" aria-label="认出的瞬间">
        <div className="reveal-heading">
          <span className="eyebrow">认出的瞬间</span>
          <h1>
            {round.phase === 'trim'
              ? '再少一点，还认得出吗？'
              : finished
                ? round.finishReason === 'complete'
                  ? '已经全部显影。'
                  : `你在第 ${round.stopAt} 条边界时按停。`
                : '第几条线，你会认出它？'}
          </h1>
          <p>
            {finished
              ? '没有标准答案。看看原图，再决定还能删掉多少。'
              : '让朋友选一张你熟悉的照片。画面逐渐显影，你来决定哪一刻看清了。'}
          </p>
        </div>
        <div className={`reveal-pictures ${finished ? 'is-revealed' : ''}`}>
          <figure className="moment-picture">
            <div className="moment-paper">
              <canvas
                ref={canvas}
                width={800}
                height={800}
                aria-label={`当前由 ${round.displayed} 条边界重建的画面`}
              />
              {['loading', 'ready', 'empty'].includes(round.phase) && (
                <div className="moment-cover">
                  <span className="question-mark">?</span>
                  <strong>
                    {round.phase === 'loading'
                      ? '正在准备这张照片…'
                      : round.phase === 'empty'
                        ? '这张图没有足够清晰的边界'
                        : '原图先藏起来。'}
                  </strong>
                  <p>
                    {round.phase === 'empty'
                      ? '换一张对比清楚的照片试试。'
                      : '从模糊的明暗，慢慢看到具体的模样。'}
                  </p>
                  {round.phase === 'ready' && !error && (
                    <Button
                      className="start-round"
                      onClick={() => dispatch({ type: 'start' })}
                    >
                      开始显影 <ArrowRight size={17} />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <figcaption>
              {finished
                ? '你留下的画面'
                : playing
                  ? '还没揭晓的画面'
                  : '准备好了再开始'}
              <span>
                {round.frame
                  ? `${round.displayed} 条边界 · ${round.frame.stats.segments} 段曲线`
                  : ''}
              </span>
            </figcaption>
          </figure>
          {finished && (
            <figure className="answer-picture">
              <div className="answer-paper">
                {/* Local photo URLs are decoded directly and are never uploaded. */}
                {/* oxlint-disable-next-line next/no-img-element */}
                <img src={source} alt="揭晓后的原照片" />
              </div>
              <figcaption>
                原来是这张照片
                <span>
                  {source === sample ? 'Eileen Collins · NASA' : '你选择的照片'}
                </span>
              </figcaption>
            </figure>
          )}
        </div>
        {playing && (
          <div className="reveal-live">
            <div className="live-count">
              <strong>{round.displayed}</strong>
              <span> / {round.total} 条边界</span>
            </div>
            <progress
              className="reveal-meter"
              aria-label="显影进度"
              max={round.total}
              value={round.displayed}
            />
            <Button
              className="recognize-button"
              disabled={!round.frame || !!error}
              onClick={() => dispatch({ type: 'stop' })}
            >
              我看出来了
            </Button>
            <span className="space-hint">也可以按空格，停在眼前这一帧</span>
          </div>
        )}
        {finished && (
          <div className="after-reveal">
            <div className="trim-actions">
              <span>
                {round.phase === 'trim'
                  ? `现在留下 ${round.displayed} 条`
                  : '试试删到不能再删'}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="再少一条边界"
                disabled={pending || round.displayed === 0 || !!error}
                onClick={() =>
                  dispatch({ type: 'trim', count: round.displayed - 1 })
                }
              >
                <Minus size={17} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="加回一条边界"
                disabled={pending || round.displayed >= round.total || !!error}
                onClick={() =>
                  dispatch({ type: 'trim', count: round.displayed + 1 })
                }
              >
                <Plus size={17} />
              </Button>
              {round.phase === 'trim' && (
                <button
                  className="return-moment"
                  onClick={() => dispatch({ type: 'return' })}
                >
                  回到按停的瞬间
                </button>
              )}
            </div>
            <div className="moment-exports">
              <Button disabled={pending || !!error} onClick={saveMoment}>
                <ArrowDownToLine size={16} />
                留下这一刻
              </Button>
              <Button
                variant="ghost"
                disabled={pending || !!error}
                onClick={saveRecipe}
              >
                保存数学配方
              </Button>
              <Button
                variant="ghost"
                onClick={() => dispatch({ type: 'start' })}
              >
                <RotateCcw size={15} />
                重看这张
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className="reveal-error" role="alert">
            {error}
            <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
              重试
            </Button>
          </div>
        )}
        <div className="round-settings">
          <div>
            <Button variant="ghost" onClick={() => input.current?.click()}>
              <Upload size={15} />
              {finished ? '换一张照片' : '请朋友选张照片'}
            </Button>
            <input
              ref={input}
              className="sr-only"
              aria-label="选择一张用于显影的照片"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {source !== sample && (
              <button className="use-sample" onClick={() => setSource(sample)}>
                用示例试试
              </button>
            )}
          </div>
          {!finished && (
            <div className="pace-controls">
              <button
                aria-pressed={automatic}
                onClick={() => setAutomatic((v) => !v)}
              >
                {automatic ? '自动显影' : '逐条看'}
              </button>
              {playing && !automatic && (
                <Button
                  variant="outline"
                  disabled={pending || !!error}
                  onClick={() => dispatch({ type: 'advance' })}
                >
                  下一条 <ArrowRight size={14} />
                </Button>
              )}
            </div>
          )}
        </div>
        <details className="reveal-about">
          <summary>它如何显影？</summary>
          <p>
            每一步增加一条图像边界，由明确的三次曲线和明暗约束重新求解。新排序更重视靠近画面中央、描述较紧凑的细节，减少长轮廓抢占前几步的情况；它还没有识别出眼睛、鼻子等部位。
          </p>
          <p>
            一条边界可由多段曲线组成。画面还使用 64 个粗略明暗锚点，因此“10
            条线”并不是只保存 10
            个数字。按停只是你的主观判断，游戏不会把它当成正确率或美感评分。
          </p>
          <p>
            照片只在本机处理。保存的数学配方可以在
            <a href={`${base}/construct/`}>构造实验</a>
            中导入，不需要原照片。示例是 NASA 的公开领域照片。
            <a
              href="https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut"
              target="_blank"
              rel="noreferrer"
            >
              来源 ↗
            </a>
          </p>
        </details>
      </section>
      <footer className="reveal-footer">
        <span>本地实验 · 照片不会上传</span>
        <span>少一些，看见更多。</span>
      </footer>
    </main>
  );
}
