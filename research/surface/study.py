"""Reproducible controls. Predictions are declared in README before results.

Outputs JSON measurements, a continuous model, and an explanatory figure.
No learned component, generated image, or private photograph is used.
"""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from model import Settings, SurfaceProblem, grid, shading, evaluate_model, unit_light

LIGHT = [.5, -.35, 1.]
NEW_LIGHT = [-.65, .3, 1.]
RHO = .6


def truth(points, kind):
    x, y = np.asarray(points).T
    if kind == 'dome':
        z = .28*(1-x*x)**2*(1-y*y)**2
        p = -1.12*x*(1-x*x)*(1-y*y)**2
        q = -1.12*y*(1-y*y)*(1-x*x)**2
    elif kind == 'saddle':
        z = .38*x*y*(1-x*x)*(1-y*y)
        p = .38*y*(1-y*y)*(1-3*x*x)
        q = .38*x*(1-x*x)*(1-3*y*y)
    elif kind == 'off_basis_bumps':
        # Analytic Gaussian detail not in the finite spline dictionary.
        a = np.exp(-((x+.25)**2/.16+(y-.18)**2/.27))
        b = np.exp(-((x-.38)**2/.12+(y+.28)**2/.18))
        z = .22*a - .13*b
        p = -.44*(x+.25)/.16*a + .26*(x-.38)/.12*b
        q = -.44*(y-.18)/.27*a + .26*(y+.28)/.18*b
    else:
        raise ValueError(kind)
    return z, p, q


def observations(kind, interior=False):
    t = np.linspace(-1, 1, 33)
    border = np.vstack([np.c_[t, -np.ones(33)], np.c_[t, np.ones(33)],
                        np.c_[-np.ones(33), t], np.c_[np.ones(33), t]])
    curves = [{'kind': 'height', 'points': border.tolist(), 'values': truth(border, kind)[0].tolist(),
               'source': 'synthetic oracle: known boundary height, not inferred from pixels'}]
    if interior:
        cross = np.vstack([np.c_[t, np.zeros(33)], np.c_[np.zeros(33), t]])
        curves.append({'kind': 'height', 'points': cross.tolist(), 'values': truth(cross, kind)[0].tolist(),
                       'source': 'synthetic oracle: two measured interior depth profiles'})
    return curves


def rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a)-np.asarray(b))**2)))


def gray(values, size):
    # Display linear intensity with an sRGB transfer, not per-panel normalization.
    values = np.clip(values, 0, 1)
    s = np.where(values <= .0031308, 12.92*values, 1.055*values**(1/2.4)-.055)
    return Image.fromarray(np.uint8(np.clip(s.reshape(size, size)*255, 0, 255))).convert('RGB')


def height_image(values, size):
    # Shared scale across every shape panel: -0.30 (blue) to +0.30 (orange).
    v = np.clip(np.asarray(values).reshape(size, size)/.3, -1, 1)
    white = np.array([238, 235, 224.])
    positive, negative = np.array([185, 77, 36.]), np.array([45, 104, 154.])
    rgb = white + np.abs(v)[..., None] * (np.where(v[..., None] >= 0, positive, negative)-white)
    return Image.fromarray(np.uint8(rgb))


