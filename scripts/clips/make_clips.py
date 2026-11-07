"""Short scripted CARLA scenario clips for the Faultline website (illustrative; no 0G decisions drive these).

Usage: .venv/bin/python scripts/clips/make_clips.py <lead-brake|cut-in|pedestrian|lidar-dropout|intersection> <out.mp4>
Takes the shared flock (faultline.carla_world.LOCK_PATH), runs synchronous mode at dt 0.05 and renders one 1920x1080
frame per sim tick (20 fps = sim time). Never loads a map or touches the server; always restores the previous world
settings and weather and destroys its actors. Vehicles are physics-driven (pure pursuit + throttle/brake), the
pedestrian uses WalkerControl. Geometry: Town10HD_Opt road 7 (straight, lanes -1/-2, shoulder -3) and T-junction 23.
"""
import fcntl
import math
import queue
import subprocess
import sys

import carla
import numpy as np

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])
from faultline.carla_world import LOCK_PATH, LIDAR_ATTRS  # noqa: E402
from faultline.director import Painter, ffmpeg_cmd, turbo  # noqa: E402

DT, FPS, W, H, WARM = 0.05, 20, 1920, 1080, 15
ROAD7 = carla.Location(x=-24.0, y=-57.75, z=0.0)  # road 7 lane -2, as in faultline/carla_cutin.py


def lane_path(wp, length, back=0.0, step=0.5):
    """Lane centre points (x, y, z) from `back` m behind wp to `length` m ahead, following next()[0]."""
    pts = []
    if back:
        cur = wp
        for _ in range(int(back / step)):
            cur = cur.previous(step)[0]
            pts.append(cur)
        pts.reverse()
    cur = wp
    pts.append(cur)
    for _ in range(int(length / step)):
        cur = cur.next(step)[0]
        pts.append(cur)
    return np.array([[p.transform.location.x, p.transform.location.y, p.transform.location.z] for p in pts])


def pose(path, arc, step=0.5, dz=0.3):
    i = int(np.clip(arc / step, 0, len(path) - 2))
    d = path[i + 1] - path[i]
    return carla.Transform(carla.Location(x=float(path[i, 0]), y=float(path[i, 1]), z=float(path[i, 2] + dz)),
                           carla.Rotation(yaw=math.degrees(math.atan2(d[1], d[0]))))


class Driver:
    """Pure pursuit on a point path; speed by target speed (P control) or a direct brake command."""

    def __init__(self, actor, path, step=0.5, look=0.9):
        self.a, self.path, self.step, self.i, self.look = actor, path, step, 0, look

    def speed(self):
        v = self.a.get_velocity()
        return math.hypot(v.x, v.y)

    def arc(self):
        return self.i * self.step

    def kick(self, v):
        yaw = math.radians(self.a.get_transform().rotation.yaw)
        self.a.set_target_velocity(carla.Vector3D(v * math.cos(yaw), v * math.sin(yaw), 0))

    def drive(self, vt=None, brake=None):
        tf, v = self.a.get_transform(), self.speed()
        p = np.array([tf.location.x, tf.location.y])
        seg = self.path[self.i:self.i + 80, :2]
        self.i += int(np.argmin(np.linalg.norm(seg - p, axis=1)))
        L = max(4.0, self.look * v)
        tx, ty = self.path[min(self.i + int(L / self.step), len(self.path) - 1), :2]
        alpha = math.atan2(ty - p[1], tx - p[0]) - math.radians(tf.rotation.yaw)
        alpha = (alpha + math.pi) % (2 * math.pi) - math.pi
        steer = float(np.clip(math.atan2(2 * 2.9 * math.sin(alpha), L) / math.radians(60), -1, 1))
        if brake is not None:
            c = carla.VehicleControl(throttle=0.0, steer=steer, brake=float(brake))
        else:
            e = vt - v
            c = (carla.VehicleControl(throttle=float(np.clip(0.3 + 0.25 * e, 0, 0.9)), steer=steer) if e > -0.4 else
                 carla.VehicleControl(throttle=0.0, steer=steer, brake=float(np.clip(-0.25 * e, 0, 1))))
        self.a.apply_control(c)


