"""
Simulation explainer — Manim Slides

Render into slides folder
    manim-slides render slides\simulation.py --transparent --format webm
Convert into single html file
    manim-slides convert Simulation slides/simulation.html --one-file --offline   
"""

from manim import *
from manim_slides import Slide


# ── Palette ────────────────────────────────────────────────────────────────
OCEAN       = ManimColor("#7aabd8")
LAND1       = ManimColor("#8ec89a")
LAND2       = ManimColor("#a0d4aa")
LAND3       = ManimColor("#78bc88")
LAND4       = ManimColor("#70b080")
ATMO        = ManimColor("#a8c8e8")
DOT         = ManimColor("#f0a080")
DOT2        = ManimColor("#f8b898")
RULE_FILL   = ManimColor("#dce8f8")
RULE_STROKE = ManimColor("#88aad8")
RULE_TEXT   = ManimColor("#4878b8")
BADGE_FILL  = ManimColor("#eef4fc")
BADGE_TEXT  = ManimColor("#4878b8")
RESULT_FILL = ManimColor("#fdf4e0")
RESULT_EDGE = ManimColor("#d4a030")
RESULT_TEXT = ManimColor("#a07020")
ARROW_BLUE  = ManimColor("#5890d0")
ARROW_PURP  = ManimColor("#a888d8")


# ── Helpers ────────────────────────────────────────────────────────────────

def make_globe(cx, cy, r, ocean_color=OCEAN, land_configs=None, dot_configs=None,
               atmo=True, extra_rings=0):
    """Return a VGroup representing one world snapshot."""
    g = VGroup()

    # ocean
    circle = Circle(radius=r, color=ocean_color, fill_color=ocean_color,
                    fill_opacity=1, stroke_width=2)
    circle.move_to([cx, cy, 0])
    g.add(circle)

    # land blobs (list of (points_in_manim_coords, color))
    if land_configs:
        for pts, color in land_configs:
            poly = Polygon(*pts, color=color, fill_color=color,
                           fill_opacity=0.88, stroke_width=0)
            g.add(poly)

    # atmosphere ring
    if atmo:
        ring = Circle(radius=r * 1.06, color=ATMO, fill_opacity=0,
                      stroke_width=1, stroke_opacity=0.4)
        ring.move_to([cx, cy, 0])
        g.add(ring)

    # extra faint rings (for final world)
    for i in range(extra_rings):
        er = Circle(radius=r * (1.10 + i * 0.05), color=ATMO, fill_opacity=0,
                    stroke_width=0.5, stroke_opacity=0.2)
        er.move_to([cx, cy, 0])
        g.add(er)

    # life dots
    if dot_configs:
        for dx, dy, dr, col in dot_configs:
            dot = Dot([dx, dy, 0], radius=dr, color=col)
            g.add(dot)

    return g


def make_rule_node(cx, cy, label, r=0.28):
    g = VGroup()
    circle = Circle(radius=r, color=RULE_STROKE, fill_color=RULE_FILL,
                    fill_opacity=1, stroke_width=2)
    circle.move_to([cx, cy, 0])
    text = Text(label, font_size=18, color=RULE_TEXT, font="monospace")
    text.move_to([cx, cy, 0])
    g.add(circle, text)
    return g


def badge(text_str, cx, cy, width=2.2, height=0.45,
          fill=BADGE_FILL, stroke=RULE_STROKE, tc=BADGE_TEXT, fs=22):
    rect = RoundedRectangle(width=width, height=height, corner_radius=0.1,
                            color=stroke, fill_color=fill, fill_opacity=1,
                            stroke_width=1.5)
    rect.move_to([cx, cy, 0])
    t = Text(text_str, font_size=fs, color=tc)
    t.move_to([cx, cy, 0])
    return VGroup(rect, t)


# ── SVG coords → Manim coords ──────────────────────────────────────────────
# SVG: viewBox="0 0 760 360", centre at (380,180)
# Manim default frame: 14.2w × 8h, centre at (0,0)
# Map: svg_x=380→0, svg_y=180→0; scale = 14.2/760 ≈ 0.01868

def s(sx, sy):
    """Convert SVG pixel coords to Manim scene coords."""
    scale = 14.2 / 760
    return [(sx - 380) * scale, -(sy - 180) * scale, 0]


def sr(r_px):
    """Convert SVG pixel radius to Manim radius."""
    return r_px * (14.2 / 760)


# ── Scene ──────────────────────────────────────────────────────────────────

