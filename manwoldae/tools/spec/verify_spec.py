import json, math
from collections import deque
d = json.load(open('spec.json', encoding='utf-8'))
T = {t['id']: t for t in d['terraces']}; Bd = {b['id']: b for b in d['buildings']}
S = {s['id']: s for s in d['stairs']}; C = {c['id']: c for c in d['corridors']}; W = {w['id']: w for w in d['walls']}
def rot(u, v, r): r = math.radians(r); return (u*math.cos(r)-v*math.sin(r), u*math.sin(r)+v*math.cos(r))
def rect(cx, cz, w, dd, r): return [(cx+a, cz+b) for a, b in (rot(su*w/2, sv*dd/2, r) for su, sv in ((-1,-1),(1,-1),(1,1),(-1,1)))]
def sep(A, B):
    best = -1e9
    for P in (A, B):
        for i in range(len(P)):
            x1, z1 = P[i]; x2, z2 = P[(i+1) % len(P)]; nx, nz = -(z2-z1), x2-x1; L = math.hypot(nx, nz); nx /= L; nz /= L
            pa = [q[0]*nx+q[1]*nz for q in A]; pb = [q[0]*nx+q[1]*nz for q in B]
            best = max(best, min(pb)-max(pa), min(pa)-max(pb))
    return best
def seg_rect(p1, p2, w):
    dx, dz = p2[0]-p1[0], p2[1]-p1[1]; L = math.hypot(dx, dz); nx, nz = -dz/L*w/2, dx/L*w/2
    return [(p1[0]+nx, p1[1]+nz), (p2[0]+nx, p2[1]+nz), (p2[0]-nx, p2[1]-nz), (p1[0]-nx, p1[1]-nz)]
bp = lambda b: rect(b['cx'], b['cz'], b['platformW'], b['platformD'], b['rotationDeg'])
tb = lambda t: (t['cx']-t['w']/2, t['cx']+t['w']/2, t['cz']-t['d']/2, t['cz']+t['d']/2)
out = []
# 1 janghwa wings
for w in ('janghwa_seomu', 'janghwa_dongmu'):
    out.append(f"{w} rot {Bd[w]['rotationDeg']} c=({Bd[w]['cx']},{Bd[w]['cz']}) gap to main {sep(bp(Bd[w]), bp(Bd['janghwajeon'])):.2f}, to corridors {min(sep(bp(Bd[w]), seg_rect(p1,p2,c['width'])) for c in C.values() if c['id'].startswith('jh_u') for p1,p2 in zip(c['path'],c['path'][1:])):.2f}")
# 2 gates in corridor lines
for g, cs in (('w5_gate', ('jh_u', 'jh_u_2')), ('janghwa_bukmun', ('jh_u_2', 'jh_u_3')), ('janghwajeonmun', ('jh_s_w', 'jh_s_e'))):
    seps = [min(sep(bp(Bd[g]), seg_rect(p1, p2, C[c]['width'])) for p1, p2 in zip(C[c]['path'], C[c]['path'][1:])) for c in cs]
    out.append(f"{g} vs {cs}: {[round(x, 3) for x in seps]}")
# 3 raster walk in janghwa compound: from janghwajeonmun south landing to wondeok stair foot and to w5 stair top
t = T['janghwa']; x0, x1, z0, z1 = tb(t); st = 0.25
obst = []
for c in C.values():
    if c['terraceId'] != 'janghwa': continue
    for p1, p2 in zip(c['path'], c['path'][1:]): obst.append(seg_rect(p1, p2, c['width']))
gates = {b['id'] for b in d['buildings'] if b['kind'] in ('gate', 'gatehouse')}
for b in d['buildings']:
    if b['terraceId'] == 'janghwa' and b['id'] not in gates: obst.append(bp(b))
gatepolys = [bp(Bd[g]) for g in gates if Bd[g]['terraceId'] == 'janghwa']
def pip(p, P):
    x, z = p; ins = False
    for i in range(len(P)):
        xa, za = P[i]; xb, zb = P[(i+1) % len(P)]
        if (za > z) != (zb > z) and x < xa + (z-za)*(xb-xa)/(zb-za): ins = not ins
    return ins
