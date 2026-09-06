"""Continuous, integrable 2.5D inverse-rendering experiment. NumPy only.

All coordinates are in [-1, 1]. Lighting and optional geometric observations
are supplied, never inferred from an image edge's location or brightness.
"""
from dataclasses import asdict, dataclass
import numpy as np


def basis_1d(x, count=8):
    """Open-uniform cubic B-splines and analytic first/second derivatives."""
    x = np.asarray(x, dtype=float).reshape(-1)
    if count < 4 or not np.all(np.isfinite(x)) or np.any(np.abs(x) > 1 + 1e-12):
        raise ValueError("Cubic basis needs count >= 4 and finite coordinates in [-1, 1]")
    u = np.minimum(np.clip((x + 1) / 2, 0, 1), np.nextafter(1., 0.))
    knots = np.r_[np.zeros(4), np.arange(1, count - 3) / (count - 3), np.ones(4)]
    b = ((u[:, None] >= knots[:-1]) & (u[:, None] < knots[1:])).astype(float)
    d, dd = np.zeros_like(b), np.zeros_like(b)
    for degree in range(1, 4):
        width = len(knots) - degree - 1
        nb, nd, ndd = (np.zeros((len(x), width)) for _ in range(3))
        for i in range(width):
            left, right = knots[i + degree] - knots[i], knots[i + degree + 1] - knots[i + 1]
            if left:
                nb[:, i] += (u - knots[i]) / left * b[:, i]
                nd[:, i] += degree / left * b[:, i]
                ndd[:, i] += degree / left * d[:, i]
            if right:
                nb[:, i] += (knots[i + degree + 1] - u) / right * b[:, i + 1]
                nd[:, i] -= degree / right * b[:, i + 1]
                ndd[:, i] -= degree / right * d[:, i + 1]
        b, d, dd = nb, nd, ndd
    return b, d / 2, dd / 4


def basis_2d(points, count=8):
    points = np.asarray(points, dtype=float)
    x, dx, ddx = basis_1d(points[:, 0], count)
    y, dy, ddy = basis_1d(points[:, 1], count)
    def product(a, b):
        return np.einsum("ni,nj->nij", a, b).reshape(len(points), -1)
    return tuple(product(a, b) for a, b in
                 [(x, y), (dx, y), (x, dy), (ddx, y), (dx, dy), (x, ddy)])


def grid(size):
    x, y = np.meshgrid(np.linspace(-1, 1, size), np.linspace(-1, 1, size))
    return np.c_[x.ravel(), y.ravel()]


def unit_light(light):
    light = np.asarray(light, dtype=float)
    if light.shape != (3,) or not np.all(np.isfinite(light)) or np.linalg.norm(light) == 0:
        raise ValueError("Light must be a finite nonzero 3-vector")
    return light / np.linalg.norm(light)


def shading(p, q, light, ambient=.08):
    light = unit_light(light)
    d = np.sqrt(1 + p * p + q * q)
    b = light[2] - light[0] * p - light[1] * q
    lit = b > 0
    s = ambient + np.maximum(b / d, 0)
    sp = np.where(lit, -light[0] / d - b * p / d**3, 0.)
    sq = np.where(lit, -light[1] / d - b * q / d**3, 0.)
    return s, sp, sq


@dataclass
class Settings:
    surface_count: int = 8
    reflectance_count: int = 4
    bending: float = 2e-5
    reflectance_smoothness: float = .02
    slope_penalty: float = 1e-7
    gauge_weight: float = 1.
    curve_weight: float = 10.
    ambient: float = .08
    max_iterations: int = 100


