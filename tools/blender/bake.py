# STEP 2 of the sculpt pipeline (Blender, headless): high-to-low.
#   Blender -b --factory-startup --python tools/blender/bake.py -- <build dir> <repo root> [set ...]
# Reads <build dir>/manifest.json (written by export_hi.mjs) and, per texture SET:
#   1. imports every piece's high poly (dense DC mesh, painted vertices) and low source
#   2. the lows arrive decimated and CHARTED (export_hi.mjs: QEM + axis charts — Smart UV
#      Project shredded the bumpy lows into islands at 0.20 coverage); Blender's concave
#      packer repacks every chart of the set into one atlas (0.27 -> 0.50)
#   4. bakes, per piece, high -> low with Cycles, selected-to-active through a cage:
#      tangent-space NORMAL (MikkTSpace, OpenGL +Y), AO, albedo (emission of the painted
#      vertex colour), roughness (emission of the vertex alpha)
#   5. writes <set>_albedo.webp (sRGB), <set>_normal.webp, <set>_orm.webp (R = AO,
#      G = roughness, B = 0; half resolution) and one <name>.glb with every low mesh
#      (normals, UVs, tangents; no materials — the game builds its own), plus <name>.json
#      (manifest meta, probes, stats).
# Deterministic given the PLYs (Decimate and Smart UV Project are deterministic).
#
# ADDITIVE (brooder2): ORM.B now carries CAVITY (0.5 flat, > 0.5 concave, < 0.5 convex),
# derived from the baked tangent-space normal map's divergence at two scales; the .json
# marks it (sets[s].ormB = 'cavity'), so a runtime that never reads B is unchanged.
# manifest.compress (optional, from the creature's pipeline().compress):
#   mesh: 'draco'  -> the .glb is Draco-compressed (three's DRACOLoader decodes it)
#   tex:  'ktx2'   -> raw RGBA8 dumps of every map land in the build dir for ktx2.mjs,
#                     which writes block-compressed KTX2 beside the WebP (kept as fallback)
import bpy, sys, os, json, math, time
import numpy as np
ORMB = {}   # set -> what ORM.B carries ('emit' | 'cavity')
WRINKLE = set()   # sets that carry a <set>_wrinkle normal map (additive, salSkin)

argv = sys.argv[sys.argv.index('--') + 1:]
BUILD, ROOT = argv[0], argv[1]
ONLY = set(argv[2:])
man = json.load(open(os.path.join(BUILD, 'manifest.json')))
OUT = os.path.join(ROOT, man['out'])
os.makedirs(OUT, exist_ok=True)
T0 = time.time()

def log(*a):
    print('[bake %6.1fs]' % (time.time() - T0), *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
    log('cycles device GPU', [d.name for d in prefs.devices if d.use])
except Exception as e:
    log('cycles device CPU', e)
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('bake')
scene.world = world
world.use_nodes = True

def deselect():
    for o in bpy.data.objects:
        if o.name in bpy.context.view_layer.objects:
            o.select_set(False)

def imp(fn, name):
    deselect()
    bpy.ops.wm.ply_import(filepath=os.path.join(BUILD, fn), forward_axis='Y', up_axis='Z')
    o = bpy.context.selected_objects[0]
    o.name = name
    o.data.name = name
    return o

def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True

def weld_normals(o):
    # the low arrives SPLIT along its UV seams (every chart its own island), so Blender's
    # vertex normals are computed per island and disagree across every seam: a shading line
    # along each chart edge, and a crack wherever a shader pushes along the normal (the
    # dress's corrective push / underwater balloon). Normals are taken from a welded copy
    # and set as custom normals BEFORE the bake, so the tangent frame the maps are baked in
    # is the one the game uses. (Additive: set config weldNormals: true.)
    import bmesh, mathutils
    import mathutils.kdtree
    me = bpy.data.meshes.new(o.name + '_weldN')
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(me)
    bm.free()
    kd = mathutils.kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co, i)
    kd.balance()
    vn = [me.vertex_normals[i].vector.copy() for i in range(len(me.vertices))]
    o.data.normals_split_custom_set_from_vertices([vn[kd.find(v.co)[1]] for v in o.data.vertices])
    bpy.data.meshes.remove(me)