def idm(v, v0, gap, dv, s0=3.0, T=0.9, a=2.0, b=3.0):
    """Desired accel; gap bumper-to-bumper (None = free road), dv = v - v_lead."""
    free = 1 - (v / v0) ** 4
    if gap is None:
        return a * free
    s_star = s0 + max(0.0, v * T + v * dv / (2 * math.sqrt(a * b)))
    return a * (free - (s_star / max(gap, 0.1)) ** 2)


def follow(drv, v0, gap, dv):
    acc = idm(drv.speed(), v0, gap, dv)
    if acc < -0.3:
        drv.drive(brake=min(1.0, -acc / 7.0))
    else:
        drv.drive(vt=min(v0, drv.speed() + acc))


def bumper_gap(ego, other):
    """Bumper-to-bumper distance along the ego heading, and lateral offset of `other` (ego frame, m)."""
    et, ot = ego.get_transform(), other.get_transform()
    yaw = math.radians(et.rotation.yaw)
    dx, dy = ot.location.x - et.location.x, ot.location.y - et.location.y
    fwd, lat = dx * math.cos(yaw) + dy * math.sin(yaw), -dx * math.sin(yaw) + dy * math.cos(yaw)
    return fwd - ego.bounding_box.extent.x - other.bounding_box.extent.x, lat


def look_at(eye, target):
    d = target - eye
    return carla.Transform(eye, carla.Rotation(pitch=math.degrees(math.atan2(d.z, math.hypot(d.x, d.y))),
                                               yaw=math.degrees(math.atan2(d.y, d.x))))


class Sim:
    def __init__(self):
        self.client = carla.Client("127.0.0.1", 2000)
        self.client.set_timeout(30.0)
        self.lock = open(LOCK_PATH, "w")
        fcntl.flock(self.lock, fcntl.LOCK_EX)  # shared server: wait for any faultline run to finish
        self.world = self.client.get_world()
        stray = [a.type_id for a in self.world.get_actors() if a.type_id.startswith(("vehicle.", "walker."))]
        assert not stray, f"another client's actors are in the world: {stray}"
        assert "Town10HD" in self.world.get_map().name, "expects Town10HD_Opt already loaded (never reloads)"
        self.map, self.bl = self.world.get_map(), self.world.get_blueprint_library()
        self.saved, self.weather = self.world.get_settings(), self.world.get_weather()
        st = self.world.get_settings()
        st.synchronous_mode, st.fixed_delta_seconds = True, DT
        self.world.apply_settings(st)
        self.actors, self.sensors, self.t = [], [], 0.0

    def vehicle(self, bp_id, tf, color=None):
        bp = self.bl.find(bp_id)
        if color and bp.has_attribute("color"):
            bp.set_attribute("color", color)
        bp.set_attribute("role_name", "clip")
        a = self.world.spawn_actor(bp, tf)
        self.actors.append(a)
        return a

    def camera(self, tf, attach=None, w=W, h=H, fov=72):
        bp = self.bl.find("sensor.camera.rgb")
        for k, v in {"image_size_x": str(w), "image_size_y": str(h), "fov": str(fov)}.items():
            bp.set_attribute(k, v)
        cam = self.world.spawn_actor(bp, tf, attach_to=attach) if attach else self.world.spawn_actor(bp, tf)
        q = queue.Queue()
        cam.listen(q.put)
        self.sensors.append(cam)
        return q

    def lidar(self, attach):
        bp = self.bl.find("sensor.lidar.ray_cast")
        for k, v in LIDAR_ATTRS.items():
            bp.set_attribute(k, v)
        s = self.world.spawn_actor(bp, carla.Transform(carla.Location(x=1.5, z=1.9)), attach_to=attach)
        q = queue.Queue()
        s.listen(q.put)
        self.sensors.append(s)
        return q

    def tick(self):
        self.frame = self.world.tick()
        self.t += DT
        return self.frame

    def get(self, q):
        d = q.get(timeout=20.0)
        while d.frame < self.frame:
            d = q.get(timeout=20.0)
        return d

    def close(self):
        for s in self.sensors:
            try:
                s.stop()
            except RuntimeError:
                pass
        for a in self.sensors + self.actors:
            try:
                a.destroy()
            except RuntimeError:
                pass
        try:
            self.world.tick()
        except RuntimeError:
            pass
        self.saved.synchronous_mode, self.saved.fixed_delta_seconds = False, None  # always hand back async mode
        self.world.apply_settings(self.saved)
        self.world.set_weather(self.weather)
        # a spawn that raises can still leave the actor alive on this build (seen twice): sweep everything we tagged
        left = [a.id for a in self.world.get_actors() if a.attributes.get("role_name") == "clip"]
        self.client.apply_batch_sync([carla.command.DestroyActor(i) for i in left], False)
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        self.lock.close()


