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
import bpy, sys, os, json, math, time
import numpy as np

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
    orm[2::4] = emit[0::4] if emit is not None else 0.0
    orm[3::4] = 1.0
    om = new_img(set_name + '_orm', size, True)
    om.pixels.foreach_set(orm)
    if sconf.get('ormHalf', True):
        om.scale(size // 2, size // 2)
    files['orm'] = save_webp(om, os.path.join(OUT, set_name + '_orm.webp'), 92)
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
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_tangents=True,
                          export_normals=True, export_texcoords=True, export_materials='NONE', export_apply=True)
stats['glbBytes'] = os.path.getsize(glb)
meta = {'name': man['name'], 'meta': man.get('meta', {}), 'probes': man.get('probes', {}), 'stats': stats,
        'sets': dict({k: {'size': v.get('size', 1024)} for k, v in sets.items()},
                     **{k: {'size': v['W'], 'h': v['H'], 'strip': True} for k, v in (man.get('strips') or {}).items()})}
json.dump(meta, open(os.path.join(OUT, man['name'] + '.json'), 'w'))
log('DONE', glb, stats['glbBytes'])
