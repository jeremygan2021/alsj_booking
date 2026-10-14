"""Build the 13 story-specific mobile GLBs, Blender sources and preview PNGs.
Run with Blender: --background --factory-startup --python scripts/generate-story-models.py
"""
from pathlib import Path
import math, json, sys, argparse, runpy
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
helpers=runpy.run_path(str(ROOT/'scripts/generate-evidence-models.py'))
box=helpers['box']; cylinder=helpers['cylinder']; path=helpers['path']; frame=helpers['frame']; finish=helpers['finish']
OUTPUT=ROOT/'output/models/story'; RUNTIME=ROOT/'public/models'
BRIEFS=json.loads((ROOT/'server/story-materials.json').read_text())['models']

def mesh(name,verts,faces,mat):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
 obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.data.materials.append(mat);return obj

def sphere(name,xyz,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=xyz)
 obj=bpy.context.object;obj.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return finish(obj,name,mat)

def limb(name,a,b,radius,mat):
 a=Vector(a);b=Vector(b);obj=cylinder(name,(a+b)/2,radius,(b-a).length,mat,bevel=radius*.2,segments=20)
 obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return obj

def platter(p,width=.40,depth=.29):
 box('display_base',(0,0,.012),(width,depth,.022),p['black'],.006)
 box('felt_insert',(0,0,.027),(width-.024,depth-.024,.009),p['felt'],.004)
 frame('brass_rim',(0,0),width-.012,depth-.012,.033,.003,p['gold'])

def body(p):
 box('body_position',(0,0,.03),(.72,2.1,.055),p['felt'],.012)
 frame('slab_rim',(0,0),.7,2.05,.064,.006,p['silver'])
 sphere('chest',(0,.28,.16),(.22,.32,.10),p['black']);sphere('hip',(0,-.05,.145),(.19,.18,.10),p['black'])
 sphere('head_injury',(0,.71,.175),(.105,.14,.115),p['paper'])
 cylinder('neck',(0,.54,.15),.053,.08,p['paper'],(math.pi/2,0,0))
 for x in [-1,1]:
  limb('upper_arm',(x*.21,.42,.13),(x*.30,.15,.12),.058,p['black']);limb('lower_arm',(x*.30,.15,.12),(x*.30,-.11,.12),.043,p['black'])
  sphere('hand',(x*.30,-.18,.12),(.044,.077,.032),p['paper'])
  limb('thigh',(x*.11,-.11,.14),(x*.13,-.46,.14),.086,p['black']);limb('lower_leg',(x*.13,-.46,.14),(x*.13,-.82,.12),.065,p['black'])
  sphere('shoe',(x*.13,-.91,.125),(.065,.125,.056),p['black'])
 box('shirt_front',(0,.35,.252),(.085,.29,.007),p['paper'])
 for y in [.25,.31,.37,.43]:cylinder('shirt_button',(0,y,.258),.005,.004,p['gold'])
 mesh('impact_outline',[(-.095,.72,.245),(-.08,.76,.263),(-.064,.733,.275),(-.083,.696,.258)],[(0,1,2,3)],p['silver'])
 path('position_cross',[(-.33,.9,.065),(-.27,.9,.065)],.002,p['light'])

def trophy(p):
 platter(p,.20,.16)
 # Six-edge foot with an actual missing rear corner; crack facets visible from the back.
 poly=[(-.065,-.045),(.065,-.045),(.065,.045),(.023,.045),(.005,.026),(-.018,.045),(-.065,.045)]
 vs=[(x,y,z) for z in [.038,.070] for x,y in poly];n=len(poly)
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh('damaged_base',vs,faces,p['black'])
 cylinder('pedestal',(0,0,.107),.024,.075,p['gold'],segments=8)
 # Faceted aurora crystal spire and mountain shoulders.
 verts=[(-.055,-.018,.145),(.055,-.018,.145),(.055,.018,.145),(-.055,.018,.145),(-.018,-.026,.235),(.026,-.012,.25),(.026,.018,.25),(-.018,.026,.235),(0,0,.285)]
 mesh('trophy_front',verts,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,8),(5,6,8),(6,7,8),(7,4,8),(0,3,2,1)],p['glass'])
 path('aurora_inlay',[(-.037,-.019,.17),(0,-.027,.218),(.021,-.013,.243)],.0014,p['gold'])
 # Small neutral fibers mark an observation site, not the identity conclusion.
 for i in range(4):path('fiber_socket'+str(i),[(.006+i*.001,.03,.071),(.013+i*.001,.04,.074),(.022+i*.001,.044,.070)],.00045,p['silver'])
 mesh('mountain_crest',[(-.048,-.046,.042),(0,-.046,.064),(.04,-.046,.042)],[(0,1,2)],p['gold'])

