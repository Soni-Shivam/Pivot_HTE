import sys, carla, time
sys.path.insert(0, '/home/sedrica-w/carla/Carla-0.10.0-Linux-Shipping/PythonAPI/carla')
try:
    from agents.navigation.behavior_agent import BehaviorAgent; from agents.navigation.controller import VehiclePIDController; print('agents import OK')
except Exception as e: print('agents import FAIL', e)
c=carla.Client('127.0.0.1',2000); c.set_timeout(60); w=c.get_world(); m=w.get_map(); bl=w.get_blueprint_library()
s=w.get_settings(); s.synchronous_mode=True; s.fixed_delta_seconds=0.05; w.apply_settings(s)
cands=[]
for sp in m.get_spawn_points():
    wp=m.get_waypoint(sp.location, project_to_road=True, lane_type=carla.LaneType.Driving); d=0; cur=wp; ok=True
    while d<140:
        nxt=cur.next(5.0)
        if not nxt or nxt[0].is_junction: ok=False; break
        cur=nxt[0]; d+=5
    if ok: cands.append(wp)
bp=bl.find('vehicle.lincoln.mkz')
for i,wp in enumerate(cands):
    t=wp.transform; t.location.z+=0.5; v=w.try_spawn_actor(bp,t)
    if not v: print(i,'spawn fail'); continue
    w.tick(); w.tick()
    lm=wp.get_landmarks_of_type(150.0,'274')
    print(f'cand {i}: road {wp.road_id} lane {wp.lane_id} lanes_right {wp.lane_change} speed_limit {v.get_speed_limit():.0f} km/h loc ({wp.transform.location.x:.0f},{wp.transform.location.y:.0f}) yaw {wp.transform.rotation.yaw:.0f} limits_ahead {[int(l.value) for l in lm][:4]}')
    v.destroy(); w.tick()
s.synchronous_mode=False; s.fixed_delta_seconds=None; w.apply_settings(s)
