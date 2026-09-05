'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { registerDrawingTools } from '../lib/drawing-tools';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Fingerprint,
  Focus,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { outline, svg } from '../public/engine.mjs';

type Stroke = {
  id: number;
  points: number[];
  width: number;
  soft: boolean;
  alpha: number;
  gain: number;
  reduction: number;
  lossBefore: number;
  lossAfter: number;
  x: number;
  y: number;
};
type Drawing = {
  strokes: Stroke[];
  initialLoss: number;
  finalLoss: number;
  candidateCount: number;
  version: string;
  settings: Record<string, unknown>;
};
const base = process.env.NEXT_PUBLIC_BASE_PATH || '',
  sample = `${base}/portrait.png`;
const hands = [
  { id: 'pencil', name: 'Graphite', sub: 'Find the shape', glyph: '///' },
  { id: 'etch', name: 'Etching', sub: 'Every line counts', glyph: '≋' },
  { id: 'wash', name: 'Soft ink', sub: 'Let the edges go', glyph: '≈' },
];
const phases: Record<string, string> = {
  observe: 'Looking for light & edges…',
  candidates: 'Trying thousands of possible marks…',
  select: 'Choosing the marks that matter…',
};
function mark(ctx: CanvasRenderingContext2D, s: Stroke, size: number) {
  const poly = outline(s, (size * 0.8) / 160, size * 0.1);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1 - Math.exp(-1.8 * s.alpha);
  ctx.fillStyle = '#293533';
  if (s.soft) ctx.filter = `blur(${(s.width * 0.32 * size * 0.8) / 160}px)`;
  ctx.beginPath();
  poly.forEach(([x, y]: number[], i: number) =>
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function paint(c: HTMLCanvasElement, r: Drawing, n: number) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, c.width, c.height);
  r.strokes.slice(0, n).forEach((s) => mark(ctx, s, c.width));
}
function download(blob: Blob, name: string) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function describe(r: Drawing, n: number) {
  const selected = r.strokes.slice(0, n),
    last = selected.at(-1);
  const explained = r.initialLoss
    ? Math.round(100 * (1 - (last?.lossAfter ?? r.initialLoss) / r.initialLoss))
    : 0;
  const hand =
    r.settings.style === 'wash'
      ? 'soft washes and fine curves'
      : r.settings.style === 'etch'
        ? 'narrow etched curves'
        : 'tapered graphite curves';
  return `This study keeps ${n} of ${r.candidateCount.toLocaleString()} candidate marks. It uses ${hand} to follow changes in local light. ${r.settings.strategy === 'random' ? 'The candidates arrive in a reproducible random order; only useful marks survive.' : 'Each new mark is chosen for the remaining light and edge information it can explain, after paying a small cost for using more ink.'} The attention point gives nearby details more weight. At this stopping point, the mathematical drawing error has fallen by ${explained}%. No source pixels are pasted into the finished drawing.`;
}