def scarf(p):
 platter(p,.38,.27)
 for center,name in [(-.085,'fiber_sample'),(.085,'torn_edge')]:
  w=.063;h=.082
  verts=[(center-w,-h,.04),(center+w,-h,.04),(center+w,h*.77,.04),(center+w*.6,h*.5,.04),(center+w*.1,h*.95,.04),(center-w*.3,h*.55,.04),(center-w,h,.04)]
  mesh(name,verts,[tuple(range(len(verts)))],p['cloth'])
  for i in range(20):
   x=center-w+i*(2*w/19);top=h*.55
   path(name+'_warp'+str(i),[(x,-h,.043),(x,top,.043)],.0008,p['silver'])
  for i in range(15):path(name+'_weft'+str(i),[(center-w,-h+i*.009,.044),(center+w,-h+i*.009,.044)],.0006,p['cloth'])
  for i in range(7):path('frayed_fiber'+name+str(i),[(center-.04+i*.011,h*.5,.045),(center-.038+i*.011,h*.7,.044),(center-.035+i*.011,h*.84,.043)],.00055,p['silver'])
 cylinder('weave_zoom',(0,-.005,.089),.040,.008,p['gold'],bevel=.001)
 cylinder('zoom_glass',(0,-.005,.094),.036,.003,p['glass'],bevel=.001)
 limb('magnifier_handle',(0,-.049,.09),(0,-.109,.09),.007,p['black'])

def watch(p):
 platter(p,.20,.23)
 box('strap',(0,0,.045),(.028,.18,.012),p['black'],.004)
 for y in [.05,.066,.081]:cylinder('strap_hole',(0,y,.053),.0025,.002,p['felt'])
 box('watch_case',(0,-.006,.059),(.048,.055,.022),p['silver'],.008)
 box('watch_screen',(0,-.006,.073),(.039,.044,.005),p['screen'],.007)
 points=[(-.015,-.006,.077),(-.008,-.006,.077),(-.004,.002,.077),(0,-.02,.077),(.004,.006,.077),(.008,-.006,.077),(.015,-.006,.077)]
 path('neutral_signal',points,.0008,p['light'])
 cylinder('sensor_back',(0,-.006,.047),.010,.003,p['black'])
 cylinder('crown',(.026,-.008,.060),.004,.006,p['gold'],(0,math.pi/2,0))
 frame('buckle',(0,.085),.03,.012,.054,.002,p['silver'])

def access(p):
 platter(p,.23,.19)
 box('console_housing',(0,.02,.15),(.16,.04,.24),p['black'],.007)
 box('mode_screen',(0,-.003,.19),(.125,.007,.084),p['screen'],.004)
 box('card_reader',(0,-.006,.093),(.11,.009,.065),p['silver'],.005)
 path('reader_glyph',[(-.016,-.012,.084),(-.016,-.012,.108),(.016,-.012,.108),(.016,-.012,.084),(-.016,-.012,.084)],.001,p['black'])
 for i in range(3):cylinder('state_light'+str(i),(-.035+i*.035,-.013,.140),.005,.003,p['light'],(math.pi/2,0,0))
 box('approval_panel',(0,.041,.146),(.116,.003,.195),p['silver'],.002)
 for i in range(4):box('blank_log_line'+str(i),(0,-.008,.165+i*.015),(.095,.001,.002),p['light'])

def audio(p):
 helpers['echo_terminal'](p,False)
 # Semantic mesh names used by commissioning briefs and inspectable neutral controls.
 bpy.data.objects.get('Record_Display').name='file_browser'
 bpy.data.objects.get('Keyboard_Deck').name='playback_panel'
 bpy.data.objects.get('Cable_Socket').name='mic_port'
 box('agent_panel',(-.071,.112,.197),(.092,.005,.048),p['screen'],.003)

def folios(p):
 platter(p,.40,.30)
 box('digital_folder',(.073,.01,.045),(.16,.205,.015),p['silver'],.002)
 box('document_page',(.071,-.001,.057),(.142,.176,.003),p['paper'],.0005)
 box('sealed_envelope',(-.091,-.008,.059),(.13,.185,.02),p['paper'],.002)
 cylinder('seal',(-.091,-.008,.074),.020,.007,p['wax'])
 path('flap_edge',[(-.15,.07,.074),(-.091,.016,.074),(-.032,.07,.074)],.0009,p['gold'])
 for i in range(7):box('blank_page_rule'+str(i),(.071,-.059+i*.017,.059),(.111,.001,.0004),p['cloth'],.0001)
 box('folder_clip',(.071,.10,.057),(.045,.025,.006),p['gold'],.001)