nx = int((x1-x0)/st); nz = int((z1-z0)/st)
free = [[True]*nx for _ in range(nz)]
for j in range(nz):
    for i in range(nx):
        p = (x0+(i+.5)*st, z0+(j+.5)*st)
        if any(pip(p, G) for G in gatepolys): continue
        if any(pip(p, O) for O in obst): free[j][i] = False
def cell(x, z): return (int((z-z0)/st), int((x-x0)/st))
def bfs(a):
    q = deque([a]); seen = {a}
    while q:
        j, i = q.popleft()
        for dj, di in ((1,0),(-1,0),(0,1),(0,-1)):
            n = (j+dj, i+di)
            if 0 <= n[0] < nz and 0 <= n[1] < nx and n not in seen and free[n[0]][n[1]]: seen.add(n); q.append(n)
    return seen
court = bfs(cell(28.0, -92.0 + 30))   # inside courtyard south of main hall
s = S['st_wondeok']; foot = (s['cx'], s['cz'] + s['run']/2 - 0.3)   # just inside terrace edge? foot is on lower terrace (janghwa)
foot = (s['cx'], s['cz'] + s['run']/2 + 0.3)
w5 = S['st_w5']; w5top = (w5['cx'] + w5['run']/2 + 0.3, w5['cz'])
lw = S['st_link_w']; lwtop = (lw['cx'], lw['cz'] - lw['run']/2 - 0.3)
out.append(f"courtyard reaches wondeok stair foot: {cell(*foot) in court}; w5 stair top: {cell(*w5top) in court}; link_w stair top: {cell(*lwtop) in court}")
# 4 stairs arithmetic
bad = [s['id'] for s in d['stairs'] if abs(s['riser']*s['steps']-(s['topY']-s['bottomY'])) > 0.003 or abs(s['tread']*s['steps']-s['run']) > 0.003]
out.append(f"stairs with rounding leftovers: {bad}; riser range {min(s['riser'] for s in d['stairs'])}-{max(s['riser'] for s in d['stairs'])}")
# 5 terrace cracks/overlaps
tl = list(T.values()); issues = []
for i in range(len(tl)):
    for j in range(i+1, len(tl)):
        a, b = tb(tl[i]), tb(tl[j])
        ox = min(a[1], b[1]) - max(a[0], b[0]); oz = min(a[3], b[3]) - max(a[2], b[2])
        if ox > 1e-6 and oz > 1e-6: issues.append(('overlap', tl[i]['id'], tl[j]['id']))
        if (1e-6 < -ox < 0.05 and oz > 0) or (1e-6 < -oz < 0.05 and ox > 0): issues.append(('crack', tl[i]['id'], tl[j]['id']))
out.append(f"terrace overlaps/cracks: {issues}")
# 6 hwangseong vs naseong
def segx(p1, p2, p3, p4):
    (xa, za), (xb, zb), (xc, zc), (xd, zd) = p1, p2, p3, p4
    den = (xb-xa)*(zd-zc)-(zb-za)*(xd-xc)
    if abs(den) < 1e-12: return None
    t_ = ((xc-xa)*(zd-zc)-(zc-za)*(xd-xc))/den; u_ = ((xc-xa)*(zb-za)-(zc-za)*(xb-xa))/den
    return (xa+t_*(xb-xa), za+t_*(zb-za)) if 0 <= t_ <= 1 and 0 <= u_ <= 1 else None