def tagged(sim, bp_id):
    bp = sim.bl.find(bp_id)
    bp.set_attribute("role_name", "clip")
    return bp


def img(d, w=W, h=H):
    return np.frombuffer(d.raw_data, dtype=np.uint8).reshape(h, w, 4).copy()


def label(buf, title, sub="CARLA 0.10 · scripted scenario"):
    p = Painter(buf)
    p.rect(28, H - 108, max(470, 15 * len(title) + 40), 80, (0, 0, 0), 0.55)
    p.text(46, H - 98, title, 26, (255, 255, 255), bold=True)
    p.text(46, H - 60, sub, 18, (205, 205, 205))
    p.flush()


# ---- scenarios: each yields one BGRX frame per tick -------------------------------------------------------------
def lead_brake(sim, n):
    wp = sim.map.get_waypoint(ROAD7)
    path = lane_path(wp, 120, back=30)
    ego = sim.vehicle("vehicle.lincoln.mkz", pose(path, 2.0), "20,60,140")
    lead = sim.vehicle("vehicle.dodge.charger", pose(path, 16.0), "150,10,10")
    de, dl = Driver(ego, path), Driver(lead, path)
    cam = sim.camera(carla.Transform(carla.Location(x=-8.5, y=-1.2, z=3.6), carla.Rotation(pitch=-11, yaw=3)), ego)
    for k in range(WARM + n):
        if k == WARM - 3:
            de.kick(12.0), dl.kick(12.0)
        t = (k - WARM) * DT
        if k < WARM - 3:
            de.drive(brake=1.0), dl.drive(brake=1.0)
        else:
            dl.drive(brake=1.0) if t >= 4.0 else dl.drive(vt=12.0)
            g, _ = bumper_gap(ego, lead)
            follow(de, 12.0, g, de.speed() - dl.speed())
        sim.tick()
        f = img(sim.get(cam))
        if k >= WARM:
            label(f, "Lead vehicle suddenly brakes")
            yield f


def cut_in(sim, n):
    wp = sim.map.get_waypoint(ROAD7)
    ego_p = lane_path(wp, 120, back=30)
    left_p = lane_path(wp.get_left_lane(), 120, back=30)
    a1 = 1e9
    ego = sim.vehicle("vehicle.lincoln.mkz", pose(ego_p, 10.0), "20,60,140")
    adv = sim.vehicle("vehicle.dodge.charger", pose(left_p, 4.0), "230,140,0")
    de, da = Driver(ego, ego_p), Driver(adv, left_p, look=0.4)
    cam = sim.camera(carla.Transform(carla.Location(x=-9.0, y=-1.6, z=3.6), carla.Rotation(pitch=-12, yaw=3)), ego)
    for k in range(WARM + n):
        if k == WARM - 3:
            de.kick(11.0), da.kick(14.0)
        if k < WARM - 3:
            de.drive(brake=1.0), da.drive(brake=1.0)
        else:
            if a1 > 1e8 and da.arc() - de.arc() > 6.5:  # sharp lane change over 11 m, just ahead of the ego
                a0, a1 = da.arc() + 0.5, da.arc() + 13.5
                u = np.clip((np.arange(len(ego_p)) * 0.5 - a0) / (a1 - a0), 0, 1)
                u = u * u * (3 - 2 * u)
                da.path = left_p * (1 - u)[:, None] + ego_p * u[:, None]
            da.drive(vt=14.0 if da.arc() < a1 else 6.0)
            g, lat = bumper_gap(ego, adv)
            follow(de, 11.0, g if abs(lat) < 2.4 else None, de.speed() - da.speed())
        sim.tick()
        f = img(sim.get(cam))
        if k >= WARM:
            label(f, "Aggressive cut-in")
            yield f