def personality(p):
 platter(p,.38,.24)
 for x in [-.13,.13]:
  box('server_column',(x,.042,.172),(.07,.13,.28),p['black'],.007)
  for i in range(5):
   box('server_drawer',(x,-.027,.070+i*.047),(.06,.007,.035),p['silver'],.003)
   cylinder('server_light',(x+.019,-.033,.071+i*.047),.002,.002,p['light'],(math.pi/2,0,0))
 box('profile_directory',(0,-.020,.16),(.177,.013,.154),p['screen'],.005)
 for i in range(4):box('authorization_tab'+str(i),(.022,-.029,.105+i*.028),(.104,.002,.003),p['light'])
 sphere('profile_placeholder',(-.044,-.034,.199),(.013,.006,.013),p['silver'])
 box('instance_status',(0,-.034,.071),(.112,.004,.017),p['gold'],.002)

def camera(p):
 platter(p,.34,.28)
 box('replay_terminal',(0,.055,.126),(.26,.045,.17),p['black'],.007)
 box('replay_screen',(0,.027,.13),(.224,.008,.126),p['screen'],.005)
 # Screen mini-room provides spatial observation without names or timestamps.
 for x in [-.083,.083]:box('screen_frame',(x,.021,.13),(.003,.001,.08),p['light'])
 box('coverage_map',(0,-.065,.047),(.26,.111,.007),p['paper'],.002)
 cylinder('camera_lens',(-.10,-.004,.266),.020,.048,p['black'],(math.pi/2,0,0))
 box('camera_housing',(-.10,.026,.266),(.085,.06,.053),p['silver'],.006)
 cylinder('lens_glass',(-.10,-.030,.266),.013,.003,p['glass'],(math.pi/2,0,0))
 limb('camera_mount',(-.10,.052,.266),(-.10,.080,.221),.006,p['silver'])


def photo(p):
 platter(p,.26,.18)
 box('frame_back',(0,.025,.147),(.192,.016,.23),p['black'],.005)
 box('photo_plane',(0,.014,.147),(.160,.003,.193),p['paper'],.001)
 for x in [-.087,.087]:box('frame_side',(x,.010,.147),(.006,.008,.213),p['gold'],.002)
 for z in [.039,.255]:box('frame_edge',(0,.010,z),(.18,.008,.006),p['gold'],.001)
 # Neutral photographic plate: silhouetted mountains, not fake actor/photo evidence.
 mesh('image_mountains',[(-.074,.009,.081),(-.019,.009,.164),(.012,.009,.118),(.047,.009,.157),(.076,.009,.081)],[(0,1,2,3,4)],p['cloth'])
 sphere('image_moon',(.041,.006,.207),(.017,.002,.017),p['light'])
 box('metadata_button',(.105,-.003,.050),(.011,.022,.019),p['silver'],.002)


def recorder(p):
 platter(p,.38,.25)
 box('recorder_housing',(0,.018,.10),(.306,.113,.125),p['black'],.006)
 for x,name in [(-.074,'real_recording'),(.074,'echo_recording')]:
  cylinder(name,(x,-.041,.127),.048,.011,p['silver'],(math.pi/2,0,0))
  cylinder(name+'_hub',(x,-.049,.127),.008,.006,p['gold'],(math.pi/2,0,0))
  for i in range(5):
   a=i*math.tau/5;sphere('reel_hole',(x+math.cos(a)*.026,-.050,.127+math.sin(a)*.026),(.007,.002,.007),p['felt'])
 box('letter_slot',(0,-.044,.063),(.105,.004,.027),p['screen'],.003)
 for x in [-.10,-.055,.055,.10]:box('play_control',(x,-.079,.040),(.026,.023,.012),p['gold'],.002)
 path('tape_path',[(-.074,-.05,.085),(-.04,-.05,.075),(.04,-.05,.075),(.074,-.05,.085)],.0015,p['cloth'])

def wine(p):
 platter(p,.23,.23)
 # Lathed glass bowl with actual wall thickness, open rim and rounded silhouette.
 profile=[(.008,.11),(.024,.116),(.034,.139),(.045,.165),(.043,.19),(.042,.215),(.04,.215),(.041,.19),(.042,.165),(.031,.138),(.021,.12),(.008,.115)]
 verts=[];n=48
 for radius,z in profile:
  verts.extend((math.cos(i*math.tau/n)*radius,math.sin(i*math.tau/n)*radius,z) for i in range(n))
 faces=[]
 for ring in range(len(profile)-1):
  for i in range(n):faces.append((ring*n+i,ring*n+(i+1)%n,(ring+1)*n+(i+1)%n,(ring+1)*n+i))
 mesh('glass_rim',verts,faces,p['glass'])
 cylinder('glass_foot',(0,0,.044),.038,.007,p['glass']);cylinder('glass_stem',(0,0,.077),.0035,.07,p['glass'])
 cylinder('liquid_sample',(0,0,.142),.032,.032,p['glass'])
 cylinder('sample_vial',(.074,-.045,.070),.008,.06,p['glass']);cylinder('sample_cap',(.074,-.045,.103),.010,.006,p['gold'])