class SurfaceProblem:
    """Fixed-light, positive-reflectance fitting with explicit curve observations.

    Curves support height z(C)=h and directional slope grad(z)(C) dot m=g.
    Sample weights are normalized per curve, so increasing sampling density
    does not automatically strengthen a geometric observation.
    """
    def __init__(self, points, intensity, light, settings=None,
                 known_reflectance=None, curves=()):
        self.settings = settings or Settings()
        cfg = self.settings
        if cfg.ambient <= 0 or min(cfg.bending, cfg.reflectance_smoothness,
                                  cfg.slope_penalty, cfg.gauge_weight, cfg.curve_weight) < 0:
            raise ValueError("Ambient must be positive and penalty weights nonnegative")
        self.points = np.asarray(points, dtype=float)
        self.target = np.asarray(intensity, dtype=float).reshape(-1)
        if len(self.target) != len(points) or np.any(self.target <= 0) or not np.all(np.isfinite(self.target)):
            raise ValueError("Use finite, positive linear intensities (mask invalid/shadow pixels first)")
        self.light = unit_light(light)
        self.B, self.Bx, self.By, self.Bxx, self.Bxy, self.Byy = basis_2d(points, cfg.surface_count)
        self.nz = cfg.surface_count**2
        if known_reflectance is None:
            self.A, self.Ax, self.Ay, *_ = basis_2d(points, cfg.reflectance_count)
            self.log_rho = np.zeros(len(points))
        else:
            rho = np.broadcast_to(np.asarray(known_reflectance, dtype=float), self.target.shape)
            if np.any(rho <= 0) or not np.all(np.isfinite(rho)):
                raise ValueError("Known reflectance must be positive and finite")
            self.log_rho = np.log(rho)
            self.A = self.Ax = self.Ay = np.zeros((len(points), 0))
        self.na = self.A.shape[1]
        self.curves = list(curves)
        self.priors = {}
        def add(name, matrix, rhs, weight):
            matrix = np.asarray(matrix)
            self.priors[name] = (matrix, np.broadcast_to(rhs, (len(matrix),)).copy(), weight / len(matrix))
        def embed(matrix, reflectance=False):
            out = np.zeros((len(matrix), self.nz + self.na))
            out[:, self.nz if reflectance else 0 : None if reflectance else self.nz] = matrix
            return out
        # Uniform quadrature makes priors independent of the observation mask.
        b, bx, by, bxx, bxy, byy = basis_2d(grid(25), cfg.surface_count)
        add("bending", embed(np.vstack([bxx, np.sqrt(2) * bxy, byy])), 0., 3 * cfg.bending)
        add("slope", embed(np.vstack([bx, by])), 0., 2 * cfg.slope_penalty)
        # Omit height gauge when absolute-height observations already fix it.
        if not any(c["kind"] == "height" for c in self.curves):
            add("height_gauge", embed(b.mean(axis=0, keepdims=True)), 0., cfg.gauge_weight)
        if self.na:
            _, ax, ay, *_ = basis_2d(grid(25), cfg.reflectance_count)
            add("reflectance_smoothness", embed(np.vstack([ax, ay]), True), 0., 2 * cfg.reflectance_smoothness)
        for i, curve in enumerate(self.curves):
            cb, cx, cy, *_ = basis_2d(curve["points"], cfg.surface_count)
            if curve["kind"] == "height":
                matrix = cb
            elif curve["kind"] == "cross_slope":
                direction = np.asarray(curve["directions"], dtype=float)
                if direction.shape != (len(cb), 2) or not np.all(np.isfinite(direction)):
                    raise ValueError("Cross-slope observations require finite 2D directions")
                if not np.allclose(np.linalg.norm(direction, axis=1), 1):
                    raise ValueError("Cross-slope directions must be unit vectors")
                matrix = direction[:, :1] * cx + direction[:, 1:] * cy
            else:
                raise ValueError("Curve kind must be height or cross_slope")
            values = np.asarray(curve["values"], dtype=float)
            if not np.all(np.isfinite(values)):
                raise ValueError("Curve observations must be finite")
            add(f"curve_{i}", embed(matrix), values, cfg.curve_weight)
        n = self.nz + self.na
        self.Q, self.linear = np.zeros((n, n)), np.zeros(n)
        for matrix, rhs, weight in self.priors.values():
            self.Q += weight * matrix.T @ matrix
            self.linear += weight * matrix.T @ rhs

    def prediction(self, theta, jacobian=False):
        p, q = self.Bx @ theta[:self.nz], self.By @ theta[:self.nz]
        s, sp, sq = shading(p, q, self.light, self.settings.ambient)
        log_prediction = self.log_rho + self.A @ theta[self.nz:] + np.log(s)
        if not jacobian:
            return log_prediction
        J = np.c_[sp[:, None] / s[:, None] * self.Bx + sq[:, None] / s[:, None] * self.By, self.A]
        return log_prediction, J

    def losses(self, theta):
        losses = {"photometric": float(np.mean((self.prediction(theta) - np.log(self.target))**2))}
        for name, (matrix, rhs, weight) in self.priors.items():
            losses[name] = float(weight * np.sum((matrix @ theta - rhs)**2))
        losses["total"] = sum(losses.values())
        return losses

    def solve(self):
        theta = np.zeros(self.nz + self.na)
        if self.na:
            theta[self.nz:] = np.mean(np.log(self.target) - np.log(self.settings.ambient + max(self.light[2], 0)))
        history = [self.losses(theta)]
        damping, status = 1e-3, "iteration_limit"
        for iteration in range(self.settings.max_iterations):
            prediction, J = self.prediction(theta, jacobian=True)
            residual = prediction - np.log(self.target)
            H = J.T @ J / len(J) + self.Q
            gradient = J.T @ residual / len(J) + self.Q @ theta - self.linear
            if np.max(np.abs(gradient)) < 1e-9:
                status = "stationary"
                break
            accepted = False
            for attempt in range(14):
                step = np.linalg.solve(H + damping * np.diag(np.maximum(np.diag(H), 1e-6)), -gradient)
                candidate = theta + step
                loss = self.losses(candidate)
                if np.isfinite(loss["total"]) and loss["total"] < history[-1]["total"]:
                    improvement = history[-1]["total"] - loss["total"]
                    theta = candidate
                    history.append(loss)
                    damping = max(damping / 3, 1e-10)
                    accepted = True
                    if improvement < 1e-11 * max(1., history[-2]["total"]):
                        status = "small_objective_change"
                    break
                damping *= 5
            if not accepted:
                status = "no_descent_step"
                break
            if status == "small_objective_change":
                break
        return {"theta": theta, "history": history, "status": status,
                "accepted_steps": len(history) - 1}

    def export(self, result):
        # Known spatial reflectance is an external field, not spline coefficients.
        if self.na == 0 and not np.allclose(self.log_rho, self.log_rho[0], rtol=0, atol=1e-12):
            raise ValueError("Cannot export a spatially known reflectance field as a constant")
        return {"version": "sfumato-surface-1", "domain": [-1, 1],
                "surface_basis": "open_uniform_cubic_tensor_bspline",
                "settings": asdict(self.settings), "light": self.light.tolist(),
                "surface_coefficients": result["theta"][:self.nz].tolist(),
                "log_reflectance_coefficients": result["theta"][self.nz:].tolist(),
                "known_constant_reflectance": None if self.na else float(np.exp(self.log_rho[0])),
                "curve_observations": self.curves, "solver_status": result["status"],
                "history": result["history"],
                "scope": "One regularized height-field hypothesis under supplied lighting and curve observations; not identified anatomy or true depth."}