def pedestrian(sim, n):
    wp = sim.map.get_waypoint(ROAD7)
    path = lane_path(wp.get_left_lane(), 120, back=30)
    shp = lane_path(wp, 120, back=30)
    yaw0 = math.radians(sim.map.get_waypoint(ROAD7).transform.rotation.yaw)
    shp[:, 0] -= 0.4 * math.sin(yaw0)  # 0.4 m towards the kerb
    shp[:, 1] += 0.4 * math.cos(yaw0)
    for van_arc in np.arange(66.0, 90.0, 0.5):  # first free spot (the map has parked cars at the kerb)
        van = sim.world.try_spawn_actor(tagged(sim, "vehicle.sprinter.mercedes"), pose(shp, van_arc, dz=0.2))
        if van:
            sim.actors.append(van)
            break
    assert van, "no free spot for the van"
    for truck_arc in np.arange(van_arc + 8.0, van_arc + 20.0, 0.5):  # first free spot ahead (the map has parked cars)
        truck = sim.world.try_spawn_actor(tagged(sim, "vehicle.carlacola.actors"), pose(shp, truck_arc, dz=0.2))
        if truck:
            sim.actors.append(truck)
            break
    assert truck, "no free spot for the truck"
    van_front = van_arc + van.bounding_box.extent.x
    walk_arc = (van_front + truck_arc - truck.bounding_box.extent.x) / 2  # in the gap, hidden behind the van
    print("van", van_arc, "truck", truck_arc, "walker", walk_arc, flush=True)
    ego = sim.vehicle("vehicle.lincoln.mkz", pose(path, 2.0), "20,60,140")
    wbp = tagged(sim, "walker.pedestrian.0040")
    if wbp.has_attribute("is_invincible"):
        wbp.set_attribute("is_invincible", "true")
    wtf = pose(shp, walk_arc, dz=1.0)
    wtf.rotation.yaw -= 90  # facing the road (left of the driving direction)
    ped = sim.world.spawn_actor(wbp, wtf)
    sim.actors.append(ped)
    de = Driver(ego, path)
    yaw = math.radians(wtf.rotation.yaw)
    wdir = carla.Vector3D(math.cos(yaw), math.sin(yaw), 0.0)
    cam = sim.camera(carla.Transform(carla.Location(x=-8.0, y=0.5, z=3.0), carla.Rotation(pitch=-9)), ego)
    walking, seen_t = None, None
    for k in range(WARM + n):
        t = (k - WARM) * DT
        if k == WARM - 3:
            de.kick(10.0)
        if k < WARM - 3:
            de.drive(brake=1.0)
            ped.apply_control(carla.WalkerControl(direction=wdir, speed=0.0))
        else:
            ego_front = de.arc() + 2.4
            if walking is None and walk_arc - ego_front < 21.0:
                walking = t
            lat = abs(bumper_gap(ego, ped)[1])
            if walking is not None:
                # WalkerControl/set_target_velocity move walkers at ~0.1 m/s on this 0.10 build (measured), so the
                # position is scripted with set_transform; the control still drives the walk animation
                spd = 2.2 if t - walking < 1.55 else (0.0 if t - walking < 3.3 else 1.6)
                ped.apply_control(carla.WalkerControl(direction=wdir, speed=spd))
                walked += spd * DT
                ped.set_transform(carla.Transform(w0 + wdir * walked, wtf.rotation))
            else:
                w0, walked = ped.get_location(), 0.0
            if seen_t is None and walking is not None and lat < 2.3:
                seen_t = t
            if seen_t is not None and t - seen_t > 0.25:
                de.drive(brake=1.0)
            else:
                de.drive(vt=10.0)
        sim.tick()
        f = img(sim.get(cam))
        if k >= WARM:
            label(f, "Pedestrian emerges from behind a parked vehicle")
            yield f


BEV_W, BEV_PX_M, BEV_BACK = 840, 16.0, 10.0