def route(p):
 platter(p,.50,.40)
 box('room_floor',(0,.04,.041),(.245,.21,.013),p['paper'],.002)
 # Archive room with east and west openings, no perpetrator path baked in.
 for x,name in [(-.124,'west_corridor'),(.124,'east_corridor')]:
  for y in [-.03,.11]:box('door_wall_segment',(x,y,.084),(.013,.065,.074),p['black'],.002)
  box(name,(x*1.43,-.015,.042),(.09,.22,.012),p['silver'],.001)
 box('room_north_wall',(0,.148,.084),(.25,.012,.074),p['black'],.002)
 box('archive_door',(0,-.069,.056),(.060,.012,.028),p['gold'],.002)
 box('private_desk',(0,.061,.059),(.07,.038,.026),p['black'],.002)
 mesh('camera_coverage',[(.18,.09,.055),(.142,-.1,.055),(.218,-.1,.055)],[(0,1,2)],p['screen'])
 cylinder('east_camera',(.18,.09,.080),.010,.010,p['gold'])
 for x in [-.176,.176]:path('corridor_centerline',[(x,-.11,.055),(x,.067,.055)],.001,p['light'])

BUILDERS={'body-analysis':body,'aurora-trophy':trophy,'scarf-samples':scarf,'smart-watch':watch,'access-console':access,'audio-console':audio,'archive-folios':folios,'personality-terminal':personality,'security-camera':camera,'photo-frame':photo,'memory-recorder':recorder,'wine-glass':wine,'archive-route':route}

def preview(name):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
 objs=[o for o in scene.objects if o.type=='MESH']
 points=[o.matrix_world@Vector(v) for o in objs for v in o.bound_box]
 low=Vector(tuple(min(v[i] for v in points) for i in range(3)));high=Vector(tuple(max(v[i] for v in points) for i in range(3)))
 target=(low+high)/2;size=max(high-low)
 # Camera is intentionally pitched high enough to see trays and back-facing broken edge.
 loc=target+Vector((1.3,-1.85,1.7))*size
 bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=size*1.38;scene.camera=cam
 for xyz,energy,color in [((2,-3,4),350,(1,.84,.64)),((-3,-1,3),220,(.55,.72,1)),((1,3,4),400,(.65,.82,1))]:
  bpy.ops.object.light_add(type='AREA',location=target+Vector(xyz)*size);l=bpy.context.object;l.data.energy=energy*size*size;l.data.color=color;l.data.shape='DISK';l.data.size=size*2;l.rotation_euler=(target-l.location).to_track_quat('-Z','Y').to_euler()
 if scene.world is None:scene.world=bpy.data.worlds.new('Studio_World')
 scene.world.color=(.08,.09,.12);scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUTPUT/(name+'.png'))
 bpy.ops.render.render(write_still=True)

def run(ids,render=True):
 OUTPUT.mkdir(parents=True,exist_ok=True);RUNTIME.mkdir(parents=True,exist_ok=True)
 report=[]
 for name in ids:
  p=helpers['setup'](False)
  p['cloth']=helpers['material']('Silver_Grey_Weave',(.29,.32,.35),.18,.79,True)
  p['glass']=helpers['material']('Aurora_Frosted_Crystal',(.38,.64,.73),.18,.23,False,.66)
  BUILDERS[name](p)
  helpers['add_uvs']()
  root=bpy.data.objects.new(name+'_Assembly',None);bpy.context.scene.collection.objects.link(root)
  for obj in list(bpy.context.scene.objects):
   if obj is not root:obj.parent=root
  triangles=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')
  bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/(name+'.blend')))
  glb=RUNTIME/(name+'.glb')
  bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_apply=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
  if render:preview(name)
  report.append({'id':name,'filename':glb.name,'bytes':glb.stat().st_size,'source':str(OUTPUT/(name+'.blend')),'preview':str(OUTPUT/(name+'.png')),'status':'已建模','mesh_polygons':triangles})
  print('STORY_MODEL_COMPLETE',name,glb.stat().st_size,flush=True)
 (OUTPUT/'generation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
 args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 parser=argparse.ArgumentParser();parser.add_argument('--only',default='');parser.add_argument('--no-render',action='store_true');a=parser.parse_args(args)
 run(a.only.split(',') if a.only else list(BUILDERS),not a.no_render)
