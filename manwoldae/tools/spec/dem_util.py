import numpy as np, math, os
_HERE = os.path.dirname(os.path.abspath(__file__))
_M = np.load(os.path.join(_HERE, 'env', 'terr13.npy'))
_ZOOM = 13
_X0, _Y0 = 6974, 3158
LAT0, LON0 = 37.98530, 126.54325
MLAT = 110996.2
MLON = 87850.08
DATUM = 58.0
ROT = math.radians(17.0)
C17, S17 = math.cos(ROT), math.sin(ROT)


def _h_latlon(lat, lon):
    n = 2 ** _ZOOM
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    px = (x - _X0) * 256 - 0.5
    py = (y - _Y0) * 256 - 0.5
    i0, j0 = int(math.floor(px)), int(math.floor(py))
    fx, fy = px - i0, py - j0
    M = _M
    return (M[j0, i0] * (1 - fx) * (1 - fy) + M[j0, i0 + 1] * fx * (1 - fy)
            + M[j0 + 1, i0] * (1 - fx) * fy + M[j0 + 1, i0 + 1] * fx * fy)


def true_asl(xt, zt):
    """true frame: x east, z south (m) from origin"""
    return float(_h_latlon(LAT0 - zt / MLAT, LON0 + xt / MLON))


def plan2true(xp, zp):
    return C17 * xp + S17 * zp, -S17 * xp + C17 * zp


def true2plan(xt, zt):
    return C17 * xt - S17 * zt, S17 * xt + C17 * zt


SUMMIT = (60.0, -2150.0, 28.0, 160.0)  # plan x, z, amplitude m, sigma m


def plan_y(xp, zp, summit=True):
    xt, zt = plan2true(xp, zp)
    y = true_asl(xt, zt) - DATUM
    if summit:
        sx, sz, a, sg = SUMMIT
        d2 = (xp - sx) ** 2 + (zp - sz) ** 2
        y += a * math.exp(-d2 / (2 * sg * sg))
    return y