def bev(buf, pts, x0, gt_box, lost):
    """LiDAR bird's-eye on buf[:, x0:x0+BEV_W] (sensor frame x fwd, y right), turbo-coloured by height."""
    w, h = BEV_W, H
    buf[:, x0:x0 + w, :3] = (18, 14, 12)
    if len(pts):
        u = (x0 + w / 2 + pts[:, 1] * BEV_PX_M).astype(int)
        v = (h - (pts[:, 0] + BEV_BACK) * BEV_PX_M).astype(int)
        ok = (u >= x0) & (u < x0 + w) & (v >= 0) & (v < h)
        hz = pts[ok, 2] + 1.9  # height above the road (sensor 1.9 m up)
        col = turbo(0.25 + hz / 2.6)
        col[hz < 0.3] = (60, 60, 64)  # ground returns
        for du in (0, 1):
            for dv in (0, 1):
                buf[np.clip(v[ok] + dv, 0, h - 1), np.clip(u[ok] + du, x0, x0 + w - 1), :3] = col[:, ::-1]
    p = Painter(buf)
    px = lambda f, r: (x0 + w / 2 + r * BEV_PX_M, h - (f + BEV_BACK) * BEV_PX_M)
    ex, ey = px(0, 0)
    p.rect(ex - 1.05 * BEV_PX_M, ey - 0.9 * BEV_PX_M, 2.1 * BEV_PX_M, 4.9 * BEV_PX_M, (90, 170, 255), 1.0, fill=False, lw=3)
    f, r, ln, wd = gt_box
    bx, by = px(f + ln / 2, r - wd / 2)
    if lost:
        p.cr.set_dash([8, 6])
        p.rect(bx - 6, by - 6, wd * BEV_PX_M + 12, ln * BEV_PX_M + 12, (255, 60, 60), 1.0, fill=False, lw=3)
        p.cr.set_dash([])
        p.text(bx + wd * BEV_PX_M + 16, by + 4, "no returns", 18, (255, 90, 90), bold=True)
        p.rect(x0 + 24, 70, 300, 44, (190, 25, 25), 0.9)
        p.text(x0 + 40, 80, "LiDAR dropout", 22, (255, 255, 255), bold=True)
    else:
        p.rect(bx - 6, by - 6, wd * BEV_PX_M + 12, ln * BEV_PX_M + 12, (40, 230, 255), 1.0, fill=False, lw=3)
        p.text(bx + wd * BEV_PX_M + 16, by + 4, "obstacle", 18, (40, 230, 255), bold=True)
    p.rect(x0, 0, w, 44, (0, 0, 0), 0.6)
    p.text(x0 + 16, 11, "Ego LiDAR · bird's-eye", 20, bold=True)
    p.rect(x0, 0, 3, h, (60, 60, 60))
    p.flush()


def lidar_dropout(sim, n):
    wp = sim.map.get_waypoint(ROAD7)
    path = lane_path(wp, 120, back=30)
    ego = sim.vehicle("vehicle.lincoln.mkz", pose(path, 2.0), "20,60,140")
    lead = sim.vehicle("vehicle.taxi.ford", pose(path, 36.0), None)
    de, dl = Driver(ego, path), Driver(lead, path)
    cam = sim.camera(carla.Transform(carla.Location(x=-9.0, y=-2.2, z=4.0), carla.Rotation(pitch=-12, yaw=6)), ego,
                     w=W - BEV_W, h=H, fov=80)
    lq = sim.lidar(ego)
    d0, d1 = 4.5, 5.6  # dropout window (s): the obstacle's sector returns nothing
    for k in range(WARM + n):
        t = (k - WARM) * DT
        if k == WARM - 3:
            de.kick(12.0), dl.kick(6.0)
        g, lat = bumper_gap(ego, lead)
        lost = d0 <= t < d1
        if k < WARM - 3:
            de.drive(brake=1.0), dl.drive(brake=1.0)
        else:
            dl.drive(vt=6.0 if t < 4.0 else 3.0)
            # the follower reacts only to what its LiDAR shows: during the dropout it sees free road
            follow(de, 12.0, None if lost else g, de.speed() - dl.speed())
        sim.tick()
        cam_img, scan = img(sim.get(cam), W - BEV_W, H), sim.get(lq)
        if k < WARM:
            continue
        pts = np.frombuffer(scan.raw_data, dtype=np.float32).reshape(-1, 4)[:, :3].copy()
        fwd = g + ego.bounding_box.extent.x + lead.bounding_box.extent.x - 1.5  # lead centre, from the LiDAR origin
        if lost:
            az = np.degrees(np.arctan2(pts[:, 1], pts[:, 0]))
            a_c = math.degrees(math.atan2(lat, fwd))
            half = math.degrees(math.atan2(lead.bounding_box.extent.y + 0.6, max(fwd - 2.5, 1.0)))
            pts = pts[~((np.abs(az - a_c) <= half) & (pts[:, 0] > 2.0))]
        buf = np.zeros((H, W, 4), np.uint8)
        buf[:, :W - BEV_W] = cam_img
        bev(buf, pts, W - BEV_W, (fwd, lat, 2 * lead.bounding_box.extent.x, 2 * lead.bounding_box.extent.y), lost)
        label(buf, "Sensor temporarily loses sight of an obstacle")
        yield buf