def make_figure(rows, output, headings=None, footer=None):
    size, gap = 170, 16
    canvas = Image.new('RGB', (1160, 100 + len(rows)*225 + 70), '#f5f2ea')
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
        small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 13)
        title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 25)
    except OSError:
        font = small = title = ImageFont.load_default()
    draw.text((24, 18), 'A surface must survive a change of light', fill='#242b2a', font=title)
    headings = headings or ['Input', 'True height', 'Fitted height', 'Input residual x 5', 'True new light', 'Fitted new light']
    for col, heading in enumerate(headings):
        draw.text((24+col*(size+gap), 65), heading, font=small, fill='#39423e')
    for row_index, row in enumerate(rows):
        y = 96+row_index*225
        for col, panel in enumerate(row['panels']):
            canvas.paste(panel.resize((size, size)), (24+col*(size+gap), y))
        draw.text((24, y+178), row['label'], font=font, fill='#242b2a')
        draw.text((24, y+201), row['metrics'], font=small, fill='#5d655e')
    draw.text((24, canvas.height-46), footer or 'Height: shared [-0.30, +0.30] scale. Geometric curves in these controls are supplied by the synthetic oracle.', font=small, fill='#39423e')
    draw.text((24, canvas.height-26), 'Low input residual alone does not establish correct shape. Single-view reflectance / lighting / shape remain ambiguous.', font=small, fill='#39423e')
    canvas.save(output)


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    settings = Settings()
    points, eval_points = grid(41), grid(73)
    records, rows = [], []
    started = time.monotonic()
    for kind in ['dome', 'saddle', 'off_basis_bumps']:
        z, p, q = truth(points, kind)
        image = RHO*shading(p, q, LIGHT)[0]
        ez, ep, eq = truth(eval_points, kind)
        ei = RHO*shading(ep, eq, LIGHT)[0]
        enew = RHO*shading(ep, eq, NEW_LIGHT)[0]
        modes = ['calibrated_boundary', 'unknown_reflectance_boundary', 'unknown_reflectance_profiles']
        if kind == 'off_basis_bumps':
            modes.append('refined_unknown_reflectance_profiles')
        for mode in modes:
            curves = observations(kind, interior=mode.endswith('profiles'))
            local_settings = Settings(surface_count=13) if mode.startswith('refined') else settings
            problem = SurfaceProblem(points, image, LIGHT, local_settings,
                                     known_reflectance=RHO if mode.startswith('calibrated') else None, curves=curves)
            result = problem.solve()
            model = problem.export(result)
            field = evaluate_model(model, eval_points)
            relit = evaluate_model(model, eval_points, NEW_LIGHT)['intensity']
            true_normal = np.c_[-ep, -eq, np.ones(len(ep))]
            true_normal /= np.linalg.norm(true_normal, axis=1, keepdims=True)
            normal_deg = float(np.mean(np.degrees(np.arccos(np.clip(np.sum(true_normal*field['normal'], axis=1), -1, 1)))))
            record = {'shape': kind, 'mode': mode, 'evaluation_grid': 73, 'training_grid': 41,
                      'surface_coefficient_count': problem.nz,
                      'input_rmse': rmse(field['intensity'], ei), 'height_rmse': rmse(field['height'], ez),
                      'new_light_rmse': rmse(relit, enew), 'normal_mean_degrees': normal_deg,
                      'reflectance_rmse': rmse(field['reflectance'], RHO), 'status': result['status'],
                      'steps': result['accepted_steps'], 'initial_objective': result['history'][0]['total'],
                      'final_losses': result['history'][-1],
                      'monotone_accepted_objective': all(a['total'] > b['total'] for a, b in zip(result['history'], result['history'][1:]))}
            records.append(record)
            print(json.dumps(record), flush=True)
            if kind == 'dome' or (kind == 'saddle' and mode == 'calibrated_boundary') or kind == 'off_basis_bumps':
                rows.append({'label': f'{kind} / {mode}',
                             'metrics': f"Input RMSE {record['input_rmse']:.5f}    Height RMSE {record['height_rmse']:.5f}    New-light RMSE {record['new_light_rmse']:.5f}    Mean normal error {normal_deg:.2f} deg",
                             'panels': [gray(ei, 73), height_image(ez, 73), height_image(field['height'], 73),
                                        gray(5*np.abs(field['intensity']-ei), 73), gray(enew, 73), gray(relit, 73)]})
            if kind == 'dome' and mode == 'unknown_reflectance_profiles':
                (output/'example-surface.json').write_text(json.dumps(model, indent=2)+'\n')
    # Exact image-identical pair: curved uniform material vs flat painted plane.
    z, p, q = truth(eval_points, 'dome')
    curved_image = RHO*shading(p, q, LIGHT)[0]
    flat_shading = shading(np.zeros(len(p)), np.zeros(len(p)), LIGHT)[0]
    flat_rho = curved_image/flat_shading
    pair = {'construction': 'rho_flat = I_curved / shading_flat; no shape estimator can distinguish identical input pixels without extra assumptions or observations',
            'same_light': LIGHT, 'maximum_pixel_difference': float(np.max(np.abs(curved_image-flat_rho*flat_shading))),
            'true_height_rmse_between_pair': rmse(z, np.zeros(len(z))),
            'flat_reflectance_range': [float(flat_rho.min()), float(flat_rho.max())]}
    # Both truths match under the original light but disagree when relit.
    curved_new = RHO*shading(p, q, NEW_LIGHT)[0]
    flat_new = flat_rho*shading(np.zeros(len(p)), np.zeros(len(p)), NEW_LIGHT)[0]
    pair['new_light_rmse_between_pair'] = rmse(curved_new, flat_new)
    make_figure([{'label': 'Identical pixels, different physical explanations',
                  'metrics': f"Original-light difference {pair['maximum_pixel_difference']:.2g}; new-light difference {pair['new_light_rmse_between_pair']:.5f}. Left height = curved, right height = flat.",
                  'panels': [gray(curved_image, 73), height_image(z, 73), height_image(np.zeros(len(z)), 73),
                             gray(5*np.abs(curved_image-flat_rho*flat_shading), 73), gray(curved_new, 73), gray(flat_new, 73)]}],
                output/'ambiguity.png',
                headings=['Same input', 'Curved explanation', 'Flat explanation', 'Pixel difference x 5', 'Curved: new light', 'Flat: new light'],
                footer='Exact analytic counterexample, not fitted reconstructions. Both materials stay positive and below one. Height scale [-0.30, +0.30].')
    report = {'settings': vars(settings), 'light': LIGHT, 'new_light': NEW_LIGHT,
              'data': 'analytic synthetic surfaces; uniform known true reflectance 0.6; no cast shadows or noise',
              'records': records, 'indistinguishable_pair': pair,
              'elapsed_seconds': time.monotonic()-started,
              'claims': 'Finite synthetic controls only; external oracle curves are not extracted from photographs; no real-face geometry validation.'}
    report['followup'] = 'The 13x13 refinement was added AFTER observing the 8x8 off-basis profile failure. It doubles knot spans with the same regularization weights; this is a targeted diagnostic, not a pre-registered generalization success or automatic model selection.'
    (output/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
    make_figure(rows, output/'surface-study.png')
    make_figure([row for row in rows if row['label'] in
                 ['off_basis_bumps / unknown_reflectance_profiles', 'off_basis_bumps / refined_unknown_reflectance_profiles']],
                output/'refinement-study.png')
    print(json.dumps({'indistinguishable_pair': pair, 'elapsed_seconds': report['elapsed_seconds']}), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).parent/'results')
    run(parser.parse_args().output)
