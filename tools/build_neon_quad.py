"""Build DroneLab's original neon FPV quad asset without external textures.

Run from any directory with Blender 5.1+:
  blender --background --python tools/build_neon_quad.py
"""
from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
GLB_PATH = ROOT / "public" / "models" / "neon-quad.glb"
OUTPUTS = ROOT.parent
BLEND_PATH = OUTPUTS / "neon-quad.blend"
RENDER_PATH = OUTPUTS / "neon-quad-render.png"


def material(name, color, metallic=0.0, roughness=0.45, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.25
    # Shader to RGB is Eevee-only.  Keep it as an optional preview node so the
    # saved .blend carries the intended cel setup without making GLB depend on it.
    if bpy.context.scene.render.engine.startswith("BLENDER_EEVEE"):
        try:
            ramp = mat.node_tree.nodes.new("ShaderNodeValToRGB")
            ramp.name = "CelRamp_3Band"
            ramp.color_ramp.elements[0].position = 0.32
            ramp.color_ramp.elements[1].position = 0.74
            toon = mat.node_tree.nodes.new("ShaderNodeShaderToRGB")
            toon.name = "EeveeShaderToRGB"
            mat.node_tree.links.new(bsdf.outputs["BSDF"], toon.inputs["Shader"])
            mat.node_tree.links.new(toon.outputs["Color"], ramp.inputs["Fac"])
            mat["cel_preview"] = "Eevee ShaderToRGB + 3-band ramp"
        except RuntimeError:
            mat["cel_preview"] = "ShaderToRGB unavailable in this Eevee build"
    return mat


CARBON = material("Carbon_Fiber_Black", (0.018, 0.025, 0.033), 0.75, 0.23)
EDGE = material("Crisp_Black_Edge", (0.004, 0.006, 0.008), 0.35, 0.3)
ORANGE = material("Signal_Orange", (1.0, 0.16, 0.025), 0.12, 0.34)
TEAL = material("Neon_Teal", (0.01, 0.78, 0.74), 0.15, 0.26, (0.0, 0.35, 0.32))
CREAM = material("Armor_Cream", (0.92, 0.75, 0.39), 0.04, 0.42)
MOTOR = material("Motor_Gunmetal", (0.055, 0.08, 0.1), 0.82, 0.25)
PROP = material("Propeller_Smoke", (0.065, 0.22, 0.25), 0.22, 0.28)
LENS = material("FPV_Lens", (0.002, 0.008, 0.012), 0.65, 0.08, (0.0, 0.08, 0.11))


def active(obj, name, mat, parent=None):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    bpy.ops.object.shade_smooth_by_angle()
    return obj


def cube(name, location, scale, mat, bevel=0.0, parent=None, rotation=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=(0, 0, rotation))
    obj = active(bpy.context.object, name, mat, parent)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("small_fillet", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cylinder(name, location, radius, depth, mat, parent=None, rotation=(0, 0, 0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    return active(bpy.context.object, name, mat, parent)


def uv_sphere(name, location, scale, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=location)
    obj = active(bpy.context.object, name, mat, parent)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def make_blade_mesh():
    # Low-poly swept blade, reused by all twelve prop blades.
    verts = [(0.015, -0.018, -0.006), (0.17, -0.027, -0.003), (0.145, 0.05, -0.003),
             (0.015, -0.018, 0.006), (0.17, -0.027, 0.003), (0.145, 0.05, 0.003)]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new("TriBlade_Reusable_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(PROP)
    return mesh


def make_rotor(index, x, y, root, blade_mesh):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(x, y, 0.11))
    rotor = bpy.context.object
    rotor.name = f"rotor_{index}"
    rotor.parent = root
    rotor["animated"] = True
    cylinder(f"motor_{index}", (x, y, 0.07), 0.062, 0.095, MOTOR, root, vertices=14)
    cap = cylinder(f"motor_cap_{index}", (0, 0, 0), 0.032, 0.018, TEAL if index % 2 else ORANGE, rotor, vertices=12)
    cap.location = (0, 0, 0.012)
    for blade_i in range(3):
        blade = bpy.data.objects.new(f"prop_{index}_{blade_i}", blade_mesh)
        bpy.context.collection.objects.link(blade)
        blade.parent = rotor
        blade.rotation_euler[2] = blade_i * math.tau / 3 + (0.15 if index % 2 else 0)


def setup_world():
    scene = bpy.context.scene
    # Blender 5.1 exposes the Next renderer under the stable BLENDER_EEVEE id.
    engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDER_PATH)
    scene.render.film_transparent = False
    scene.world.color = (0.006, 0.009, 0.014)
    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.008, 0.015, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.18
    scene.view_settings.look = "AgX - Medium High Contrast"


def light(location, color, energy, size):
    bpy.ops.object.light_add(type="AREA", location=location)
    lamp = bpy.context.object
    lamp.data.energy = energy
    lamp.data.shape = "DISK"
    lamp.data.color = color
    lamp.data.size = size
    return lamp


def build():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    setup_world()
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.object
    root.name = "neon_quad"
    root["span_m"] = 0.95
    root["forward_axis"] = "+X"

    # Angular carbon X-frame.  Motor centres stay inside the requested +/-0.5m envelope.
    for i, (x, y) in enumerate(((0.32, 0.32), (0.32, -0.32), (-0.32, 0.32), (-0.32, -0.32))):
        angle = math.atan2(y, x)
        cube(f"carbon_arm_{i}", (x * 0.52, y * 0.52, 0.025), (0.255, 0.026, 0.018), CARBON, 0.007, root, angle)
        cube(f"arm_edge_{i}", (x * 0.58, y * 0.58, 0.046), (0.13, 0.007, 0.009), EDGE, 0.003, root, angle)
    cube("central_carbon_plate", (0, 0, 0.032), (0.20, 0.145, 0.025), CARBON, 0.015, root, math.radians(8))
    cube("lower_armor_plate", (0.01, 0, -0.012), (0.16, 0.11, 0.018), EDGE, 0.009, root, math.radians(8))

    # Forward +X armored canopy, a distinct camera pod, and sharp graphic panels.
    cube("armored_canopy", (0.045, 0, 0.125), (0.18, 0.125, 0.09), CREAM, 0.035, root, math.radians(-6))
    cube("canopy_orange_panel", (0.10, -0.106, 0.144), (0.09, 0.008, 0.055), ORANGE, 0.006, root, math.radians(-6))
    cube("canopy_teal_panel", (0.10, 0.106, 0.144), (0.09, 0.008, 0.055), TEAL, 0.006, root, math.radians(-6))
    cube("canopy_black_spine", (0.055, 0, 0.218), (0.17, 0.028, 0.012), EDGE, 0.006, root, math.radians(-6))
    uv_sphere("front_fpv_camera", (0.215, 0, 0.105), (0.062, 0.07, 0.057), EDGE, root)
    cylinder("front_camera_lens", (0.269, 0, 0.105), 0.039, 0.015, LENS, root, rotation=(0, math.pi / 2, 0), vertices=16)
    cube("camera_orange_guard", (0.244, 0, 0.164), (0.055, 0.092, 0.01), ORANGE, 0.004, root)
    for side in (-1, 1):
        cube(f"vent_{side}_0", (0.0, side * 0.13, 0.13), (0.06, 0.006, 0.008), EDGE, 0.002, root, math.radians(12))
        cube(f"vent_{side}_1", (-0.055, side * 0.13, 0.13), (0.045, 0.006, 0.008), EDGE, 0.002, root, math.radians(12))

    # Rear battery and strap make the body readable from a chase view.
    cube("battery_pack", (-0.16, 0, 0.122), (0.15, 0.095, 0.06), CARBON, 0.017, root)
    cube("battery_cream_label", (-0.16, 0, 0.186), (0.082, 0.073, 0.009), CREAM, 0.003, root)
    cube("orange_battery_strap", (-0.16, 0, 0.199), (0.025, 0.115, 0.012), ORANGE, 0.003, root)
    cube("tail_plate", (-0.29, 0, 0.082), (0.09, 0.065, 0.018), EDGE, 0.005, root)
    cylinder("tail_antenna_base", (-0.27, 0, 0.13), 0.018, 0.022, TEAL, root, vertices=10)
    antenna = cylinder("tail_antenna", (-0.29, 0, 0.21), 0.008, 0.19, EDGE, root, rotation=(0, math.radians(30), 0), vertices=8)
    antenna.rotation_euler[1] = math.radians(30)

    blade_mesh = make_blade_mesh()
    for index, (x, y) in enumerate(((0.32, 0.32), (0.32, -0.32), (-0.32, 0.32), (-0.32, -0.32))):
        make_rotor(index, x, y, root, blade_mesh)

    # Ground, studio camera, and colour-separated area lights are saved in .blend only.
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.14))
    floor = active(bpy.context.object, "render_floor", material("Studio_Ground", (0.009, 0.015, 0.022), 0.05, 0.62))
    light((1.4, -1.5, 2.0), (1.0, 0.19, 0.05), 900, 1.3)
    light((0.25, 1.5, 1.35), (0.02, 0.85, 0.76), 850, 1.0)
    light((-1.4, -0.4, 1.0), (0.9, 0.75, 0.42), 530, 1.4)
    bpy.ops.object.camera_add(location=(1.28, -1.38, 0.92))
    camera = bpy.context.object
    camera.name = "render_camera"
    bpy.context.scene.camera = camera
    target = Vector((0, 0, 0.07))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 56
    bpy.context.scene.render.filepath = str(RENDER_PATH)

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.render.render(write_still=True)
    # Export only the runtime asset hierarchy, excluding studio lights, camera and ground.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB", use_selection=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False,
                              export_yup=True, export_apply=True)
    print(f"NEON_QUAD_GLB={GLB_PATH} bytes={GLB_PATH.stat().st_size}")
    print(f"NEON_QUAD_RENDER={RENDER_PATH}")


if __name__ == "__main__":
    build()
