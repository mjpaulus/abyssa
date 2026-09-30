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
    for o in bpy.data.objects:
        o.hide_render = False
    # ---- write the maps
    files = {}
    files['albedo'] = save_webp(imgs['albedo'], os.path.join(OUT, set_name + '_albedo.webp'), 92)
    files['normal'] = save_webp(imgs['normal'], os.path.join(OUT, set_name + '_normal.webp'), 95)
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
        ORMB[set_name] = 'emit'
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
        json.dump({'size': size, 'orm': om.size[0]}, open(os.path.join(BUILD, set_name + '_raw.json'), 'w'))
    stats['sets'][set_name] = {'size': size, 'bytes': files}
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

# ---- the game mesh: every low, one .glb
deselect()
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
        'sets': dict({k: {'size': v.get('size', 1024), 'ormB': ORMB.get(k, 'cavity')} for k, v in sets.items()},
                     **{k: {'size': v['W'], 'h': v['H'], 'strip': True} for k, v in (man.get('strips') or {}).items()})}
if man.get('compress'):
    meta['compress'] = man['compress']
json.dump(meta, open(os.path.join(OUT, man['name'] + '.json'), 'w'))
log('DONE', glb, stats['glbBytes'])