hw = W['hwangseong']['path']; ns = W['naseong']['path']
cr = [q for a, b in zip(hw, hw[1:]+[hw[0]]) for c_, e in zip(ns, ns[1:]+[ns[0]]) for q in [segx(a, b, c_, e)] if q]
out.append(f"hwangseong x naseong crossings: {len(cr)}; vertices outside: {sum(not pip(q, ns) for q in hw)}")
out.append("waterGates: " + str({k: W[k].get('waterGates') for k in ('gungseong', 'hwangseong', 'naseong')}))
# 7 palace polygon area/perimeter
g = W['gungseong']['path']; poly = g[1:-1]
A = abs(sum(poly[i][0]*poly[(i+1) % len(poly)][1]-poly[(i+1) % len(poly)][0]*poly[i][1] for i in range(len(poly))))/2
per = sum(math.dist(poly[i], poly[(i+1) % len(poly)]) for i in range(len(poly)))
out.append(f"gungseong area {A:,.0f} m2 perimeter {per:,.0f} m")
# 8 stream carve vs terraces inside palace
st0 = d['terrain']['streams'][0]; mind = 1e9
for p1, p2 in zip(st0['path'], st0['path'][1:]):
    for k in range(200):
        f = k/199; x = p1[0]+(p2[0]-p1[0])*f; z = p1[1]+(p2[1]-p1[1])*f
        if not pip((x, z), poly): continue
        for t_ in tl:
            a = tb(t_); dd = math.hypot(max(a[0]-x, 0, x-a[1]), max(a[2]-z, 0, z-a[3])); mind = min(mind, dd)
out.append(f"gwangmyeongcheon centerline min distance to terrace inside palace: {mind:.2f} (carve half {st0['width']/2+0.5})")
# 9 approach terrain profile
G = d['terrain']['heightGrids']
def sg(gr, x, z):
    fx = (x-gr['x0'])/gr['step']; fz = (z-gr['z0'])/gr['step']; i = int(math.floor(fx)); j = int(math.floor(fz))
    if not (0 <= i < gr['nx']-1 and 0 <= j < gr['nz']-1): return None
    tx, tz = fx-i, fz-j; v = gr['values']; n = gr['nx']
    return v[j*n+i]*(1-tx)*(1-tz)+v[j*n+i+1]*tx*(1-tz)+v[(j+1)*n+i]*(1-tx)*tz+v[(j+1)*n+i+1]*tx*tz
def rg(x, z):
    for k in ('palace', 'near', 'far'):
        y = sg(G[k], x, z)
        if y is not None: return y
out.append("approach x=-4: " + ", ".join(f"{z}:{rg(-4, z):.1f}" for z in range(290, 470, 20)))
out.append("approach x=45: " + ", ".join(f"{z}:{rg(45, z):.1f}" for z in range(290, 470, 20)))
# 10 landmarks
for lm in d['landmarks']:
    out.append(f"  landmark {lm['id']:18s} ({lm['x']},{lm['z']}) y {lm['y']} ground {rg(lm['x'], lm['z']):.1f}")
for p in d['terrain']['peaks']:
    gy = rg(p['x'], p['z']); out.append(f"  peak {p['id']:11s} height {p['height']} ground {gy if gy is None else round(gy,1)} lit {p['heightLiteratureY']}")
# 11 building overlap and on-terrace
for i, a in enumerate(d['buildings']):
    for b in d['buildings'][i+1:]:
        if sep(bp(a), bp(b)) < -0.02: out.append(f"BUILDING OVERLAP {a['id']} {b['id']}")
    x0_, x1_, z0_, z1_ = tb(T[a['terraceId']])
    for q in bp(a):
        if not (x0_-0.05 <= q[0] <= x1_+0.05 and z0_-0.05 <= q[1] <= z1_+0.05): out.append(f"OFF TERRACE {a['id']}")
# 12 ids
ids = [o['id'] for k in ('terraces','stairs','buildings','corridors','walls','bridges','ponds','landmarks') for o in d[k]]
out.append(f"scene ids {len(ids)} unique {len(set(ids))}; gates without doors {[b['id'] for b in d['buildings'] if b['kind'] in ('gate','gatehouse') and 'doors' not in b]}; roofTileColor values {set(b['roofTileColor'] for b in d['buildings'])}")
out.append(f"stories: seungpyeongmun {Bd['seungpyeongmun']['stories']}, sinbongmun {Bd['sinbongmun']['stories']}")
print("\n".join(out))