class Simulation(Slide):
    skip_reversing = True

    def construct(self):
        self.camera.background_color = WHITE
        self.camera.background_opacity = 0

        # ── SLIDE 1: World assembles ────────────────────────────────────────
        CX, CY, R = 380, 180, 108

        def lpts(raw):
            return [s(x, y) for x, y in raw]

        ocean = Circle(radius=sr(R), color=OCEAN, fill_color=OCEAN,
                       fill_opacity=1, stroke_color=ManimColor("#7aaad0"),
                       stroke_width=2)
        ocean.move_to(s(CX, CY))

        land1 = Polygon(*lpts([(308,168),(346,158),(358,182),(340,198),(306,190)]),
                        fill_color=LAND1, fill_opacity=0.9, stroke_width=0)
        land2 = Polygon(*lpts([(354,152),(390,146),(404,164),(394,180),(360,176)]),
                        fill_color=LAND2, fill_opacity=0.85, stroke_width=0)
        land3 = Polygon(*lpts([(388,166),(422,162),(432,184),(418,196),(392,194)]),
                        fill_color=LAND3, fill_opacity=0.85, stroke_width=0)
        land4 = Polygon(*lpts([(326,198),(354,192),(360,214),(342,226),(322,216)]),
                        fill_color=LAND4, fill_opacity=0.8, stroke_width=0)

        atmo = Circle(radius=sr(115), color=ATMO, fill_opacity=0,
                      stroke_width=1, stroke_opacity=0.5)
        atmo.move_to(s(CX, CY))

        dot_a = Dot(s(336,168), radius=sr(4),  color=DOT)
        dot_b = Dot(s(374,152), radius=sr(3.5),color=DOT2)
        dot_c = Dot(s(412,168), radius=sr(3),  color=DOT)

        # clip lands to globe (Manim Intersection)
        clip = Circle(radius=sr(R)).move_to(s(CX, CY))
        for land in [land1, land2, land3, land4]:
            land.set_clip_path(clip)  # requires manim >= 0.18

        world_group = VGroup(ocean, land1, land2, land3, land4, atmo,
                             dot_a, dot_b, dot_c)

         # Imaginary World badge (large, below globe)
        iw_badge = badge("Imaginary World", *s(380, 318)[:2],
                         width=3.6, height=0.6,
                         fill=RESULT_FILL, stroke=RESULT_EDGE,
                         tc=RESULT_TEXT, fs=28)
        self.play(FadeIn(iw_badge, shift=UP * 0.15), run_time=0.5)

        self.play(
            GrowFromCenter(ocean),
            run_time=0.8
        )
        self.play(
            FadeIn(land1, shift=UP * 0.3 + LEFT * 0.5),
            FadeIn(land2, shift=UP * 0.4 + RIGHT * 0.5),
            run_time=0.7
        )
        self.play(
            FadeIn(land3, shift=DOWN * 0.4 + LEFT * 0.4),
            FadeIn(land4, shift=DOWN * 0.3 + RIGHT * 0.4),
            run_time=0.7
        )
        self.play(FadeIn(atmo), run_time=0.5)
        self.play(
            GrowFromCenter(dot_a),
            GrowFromCenter(dot_b),
            GrowFromCenter(dot_c),
            run_time=0.5
        )
        self.next_slide()

        # ── SLIDE 2: Rules imposed ──────────────────────────────────────────
        rn1 = make_rule_node(*s(330,148)[:2], "R₁")
        rn2 = make_rule_node(*s(396,134)[:2], "R₂")
        rn3 = make_rule_node(*s(444,162)[:2], "R₃")
        rn4 = make_rule_node(*s(356,210)[:2], "R₄")

        def rule_line(ax, ay, bx, by):
            return Line(s(ax,ay), s(bx,by), color=RULE_STROKE,
                        stroke_width=1.5, stroke_opacity=0.8)

        rl1 = rule_line(330,148, 396,134)
        rl2 = rule_line(396,134, 444,162)
        rl3 = rule_line(444,162, 356,210)
        rl4 = rule_line(356,210, 330,148)

        rules_badge = badge("Our own rules", *s(381,90)[:2], width=2.4)

        self.play(GrowFromCenter(rn1), run_time=0.5)
        self.play(GrowFromCenter(rn2), run_time=0.5)
        self.play(GrowFromCenter(rn3), run_time=0.5)
        self.play(GrowFromCenter(rn4), run_time=0.5)
        self.play(
            Create(rl1), Create(rl2), Create(rl3), Create(rl4),
            run_time=0.6
        )
        self.play(FadeIn(rules_badge, shift=UP * 0.2), run_time=0.5)

       
        self.next_slide()

        # ── SLIDE 3: Zoom + timeline + snapshot worlds ──────────────────────
        full_world = VGroup(ocean, land1, land2, land3, land4, atmo,
                            dot_a, dot_b, dot_c,
                            rn1, rn2, rn3, rn4,
                            rl1, rl2, rl3, rl4,
                            rules_badge, iw_badge)

        # target position: far left, same y, scale down to r=40/108
        target_scale = 40 / 108
        target_pos = s(120, 180)

        self.play(
            full_world.animate
                .scale(target_scale, about_point=s(CX, CY))
                .shift(np.array(target_pos) - np.array(s(CX, CY))),
            run_time=1.2,
            rate_func=rate_functions.ease_in_out_cubic
        )

        # time axis
        t_axis = Arrow(s(60,180), s(712,180), color=RULE_STROKE,
                       stroke_width=1.5, stroke_opacity=0.6,
                       buff=0, max_tip_length_to_length_ratio=0.02)
        t_label = Text("t", font_size=18, color=RULE_STROKE).move_to(s(726,180))
        self.play(Create(t_axis), FadeIn(t_label), run_time=0.8)

        # ── Snapshot worlds ─────────────────────────────────────────────────
        SR = sr(40)  # all same radius

        def snap_land(cx, cy, raw_pts, color):
            poly = Polygon(*[s(x, y) for x,y in raw_pts],
                           fill_color=color, fill_opacity=0.88, stroke_width=0)
            clip2 = Circle(radius=SR).move_to(s(cx, cy))
            poly.set_clip_path(clip2)
            return poly

        # Snap 2 — cx=260
        s2_ocean = Circle(radius=SR, color=ManimColor("#7eaedd"),
                          fill_color=ManimColor("#7eaedd"), fill_opacity=1, stroke_width=1.5)
        s2_ocean.move_to(s(260,180))
        s2_land1 = snap_land(260,180, [(248,156),(272,150),(280,164),(268,172),(246,168)], ManimColor("#90ca9c"))
        s2_land2 = snap_land(260,180, [(236,166),(252,162),(256,174),(244,178),(234,174)], ManimColor("#a4d4ae"))
        s2_dots  = VGroup(*[Dot(s(x,y), radius=sr(r), color=c) for x,y,r,c in [
            (250,162,3,DOT),(263,157,3,DOT2),(275,163,2.5,DOT),(255,173,2.5,DOT2)]])
        s2_lines = VGroup(
            Line(s(250,162),s(263,157),color=RULE_STROKE,stroke_width=1,stroke_opacity=0.6),
            Line(s(263,157),s(275,163),color=RULE_STROKE,stroke_width=1,stroke_opacity=0.6),
        )
        snap2 = VGroup(s2_ocean, s2_land1, s2_land2, s2_dots, s2_lines)

        # Snap 3 — cx=400
        s3_ocean = Circle(radius=SR, color=ManimColor("#84b2e0"),
                          fill_color=ManimColor("#84b2e0"), fill_opacity=1, stroke_width=1.5)
        s3_ocean.move_to(s(400,180))
        s3_land1 = snap_land(400,180, [(378,188),(398,182),(406,194),(398,204),(376,200)], ManimColor("#98cc9e"))
        s3_land2 = snap_land(400,180, [(396,180),(414,176),(420,188),(412,196),(396,194)], ManimColor("#a8d4b0"))
        s3_dots  = VGroup(*[Dot(s(x,y), radius=sr(r), color=c) for x,y,r,c in [
            (382,171,3.5,DOT),(394,165,3,DOT2),(408,170,3,DOT),(416,179,2.5,DOT2),(390,182,2,DOT)]])
        s3_lines = VGroup(
            Line(s(382,171),s(394,165),color=RULE_STROKE,stroke_width=1,stroke_opacity=0.6),
            Line(s(394,165),s(408,170),color=RULE_STROKE,stroke_width=1,stroke_opacity=0.6),
            Line(s(408,170),s(416,179),color=RULE_STROKE,stroke_width=1,stroke_opacity=0.6),
            Line(s(382,171),s(390,182),color=RULE_STROKE,stroke_width=0.8,stroke_opacity=0.5),
        )
        snap3 = VGroup(s3_ocean, s3_land1, s3_land2, s3_dots, s3_lines)

        # Snap 4 — cx=540 (final, glowing)
        s4_ocean = Circle(radius=SR, color=ManimColor("#8ab8e0"),
                          fill_color=ManimColor("#8ab8e0"), fill_opacity=1, stroke_width=2)
        s4_ocean.move_to(s(540,180))
        s4_ring1 = Circle(radius=SR*1.075, color=ATMO, fill_opacity=0, stroke_width=1, stroke_opacity=0.5)
        s4_ring1.move_to(s(540,180))
        s4_ring2 = Circle(radius=SR*1.15,  color=ATMO, fill_opacity=0, stroke_width=0.5, stroke_opacity=0.2)
        s4_ring2.move_to(s(540,180))
        s4_land1 = snap_land(540,180, [(516,168),(534,162),(542,172),(538,184),(520,188),(512,180)], ManimColor("#a0d0a8"))
        s4_land2 = snap_land(540,180, [(538,164),(556,164),(562,176),(552,184),(538,182)],           ManimColor("#b0d8b8"))
        s4_land3 = snap_land(540,180, [(514,184),(528,190),(522,202),(508,198)],                     ManimColor("#88c094"))
        s4_dots  = VGroup(*[Dot(s(x,y), radius=sr(r), color=c) for x,y,r,c in [
            (518,167,3.5,DOT),(530,161,3,DOT2),(542,164,3,DOT),
            (554,168,3,DOT2),(526,176,2.5,DOT),(542,174,2.5,DOT2)]])
        s4_lines = VGroup(
            Line(s(518,167),s(530,161),color=RULE_STROKE,stroke_width=1,  stroke_opacity=0.6),
            Line(s(530,161),s(542,164),color=RULE_STROKE,stroke_width=1,  stroke_opacity=0.6),
            Line(s(542,164),s(554,168),color=RULE_STROKE,stroke_width=1,  stroke_opacity=0.6),
            Line(s(518,167),s(526,176),color=RULE_STROKE,stroke_width=0.9,stroke_opacity=0.5),
            Line(s(542,164),s(542,174),color=RULE_STROKE,stroke_width=0.9,stroke_opacity=0.5),
            Line(s(526,176),s(542,174),color=RULE_STROKE,stroke_width=0.9,stroke_opacity=0.5),
            Line(s(542,174),s(554,168),color=RULE_STROKE,stroke_width=0.8,stroke_opacity=0.4),
        )
        snap4 = VGroup(s4_ocean, s4_ring1, s4_ring2, s4_land1, s4_land2,
                       s4_land3, s4_dots, s4_lines)

        self.play(GrowFromCenter(snap2), run_time=0.7)
        self.play(GrowFromCenter(snap3), run_time=0.7)
        self.play(GrowFromCenter(snap4), run_time=0.7)

        # pulse glow on snap4
        self.play(
            s4_ring1.animate.set_stroke(opacity=0.9),
            s4_ring2.animate.set_stroke(opacity=0.5),
            run_time=0.6, rate_func=there_and_back
        )

        # End Result badge
        end_badge = badge("End Result", *s(540,243)[:2],
                          width=2.0, height=0.45,
                          fill=RESULT_FILL, stroke=RESULT_EDGE,
                          tc=RESULT_TEXT, fs=22)
        self.play(GrowFromCenter(end_badge), run_time=0.6)
        self.next_slide()

        # ── SLIDE 4: Cause arrows ───────────────────────────────────────────

        # Rules arrow — horizontal from right into snap4
        rules_arrow = Arrow(s(690,162), s(588,162),
                            color=ARROW_BLUE, stroke_width=2,
                            buff=0, max_tip_length_to_length_ratio=0.04)
        rules_label = badge("From our rules", *s(726,162)[:2],
                            width=2.1, height=0.45,
                            fill=BADGE_FILL, stroke=RULE_STROKE,
                            tc=ManimColor("#3a70b0"), fs=20)

        # Probability arrow — diagonal from lower-right
        prob_arrow = Arrow(s(690,306), s(592,224),
                           color=ARROW_PURP, stroke_width=2,
                           buff=0, max_tip_length_to_length_ratio=0.04)
        prob_label = badge("Laws of Probability", *s(672,328)[:2],
                           width=2.9, height=0.45,
                           fill=ManimColor("#f4f0fc"),
                           stroke=ManimColor("#c0a0e0"),
                           tc=ManimColor("#8060b8"), fs=20)

        self.play(GrowArrow(rules_arrow), run_time=0.6)
        self.play(FadeIn(rules_label, shift=LEFT * 0.2), run_time=0.4)
        self.play(GrowArrow(prob_arrow), run_time=0.6)
        self.play(FadeIn(prob_label, shift=LEFT * 0.2), run_time=0.4)
        self.next_slide()