"""Build reproducible spoiler-free Art Deco evidence props with Blender 5.x.

Run: blender --background --factory-startup --python scripts/generate-evidence-models.py
Preview: append -- --stage graybox (writes only output/models/graybox/*.blend).
Runtime GLBs are read through authenticated /api/models routes, never /models.
"""
from pathlib import Path
import argparse
import math
import random
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "output" / "models"
RUNTIME = ROOT / "public" / "models"
SEED = 20261013
BEVEL_SEGMENTS = 3
RADIAL_SEGMENTS = 48


def material(name, color, metallic=0, roughness=.5, textured=False, alpha=1):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, alpha)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = "BLENDED"
    if textured:
        # Small packed base-color textures survive GLB export, unlike noise nodes.
        size = 128
        texture = bpy.data.images.new(name + "_grain", width=size, height=size)
        rng = random.Random(SEED + len(name))
        pixels = []
        for y in range(size):
            for x in range(size):
                factor = 1 + rng.uniform(-.035, .035) + .008 * math.sin(y * 1.9)
                channels = [min(1, max(0, channel * factor)) for channel in color]
                # A base-color image is sampled as sRGB by Blender and glTF.
                pixels.extend([12.92*c if c <= .0031308 else 1.055*c**(1/2.4)-.055 for c in channels] + [1])
        texture.pixels[:] = pixels
        texture.pack()
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = texture
        mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    return mat


def setup(graybox):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.view_settings.view_transform = "AgX"
    palette = {
        "black": material("Obsidian_Lacquer", (.047, .061, .053), .35, .32, not graybox),
        "gold": material("Brushed_Brass", (.58, .37, .13), .82, .3),
        "paper": material("Warm_Parchment", (.73, .64, .47), 0, .85, not graybox),
        "wax": material("Burgundy_Sealing_Wax", (.11, .007, .012), 0, .31),
        "felt": material("Dark_Protective_Felt", (.033, .049, .04), 0, .98, not graybox),
        "screen": material("Green_Instrument_Glass", (.019, .086, .063), .25, .18),
        "light": material("Amber_Indicators", (.66, .34, .078), .1, .28),
        "silver": material("Steel_Fasteners", (.38, .43, .41), .85, .27),
        "cloth": material("Woven_Sample", (.31, .27, .18), 0, .87, not graybox),
        "glass": material("Sample_Window", (.34, .62, .52), 0, .18, False, .2),
    }
    if graybox:
        neutral = material("Graybox_Neutral", (.46, .49, .46), 0, .7)
        return dict.fromkeys(palette, neutral)
    return palette