export default function Studio() {
  const [source, setSource] = useState(sample),
    [name, setName] = useState('The astronaut'),
    [style, setStyle] = useState('pencil'),
    [strategy, setStrategy] = useState('smart');
  const [result, setResult] = useState<Drawing | null>(null),
    [count, setCount] = useState(0),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(true);
  const [phase, setPhase] = useState('observe'),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [view, setView] = useState('drawing');
  const [focus, setFocus] = useState<[number, number]>([0.48, 0.52]),
    [focusMode, setFocusMode] = useState(false),
    [toast, setToast] = useState(''),
    [revision, setRevision] = useState(0),
    [savedAt, setSavedAt] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    image = useRef<HTMLImageElement | null>(null),
    objectUrl = useRef<string | null>(null),
    drawState = useRef({ result: null as Drawing | null, count: 0 });
  useEffect(() => {
    let cancelled = false;
    // Reset the visible job when an external worker is replaced.
    // oxlint-disable-next-line react/react-compiler
    setBusy(true);
    setPhase('observe');
    setProgress(0);
    setError('');
    setPlaying(false);
    setSavedAt(null);
    setCount(0);
    setResult(null);
    worker.current?.terminate();
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth * img.naturalHeight > 50000000) {
        setError('Try an image smaller than 50 megapixels.');
        setBusy(false);
        return;
      }
      image.current = img;
      const buffer = document.createElement('canvas');
      buffer.width = buffer.height = 160;
      const ctx = buffer.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('Your browser cannot open a drawing canvas.');
        setBusy(false);
        return;
      }
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 160, 160);
      const factor = Math.min(160 / img.naturalWidth, 160 / img.naturalHeight),
        w = img.naturalWidth * factor,
        h = img.naturalHeight * factor;
      ctx.drawImage(img, (160 - w) / 2, (160 - h) / 2, w, h);
      try {
        const wkr = new Worker(`${base}/engine.worker.mjs`, { type: 'module' });
        worker.current = wkr;
        wkr.onmessage = ({ data }) => {
          if (cancelled) return;
          if (data.type === 'progress') {
            setPhase(data.phase);
            setProgress(data.value);
          } else if (data.type === 'result') {
            setResult(data.result);
            setBusy(false);
            setCount(Math.min(100, data.result.strokes.length));
            setPlaying(
              !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            );
            wkr.terminate();
          } else {
            setBusy(false);
            setError(data.message);
          }
        };
        wkr.onerror = () => {
          if (!cancelled) {
            setBusy(false);
            setError('The drawing stopped. Try a smaller photo or restart.');
          }
        };
        const pixels = ctx.getImageData(0, 0, 160, 160).data;
        wkr.postMessage(
          {
            pixels,
            settings: { style, strategy, budget: 1200, seed: 42, focus },
          },
          [pixels.buffer],
        );
      } catch {
        setBusy(false);
        setError(
          'Try a recent Chrome, Firefox or Safari to start the drawing engine.',
        );
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setBusy(false);
        setError('We could not read that image. Try a JPG, PNG or WebP.');
      }
    };
    img.src = source;
    return () => {
      cancelled = true;
      worker.current?.terminate();
    };
  }, [source, style, strategy, focus, revision]);
  useEffect(() => {
    if (!playing || !result) return;
    const timer = setInterval(
      () =>
        setCount((n) => {
          const next = Math.min(n + 7, result.strokes.length);
          if (next === result.strokes.length) setPlaying(false);
          return next;
        }),
      40,
    );
    return () => clearInterval(timer);
  }, [playing, result]);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const old = drawState.current;
    if (view === 'original') {
      ctx.fillStyle = '#faf9f5';
      ctx.fillRect(0, 0, c.width, c.height);
      const img = image.current;
      if (img) {
        const scale =
            (c.width * 0.8) / Math.max(img.naturalWidth, img.naturalHeight),
          w = img.naturalWidth * scale,
          h = img.naturalHeight * scale;
        ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
      }
      drawState.current = { result: null, count: 0 };
      return;
    }
    if (!result) {
      ctx.fillStyle = '#faf9f5';
      ctx.fillRect(0, 0, c.width, c.height);
      drawState.current = { result: null, count: 0 };
      return;
    }
    if (old.result !== result || count < old.count) paint(c, result, count);
    else
      result.strokes
        .slice(old.count, count)
        .forEach((s) => mark(ctx, s, c.width));
    drawState.current = { result, count };
  }, [result, count, view, busy]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const upload = (file?: File) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(
        file.type,
      )
    ) {
      setError('Choose a JPG, PNG, WebP or AVIF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('That image is over 20 MB. Try a smaller copy.');
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setSource(objectUrl.current);
    setName(file.name);
    setFocus([0.5, 0.4]);
    setView('drawing');
  };
  const exportPng = () => {
    if (!result) return;
    const c = document.createElement('canvas');
    c.width = c.height = 2000;
    paint(c, result, count);
    c.toBlob((b) => {
      if (b) {
        download(b, `sfumato-${style}-${count}.png`);
        setToast('Your drawing is saved.');
      }
    });
  };
  const exportRecipe = () => {
    if (!result) return;
    download(
      new Blob(
        [
          JSON.stringify(
            {
              ...result,
              finalLoss: count
                ? result.strokes[count - 1].lossAfter
                : result.initialLoss,
              visibleStrokes: count,
              explanation: describe(result, count),
              strokes: result.strokes.slice(0, count),
              note: 'Source photograph is not included. Error reduction is not a beauty or identity score.',
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      `sfumato-${count}-strokes.json`,
    );
  };
  const total = result?.strokes.length ?? 1200,
    latest = result?.strokes[count - 1],
    loss = latest?.lossAfter ?? result?.initialLoss ?? 0,
    captured =
      result && result.initialLoss > 0
        ? Math.round(100 * (1 - loss / result.initialLoss))
        : 0;
  const seek = (n: number) => {
    setCount(Math.min(n, total));
    setPlaying(false);
    setView('drawing');
  };
  const toolState = useRef({ count, total, busy });
  useLayoutEffect(() => {
    toolState.current = { count, total, busy };
  }, [count, total, busy]);
  useEffect(
    () =>
      registerDrawingTools(
        () => toolState.current,
        (n) =>
          flushSync(() => {
            setCount(n);
            setPlaying(false);
            setView('drawing');
          }),
      ),
    [],
  );
  return (
    // Drop anywhere is a convenience; the keyboard-accessible upload button is equivalent.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <main
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <a className="wordmark" href={base || '/'}>
          sfumato<span>.</span>
        </a>
        <span className="top-note">
          A little less image. A little more imagination.
        </span>
        <a className="source-link" href={base || '/'}>
          数学构造 <ArrowUpRight size={15} />
        </a>
      </header>
      <div className="workspace">
        <aside className="controls">
          <div className="intro">
            <span className="eyebrow">THE COMPUTATIONAL DRAWING ROOM</span>
            <h1>
              What makes
              <br />a picture?
            </h1>
            <p>
              Give it a photo.
              <br />
              See what it chooses to keep.
            </p>
          </div>
          <section className="control-section">
            <div className="section-heading">
              <span>01</span>
              <h2>Start with something</h2>
            </div>
            <button
              className="source-preview"
              onClick={() => input.current?.click()}
            >
              {/* Local object URLs must be decoded directly; no remote image optimizer. */}
              {/* oxlint-disable-next-line next/no-img-element */}
              <img src={source} alt="Source photograph" />
              <span>
                <strong>{name}</strong>
                <small>
                  {source === sample
                    ? 'Eileen Collins · NASA'
                    : 'Your photo · stays on this device'}
                </small>
              </span>
              <Upload size={16} />
            </button>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              aria-label="Upload a photograph"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              className="upload-button"
              onClick={() => input.current?.click()}
            >
              <Upload size={15} />
              Try your own photo
            </Button>
            {source !== sample && (
              <button
                className="text-button"
                onClick={() => {
                  setSource(sample);
                  setName('The astronaut');
                  setFocus([0.48, 0.52]);
                }}
              >
                Back to the astronaut
              </button>
            )}
          </section>
          <section className="control-section">
            <div className="section-heading">
              <span>02</span>
              <h2>Choose a hand</h2>
            </div>
            <RadioGroup
              className="style-options"
              value={style}
              onValueChange={(v) => setStyle(String(v))}
              aria-label="Drawing style"
            >
              {hands.map((s) => (
                <label
                  key={s.id}
                  className={`style-choice ${style === s.id ? 'chosen' : ''}`}
                >
                  <span className={`style-glyph ${s.id}`}>{s.glyph}</span>
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.sub}</small>
                  </span>
                  <RadioGroupItem value={s.id} aria-label={s.name} />
                </label>
              ))}
            </RadioGroup>
          </section>
          <section className="control-section experiment">
            <div className="section-heading">
              <span>03</span>
              <h2>Break the rules</h2>
            </div>
            <Button
              variant="outline"
              className={`experiment-button ${strategy === 'random' ? 'active' : ''}`}
              onClick={() =>
                setStrategy((s) => (s === 'smart' ? 'random' : 'smart'))
              }
              aria-pressed={strategy === 'random'}
            >
              <Shuffle size={16} />
              {strategy === 'smart'
                ? 'What if it chose randomly?'
                : 'Random order · back to smart'}
            </Button>
            <Button
              variant="ghost"
              className={`focus-button ${focusMode ? 'active' : ''}`}
              onClick={() => {
                setFocusMode((v) => !v);
                setView('original');
              }}
              aria-pressed={focusMode}
            >
              <Focus size={15} />
              {focusMode
                ? 'Click a place in the picture'
                : 'Tell it where to look'}
            </Button>
            <p className="control-hint">The same photo. Different decisions.</p>
          </section>
          <div className="privacy">
            <Fingerprint size={21} />
            <p>
              Your photo stays in your browser.
              <br />
              <strong>No uploads. No AI image models.</strong>
            </p>
          </div>
        </aside>
        <section className="drawing-room" aria-label="Drawing studio">
          <div className="canvas-topline">
            <span className="drawing-title">
              <i />
              STUDY {String(revision + 1).padStart(3, '0')}
              <b>/</b>
              {hands.find((s) => s.id === style)?.name}
            </span>
            <Tabs value={view} onValueChange={(v) => setView(String(v))}>
              <TabsList className="view-tabs">
                <TabsTrigger value="drawing">Drawing</TabsTrigger>
                <TabsTrigger value="original">Original</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className={`paper-wrap ${focusMode ? 'focus-enabled' : ''}`}>
            <canvas
              ref={canvas}
              width={1000}
              height={1000}
              tabIndex={focusMode ? 0 : undefined}
              aria-label={
                focusMode
                  ? `Attention point. Use arrow keys to move, Enter to finish.`
                  : `${count} selected strokes`
              }
              onKeyDown={(e) => {
                if (!focusMode) return;
                if (e.key === 'Enter') {
                  setFocusMode(false);
                  setView('drawing');
                }
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-0.05, 0],
                  ArrowRight: [0.05, 0],
                  ArrowUp: [0, -0.05],
                  ArrowDown: [0, 0.05],
                };
                if (moves[e.key]) {
                  e.preventDefault();
                  const [dx, dy] = moves[e.key];
                  setFocus(([x, y]) => [
                    Math.max(0, Math.min(1, x + dx)),
                    Math.max(0, Math.min(1, y + dy)),
                  ]);
                }
              }}
              onClick={(e) => {
                if (!focusMode) return;
                const r = e.currentTarget.getBoundingClientRect();
                setFocus([
                  Math.max(
                    0,
                    Math.min(1, ((e.clientX - r.left) / r.width - 0.1) / 0.8),
                  ),
                  Math.max(
                    0,
                    Math.min(1, ((e.clientY - r.top) / r.height - 0.1) / 0.8),
                  ),
                ]);
                setFocusMode(false);
                setView('drawing');
                setToast('A new point of view.');
              }}
            />
            {busy && (
              <output className="drawing-progress">
                <LoaderCircle className="spin" size={24} />
                <strong>{phases[phase]}</strong>
                <span>
                  {phase === 'select'
                    ? `${Math.round(progress * 100)}% of the drawing explored`
                    : 'Every mark is calculated on your device.'}
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${phase === 'select' ? progress * 100 : 8}%`,
                    }}
                  />
                </div>
              </output>
            )}
            {!busy && !error && count === 0 && (
              <span className="paper-whisper">
                {total
                  ? 'Every picture begins here.'
                  : 'Nothing to draw. Try a photo with more contrast.'}
              </span>
            )}
            {error && (
              <div className="error-card" role="alert">
                <strong>A small interruption.</strong>
                <p>{error}</p>
                <Button onClick={() => setRevision((n) => n + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {focusMode && (
              <span
                className="focus-cross"
                style={{
                  left: `${10 + 80 * focus[0]}%`,
                  top: `${10 + 80 * focus[1]}%`,
                }}
              >
                +
              </span>
            )}
            <div className="paper-caption">
              <span>
                {view === 'original'
                  ? 'SOURCE PHOTOGRAPH'
                  : 'SFUMATO / SELECTED MARKS'}
              </span>
              <span>
                {view === 'original'
                  ? 'Only on this device'
                  : `${String(count).padStart(4, '0')} strokes`}
              </span>
            </div>
          </div>
          <div className="playback">
            <div className="playback-heading">
              <div>
                <span className="eyebrow">WATCH IT BECOME SOMETHING</span>
                <p>
                  <strong>{count.toLocaleString()}</strong>
                  <span> / {total.toLocaleString()} strokes</span>
                </p>
              </div>
              <div className="playback-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!result || !total}
                  aria-label="Restart playback"
                  onClick={() => {
                    setCount(0);
                    setPlaying(true);
                    setView('drawing');
                  }}
                >
                  <RotateCcw size={18} />
                </Button>
                <Button
                  className="play-button"
                  size="icon"
                  disabled={!result || !total}
                  aria-label={playing ? 'Pause drawing' : 'Play drawing'}
                  onClick={() => {
                    if (count >= total) setCount(0);
                    setPlaying((v) => !v);
                    setView('drawing');
                  }}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </Button>
              </div>
            </div>
            <Slider
              value={[count]}
              min={0}
              max={Math.max(1, total)}
              step={1}
              disabled={!result}
              aria-label="Visible strokes"
              onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)}
            />
            <div className="milestones">
              {savedAt !== null && savedAt !== count && (
                <button onClick={() => seek(savedAt)}>
                  Your enough · {savedAt}
                </button>
              )}
              {[100, 300, 900].map((n) => (
                <button
                  key={n}
                  disabled={!result || n > total}
                  onClick={() => seek(n)}
                >
                  {n} ·{' '}
                  {n === 100
                    ? 'a suggestion'
                    : n === 300
                      ? 'a likeness'
                      : 'a little more'}
                </button>
              ))}
            </div>
          </div>
          <div className="insight">
            <span>↳</span>
            <div>
              <strong>
                {count < 100
                  ? 'How few marks can say enough?'
                  : count < 400
                    ? 'The important things arrive first.'
                    : 'More marks. But is it a better picture?'}
              </strong>
              <p>
                {busy
                  ? 'The algorithm is weighing one possible stroke against another.'
                  : strategy === 'random'
                    ? 'Candidates arrive in a seeded random order. Only marks that still reduce the drawing error are kept.'
                    : `${result?.candidateCount.toLocaleString() ?? 'Thousands of'} possible marks. Each stroke competes to explain the light and edges that are still missing.`}
              </p>
            </div>
            <span
              className="proxy-stat"
              title="Reduction in the two-scale drawing objective, not a beauty or identity score."
            >
              {captured}%<small>target explained</small>
            </span>
          </div>
          <div className="export-bar">
            <Button
              variant="ghost"
              className="keep-button"
              disabled={!result || !count}
              onClick={() => {
                setSavedAt(count);
                setPlaying(false);
                setToast(`Your “enough” is ${count} strokes.`);
              }}
            >
              <Sparkles size={16} />
              {savedAt === count ? 'This is enough.' : 'This is the moment.'}
            </Button>
            <div>
              <Button variant="ghost" disabled={!result} onClick={exportRecipe}>
                Get the recipe
              </Button>
              <Button
                variant="ghost"
                disabled={!result || !count}
                onClick={() =>
                  result &&
                  download(
                    new Blob([svg(result, count)], { type: 'image/svg+xml' }),
                    `sfumato-${count}.svg`,
                  )
                }
              >
                SVG
              </Button>
              <Button disabled={!result || !count} onClick={exportPng}>
                <ArrowDownToLine size={16} />
                Save drawing
              </Button>
            </div>
          </div>
          {result && (
            <details className="drawing-notes">
              <summary>Why these marks?</summary>
              <p>{describe(result, count)}</p>
              <p className="fine-print">
                The percentage measures a pixel-based drawing objective. It is
                not a beauty or likeness score.
              </p>
            </details>
          )}
        </section>
      </div>
      <footer id="about">
        <div>
          <a className="wordmark" href={base || '/'}>
            sfumato<span>.</span>
          </a>
          <p>An open experiment in drawing with fewer decisions.</p>
          <a
            className="source-link"
            href="https://github.com/shen-chenyu/sfumato"
            target="_blank"
            rel="noreferrer"
          >
            Play with the source <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="about-copy">
          <strong>A drawing algorithm, with its workings showing.</strong>
          <p>
            Curves follow local image structure. A mathematical search keeps
            marks that reduce a drawing error. You control how many survive.
            This explores visual simplification; it does not reproduce an
            artist’s judgment.
          </p>
          <span>
            Sample: Eileen Collins, NASA · public domain.{' '}
            <a
              href="https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut"
              target="_blank"
              rel="noreferrer"
            >
              Image credit ↗
            </a>
          </span>
        </div>
      </footer>
      {toast && (
        <output className="toast">
          <Check size={16} />
          {toast}
        </output>
      )}
    </main>
  );
}