def intersection(sim, n):
    jn = sim.map.get_waypoint(ROAD7).previous(5.0)[0].get_junction()  # T-junction 23 just before road 7
    lanes = {(a.road_id, a.lane_id): a for a, _ in jn.get_waypoints(carla.LaneType.Driving)}
    j_ego, j_x = lanes[(89, -2)], lanes[(100, 1)]  # eastbound straight; side street turning right across it
    assert (j_ego.road_id, j_ego.lane_id, j_x.road_id) == (89, -2, 100), (j_ego.road_id, j_ego.lane_id, j_x.road_id)
    ep, xp = lane_path(j_ego, 60, back=90), lane_path(j_x, 45, back=35)
    dd = np.linalg.norm(ep[:, None, :2] - xp[None, :, :2], axis=2)
    ie, ix = np.unravel_index(np.argmin(dd), dd.shape)
    se, sx = ie * 0.5, ix * 0.5  # arcs to the conflict point
    ve, vx = 9.0, 11.0
    t1 = (sx - 14.0) / vx + 2.4  # cross car 12 m from the conflict at ~t1 s of the clip
    e0 = se - 15.4 - ve * t1  # the ego's front is then ~13 m from it: it brakes hard and stops short
    ego = sim.vehicle("vehicle.lincoln.mkz", pose(ep, e0), "20,60,140")
    xc = sim.vehicle("vehicle.nissan.patrol", pose(xp, 2.0), "200,30,30")
    de, dx = Driver(ego, ep), Driver(xc, xp)
    c = carla.Location(x=float(ep[ie, 0]), y=float(ep[ie, 1]), z=0.5)
    cam = sim.camera(look_at(carla.Location(x=c.x + 13.0, y=c.y + 15.0, z=19.0), c + carla.Location(x=-5.0, y=-2.0)),
                     fov=75)
    brake_t = None
    for k in range(WARM + n):
        t = (k - WARM) * DT
        if k == WARM - 3:
            de.kick(ve)
        if k < WARM - 3:
            de.drive(brake=1.0), dx.drive(brake=1.0)
        else:
            if t < 2.4:
                dx.drive(brake=1.0)  # waiting at the side street, then goes late and fast
            else:
                if t < 2.5:
                    dx.kick(vx)
                dx.drive(vt=vx if dx.arc() < sx - 9.0 else 7.5)  # fast up to the turn, then just holds the corner
            if brake_t is None and dx.arc() > sx - 12.0:
                brake_t = t
            de.drive(brake=1.0) if brake_t is not None and t < brake_t + 3.0 else de.drive(vt=ve)
        sim.tick()
        f = img(sim.get(cam))
        if k >= WARM:
            label(f, "Near-miss at an intersection")
            yield f


SCEN = {"lead-brake": (lead_brake, 11.0), "cut-in": (cut_in, 11.0), "pedestrian": (pedestrian, 11.0),
        "lidar-dropout": (lidar_dropout, 11.0), "intersection": (intersection, 11.0)}


def main():
    name, out = sys.argv[1], sys.argv[2]
    fn, secs = SCEN[name]
    sim = Sim()
    cmd = ffmpeg_cmd(out, W, H, FPS)  # a high-quality master; publish.sh makes the web encodes
    cmd[cmd.index("-crf") + 1], cmd[cmd.index("-preset") + 1] = "16", "medium"
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for i, f in enumerate(fn(sim, int(secs * FPS))):
            ff.stdin.write(f.tobytes())
            if i % 10 == 0:  # progress: per-actor x, y, speed
                print(f"t {i * DT:5.2f} " + "  ".join(
                    f"{a.type_id.split('.')[-1][:6]} {a.get_location().x:6.1f},{a.get_location().y:6.1f} "
                    f"{math.hypot(a.get_velocity().x, a.get_velocity().y):4.1f}" for a in sim.actors), flush=True)
    finally:
        sim.close()
        ff.stdin.close()
        ff.wait()


if __name__ == "__main__":
    main()