def finish(obj, name, mat, bevel=0):
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Manufactured_Edge_Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = BEVEL_SEGMENTS
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        normal = obj.modifiers.new("Surface_Normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    return obj


def box(name, xyz, dimensions, mat, bevel=.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, min(bevel, min(dimensions) / 3))


def cylinder(name, xyz, radius, depth, mat, rotation=None, bevel=.0008, segments=RADIAL_SEGMENTS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=depth, location=xyz)
    obj = finish(bpy.context.object, name, mat, min(bevel, depth / 4))
    if rotation:
        obj.rotation_euler = rotation
    return obj


def path(name, points, width, mat, cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = width
    data.bevel_resolution = 3
    data.resolution_u = 12
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def frame(name, center, width, depth, z, thickness, mat):
    x, y = center
    box(name + "_Front", (x, y-depth/2, z), (width, thickness, thickness), mat)
    box(name + "_Back", (x, y+depth/2, z), (width, thickness, thickness), mat)
    box(name + "_Left", (x-width/2, y, z), (thickness, depth, thickness), mat)
    box(name + "_Right", (x+width/2, y, z), (thickness, depth, thickness), mat)


def sealed_letter(p, graybox):
    box("Archive_Tray", (0, 0, .01), (.31, .225, .02), p["black"], .006)
    box("Tray_Felt_Insert", (0, 0, .021), (.288, .203, .004), p["felt"], .002)
    box("Letter_Envelope", (0, 0, .027), (.258, .16, .007), p["paper"], .0015)
    cylinder("Wax_Seal", (0, -.012, .0345), .022, .008, p["wax"])
    if graybox:
        return
    frame("Tray_Brass_Rim", (0, 0), .295, .21, .026, .003, p["gold"])
    # A real tapered flap; not a duplicate face or invented readable testimony.
    verts = [(-.127, .078, .031), (.127, .078, .031), (0, -.025, .0318)]
    mesh = bpy.data.meshes.new("Envelope_Flap_Mesh")
    mesh.from_pydata(verts, [], [(0, 2, 1)])
    mesh.update()
    obj = bpy.data.objects.new("Folded_Envelope_Flap", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(p["paper"])
    solid = obj.modifiers.new("Paper_Thickness", "SOLIDIFY")
    solid.thickness = .0004
    edge = obj.modifiers.new("Soft_Paper_Edge", "BEVEL")
    edge.width = .0001
    edge.segments = 2
    path("Fold_Edge", [(-.127, .078, .032), (0, -.025, .0328), (.127, .078, .032)], .0003, p["cloth"])
    rng = random.Random(SEED)
    rim = []
    for index in range(96):
        angle = index * math.tau / 96
        radius = .023 + .0008 * math.sin(angle * 7) + rng.uniform(-.0004, .0004)
        rim.append((math.cos(angle)*radius, -.012+math.sin(angle)*radius, .036))
    path("Wax_Organic_Rim", rim, .0015, p["wax"], True)
    # Abstract geometric embossing has no NPC initials, names, or plot answers.
    path("Seal_Diamond", [(0,-.001,.039),(.010,-.012,.039),(0,-.023,.039),(-.010,-.012,.039)], .0007, p["gold"], True)
    path("Seal_Central_Bar", [(0,-.021,.039),(0,-.003,.039)], .0006, p["gold"])
    for x in [-.139, .139]:
        for y in [-.096, .096]:
            cylinder("Tray_Corner_Stud", (x,y,.029), .003, .002, p["gold"])
    box("Archive_Band", (-.087, 0, .031), (.009,.16,.0007),p["gold"], .0002)
    for index in range(3):
        box("Reverse_Fold", (0,.01+index*.007,.004), (.20,.001,.0005),p["gold"],.0001)


def echo_terminal(p, graybox):
    box("Terminal_Base", (0, 0, .027), (.34, .255, .044), p["black"], .012)
    for x in [-.12, .12]:
        for y in [-.09,.09]:
            cylinder("Rubber_Foot",(x,y,.005),.014,.010,p["felt"],bevel=.002)
    box("Upper_Housing", (0,.059,.135), (.306,.102,.195),p["black"],.013)
    box("Screen_Brass_Bezel", (-.033,.004,.159), (.208,.009,.116),p["gold"],.01)
    box("Record_Display", (-.033,-.002,.159), (.185,.005,.095),p["screen"],.007)
    box("Keyboard_Deck", (-.029,-.062,.054),(.225,.103,.019),p["black"],.005)
    if graybox:
        return
    frame("Base_Trim", (0, 0), .323, .238, .044, .003, p["gold"])
    for row in range(3):
        for column in range(8):
            cylinder(f"Key_{row}_{column}", (-.121+column*.026,-.097+row*.03,.066),.008,.01,p["gold"],bevel=.0018,segments=32)
            cylinder(f"Key_Face_{row}_{column}", (-.121+column*.026,-.097+row*.03,.072),.0063,.0016,p["black"],bevel=.0004,segments=32)
    # Time-like bars deliberately do not encode or show any story timestamps.
    for index in range(5):
        x = -.11
        z = .129 + .013 * index
        length = [.086,.137,.101,.064,.122][index]
        box(f"Display_Trace_{index}",(x+length/2,-.0052,z),(length,.0009,.002),p["light"],.0002)
    cylinder("Rotary_Dial_Mount",(.112,.000,.151),.023,.009,p["gold"],(math.pi/2,0,0),.002)
    cylinder("Rotary_Dial",(.112,-.008,.151),.018,.012,p["black"],(math.pi/2,0,0),.002)
    for index in range(12):
        a=index*math.tau/12
        x=.112+math.cos(a)*.029
        z=.151+math.sin(a)*.029
        tick=box("Dial_Graduation",(x,-.003,z),(.001,.001,.004),p["gold"],.0002)
        tick.rotation_euler.y=-a
    for index in range(3):
        cylinder("Status_Lamp",(.109,-.02,.068+index*.017),.004,.005,p["light"],(math.pi/2,0,0))
    for x in [-.136,.136]:
        for z in [.060,.216]:
            cylinder("Housing_Screw",(x,.111,z),.003,.002,p["silver"],(math.pi/2,0,0))
    box("Rear_Service_Panel",(0,.113,.14),(.202,.004,.160),p["black"],.006)
    for index in range(6):
        box("Rear_Service_Vent",(0,.116,.09+index*.018),(.14,.002,.003),p["felt"],.0005)
    cylinder("Cable_Socket",(.123,.111,.075),.009,.008,p["gold"],(math.pi/2,0,0))
    cylinder("Cable_Socket_Recess",(.123,.116,.075),.006,.004,p["felt"],(math.pi/2,0,0))
    path("Side_Deco_Accent",[(.154,.102,.07),(.154,.052,.07),(.154,.028,.09),(.154,.028,.20)],.001,p["gold"])


def evidence_case(p, graybox):
    box("Case_Base",(0,0,.022),(.385,.268,.038),p["black"],.01)
    box("Case_Foam",(0,0,.043),(.359,.241,.009),p["felt"],.005)
    for x in [-.185,.185]:
        box("Case_Side_Wall",(x,0,.052),(.012,.264,.048),p["black"],.004)
    for y in [-.127,.127]:
        box("Case_End_Wall",(0,y,.052),(.36,.012,.048),p["black"],.004)
    # A fixed open lid rests at the rear hinge; its inspectable back also has detail.
    box("Open_Lid",(0,.148,.192),(.385,.025,.263),p["black"],.009)
    box("Lid_Inner_Felt",(0,.132,.193),(.35,.009,.229),p["felt"],.003)
    box("Sample_Frame",(-.057,-.01,.055),(.185,.174,.012),p["gold"],.004)
    box("Sample_Card",(-.057,-.01,.062),(.173,.162,.004),p["paper"],.002)
    box("Fabric_Sample",(-.06,-.016,.066),(.093,.081,.004),p["cloth"],.001)
    if graybox:
        return
    frame("Case_Rim",(0,0),.37,.257,.078,.003,p["gold"])
    for x in [-.13,.13]:
        cylinder("Lid_Hinge",(x,.132,.075),.007,.054,p["gold"],(0,math.pi/2,0),.001)
        box("Hinge_Base",(x,.125,.066),(.039,.014,.015),p["gold"],.002)
        box("Lid_Hinge_Plate",(x,.129,.093),(.039,.005,.028),p["gold"],.001)
        box("Case_Latch",(x,-.137,.055),(.026,.012,.030),p["gold"],.003)
        box("Latch_Grip",(x,-.144,.056),(.018,.005,.014),p["black"],.002)
    path("Case_Handle",[(-.042,-.141,.043),(-.042,-.168,.043),(.042,-.168,.043),(.042,-.141,.043)],.006,p["black"])
    for x in [-.047,.047]:
        cylinder("Handle_Fixing",(x,-.135,.044),.010,.007,p["gold"],(math.pi/2,0,0))
    for x in [-.182,.182]:
        for z in [.09,.295]:
            box("Lid_Corner_Plate",(x,.13,z),(.013,.005,.023),p["gold"],.002)
    for x in [-.164,.164]:
        box("Lid_Vertical_Inlay",(x,.125,.194),(.0015,.002,.202),p["gold"],.0004)
    for z in [.09,.295]:
        box("Lid_Horizontal_Inlay",(0,.125,z),(.327,.002,.0015),p["gold"],.0004)
    path("Lid_Art_Deco",[(-.07,.125,.17),(0,.125,.26),(.07,.125,.17),(0,.125,.215)],.001,p["gold"],True)
    # Small fiber frays remain visibly attached to the swatch, not floating clues.
    for index in range(12):
        x=-.100+index*.0075
        y=-.058
        path("Sample_Frayed_Fiber",[(x,y,.068),(x+.003,y-.008,.067),(x-.001,y-.015,.066)],.0005,p["cloth"])
    for x in [.082,.134]:
        box("Vial_Foam_Cradle",(x,.008,.052),(.044,.139,.012),p["black"],.004)
        cylinder("Evidence_Vial",(x,.010,.064),.014,.095,p["glass"],(math.pi/2,0,0),.0015)
        cylinder("Vial_Cap",(x,-.043,.064),.016,.014,p["gold"],(math.pi/2,0,0),.0015)
        cylinder("Vial_Base",(x,.059,.064),.014,.003,p["silver"],(math.pi/2,0,0))
        path("Vial_Fiber",[(x-.004,-.023,.064),(x+.003,.01,.067),(x-.001,.039,.061)],.001,p["cloth"])
    box("Glass_Sample_Cover",(-.057,-.01,.074),(.164,.153,.002),p["glass"],.0006)
    for x in [-.143, .029]:
        for y in [-.091, .071]:
            cylinder("Cover_Support_Pin",(x,y,.067),.003,.014,p["gold"],bevel=.0005)
    # Neutral blank tags show catalog structure without printing plot information.
    box("Blank_Archive_Tag",(-.057,.085,.062),(.12,.021,.002),p["paper"],.0005)
    for index in range(3):
        box("Tag_Rule",(-.057,.08+index*.005,.0635),(.095,.0007,.0002),p["cloth"],.00005)
    for x in [-.13,.13]:
        box("Rear_Lid_Rib",(x,.163,.195),(.004,.005,.204),p["gold"],.001)


def add_uvs():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.data.uv_layers:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=.03)
        bpy.ops.object.mode_set(mode="OBJECT")


def write_asset(name, build, graybox):
    p = setup(graybox)
    build(p, graybox)
    add_uvs()
    # One semantic root preserves assembly identity across .blend and GLB.
    root = bpy.data.objects.new(name + "_Assembly", None)
    bpy.context.scene.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj is not root:
            obj.parent = root
    directory = ARTIFACTS / ("graybox" if graybox else "source")
    directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory / (name + ".blend")))
    if not graybox:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(RUNTIME / (name + ".glb")), export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False)
    print("WROTE", name, "graybox" if graybox else "final")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["graybox", "final"], default="final")
    config = parser.parse_args(args)
    for name, build in [("sealed-letter", sealed_letter), ("echo-terminal", echo_terminal), ("evidence-case", evidence_case)]:
        write_asset(name, build, config.stage == "graybox")
