// Your stack: static onboarding guidance. Adapter tabs, copyable snippets and an onboarding request that is only
// copied to the clipboard (nothing is sent or stored). Facts ported from the 0f00ef3 studio and docs/evidence/faultline-stack-bridge.md.
import { href, type Page } from '../routes'
import { esc, copyText } from '../core/dom'
import { tabs } from '../core/a11y'

const SNIP: Record<string, string> = {
  'py-yaml': `name: my-planner
adapter: python            # python | leaderboard | ros2
entry: my_pkg.stack:MyStack
latency_budget_s: 0.1
files:                     # digest over these is bound into the paid permit
  - my_pkg/stack.py`,
  py: `from faultline.stack.interface import Control, SensorSpec

class MyStack:
    def sensors(self):
        return [SensorSpec(id="LIDAR", type="lidar", x=1.5, z=1.9, rate_hz=20,
                           params={"channels": "64", "range": "80"})]

    def setup(self, mission, hd_map_path):
        self.route = mission  # route, speed limit, lane width, dt

    def run_step(self, observations, ego_state, t_s):
        frame, points = observations["LIDAR"]   # float32 (N, 4), sensor frame
        return Control(throttle=0.3, brake=0.0, steer=0.0)

    def destroy(self):
        pass`,
  'lb-yaml': `name: my-leaderboard-agent
adapter: leaderboard
entry: my_agent:MyAgent    # your existing Leaderboard agent class
config: configs/agent.yaml # passed to setup(path_to_conf_file)
latency_budget_s: 0.1
files:
  - my_agent.py`,
  'ros-yaml': `name: ros2-pdm-lite
adapter: ros2
control: ackermann         # or twist
latency_budget_s: 0.2      # no control in time: full brake that step
sensors:
  - {id: LIDAR, type: lidar, x: 1.5, z: 1.9, rate_hz: 20,
     params: {channels: "64", range: "80"}}
files:
  - faultline/stack/ros_node.py`,
  ros: `publishes (ROS_DOMAIN_ID=42, frame map = CARLA with y flipped)
  /faultline/stack/<sensor id>   sensor_msgs/PointCloud2
  /faultline/stack/odom          nav_msgs/Odometry
  /tf, /clock
  /faultline/stack/route         nav_msgs/Path (latched)
  /faultline/stack/map_path      std_msgs/String (latched, Lanelet2 .osm)
your stack answers on
  /faultline/stack/control       ackermann_msgs/AckermannDriveStamped
                                 or geometry_msgs/Twist`,
  check: `stack pdm-lite-lidar (adapter python)
  [OK  ] sensor LIDAR (lidar): rate 20 Hz -> every tick (dt 0.05 s)
  [OK  ] sensor LIDAR (lidar): present in the live blueprint library, 6 attributes checked
  [OK  ] sensor SPEED (odometry): rate 20 Hz -> every tick (dt 0.05 s)
  [OK  ] control interface: 40/40 steps returned Control in range
  [OK  ] reacts to the synthetic closing lead: brakes at step 4
  [OK  ] latency: p50 2.7 ms, p95 3.5 ms, max 3.8 ms vs budget 100 ms
  [OK  ] determinism: two fresh instances, same inputs -> identical controls
  RESULT: COMPATIBLE  digest 0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba`,
  onboard: `Faultline onboarding request
Stack name:
Adapter (python | leaderboard | ros2):
Sensors (type, count, mount):
Control interface (Control / Ackermann / Twist):
Checker result (python -m faultline.stack check stack.yaml):
Contact:`,
}
const code = (k: string, label: string) => `<div class="sk-code"><div class="sk-codehead"><span>${esc(label)}</span><button class="pill sm" data-sk-copy="${k}" aria-label="Copy ${esc(label)}">Copy</button></div><pre class="msg" id="sk-${k}">${esc(SNIP[k])}</pre></div>`
const TABS: [string, string, string][] = [
  ['py', 'Python', `<div class="sk-split">${code('py-yaml', 'stack.yaml')}${code('py', 'my_pkg/stack.py')}</div>`],
  ['lb', 'CARLA Leaderboard', `<div class="sk-split">${code('lb-yaml', 'stack.yaml')}<p>Your agent keeps its usual <code>setup(path_to_conf_file)</code>, <code>sensors()</code>, <code>set_global_plan()</code>, <code>run_step(input_data, timestamp)</code> and <code>destroy()</code>. Faultline calls them by duck typing and already produces observations in the Leaderboard <code>input_data</code> format. Radar and the OpenDRIVE map sensor are not bridged yet.</p></div>`],
  ['ros', 'ROS 2', `<div class="sk-split">${code('ros-yaml', 'stack.yaml')}${code('ros', 'ROS 2 topics')}</div>`],
]