def evaluate_model(model, points, light=None):
    """Evaluate the exported continuous construction at any requested points."""
    points = np.asarray(points, dtype=float)
    if len(points) > 4096:
        chunks = [evaluate_model(model, points[i:i+4096], light) for i in range(0, len(points), 4096)]
        return {key: np.concatenate([chunk[key] for chunk in chunks]) for key in chunks[0]}
    if model["version"] != "sfumato-surface-1":
        raise ValueError("Unsupported surface model version")
    cfg = model["settings"]
    B, Bx, By, Bxx, Bxy, Byy = basis_2d(points, cfg["surface_count"])
    c = np.asarray(model["surface_coefficients"])
    z, p, q = B @ c, Bx @ c, By @ c
    if model["known_constant_reflectance"] is not None:
        rho = np.full(len(points), model["known_constant_reflectance"])
    else:
        A, *_ = basis_2d(points, cfg["reflectance_count"])
        rho = np.exp(A @ np.asarray(model["log_reflectance_coefficients"]))
    normal = np.c_[-p, -q, np.ones(len(p))]
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    return {"height": z, "p": p, "q": q, "normal": normal, "reflectance": rho,
            "zxx": Bxx @ c, "zxy": Bxy @ c, "zyy": Byy @ c,
            "intensity": rho * shading(p, q, model["light"] if light is None else light, cfg["ambient"])[0]}


def lift_curve(model, points, tangents):
    """Lift a supplied image curve and differentiate by the chain rule."""
    fields = evaluate_model(model, points)
    tangents = np.asarray(tangents)
    return (np.c_[points, fields["height"]],
            np.c_[tangents, fields["p"] * tangents[:, 0] + fields["q"] * tangents[:, 1]])


def principal_geometry(fields):
    """Actual graph-surface principal curvatures, not Hessian eigenvalues.

    Solve II v = k I v using the symmetric I^{-1/2} II I^{-1/2}.
    The returned direction is a line (either sign is valid). It is undefined
    at an umbilic, marked by the eigenvalue gap rather than invented there.
    """
    p, q = fields['p'], fields['q']
    first = np.empty((len(p), 2, 2))
    first[:, 0, 0], first[:, 1, 1] = 1+p*p, 1+q*q
    first[:, 0, 1] = first[:, 1, 0] = p*q
    second = np.empty_like(first)
    second[:, 0, 0], second[:, 1, 1] = fields['zxx'], fields['zyy']
    second[:, 0, 1] = second[:, 1, 0] = fields['zxy']
    second /= np.sqrt(1+p*p+q*q)[:, None, None]
    eigenvalue, eigenvector = np.linalg.eigh(first)
    inverse_sqrt = (eigenvector / np.sqrt(eigenvalue)[:, None, :]) @ eigenvector.transpose(0, 2, 1)
    symmetric = inverse_sqrt @ second @ inverse_sqrt
    curvature, vectors = np.linalg.eigh(symmetric)
    directions = inverse_sqrt @ vectors
    directions /= np.linalg.norm(directions, axis=1)[:, None, :]
    gap = curvature[:, 1] - curvature[:, 0]
    return {'curvatures': curvature, 'directions': directions,
            'direction_defined': gap > 1e-6*np.maximum(1., np.max(np.abs(curvature), axis=1)),
            'gaussian_curvature': np.prod(curvature, axis=1),
            'mean_curvature': curvature.mean(axis=1)}
