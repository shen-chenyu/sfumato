"""Numerical/physical checks; run with python -m unittest discover here."""
import json
import unittest
import numpy as np
from model import (Settings, SurfaceProblem, basis_1d, basis_2d, grid,
                   evaluate_model, lift_curve, shading, principal_geometry)


class SurfaceTests(unittest.TestCase):
    def test_partition_and_analytic_derivatives_including_endpoints(self):
        x = np.linspace(-1, 1, 53)
        b, d, dd = basis_1d(x)
        np.testing.assert_allclose(b.sum(axis=1), 1, atol=2e-15)
        np.testing.assert_allclose(d.sum(axis=1), 0, atol=2e-14)
        np.testing.assert_allclose(dd.sum(axis=1), 0, atol=2e-13)
        h = 1e-5
        bi, di, ddi = basis_1d(x[1:-1])
        bp, dp, _ = basis_1d(x[1:-1] + h)
        bm, dm, _ = basis_1d(x[1:-1] - h)
        np.testing.assert_allclose((bp - bm) / (2*h), di, atol=2e-8)
        np.testing.assert_allclose((dp - dm) / (2*h), ddi, atol=2e-7)
        # One-sided derivative limits at clamped endpoints.
        np.testing.assert_allclose((basis_1d([-1+h])[0] - b[:1]) / h, d[:1], atol=4e-4)
        np.testing.assert_allclose((b[-1:] - basis_1d([1-h])[0]) / h, d[-1:], atol=4e-4)

    def test_cubic_polynomial_and_integrability(self):
        pts = grid(19)
        x, y = pts.T
        B, Bx, By, Bxx, Bxy, Byy = basis_2d(pts)
        c = np.linalg.lstsq(B, x**3 + x*y + .3*y**2, rcond=None)[0]
        np.testing.assert_allclose(Bx@c, 3*x*x+y, atol=1e-12)
        np.testing.assert_allclose(By@c, x+.6*y, atol=1e-12)
        np.testing.assert_allclose(Bxx@c, 6*x, atol=1e-11)
        np.testing.assert_allclose(Bxy@c, 1, atol=1e-11)
        np.testing.assert_allclose(Byy@c, .6, atol=1e-11)

    def test_photometric_jacobian(self):
        rng = np.random.default_rng(5)
        problem = SurfaceProblem(grid(13), np.full(169, .5), [.4, -.3, 1])
        theta = rng.normal(0, .015, problem.nz + problem.na)
        theta[problem.nz:] -= .5
        _, J = problem.prediction(theta, True)
        direction = rng.normal(size=len(theta))
        eps = 1e-6
        difference = (problem.prediction(theta + eps*direction) - problem.prediction(theta - eps*direction)) / (2*eps)
        np.testing.assert_allclose(J@direction, difference, atol=1e-7)

    def test_shadow_branch_jacobian(self):
        s, sp, sq = shading(np.array([4.]), np.array([0.]), [1, 0, .1])
        np.testing.assert_allclose([s[0], sp[0], sq[0]], [.08, 0, 0])

    def test_calibrated_plane_and_json_replay(self):
        pts = grid(17)
        light = [.5, -.3, 1]
        intensity = .6 * shading(np.zeros(len(pts)), np.zeros(len(pts)), light)[0]
        problem = SurfaceProblem(pts, intensity, light, known_reflectance=.6)
        result = problem.solve()
        model = json.loads(json.dumps(problem.export(result)))
        field = evaluate_model(model, pts)
        np.testing.assert_allclose(field['height'], 0, atol=1e-12)
        np.testing.assert_allclose(field['intensity'], intensity, atol=1e-12)
        self.assertEqual(result['status'], 'stationary')

    def test_curve_lift_chain_rule_and_consistent_intersections(self):
        pts = grid(15)
        problem = SurfaceProblem(pts, np.full(len(pts), .5), [.2, .3, 1], known_reflectance=.6)
        result = problem.solve()
        model = problem.export(result)
        B, *_ = basis_2d(pts)
        model['surface_coefficients'] = np.linalg.lstsq(B, pts[:, 0]**2+.3*pts[:, 1], rcond=None)[0].tolist()
        t = np.linspace(-.8, .8, 19)
        curve = np.c_[t, .4*t**2]
        tangent = np.c_[np.ones(len(t)), .8*t]
        lifted, derivative = lift_curve(model, curve, tangent)
        np.testing.assert_allclose(lifted[:, 2], 1.12*t**2, atol=1e-12)
        np.testing.assert_allclose(derivative[:, 2], 2.24*t, atol=1e-12)
        a, _ = lift_curve(model, [[0, 0]], [[1, 0]])
        b, _ = lift_curve(model, [[0, 0]], [[0, 1]])
        np.testing.assert_array_equal(a, b)

    def test_known_material_is_not_depth(self):
        pts = grid(19)
        rho = np.where(pts[:, 0] > .1, .4, .7)
        light = [.5, .3, 1]
        image = rho * shading(np.zeros(len(pts)), np.zeros(len(pts)), light)[0]
        problem = SurfaceProblem(pts, image, light, known_reflectance=rho)
        result = problem.solve()
        np.testing.assert_allclose(result['theta'], 0, atol=1e-12)
        with self.assertRaises(ValueError):
            problem.export(result)  # A known spatial material needs its own representation.

    def test_gbr_ambiguity_with_zero_ambient(self):
        # Exact Lambertian counterexample including the normal-dependent albedo.
        pts = grid(23)
        p, q = .2*pts[:, 0], -.15*pts[:, 1]
        light = np.array([.3, -.4, 1.]); light /= np.linalg.norm(light)
        lam, mu, nu = 1.8, .12, -.1
        pp, qq = lam*p+mu, lam*q+nu
        unnormalized = np.array([light[0]/lam, light[1]/lam,
                                 light[2]+(mu*light[0]+nu*light[1])/lam])
        light2 = unnormalized / np.linalg.norm(unnormalized)
        rho2 = .5*np.linalg.norm(unnormalized)*np.sqrt(1+pp**2+qq**2)/np.sqrt(1+p**2+q**2)
        image1 = .5*shading(p, q, light, ambient=0)[0]
        image2 = rho2*shading(pp, qq, light2, ambient=0)[0]
        np.testing.assert_allclose(image1, image2, atol=2e-16)

    def test_curved_solve_generalizes_to_new_light_and_points(self):
        from study import truth, observations, LIGHT, NEW_LIGHT, RHO, rmse
        pts, check = grid(31), grid(46)
        _, p, q = truth(pts, 'dome')
        problem = SurfaceProblem(pts, RHO*shading(p, q, LIGHT)[0], LIGHT,
                                 known_reflectance=RHO, curves=observations('dome'))
        result = problem.solve()
        model = json.loads(json.dumps(problem.export(result)))
        fields = evaluate_model(model, check, NEW_LIGHT)
        z, p, q = truth(check, 'dome')
        self.assertLess(rmse(fields['height'], z), .001)
        self.assertLess(rmse(fields['intensity'], RHO*shading(p, q, NEW_LIGHT)[0]), .002)
        self.assertGreater(result['accepted_steps'], 0)
        self.assertTrue(all(a['total'] > b['total'] for a,b in zip(result['history'],result['history'][1:])))

    def test_directional_slope_observation(self):
        pts = grid(19)
        slope = .12
        light = [.4, .3, 1]
        image = .6*shading(np.full(len(pts), slope), np.zeros(len(pts)), light)[0]
        curve = {'kind': 'cross_slope', 'points': [[0,-1],[0,0],[0,1]],
                 'directions': [[1,0]]*3, 'values': [slope]*3}
        problem = SurfaceProblem(pts, image, light, known_reflectance=.6, curves=[curve])
        fields = evaluate_model(problem.export(problem.solve()), pts)
        np.testing.assert_allclose(fields['p'], slope, atol=1e-4)
        np.testing.assert_allclose(fields['q'], 0, atol=1e-4)

    def test_principal_curvature_uses_metric_and_umbilic_is_undefined(self):
        # Parabolic cylinder z=x^2/2: k=1/(1+x^2)^(3/2), 0, not 1, 0.
        p = np.array([0., .5, 1.])
        fields = {'p': p, 'q': p*0, 'zxx': p*0+1, 'zxy': p*0, 'zyy': p*0}
        geometry = principal_geometry(fields)
        np.testing.assert_allclose(geometry['curvatures'][:, 1], 1/(1+p*p)**1.5, atol=1e-14)
        np.testing.assert_allclose(geometry['curvatures'][:, 0], 0, atol=1e-14)
        self.assertTrue(np.all(geometry['direction_defined']))
        # At the center of z=(x^2+y^2)/2, every tangent is a principal direction.
        fields = {key: np.array([0.]) for key in ['p','q','zxy']}
        fields.update(zxx=np.array([1.]), zyy=np.array([1.]))
        self.assertFalse(principal_geometry(fields)['direction_defined'][0])

    def test_chunked_sampling_matches_direct_sampling(self):
        pts = grid(17)
        problem = SurfaceProblem(pts, np.full(len(pts), .5), [.4,.3,1])
        model = problem.export(problem.solve())
        check = grid(67)
        all_fields = evaluate_model(model, check)
        direct_fields = evaluate_model(model, check[4000:4200])
        for key in all_fields:
            np.testing.assert_allclose(all_fields[key][4000:4200], direct_fields[key], atol=1e-13)

    def test_photo_preprocessing_uses_linear_intensity_and_records_crop(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from fit import prepare_image
        with TemporaryDirectory() as folder:
            path = Path(folder)/'gray.png'
            Image.new('RGBA', (6,4), (128,128,128,255)).save(path)
            intensity, metadata = prepare_image(path, 17)
            np.testing.assert_allclose(intensity, ((128/255+.055)/1.055)**2.4, atol=1e-7)
            self.assertEqual(metadata['center_square_crop'], [1,0,5,4])
            Image.new('RGBA', (6,4), (0,0,0,0)).save(path)
            intensity, _ = prepare_image(path, 17)
            np.testing.assert_allclose(intensity, 1, atol=1e-7)


if __name__ == '__main__':
    unittest.main()
