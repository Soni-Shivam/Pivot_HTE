"""Combined Criticality Score, v2: sigmoid normalisation and a fuzzy OR.

v1 is kept alongside this (`composite_scorer.py`) so old reports stay readable,
but it should not be used to rank anything. It has two faults, and the second is
the serious one.

**It double-counts.** `btn_score = clip(max_btn, 0, 1)` and
`drac_score = clip(max_drac / 8.0, 0, 1)`, while BTN is *defined* as
`drac / a_max_brake` with `a_max_brake = 8.0`. The two components are
algebraically the same number, so 0.25 + 0.20 = **45% of the total weight sits
on one quantity**, and both saturate together the instant DRAC reaches 8 m/s2 --
which is exactly the near-crash region the score exists to discriminate within.
BTN is dropped here entirely rather than reweighted; it carries no information
DRAC does not.

**It dilutes.** A weighted sum averages risk. Take a vehicle 0.8 s from a
lateral collision while longitudinal physics and headway are perfectly safe:
under a linear sum the one critical number is divided by the safe ones and the
scenario reports as moderate. Worse, v1 gives TTC2D **zero weight**, so a
crossing conflict scores near zero however close it came. An optimiser pointed
at that objective would learn to avoid rear-ending the car ahead and drive
happily into T-bones.

The architecture here fixes both:

1. **One metric per domain**, so nothing amplifies itself.

   | domain | metric | why |
   |---|---|---|
   | longitudinal physics | DRAC | what the ego must produce, against what it can |
   | longitudinal kinematics | THW | how much time the gap represents |
   | lateral / crossing | TTC2D | the only one that sees a crossing conflict |

2. **Sigmoid normalisation** into a unitless [0, 1] "probability of collision".
   Sigmoids give steep gradients exactly at the decision boundary and flatten
   where the scene is already safe, so a search engine spends its effort where
   the answer changes rather than polishing a safe state.

3. **Fuzzy OR** -- the probabilistic union, `1 - prod(1 - m_i)`. Any single
   metric going critical pulls the whole score up, which is the property a
   safety score must have and a weighted sum cannot provide. It is smooth and
   differentiable everywhere, and bounded to [0, 1] by construction, so it is
   also a well-behaved objective.

The alternatives considered were LogSumExp (a smooth max, needs an alpha and a
`ln(n)` correction to stay bounded) and an L-p norm with p around 4-6. Both work;
the fuzzy OR was chosen because it needs no tuning parameter beyond the
per-metric thresholds, which have physical meaning and can be argued about
directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

VERSION = 2

#: Every threshold is the value at which that metric alone is 50% critical, and
#: every steepness controls how sharply the score moves across it. They are
#: stated in the metric's own units so they can be argued about physically
#: rather than tuned blindly.
@dataclass(frozen=True)
class Thresholds:
    #: Time-to-collision in 2-D, seconds. 1.5 s is the usual "critical TTC"
    #: line in the surrogate-safety literature and the value this repo's own
    #: TTC metric already flags at.
    ttc2d_mid: float = 1.5
    ttc2d_k: float = 4.0
    #: Deceleration to avoid a crash, m/s2. 4.0 is where braking stops being
    #: comfortable and becomes an emergency manoeuvre; the tyre limit on dry
    #: tarmac is about 8.
    drac_mid: float = 4.0
    drac_k: float = 1.5
    #: Time headway, seconds. 1.0 s is the point below which no reaction budget
    #: remains.
    thw_mid: float = 1.0
    thw_k: float = 3.0


DEFAULT_THRESHOLDS = Thresholds()


#: `math.exp` overflows around 709. Beyond this the sigmoid is 0 or 1 to far
#: more precision than any of these metrics carry, so the exponent is clamped
#: rather than computed. A live episode reported a TTC2D of ~1e5 seconds -- two
#: actors barely converging -- and the unclamped form raised OverflowError
#: mid-run, which the tests missed because they used `inf`, and `inf` was
#: already guarded.
_EXP_LIMIT = 60.0


def _logistic(exponent: float) -> float:
    """`1 / (1 + exp(exponent))`, saturating instead of overflowing."""
    if exponent >= _EXP_LIMIT:
        return 0.0
    if exponent <= -_EXP_LIMIT:
        return 1.0
    return 1.0 / (1.0 + math.exp(exponent))


def falling_sigmoid(value: float, mid: float, k: float) -> float:
    """Criticality of a metric where **lower is more dangerous** (times).

    1 as the value approaches 0, 0.5 at `mid`, 0 as it grows. Non-negative
    times only; a negative or NaN time means "no conflict on this axis" and
    scores 0 rather than saturating.
    """
    if value is None or not math.isfinite(value):
        return 0.0
    if value <= 0.0:
        # Already at or past the conflict point.
        return 1.0
    return _logistic(k * (value - mid))


def rising_sigmoid(value: float, mid: float, k: float) -> float:
    """Criticality of a metric where **higher is more dangerous** (decelerations)."""
    if value is None or not math.isfinite(value):
        return 0.0
    if value <= 0.0:
        return 0.0
    return _logistic(-k * (value - mid))


def fuzzy_or(components: dict) -> float:
    """The probabilistic union of independent criticalities.

    `1 - prod(1 - m_i)`: the complement of everything being safe at once. One
    component at 0.94 with the rest at 0.01 gives 0.94, not the 0.3 a weighted
    average would return -- which is the entire point.
    """
    safe = 1.0
    for value in components.values():
        safe *= (1.0 - min(max(float(value), 0.0), 1.0))
    return 1.0 - safe


@dataclass
class CriticalityBreakdown:
    """A score plus the reason for it.

    The components are carried, not just the total, because a report has to be
    able to say *which* factor made a scenario critical -- and because with a
    fuzzy OR the answer is usually one of them rather than the mixture.
    """

    ccs: float
    components: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)
    version: int = VERSION

    @property
    def dominant(self) -> str:
        """The component that contributed most. Empty when nothing is critical."""
        if not self.components:
            return ""
        name, value = max(self.components.items(), key=lambda kv: kv[1])
        return name if value > 0.01 else ""

    def as_dict(self) -> dict:
        return {
            "ccs": self.ccs,
            "components": dict(self.components),
            "raw": dict(self.raw),
            "dominant": self.dominant,
            "version": self.version,
        }


def score(drac: float | None = None, ttc2d: float | None = None,
          thw: float | None = None,
          thresholds: Thresholds = DEFAULT_THRESHOLDS) -> CriticalityBreakdown:
    """Score one instant from the three domain metrics.

    Any metric may be `None` or infinite, meaning "no conflict on this axis" --
    which scores 0 and, under a fuzzy OR, correctly leaves the total to the
    others. That is a real improvement on v1, where a missing metric defaulted
    to a *low-danger* number and quietly pulled a weighted average down.
    """
    components = {
        "drac": rising_sigmoid(drac, thresholds.drac_mid, thresholds.drac_k),
        "ttc2d": falling_sigmoid(ttc2d, thresholds.ttc2d_mid, thresholds.ttc2d_k),
        "thw": falling_sigmoid(thw, thresholds.thw_mid, thresholds.thw_k),
    }
    return CriticalityBreakdown(
        ccs=fuzzy_or(components),
        components=components,
        raw={"drac": drac, "ttc2d": ttc2d, "thw": thw},
    )


def score_series(dracs, ttc2ds, thws,
                 thresholds: Thresholds = DEFAULT_THRESHOLDS) -> list[CriticalityBreakdown]:
    """Score every step of an episode.

    Per-step scoring is what makes a peak-criticality frame findable at all: the
    episode CCS is the maximum over these, and the step it occurred at is the
    one worth a picture.
    """
    length = max(len(dracs), len(ttc2ds), len(thws))

    def at(series, i):
        return series[i] if i < len(series) else None

    return [score(at(dracs, i), at(ttc2ds, i), at(thws, i), thresholds)
            for i in range(length)]


def score_episode(dracs, ttc2ds, thws,
                  thresholds: Thresholds = DEFAULT_THRESHOLDS) -> dict:
    """The episode's criticality: its worst instant, and where that was.

    The **maximum** over steps, not the mean. A scenario is as critical as its
    worst moment -- averaging would let a long safe approach dilute the two
    seconds that mattered, which is the same dilution fault the fuzzy OR fixes
    across metrics, applied across time.
    """
    series = score_series(dracs, ttc2ds, thws, thresholds)
    if not series:
        return {"ccs": 0.0, "peak_step": None, "components": {}, "raw": {},
                "dominant": "", "version": VERSION, "series": []}

    peak_step = max(range(len(series)), key=lambda i: series[i].ccs)
    peak = series[peak_step]
    return {
        "ccs": peak.ccs,
        "peak_step": peak_step,
        "components": dict(peak.components),
        "raw": dict(peak.raw),
        "dominant": peak.dominant,
        "version": VERSION,
        "series": [b.ccs for b in series],
    }


def badge(ccs: float) -> str:
    """Red / amber / green, for the report.

    Boundaries at the points where one metric alone is at its own 50% threshold
    (0.5) and where two are well past it (0.75). Stated here once so the report
    and any ranking agree.
    """
    if ccs >= 0.75:
        return "red"
    if ccs >= 0.5:
        return "amber"
    return "green"
