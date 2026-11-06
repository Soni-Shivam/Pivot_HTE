# Spike: CARLA 0.10 lead-brake staging + LiDAR on the ego + recorder. Throwaway; learns the API, prints facts.
import carla, time, math, sys, numpy as np
c=carla.Client('127.0.0.1',2000); c.set_timeout(120.0)
print('server', c.get_server_version(), 'client', c.get_client_version(), 'maps', c.get_available_maps())
w=c.get_world(); print('current map', w.get_map().name)
if 'Town10HD' not in w.get_map().name: w=c.load_world('Town10HD_Opt'); time.sleep(3)
bl=w.get_blueprint_library()
print('vehicles:', sorted(b.id for b in bl.filter('vehicle.*'))[:40])
print('lidar/collision bp:', [b.id for b in bl.filter('sensor.lidar.*')], [b.id for b in bl.filter('sensor.other.collision')])
s=w.get_settings(); s.synchronous_mode=True; s.fixed_delta_seconds=0.05; w.apply_settings(s)
m=w.get_map()
# find a straight-ish stretch: a driving waypoint with >= 120 m ahead without junction
cands=[]
for sp in m.get_spawn_points():
    wp=m.get_waypoint(sp.location, project_to_road=True, lane_type=carla.LaneType.Driving)
    d=0; cur=wp; ok=True
    while d<140:
        nxt=cur.next(5.0)
        if not nxt or nxt[0].is_junction: ok=False; break
        cur=nxt[0]; d+=5
    if ok: cands.append(wp)
print('straight candidates:', len(cands))
wp=cands[0]
veh_bp=bl.filter('vehicle.*')
def pick(name):
    f=[b for b in veh_bp if name in b.id]; return f[0] if f else veh_bp[0]
ego_bp=pick('lincoln'); lead_bp=pick('audi') if pick('audi').id!=ego_bp.id else veh_bp[1]
lead_wp=wp.next(35.0)[0]
t_e=wp.transform; t_e.location.z+=0.5; t_l=lead_wp.transform; t_l.location.z+=0.5
ego=w.try_spawn_actor(ego_bp,t_e); lead=w.try_spawn_actor(lead_bp,t_l); print('spawned', ego and ego.type_id, lead and lead.type_id)
lbp=bl.find('sensor.lidar.ray_cast')
for k,v in {'channels':'32','range':'60','points_per_second':'300000','rotation_frequency':'20','upper_fov':'5','lower_fov':'-20'}.items(): lbp.set_attribute(k,v)
lid=w.spawn_actor(lbp, carla.Transform(carla.Location(x=1.5,z=1.9)), attach_to=ego)
scans=[]; lid.listen(lambda d: scans.append(d))
col=w.spawn_actor(bl.find('sensor.other.collision'), carla.Transform(), attach_to=ego); hits=[]; col.listen(lambda e: hits.append(e))
c.start_recorder('./runs/spike/spike.log', True)
fwd=t_l.get_forward_vector()
lead.set_target_velocity(carla.Vector3D(fwd.x*20,fwd.y*20,fwd.z*20)); ego.set_target_velocity(carla.Vector3D(fwd.x*22,fwd.y*22,fwd.z*22))
t0=time.time()
for i in range(80):
    if i==40: lead.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0))
    else: lead.apply_control(carla.VehicleControl(throttle=0.5 if i<40 else 0.0, brake=0.0 if i<40 else 1.0))
    ego.apply_control(carla.VehicleControl(throttle=0.6))
    w.tick()
    if i%20==19:
        gap=lead.get_location().distance(ego.get_location()); ve=ego.get_velocity().length(); vl=lead.get_velocity().length()
        sc=scans[-1] if scans else None
        pts=np.frombuffer(sc.raw_data,dtype=np.float32).reshape(-1,4) if sc else None
        ahead=pts[(pts[:,0]>0)&(np.abs(pts[:,1])<1.5)&(pts[:,2]>-1.4)&(pts[:,2]<1.0)] if pts is not None else None
        print(f'tick {i+1}: gap {gap:.1f} m  v_ego {ve:.1f} v_lead {vl:.1f}  scans {len(scans)} pts {0 if pts is None else len(pts)} corridor_pts {0 if ahead is None else len(ahead)} nearest_x {None if ahead is None or not len(ahead) else round(float(ahead[:,0].min()),2)} frame {sc.frame if sc else None} ts {None if not sc else round(sc.timestamp,2)}')
print('80 ticks wall', round(time.time()-t0,2),'s; collisions', len(hits))
c.stop_recorder(); print('recorder info head:', c.show_recorder_file_info('./runs/spike/spike.log', False)[:300].replace('\n',' | '))
for a in (lid,col,ego,lead): a.destroy()
s.synchronous_mode=False; s.fixed_delta_seconds=None; w.apply_settings(s)
