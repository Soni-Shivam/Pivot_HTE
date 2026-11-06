import argparse
import sys

from faultline.stack.check import check, digest, render, resolve

p = argparse.ArgumentParser(prog="python -m faultline.stack")
sub = p.add_subparsers(dest="cmd", required=True)
c = sub.add_parser("check", help="compatibility report + stack artifact digest")
c.add_argument("target", help="stack.yaml | module:Class")
c.add_argument("--steps", type=int, default=40)
d = sub.add_parser("digest", help="print only the stack artifact digest (0x...)")
d.add_argument("target")
a = p.parse_args()
if a.cmd == "check":
    rep = check(a.target, a.steps)
    print(render(rep))
    sys.exit(0 if rep["ok"] else 1)
print(digest(resolve(a.target)[0].get("files", [])))
