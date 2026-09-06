export type Point = [number, number];
export type Controls = [Point, Point, Point, Point];
export interface Pixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}
export interface Segment {
  controls: Controls;
  tones: [[number, number, number], [number, number, number]];
  maxError: number;
  rmsError: number;
  samples: number;
  edited?: boolean;
}
export interface Construction {
  version: 'sfumato-construction-1';
  size: 160;
  tolerance: number;
  curves: {
    id: number;
    score: number;
    sourceLength: number;
    segments: Segment[];
  }[];
  anchors: { x: number; y: number; value: number }[];
  description: string;
}
export interface Recipe {
  version: 'sfumato-recipe-1';
  construction: Construction;
  render: { iterations: number; tolerance: number };
  language: 'en' | 'zh-CN';
}
export interface Portrait {
  image: { data: Uint8ClampedArray; width: 160; height: 160 };
  recipe: Recipe;
  /** Vector curves only; image contains the tonal reconstruction. */
  svg: string;
  explanation: string;
  math: MathPortrait;
  /** Self-contained SVG card with curves, measured counts and an example equation. */
  card: string;
  stats: {
    curves: number;
    segments: number;
    scalarParameters: number;
    constraints: number;
    iterations: number;
    maxChange: number;
    residual: number;
    converged: boolean;
  };
}
export interface MathPortrait {
  scores: PortraitScores;
  boundaryChains: number;
  cubicSegments: number;
  /** x(t) and y(t) for every segment, excluding tone equations. */
  coordinatePolynomials: number;
  geometryScalars: number;
  curveToneSamples: number;
  toneAnchors: number;
  anchorScalars: number;
  /** Stored geometry + tone entries, including repeated endpoints; not independent DOF. */
  storedScalars: number;
  /** Actual UTF-8 bytes of the compact JSON recipe, including metadata. */
  recipeBytes: number;
  example: {
    curveId: number;
    segment: number;
    x: number[];
    y: number[];
  } | null;
  summary: string;
}
export interface PortraitScores {
  version: 'sfumato-profile-1';
  complexity: { value: number; segments: number };
  /** null when no visible boundary geometry is available. */
  symmetry: {
    value: number | null;
    axis: number;
    gridSize: number;
    occupiedCells: number;
  };
  tone: { value: number; entropyBits: number; histogram: number[] };
}
export function scorePortrait(recipe: Recipe): PortraitScores;
export function createPortrait(
  image: Pixels,
  options?: {
    /** Maximum image-boundary chains, 0..180. Default: all detected chains. */
    curves?: number;
    /** Fitting tolerance on the 160px grid, 0.15..4. Default: 0.8. */
    tolerance?: number;
    language?: 'en' | 'zh-CN';
    iterations?: number;
  },
): Portrait;
export function redraw(recipe: Recipe): Portrait;
export function toSVG(recipe: Recipe, options?: { size?: number }): string;
export function describeMath(recipe: Recipe): MathPortrait;
export function toMathCard(recipe: Recipe): string;
export function bezier(controls: Controls, t: number): Point;
/** Coefficients [constant, t, t², t³] for x and y. */
export function polynomial(controls: Controls): [number[], number[]];