const html = () => `<div class="grid">
  <div class="card k"><p class="kicker">Your stack</p><h1 class="sec" id="h-stack" style="color:var(--paper)">Test your own AV stack</h1>
    <p class="lede">Faultline owns the world, the attacker and the clock. Your stack owns the car's decisions. One small interface connects them.</p></div>

  <div class="card p sk-privacy">
    <h2 class="sec">Privacy boundary</h2>
    <div class="sk-split2">
      <div><h3>Your stack receives</h3><ul><li>Only the sensors it declares in stack.yaml</li><li>Its own ego state (speed, pose)</li><li>The route and the HD map path</li></ul></div>
      <div><h3>Your stack never receives</h3><ul><li>Other actors or ground truth</li><li>The attacker's plan</li><li>Anything from the server</li></ul></div>
    </div>
    <p style="margin:12px 0 0">Faultline ticks CARLA every 0.05 s. A control that is out of range, or late past the latency budget, is never applied: the car brakes that step.</p>
  </div>

  <div class="card">
    <h2 class="sec">Five steps</h2>
    <ol class="sk-steps">
      <li><b>Pick an adapter.</b> Python in process, an existing CARLA Leaderboard agent (no changes), or ROS 2 (Autoware and similar).</li>
      <li><b>Write stack.yaml.</b> Name, adapter, entry point or sensors, latency budget, and the files whose digest identifies your stack.</li>
      <li><b>Run the checker.</b> <code>python -m faultline.stack check stack.yaml</code> checks sensors against the live CARLA 0.10 blueprints, controls, latency, determinism and the digest.</li>
      <li><b>Dry run for free.</b> <code>python -m faultline.stack.arena --site seed:0 --stacks stack.yaml --mode script</code>. Add a second stack for an A/B comparison.</li>
      <li><b>Buy a paid run.</b> The Hedera permit binds the digest from step 3, so the paid run is tied to the stack you declared.</li>
    </ol>
  </div>

  <div class="card c">
    <h2 class="sec">Adapters</h2>
    <div class="sk-tabs" role="tablist" aria-label="Adapter">${TABS.map(([k, label], i) => `<button class="pill" role="tab" id="sk-tab-${k}" aria-controls="sk-panel-${k}" aria-selected="${i === 0}">${esc(label)}</button>`).join('')}</div>
    ${TABS.map(([k, , body], i) => `<div class="sk-panel${i ? ' hidden' : ''}" role="tabpanel" id="sk-panel-${k}" aria-labelledby="sk-tab-${k}" tabindex="0">${body}</div>`).join('')}
  </div>

  <div class="card">
    <h2 class="sec">Recorded compatibility checks</h2>
    <div class="tscroll"><table><thead><tr><th>Stack</th><th>Adapter</th><th>Result</th></tr></thead><tbody>
      <tr><td>PDM-Lite on our LiDAR tracker</td><td>Python</td><td><span class="sk-chip">✓ Compatible</span> 8 of 8 checks</td></tr>
      <tr><td>Cautious IDM (1.6 s headway)</td><td>Python</td><td><span class="sk-chip">✓ Compatible</span></td></tr>
      <tr><td>PDM-Lite as a ROS 2 node</td><td>ROS 2</td><td><span class="sk-chip">✓ Compatible</span> 40 of 40 controls over ROS, 1 first-step timeout (braked)</td></tr>
    </tbody></table></div>
    ${code('check', 'Checker output, PDM-Lite')}
    <p class="sk-prov">Recorded · checker run against live CARLA 0.10 blueprints · checked by local runner</p>
  </div>

  <div class="card y">
    <h2 class="sec">Onboard your stack</h2>
    <p class="lede" style="color:inherit">Copy a ready-made onboarding request, fill it in, and send it to the Faultline team. It is only copied to your clipboard; nothing is sent or stored.</p>
    <div class="row" style="margin-top:14px"><button class="btn k big" id="sk-onboard">Copy onboarding request</button><a class="btn big" href="${href.lab()}">Run a test with an example policy</a><span id="sk-onboard-msg" role="status"></span></div>
    <pre class="msg" id="sk-onboard-text">${esc(SNIP.onboard)}</pre>
  </div>
</div>`

export const page = {
  id: 'stack' as Page,
  title: 'Your stack',
  css: `
#v-stack .sk-privacy h3 { font-size: 18px; margin: 0 0 6px } #v-stack .sk-privacy ul { margin: 0; padding-left: 20px; display: grid; gap: 4px }
#v-stack .sk-split2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px }
#v-stack .sk-split { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.2fr); gap: 14px; align-items: start }
#v-stack .sk-steps { margin: 0; padding-left: 22px; display: grid; gap: 10px } #v-stack .sk-steps li { font-size: 16px }
#v-stack code { overflow-wrap: anywhere }
#v-stack .sk-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px }
#v-stack .sk-tabs [role=tab] { min-height: 44px } #v-stack .sk-tabs [aria-selected=true] { background: var(--ink); color: var(--paper) }
#v-stack .sk-code { min-width: 0; margin-top: 8px }
#v-stack .sk-codehead { display: flex; justify-content: space-between; align-items: center; gap: 8px; font: 600 13px var(--mono) }
#v-stack .sk-codehead .pill { min-height: 44px }
#v-stack .sk-chip { font: 600 13px var(--mono); padding: 3px 9px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--lime); white-space: nowrap }
#v-stack .sk-prov { font: 13px/1.45 var(--mono); color: var(--muted); margin: 12px 0 0 }
#v-stack #sk-onboard-msg { font-weight: 600 }
@media (max-width: 760px) { #v-stack .sk-split, #v-stack .sk-split2 { grid-template-columns: 1fr } }
`,
  mount(root: HTMLElement) {
    root.setAttribute('aria-labelledby', 'h-stack')
    root.innerHTML = html()
    tabs(root.querySelector<HTMLElement>('.sk-tabs')!)
    root.querySelectorAll<HTMLButtonElement>('[data-sk-copy]').forEach((b) => b.addEventListener('click', () => copyText(SNIP[b.dataset.skCopy!], b)))
    const msg = root.querySelector<HTMLElement>('#sk-onboard-msg')!
    root.querySelector('#sk-onboard')!.addEventListener('click', () => copyText(SNIP.onboard, msg, 'Copied. Paste it into a message to the Faultline team.'))
  },
  open(_id: string | null, _search: URLSearchParams) {},
}
