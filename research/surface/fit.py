"""Photo -> continuous mathematical hypothesis, image, and factual explanation.

This diagnostic CLI does not estimate camera/light calibration or anatomy.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from model import Settings, SurfaceProblem, evaluate_model, grid, principal_geometry
from study import gray, height_image, rmse


def prepare_image(path, size):
    with Image.open(path) as source:
        rgba = ImageOps.exif_transpose(source).convert('RGBA')
        # Preserve aspect ratio, use the central square, record the crop.
        width, height = rgba.size
        side = min(width, height)
        left, top = (width-side)//2, (height-side)//2
        crop = [left, top, left+side, top+side]
        white = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        white.alpha_composite(rgba)
        rgb = np.asarray(white.convert('RGB').crop(crop), dtype=float)/255
    linear = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)
    luminance = linear @ np.array([.2126, .7152, .0722])
    image = Image.fromarray(luminance.astype('float32')).resize((size, size), Image.Resampling.BOX)
    return np.asarray(image, dtype=float).ravel(), {'source_size': [width, height], 'center_square_crop': crop,
                                                       'transfer': 'nominal sRGB inverse transfer, then linear Rec.709 luminance; image exposure is not calibrated'}


def run(args):
    if not 17 <= args.size <= 97 or not 4 <= args.basis <= 16 or not 32 <= args.render_size <= 1024:
        raise ValueError('Use fit size 17..97, basis 4..16, render size 32..1024')
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    intensity, preprocessing = prepare_image(args.input, args.size)
    # Very dark and clipped bright observations violate this log-domain fit.
    valid = (intensity > .005) & (intensity < .98)
    if np.sum(valid) < 4*args.basis**2:
        raise ValueError('Too few valid observations for this basis; reduce basis or change crop')
    points = grid(args.size)
    curves = json.loads(args.curves.read_text()) if args.curves else []
    problem = SurfaceProblem(points[valid], intensity[valid], args.light,
                             Settings(surface_count=args.basis), curves=curves)
    result = problem.solve()
    model = problem.export(result)
    model['preprocessing'] = preprocessing
    model['lighting_provenance'] = 'user-supplied hypothesis, not estimated or calibrated'
    (output/'model.json').write_text(json.dumps(model, indent=2)+'\n')
    train = evaluate_model(model, points)
    field = evaluate_model(model, grid(args.render_size))
    relit = evaluate_model(model, grid(args.render_size), args.new_light)
    geometry = principal_geometry(field)
    gray(intensity, args.size).resize((args.render_size, args.render_size)).save(output/'input.png')
    gray(field['intensity'], args.render_size).save(output/'reconstruction.png')
    gray(field['reflectance'], args.render_size).save(output/'reflectance.png')
    gray(relit['intensity'], args.render_size).save(output/'new-light.png')
    height_image(field['height'], args.render_size).save(output/'height-hypothesis.png')
    normal = np.uint8(np.clip((field['normal']+1)/2*255, 0, 255)).reshape(args.render_size, args.render_size, 3)
    Image.fromarray(normal).save(output/'normals.png')
    report = {'input': args.input.name, 'preprocessing': preprocessing,
              'valid_pixels': int(valid.sum()), 'masked_pixels': int((~valid).sum()),
              'scalar_coefficients': problem.nz+problem.na, 'assumed_light': list(args.light),
              'new_assumed_light': list(args.new_light), 'external_curve_count': len(curves),
              'valid_pixel_linear_rmse': rmse(train['intensity'][valid], intensity[valid]),
              'all_pixel_linear_rmse': rmse(train['intensity'], intensity),
              'height_range': [float(field['height'].min()), float(field['height'].max())],
              'slope_magnitude_quantiles_50_90_99': np.quantile(np.hypot(field['p'], field['q']), [.5,.9,.99]).tolist(),
              'height_display_clipped_fraction': float(np.mean(np.abs(field['height']) > .3)),
              'reflectance_display_clipped_fraction': float(np.mean(field['reflectance'] > 1)),
              'reconstruction_display_clipped_fraction': float(np.mean(field['intensity'] > 1)),
              'defined_principal_direction_fraction': float(np.mean(geometry['direction_defined'])),
              'solver_status': result['status'], 'accepted_steps': result['accepted_steps'],
              'final_losses': result['history'][-1], 'true_depth_validation': None}
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    (output/'explanation.md').write_text(
        '# 这张图的数学解释\n\n'
        f"图像由 {problem.nz} 个连续曲面系数与 {problem.na} 个对数材料系数构造。"
        '法向来自曲面的解析导数；换光照图使用同一个曲面和材料函数重新计算。\n\n'
        f"光照方向是外部给定的假设 {list(args.light)}；额外几何曲线 {len(curves)} 条。"
        f"有效像素上的线性亮度 RMSE 为 {report['valid_pixel_linear_rmse']:.5f}。"
        f"优化接受了 {result['accepted_steps']} 次下降步骤，停止原因：{result['status']}。\n\n"
        '这是一种符合平滑先验的浅浮雕解释，未验证真实深度；肤色、头发、高光、投射阴影都可能被误解为几何。'
        f"本次高度范围为 {report['height_range'][0]:.3f} 到 {report['height_range'][1]:.3f}（图像横向宽度为 2）；"
        '数值过大的起伏可能偏离浅浮雕的使用范围，不能因为优化停止就接受该几何。'
        '该误差不衡量肖像相似度或美感。没有自动识别人脸器官，也没有从普通图像边界推断高度观测。'
        '输出分辨率来自连续函数的新采样，不代表恢复了额外细节。\n')
    print(json.dumps(report, indent=2))
    return model, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--light', nargs=3, type=float, required=True, metavar=('X','Y','Z'))
    parser.add_argument('--new-light', nargs=3, type=float, default=[-.65, .3, 1.])
    parser.add_argument('--size', type=int, default=49)
    parser.add_argument('--basis', type=int, default=8)
    parser.add_argument('--render-size', type=int, default=320)
    parser.add_argument('--curves', type=Path, help='JSON array of declared external geometric observations')
    run(parser.parse_args())