def decimate(o, tris):
    n = len(o.data.polygons)
    if tris and n > tris:
        deselect()
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = tris / n
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    smooth(o)
    return len(o.data.polygons)

def new_img(name, size, noncolor):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return img

def box_blur(a, r):
    # separable box blur with wrap (charts sit in gutters; wrap never reaches an island)
    if r <= 0:
        return a
    k = 2 * r + 1
    c = np.cumsum(np.concatenate([a[:, -r - 1:], a, a[:, :r]], axis=1), axis=1)
    a = (c[:, k:] - c[:, :-k]) / k
    c = np.cumsum(np.concatenate([a[-r - 1:, :], a, a[:r, :]], axis=0), axis=0)
    return (c[k:, :] - c[:-k, :]) / k

def cavity_from_normal(npx, size):
    # divergence of the tangent-space normal's XY (OpenGL: +x along u, +y along v, rows
    # run with v): positive where the surface is convex. Fine scale + broad scale, then
    # normalised by a robust percentile so every set lands in the same range.
    n = npx.reshape(size, size, 4)
    nx = n[:, :, 0] * 2.0 - 1.0
    ny = n[:, :, 1] * 2.0 - 1.0
    div = 0.5 * (np.roll(nx, -1, 1) - np.roll(nx, 1, 1)) + 0.5 * (np.roll(ny, -1, 0) - np.roll(ny, 1, 0))
    s = max(1, size // 1024)
    d = 0.6 * box_blur(div, s) + 0.4 * box_blur(div, 6 * s) * 3.0
    q = float(np.percentile(np.abs(d), 98)) or 1.0
    cav = np.clip(0.5 - 0.45 * d / q, 0.0, 1.0)
    return cav.reshape(-1)

def push_pull(a, m):
    # fill every texel outside the charts (m == 0) from the charts around it: average down
    # a mip pyramid over the covered texels only, then pull the coarse colours back up into
    # the holes. Charts are untouched; the gutter becomes a smooth continuation of them, so
    # no mip level ever averages a chart edge with the empty (black) background.
    if m.all():
        return a
    lv = [(a * m[..., None], m.astype(np.float64))]
    while lv[-1][1].shape[0] > 1:
        c, w = lv[-1]
        h = c.shape[0] // 2
        c2 = c[:2 * h, :2 * h].reshape(h, 2, h, 2, -1).sum(axis=(1, 3))
        w2 = w[:2 * h, :2 * h].reshape(h, 2, h, 2).sum(axis=(1, 3))
        lv.append((c2, w2))
    col = lv[-1][0] / np.maximum(lv[-1][1], 1e-9)[..., None]
    for c, w in reversed(lv[:-1]):
        up = np.repeat(np.repeat(col, 2, axis=0), 2, axis=1)[:c.shape[0], :c.shape[1]]
        own = c / np.maximum(w, 1e-9)[..., None]
        col = np.where((w > 0)[..., None], own, up)
    return np.where(m[..., None] > 0, a, col)

def fill_img(img, size, mask):
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(size, size, 4)[..., :3].astype(np.float64)
    a = push_pull(a, mask)
    px.reshape(size, size, 4)[..., :3] = a
    img.pixels.foreach_set(px)

def dump_raw(img, path, w):
    # top-down RGBA8 rows (Blender stores bottom-up; the WebP is top-down), for ktx2.mjs
    px = np.empty(w * w * 4, np.float32)
    img.pixels.foreach_get(px)
    a = (np.clip(px, 0, 1) * 255 + 0.5).astype(np.uint8).reshape(w, w, 4)[::-1]
    a.tofile(path)

def save_webp(img, path, quality):
    img.filepath_raw = path
    img.file_format = 'WEBP'
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()
    return os.path.getsize(path)

stats = {'sets': {}, 'pieces': {}}
sets = man['sets']
all_lo = []
for set_name, sconf in sets.items():
    pieces = [p for p in man['pieces'] if p['set'] == set_name]
    if ONLY and set_name not in ONLY:
        continue
    size = sconf.get('size', 1024)
    gutter = sconf.get('gutter', 6)
    log('SET', set_name, size, [p['name'] for p in pieces])
    his, los = {}, {}
    for p in pieces:
        his[p['name']] = imp(p['hi'], p['name'] + '_hi')
        lo = imp(p['lo'], p['name'])       # decimated + unwrapped upstream (export_hi.mjs)
        smooth(lo)
        if sconf.get('weldNormals'):
            weld_normals(lo)
        los[p['name']] = lo
        stats['pieces'][p['name']] = {'lo': len(lo.data.polygons), 'hi': len(his[p['name']].data.polygons), 'uv': len(lo.data.uv_layers)}
        log(' ', p['name'], 'hi', len(his[p['name']].data.polygons), 'lo', len(lo.data.polygons), 'uv layers', len(lo.data.uv_layers))
    # ---- repack: the JS charts (clean, large, fold-free) go through Blender's concave
    # island packer, which fits irregular charts far tighter than a shelf of bounding boxes
    # (measured on the shell: 0.27 -> 0.50 of the atlas covered)
    deselect()
    for o in los.values():
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(los.values()))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=sconf.get('packMargin', 4) / size, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    log('  uv repacked')
    # ---- materials: the lows bake into an image node; the highs emit their paint
    tgt = bpy.data.materials.new('target_' + set_name)
    tgt.use_nodes = True
    tn = tgt.node_tree.nodes
    inode = tn.new('ShaderNodeTexImage')
    tn.active = inode
    inode.select = True
    for o in los.values():
        o.data.materials.clear()
        o.data.materials.append(tgt)
        # the low must never shadow or occlude the high it bakes from
        for k in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
            setattr(o, k, False)
    hmat = bpy.data.materials.new('hi_' + set_name)
    hmat.use_nodes = True
    hn, hl = hmat.node_tree.nodes, hmat.node_tree.links
    for nd in list(hn):
        hn.remove(nd)
    out = hn.new('ShaderNodeOutputMaterial')
    em = hn.new('ShaderNodeEmission')
    ca = hn.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    hl.new(em.outputs['Emission'], out.inputs['Surface'])
    for o in his.values():
        o.data.materials.clear()
        o.data.materials.append(hmat)
    imgs = {
        'albedo': new_img(set_name + '_albedo', size, False),
        'normal': new_img(set_name + '_normal', size, True),
        'ao': new_img(set_name + '_ao', size, True),
        'rough': new_img(set_name + '_rough', size, True),
    }
    passes = [('normal', 'NORMAL', 8), ('albedo', 'EMIT', 8), ('rough', 'EMIT', 8), ('ao', 'AO', sconf.get('aoSamples', 64))]
    world.light_settings.distance = sconf.get('aoDist', 0.12)
    for key, btype, spp in passes:
        tp = time.time()
        inode.image = imgs[key]
        scene.cycles.samples = spp
        for l in list(hl):
            if l.to_node == em and l.to_socket.name == 'Color':
                hl.remove(l)
        hl.new(ca.outputs['Alpha' if key == 'rough' else 'Color'], em.inputs['Color'])
        first = True
        for p in pieces:
            hi, lo = his[p['name']], los[p['name']]
            for o in bpy.context.view_layer.objects:
                o.hide_render = o not in (hi, lo)
            deselect()
            hi.select_set(True)
            lo.select_set(True)
            bpy.context.view_layer.objects.active = lo
            bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=p['cage'], max_ray_distance=p['ray'],
                                margin=gutter, margin_type='EXTEND', use_clear=first, target='IMAGE_TEXTURES',
                                normal_space='TANGENT')
            first = False
        log('  baked', key, '%.1fs' % (time.time() - tp))
    # ---- EMISSIVE (optional, additive): pieces whose export carried an emit paint
    # (<piece>_hiE.ply, the same high painted with the mask) bake it into the ORM's B.
    emit = None
    epieces = [p for p in pieces if p.get('hiE')]
    if epieces:
        tp = time.time()
        imgs['emit'] = new_img(set_name + '_emit', size, True)
        inode.image = imgs['emit']
        scene.cycles.samples = 8
        for l in list(hl):
            if l.to_node == em and l.to_socket.name == 'Color':
                hl.remove(l)
        hl.new(ca.outputs['Color'], em.inputs['Color'])
        for p in epieces:
            he, lo = imp(p['hiE'], p['name'] + '_hiE'), los[p['name']]
            he.data.materials.clear()
            he.data.materials.append(hmat)
            for o in bpy.context.view_layer.objects:
                o.hide_render = o not in (he, lo)
            deselect()
            he.select_set(True)
            lo.select_set(True)
            bpy.context.view_layer.objects.active = lo
            bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=p['cage'], max_ray_distance=p['ray'],
                                margin=gutter, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES')
            bpy.data.objects.remove(he, do_unlink=True)
        emit = np.empty(size * size * 4, np.float32)
        imgs['emit'].pixels.foreach_get(emit)
        log('  baked emit', [p['name'] for p in epieces], '%.1fs' % (time.time() - tp))
    # ---- WRINKLE (optional, additive; salSkin): pieces exported with a second high (the
    # same piece with compression gathers in the insides of its joints, <piece>_hiW.ply)
    # bake its tangent normals, through the same low, into <set>_wrinkle — the game blends it
    # over the normal map by the live joint bend
    wrk = None
    wpieces = [p for p in pieces if p.get('hiW')]
    if wpieces:
        tp = time.time()
        imgs['wrinkle'] = new_img(set_name + '_wrinkle', size, True)
        inode.image = imgs['wrinkle']
        scene.cycles.samples = 8
        first = True
        for p in wpieces:
            hw, lo = imp(p['hiW'], p['name'] + '_hiW'), los[p['name']]
            hw.data.materials.clear()
            hw.data.materials.append(hmat)
            for o in bpy.context.view_layer.objects:
                o.hide_render = o not in (hw, lo)
            deselect()
            hw.select_set(True)
            lo.select_set(True)
            bpy.context.view_layer.objects.active = lo
            bpy.ops.object.bake(type='NORMAL', use_selected_to_active=True, cage_extrusion=p['cage'], max_ray_distance=p['ray'],
                                margin=gutter, margin_type='EXTEND', use_clear=first, target='IMAGE_TEXTURES', normal_space='TANGENT')
            first = False
            bpy.data.objects.remove(hw, do_unlink=True)
        wrk = imgs['wrinkle']
        log('  baked wrinkle', [p['name'] for p in wpieces], '%.1fs' % (time.time() - tp))
    for o in bpy.data.objects:
        o.hide_render = False
    # ---- ALPHA CARDS (optional, additive; plants: set config alpha: true). The set's
    # pieces carry an emit paint of 1 on their high, so ORM.B = 1 wherever the high exists
    # and 0 where the cage ray MISSED it: a sea fan's lattice, a glass sponge's sieve,
    # a crinoid's pinnule comb, baked onto a plain low card/shell. The gutter fill must
    # not close those holes, so the CHART mask (every texel under a low triangle, from a
    # low-only emission bake) bounds the alpha's fill instead of the hit mask.
    cov = None
    if sconf.get('alpha') and emit is not None:
        # the chart mask is RASTERISED from the lows' own UV triangles (numpy; a low-only
        # Cycles bake of a white emitter came back empty: the lows are invisible to rays)
        tp = time.time()
        cov = np.zeros((size, size), bool)
        for p in pieces:
            me = los[p['name']].data
            uvl = me.uv_layers.active.data
            uv = np.empty(len(uvl) * 2, np.float32)
            uvl.foreach_get('uv', uv)
            uv = uv.reshape(-1, 2) * size
            me.calc_loop_triangles()
            lt = np.empty(len(me.loop_triangles) * 3, np.int32)
            me.loop_triangles.foreach_get('loops', lt)
            for t in lt.reshape(-1, 3):
                A, B, C = uv[t[0]], uv[t[1]], uv[t[2]]
                x0, x1 = int(max(0, np.floor(min(A[0], B[0], C[0])))), int(min(size - 1, np.ceil(max(A[0], B[0], C[0]))))
                y0, y1 = int(max(0, np.floor(min(A[1], B[1], C[1])))), int(min(size - 1, np.ceil(max(A[1], B[1], C[1]))))
                if x1 < x0 or y1 < y0:
                    continue
                X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
                if abs(d) < 1e-12:
                    continue
                w0 = ((B[1] - C[1]) * (X - C[0]) + (C[0] - B[0]) * (Y - C[1])) / d
                w1 = ((C[1] - A[1]) * (X - C[0]) + (A[0] - C[0]) * (Y - C[1])) / d
                e = 1.0 / max(1.0, max(x1 - x0, y1 - y0))   # a texel's worth of slack on thin slivers
                ins = (w0 >= -e) & (w1 >= -e) & (1 - w0 - w1 >= -e)
                cov[y0:y1 + 1, x0:x1 + 1] |= ins
        log('  chart mask for alpha %.1fs coverage %.3f' % (time.time() - tp, cov.mean()))
    # ---- GUTTER FILL (optional, additive: set config fill: true; salSkin). The bake's
    # margin is a few texels; KTX2/GPU mips average the black background into every chart
    # edge (measured on the dress: dark albedo seams, and ORM roughness 0 seams that
    # mirrored the sea as cyan cracks). Push-pull fills the whole background from the
    # charts. Coverage = texels the albedo bake wrote (anything not exactly 0).
    if sconf.get('fill'):
        tp = time.time()
        px = np.empty(size * size * 4, np.float32)
        imgs['albedo'].pixels.foreach_get(px)
        mask = (px.reshape(size, size, 4)[..., :3].max(axis=2) > 0)
        for key in ('albedo', 'normal', 'ao', 'rough', 'emit', 'wrinkle'):
            if key in imgs:
                fill_img(imgs[key], size, cov if (key == 'emit' and cov is not None) else mask)
        if emit is not None:
            imgs['emit'].pixels.foreach_get(emit)
        log('  gutter fill %.1fs coverage %.3f' % (time.time() - tp, mask.mean()))
    # ---- write the maps
    files = {}
    files['albedo'] = save_webp(imgs['albedo'], os.path.join(OUT, set_name + '_albedo.webp'), 92)
    files['normal'] = save_webp(imgs['normal'], os.path.join(OUT, set_name + '_normal.webp'), 95)
    wsize = size
    if wrk is not None:
        # (wrinkleHalf) the compression folds are broad: half resolution holds them (a 2048
        # BC5 is 5.3 MB of GPU memory, a 1024 one 1.3)
        if sconf.get('wrinkleHalf'):
            wsize = size // 2
            wrk.scale(wsize, wsize)
        files['wrinkle'] = save_webp(wrk, os.path.join(OUT, set_name + '_wrinkle.webp'), 95)
    n = size * size * 4
    ao = np.empty(n, np.float32)
    ro = np.empty(n, np.float32)
    imgs['ao'].pixels.foreach_get(ao)
    imgs['rough'].pixels.foreach_get(ro)
    orm = np.empty(n, np.float32)
    orm[0::4] = ao[0::4]
    orm[1::4] = ro[0::4]
    # ORM.B is shared: a set with baked emission keeps it there (Orune, Mhor); otherwise it
    # carries cavity for the micro-detail layer (Velkath). meta 'ormB' says which.
    if emit is not None:
        orm[2::4] = emit[0::4]
        ORMB[set_name] = sconf.get('ormB', 'emit')   # what the emit paint means (sal: 'metal')
    else:
        nrm = np.empty(n, np.float32)
        imgs['normal'].pixels.foreach_get(nrm)
        orm[2::4] = cavity_from_normal(nrm, size)
        ORMB[set_name] = 'cavity'
    orm[3::4] = 1.0
    om = new_img(set_name + '_orm', size, True)
    om.pixels.foreach_set(orm)
    if sconf.get('ormHalf', True):
        om.scale(size // 2, size // 2)
    files['orm'] = save_webp(om, os.path.join(OUT, set_name + '_orm.webp'), 92)
    if (man.get('compress') or {}).get('tex') == 'ktx2':
        dump_raw(imgs['albedo'], os.path.join(BUILD, set_name + '_albedo.rgba'), size)
        dump_raw(imgs['normal'], os.path.join(BUILD, set_name + '_normal.rgba'), size)
        dump_raw(om, os.path.join(BUILD, set_name + '_orm.rgba'), om.size[0])
        if wrk is not None:
            dump_raw(wrk, os.path.join(BUILD, set_name + '_wrinkle.rgba'), wsize)
        json.dump(dict({'size': size, 'orm': om.size[0]}, **({'wrinkle': wsize} if wrk is not None else {})), open(os.path.join(BUILD, set_name + '_raw.json'), 'w'))
    stats['sets'][set_name] = {'size': size, 'bytes': files}
    if wrk is not None:
        WRINKLE.add(set_name)
    for o in his.values():
        bpy.data.objects.remove(o, do_unlink=True)
    all_lo += list(los.values())
    log('  wrote', set_name, files)

# ---- STRIPS (optional, additive): tileable maps baked in node (strip.mjs), written here
# as WebP. Raw rows are v-ordered top-first (the file's order); Blender's buffer is
# bottom-first, so the rows are reversed going in.
for sname, st in (man.get('strips') or {}).items():
    if ONLY and sname not in ONLY:
        continue
    W, H = st['W'], st['H']
    files = {}
    for k, q in (('albedo', 92), ('normal', 95), ('orm', 92)):
        raw = np.fromfile(os.path.join(BUILD, sname + '_' + k + '.raw'), dtype=np.uint8).reshape(H, W, 4)[::-1]
        im = bpy.data.images.new(sname + '_' + k, W, H, alpha=False, float_buffer=False)
        im.colorspace_settings.name = 'sRGB' if k == 'albedo' else 'Non-Color'
        im.pixels.foreach_set((raw.astype(np.float32) / 255.0).ravel())
        files[k] = save_webp(im, os.path.join(OUT, sname + '_' + k + '.webp'), q)
    stats['sets'][sname] = {'size': W, 'h': H, 'strip': True, 'bytes': files}
    log('  wrote strip', sname, W, H, files)

# ---- SKIN (optional, additive; salSkin): an armature generated from the creature's bone
# list (the game rig's own pivots, rest pose), and every low whose piece carries `skin`
# weighted to it by BONE HEAT (Blender's automatic weights: a heat-diffusion solve over the
# surface from each bone, so the blend across a joint follows the cloth, not a radius),
# then CLEANED: bones a piece may not follow never deform it (the sleeve can't take a leg
# bone), weights smoothed across the joints, at most 4 influences, normalised; any vertex the
# heat solve left empty takes its nearest allowed bone. The .glb then carries JOINTS_0 /
# WEIGHTS_0 and a skin; the game maps the joint names onto its own rig groups.
skin_stats = {}
arm = None
if man.get('skin') and not ONLY:
    import mathutils
    import mathutils.kdtree
    # bone heat is solved at x10 scale (Blender's heat solve fails outright on a model a few
    # units tall: measured, every vertex of the trunk came back empty at 1x) and the mesh and
    # bones are put back to true size afterwards
    HS = 10.0
    sw = lambda v: mathutils.Vector((v[0] * HS, -v[2] * HS, v[1] * HS))      # game frame -> Blender (as the PLYs)
    ad = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', ad)
    scene.collection.objects.link(arm)
    deselect()
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in man['skin']['bones']:
        e = ad.edit_bones.new(b['name'])
        e.head = sw(b['head'])
        e.tail = sw(b['tail'])
        eb[b['name']] = e
    for b in man['skin']['bones']:
        if b.get('parent'):
            eb[b['name']].parent = eb[b['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    segs = {b['name']: (np.array(sw(b['head'])), np.array(sw(b['tail']))) for b in man['skin']['bones']}
    for p in man['pieces']:
        if not p.get('skin'):
            continue
        lo = next((o for o in all_lo if o.name == p['name']), None)
        if lo is None:
            continue
        allow = set(p['skin']['allow'])
        names = sorted(allow)
        for b in ad.bones:
            b.use_deform = b.name in allow
        # the low arrives split along its UV seams (every chart is its own island), and bone
        # heat cannot diffuse across a cut: weight a WELDED copy (x HS) and carry the weights
        # back by position
        import bmesh
        tmp = lo.copy()
        tmp.data = lo.data.copy()
        tmp.name = lo.name + '_weld'
        scene.collection.objects.link(tmp)
        bm = bmesh.new()
        bm.from_mesh(tmp.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(tmp.data)
        bm.free()
        tmp.vertex_groups.clear()
        tmp.data.transform(mathutils.Matrix.Scale(HS, 4))
        deselect()
        tmp.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        tv = tmp.data.vertices
        gi = {}
        for vg in tmp.vertex_groups:
            if vg.name in allow:
                gi[vg.index] = names.index(vg.name)
        W = np.zeros((len(tv), len(names)))
        for i, v in enumerate(tv):
            for g in v.groups:
                if g.group in gi:
                    W[i, gi[g.group]] = g.weight
        P = np.array([v.co[:] for v in tv])
        empty = np.nonzero(W.sum(axis=1) < 1e-4)[0]
        # empties (a failed heat solve) -> nearest allowed bone segment
        if len(empty):
            D = []
            for nm in names:
                a0, b2 = segs[nm]
                ab = b2 - a0
                t = np.clip(((P[empty] - a0) @ ab) / max(1e-9, ab @ ab), 0, 1)
                D.append(np.linalg.norm(P[empty] - (a0 + t[:, None] * ab), axis=1))
            W[empty, np.argmin(np.array(D), axis=0)] = 1.0
        # CLEAN (numpy, deterministic): Laplacian smoothing over the welded edges (widens a
        # too-sharp heat seam across a joint), the 4 largest influences, renormalised
        E = np.array([e.vertices[:] for e in tmp.data.edges])
        deg = np.bincount(E.ravel(), minlength=len(tv)).astype(float)
        for _ in range(p['skin'].get('smooth', 3)):
            acc = np.zeros_like(W)
            np.add.at(acc, E[:, 0], W[E[:, 1]])
            np.add.at(acc, E[:, 1], W[E[:, 0]])
            W = 0.5 * W + 0.5 * acc / np.maximum(deg, 1)[:, None]
        if W.shape[1] > 4:
            cut = np.sort(W, axis=1)[:, -4][:, None]
            W = np.where(W >= cut, W, 0.0)
        W[W < 2e-3] = 0.0
        W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
        # back onto the split low by position
        kd = mathutils.kdtree.KDTree(len(tv))
        for i, v in enumerate(tv):
            kd.insert(v.co / HS, i)
        kd.balance()
        vs = lo.data.vertices
        src = np.array([kd.find(v.co)[1] for v in vs])
        WL = W[src]
        bpy.data.objects.remove(tmp, do_unlink=True)
        lo.vertex_groups.clear()
        for k, nm in enumerate(names):
            vg = lo.vertex_groups.new(name=nm)
            for i in np.nonzero(WL[:, k])[0]:
                vg.add([int(i)], float(WL[i, k]), 'REPLACE')
        lo.parent = arm
        md = lo.modifiers.new('skin', 'ARMATURE')
        md.object = arm
        nz = [int((WL[i] > 1e-3).sum()) for i in range(len(vs))]
        empty = list(empty)
        skin_stats[p['name']] = {'verts': len(vs), 'empty': len(empty), 'maxInf': max(nz), 'meanInf': round(sum(nz) / len(nz), 2),
                                 'groups': [vg.name for vg in lo.vertex_groups]}
        log('  skinned', p['name'], skin_stats[p['name']])
    for b in ad.bones:
        b.use_deform = True
    # bones back to true size
    deselect()
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for e in ad.edit_bones:
        e.head = e.head / HS
        e.tail = e.tail / HS
    bpy.ops.object.mode_set(mode='OBJECT')
    stats['skin'] = skin_stats

# ---- FAR LODs (optional, additive; plants): a piece with `far: <tris>` also exports
# <piece>_far — a copy of its baked low, WELDED first (the low arrives split along its UV
# seams; decimating the islands separately would open cracks between charts) and then
# collapse-decimated. UVs are per-loop data in Blender, so the weld keeps every chart's UVs
# and the collapse interpolates them: the far mesh samples the SAME atlas as the near one.
far_stats = {}
if not ONLY:
    import bmesh
    for p in man['pieces']:
        if not p.get('far'):
            continue
        lo = next((o for o in all_lo if o.name == p['name']), None)
        if lo is None:
            continue
        fo = lo.copy()
        fo.data = lo.data.copy()
        fo.name = p['name'] + '_far'
        fo.data.name = p['name'] + '_far'
        scene.collection.objects.link(fo)
        bm = bmesh.new()
        bm.from_mesh(fo.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(fo.data)
        bm.free()
        n = decimate(fo, p['far'])
        far_stats[p['name']] = n
        all_lo.append(fo)
    if far_stats:
        stats['far'] = far_stats
        log('  far LODs', far_stats)

# ---- the game mesh: every low, one .glb
deselect()
if arm is not None:
    arm.select_set(True)
for o in all_lo:
    o.data.materials.clear()
    for k in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(o, k, True)
    o.select_set(True)
glb = os.path.join(OUT, man['name'] + ('_' + '_'.join(sorted(ONLY)) if ONLY else '') + '.glb')
gopt = dict(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_tangents=True,
            export_normals=True, export_texcoords=True, export_materials='NONE', export_apply=True)
if (man.get('compress') or {}).get('mesh') == 'draco':
    # positions 14 bits (~0.1 mm per shell unit), UVs 14 (an eighth of a texel at 2048),
    # normals/tangents 10; the decoder is three's DRACOLoader from the importmap's CDN
    gopt.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=14, export_draco_generic_quantization=12)
bpy.ops.export_scene.gltf(**gopt)
stats['glbBytes'] = os.path.getsize(glb)
meta = {'name': man['name'], 'meta': man.get('meta', {}), 'probes': man.get('probes', {}), 'stats': stats,
        'sets': dict({k: dict({'size': v.get('size', 1024), 'ormB': ORMB.get(k, 'cavity')}, **({'wrinkle': True} if k in WRINKLE else {})) for k, v in sets.items()},
                     **{k: {'size': v['W'], 'h': v['H'], 'strip': True} for k, v in (man.get('strips') or {}).items()})}
if man.get('compress'):
    meta['compress'] = man['compress']
json.dump(meta, open(os.path.join(OUT, man['name'] + '.json'), 'w'))
log('DONE', glb, stats['glbBytes'])
