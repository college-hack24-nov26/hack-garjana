"""Parameterized alloy-wheel template (spec 2.3).

Simplification note, stated here and surfaced in the UI: this is a *simplified
structural representation* of a one-piece cast wheel - a rim barrel of constant
wall thickness, a flat mounting hub and straight tapered spokes. It deliberately
omits bead-seat profiling, hump geometry, flange radii, drop-centre contour and
cast draft angles. It is built to explore spoke/hub/rim-wall proportions under a
defined load case, not to replace a production wheel model.

Protected (non-design) interfaces: rim outer diameter, rim width, centre bore,
bolt pattern (count, PCD, hole diameter) and hub mounting-pad diameter.
"""
from __future__ import annotations

import math

import cadquery as cq

from app.engineering.cad.base import ComponentGenerator
from app.engineering.cad.regions import (
    AndSelector,
    AngularSectorSelector,
    BoltHolesSelector,
    CylinderSelector,
    NamedRegion,
    OrSelector,
    PlaneSelector,
    RadialBandSelector,
    RegionKind,
    RegionSet,
)
from app.schemas.common import ComponentType
from app.schemas.engineering import DesignVariableSpec

#: Small radial overlap so spoke/hub and spoke/rim unions produce one solid.
_OVERLAP_M = 0.002


class AlloyWheelGenerator(ComponentGenerator):
    component_type = ComponentType.ALLOY_WHEEL
    name = "alloy_wheel_parametric"
    version = "1.0.0"
    capability_note = (
        "Simplified one-piece cast-wheel template: constant-wall rim barrel, flat "
        "mounting hub, and tapered spokes dished axially from the mounting face to "
        "the rim. Bead-seat profile, humps, bead flanges, drop centre, fillet radii "
        "and casting draft angles are not modelled. Rim outer diameter, rim width, "
        "centre bore, bolt pattern and hub pad diameter are preserved interfaces "
        "and cannot be changed by the optimizer."
    )

    # ------------------------------------------------------------------ schema

    def parameter_specs(self) -> list[DesignVariableSpec]:
        return [
            # ---------------- preserved vehicle interfaces (locked) ----------
            DesignVariableSpec(
                name="rim_diameter_m",
                label="Rim outer diameter",
                kind="continuous",
                unit="m",
                minimum=0.3048,
                maximum=0.5588,
                default=0.4318,  # 17 in
                is_design_variable=False,
                preserved_reason="Tyre fitment interface: fixed by the chosen tyre size.",
                description="Bead-seat outer diameter (nominal wheel diameter).",
            ),
            DesignVariableSpec(
                name="rim_width_m",
                label="Rim width",
                kind="continuous",
                unit="m",
                minimum=0.1270,
                maximum=0.2794,
                default=0.1905,  # 7.5 in
                is_design_variable=False,
                preserved_reason="Tyre fitment interface: fixed by the chosen tyre size.",
            ),
            DesignVariableSpec(
                name="center_bore_diameter_m",
                label="Centre bore diameter",
                kind="continuous",
                unit="m",
                minimum=0.040,
                maximum=0.090,
                default=0.0666,
                is_design_variable=False,
                preserved_reason="Hub-centric location feature on the vehicle hub.",
            ),
            DesignVariableSpec(
                name="bolt_count",
                label="Bolt count",
                kind="integer",
                unit="-",
                minimum=3,
                maximum=8,
                default=5,
                is_design_variable=False,
                preserved_reason="Vehicle mounting interface.",
            ),
            DesignVariableSpec(
                name="bolt_circle_diameter_m",
                label="Bolt circle diameter (PCD)",
                kind="continuous",
                unit="m",
                minimum=0.090,
                maximum=0.160,
                default=0.1120,  # 5x112
                is_design_variable=False,
                preserved_reason="Vehicle mounting interface.",
            ),
            DesignVariableSpec(
                name="bolt_hole_diameter_m",
                label="Bolt hole diameter",
                kind="continuous",
                unit="m",
                minimum=0.010,
                maximum=0.022,
                default=0.0140,
                is_design_variable=False,
                preserved_reason="Vehicle mounting interface.",
            ),
            DesignVariableSpec(
                name="hub_pad_diameter_m",
                label="Hub mounting-pad diameter",
                kind="continuous",
                unit="m",
                minimum=0.120,
                maximum=0.220,
                default=0.160,
                is_design_variable=False,
                preserved_reason="Must cover the bolt pattern and seat on the hub flange.",
            ),
            # ---------------------------- design variables -------------------
            DesignVariableSpec(
                name="spoke_count",
                label="Spoke count",
                kind="integer",
                unit="-",
                minimum=5,
                maximum=12,
                default=7,
                description="Number of radial spokes connecting hub to rim.",
            ),
            DesignVariableSpec(
                name="spoke_root_width_m",
                label="Spoke width at hub",
                kind="continuous",
                unit="m",
                minimum=0.025,
                maximum=0.070,
                default=0.044,
            ),
            DesignVariableSpec(
                name="spoke_tip_width_m",
                label="Spoke width at rim",
                kind="continuous",
                unit="m",
                minimum=0.018,
                maximum=0.055,
                default=0.030,
            ),
            DesignVariableSpec(
                name="spoke_thickness_m",
                label="Spoke axial thickness",
                kind="continuous",
                unit="m",
                minimum=0.008,
                maximum=0.028,
                default=0.016,
            ),
            DesignVariableSpec(
                name="spoke_dish_offset_m",
                label="Spoke dish offset",
                kind="continuous",
                unit="m",
                minimum=0.0,
                maximum=0.200,
                default=0.085,
                description=(
                    "Axial offset of the spoke where it meets the rim, measured from "
                    "the mounting face. A larger offset moves the rim support towards "
                    "the middle of the barrel and stiffens the wheel considerably."
                ),
            ),
            DesignVariableSpec(
                name="hub_thickness_m",
                label="Hub pad thickness",
                kind="continuous",
                unit="m",
                minimum=0.012,
                maximum=0.030,
                default=0.020,
            ),
            DesignVariableSpec(
                name="rim_wall_thickness_m",
                label="Rim wall thickness",
                kind="continuous",
                unit="m",
                minimum=0.005,
                maximum=0.014,
                default=0.008,
            ),
        ]

    # ------------------------------------------------------------ derived geom

    @staticmethod
    def _derived(p: dict[str, float]) -> dict[str, float]:
        r_out = p["rim_diameter_m"] / 2.0
        return {
            "r_out": r_out,
            "r_rim_inner": r_out - p["rim_wall_thickness_m"],
            "r_hub": p["hub_pad_diameter_m"] / 2.0,
            "r_bore": p["center_bore_diameter_m"] / 2.0,
            "r_pcd": p["bolt_circle_diameter_m"] / 2.0,
            "r_bolt": p["bolt_hole_diameter_m"] / 2.0,
            "width": p["rim_width_m"],
        }

    # ------------------------------------------------------------ feasibility

    def check_feasibility(self, p: dict[str, float]) -> list[str]:
        d = self._derived(p)
        errs: list[str] = []
        n = int(round(p["spoke_count"]))

        # Spokes must physically fit around the hub without merging into a disc.
        hub_circumference = 2.0 * math.pi * d["r_hub"]
        used = n * p["spoke_root_width_m"]
        if used > 0.85 * hub_circumference:
            errs.append(
                f"{n} spokes of {p['spoke_root_width_m'] * 1000:.1f} mm root width need "
                f"{used * 1000:.0f} mm of hub circumference but only "
                f"{0.85 * hub_circumference * 1000:.0f} mm is usable "
                "(spokes would merge into a solid disc)"
            )

        if p["spoke_tip_width_m"] > p["spoke_root_width_m"] + 1e-9:
            errs.append(
                f"spoke tip width ({p['spoke_tip_width_m'] * 1000:.1f} mm) exceeds root width "
                f"({p['spoke_root_width_m'] * 1000:.1f} mm): the spoke must not widen towards the rim"
            )

        if d["r_rim_inner"] <= d["r_hub"] + 0.020:
            errs.append(
                "rim inner radius leaves less than 20 mm of spoke length; "
                "reduce rim wall thickness or hub pad diameter"
            )

        if p["spoke_thickness_m"] > d["width"]:
            errs.append("spoke thickness cannot exceed the rim width")

        if p["spoke_dish_offset_m"] + p["spoke_thickness_m"] > d["width"] + 1e-9:
            errs.append(
                f"spoke dish offset ({p['spoke_dish_offset_m'] * 1000:.1f} mm) plus spoke "
                f"thickness ({p['spoke_thickness_m'] * 1000:.1f} mm) exceeds the rim width "
                f"({d['width'] * 1000:.1f} mm): the spoke would overhang the rim"
            )

        if p["hub_thickness_m"] > d["width"]:
            errs.append("hub thickness cannot exceed the rim width")

        # Bolt pattern must fit inside the hub pad and clear the centre bore.
        if d["r_pcd"] + d["r_bolt"] + 0.004 > d["r_hub"]:
            errs.append(
                "bolt holes do not fit inside the hub pad diameter with 4 mm of edge material"
            )
        if d["r_pcd"] - d["r_bolt"] - 0.004 < d["r_bore"]:
            errs.append(
                "bolt holes do not clear the centre bore with 4 mm of web material"
            )
        return errs

    # --------------------------------------------------------------- geometry

    def build(self, p: dict[str, float]):
        d = self._derived(p)
        n = int(round(p["spoke_count"]))
        w = d["width"]

        # Rim barrel: constant-wall annular cylinder spanning the full rim width.
        wheel = (
            cq.Workplane("XY")
            .circle(d["r_out"])
            .circle(d["r_rim_inner"])
            .extrude(w)
        )

        # Mounting hub: solid pad at the inboard face (z = 0 is the mounting face).
        hub = cq.Workplane("XY").circle(d["r_hub"]).extrude(p["hub_thickness_m"])
        wheel = wheel.union(hub)

        # Spokes: tapered and dished. Each spoke is lofted from a rectangle at
        # the hub pad face to a narrower rectangle at the rim, offset axially by
        # the dish. The dish is what carries the rim load back towards the
        # middle of the barrel instead of leaving it on a long cantilever.
        r0 = d["r_hub"] - _OVERLAP_M
        r1 = d["r_rim_inner"] + _OVERLAP_M
        t = p["spoke_thickness_m"]
        dish = p["spoke_dish_offset_m"]

        base_spoke = (
            cq.Workplane("YZ")
            .workplane(offset=r0)
            .moveTo(0.0, t / 2.0)
            .rect(p["spoke_root_width_m"], t)
            .workplane(offset=(r1 - r0))
            .moveTo(0.0, dish + t / 2.0)
            .rect(p["spoke_tip_width_m"], t)
            .loft(ruled=True)
        )

        for k in range(n):
            angle = k * 360.0 / n
            wheel = wheel.union(
                base_spoke.rotate((0, 0, 0), (0, 0, 1), angle)
                if angle
                else base_spoke
            )

        # Protected features are cut last so they are always fully open.
        wheel = wheel.cut(
            cq.Workplane("XY")
            .workplane(offset=-0.01)
            .circle(d["r_bore"])
            .extrude(w + 0.02)
        )

        bolts = cq.Workplane("XY").workplane(offset=-0.01)
        for k in range(int(round(p["bolt_count"]))):
            ang = math.radians(k * 360.0 / int(round(p["bolt_count"])))
            bolts = bolts.moveTo(
                d["r_pcd"] * math.cos(ang), d["r_pcd"] * math.sin(ang)
            ).circle(d["r_bolt"])
        wheel = wheel.cut(bolts.extrude(p["hub_thickness_m"] + 0.02))

        return wheel

    # ---------------------------------------------------------------- regions

    def named_regions(self, p: dict[str, float]) -> RegionSet:
        d = self._derived(p)
        n_bolt = int(round(p["bolt_count"]))
        hub_t = p["hub_thickness_m"]

        return RegionSet(
            regions=[
                # --- supports: simplified bolted-joint representation ---------
                NamedRegion(
                    name="bolt_hole_bearing_surfaces",
                    kind=RegionKind.FIXED,
                    description=(
                        "Barrels of the wheel bolt holes. Fixing these represents the "
                        "clamped bolted joint to the hub flange in a simplified way; it "
                        "is not a modelled bolt pretension or contact analysis."
                    ),
                    selector=BoltHolesSelector(
                        axis="z",
                        pcd_radius=d["r_pcd"],
                        hole_radius=d["r_bolt"],
                        count=n_bolt,
                        tol=4e-4,
                        axial_min=-1e-6,
                        axial_max=hub_t + 1e-6,
                    ),
                    min_facets=4 * n_bolt,
                ),
                NamedRegion(
                    name="hub_mounting_face",
                    kind=RegionKind.FIXED,
                    description=(
                        "Annular mounting-pad face at z = 0 that seats against the hub "
                        "flange. Used together with the bolt holes as the simplified support."
                    ),
                    selector=AndSelector(
                        of=[
                            PlaneSelector(axis="z", value=0.0, tol=1e-5),
                            RadialBandSelector(
                                axis="z", r_min=d["r_bore"], r_max=d["r_hub"]
                            ),
                        ]
                    ),
                    min_facets=8,
                ),
                # --- load: simplified tyre contact patch -----------------------
                NamedRegion(
                    name="rim_contact_patch",
                    kind=RegionKind.LOAD,
                    description=(
                        "A 50-degree sector of the rim outer surface, centred on the "
                        "-Y direction, used to apply the radial road load. This is a "
                        "simplified load-introduction patch, not a tyre/wheel contact "
                        "simulation."
                    ),
                    selector=AndSelector(
                        of=[
                            CylinderSelector(
                                axis="z",
                                radius=d["r_out"],
                                tol=6e-4,
                                axial_min=-1e-6,
                                axial_max=d["width"] + 1e-6,
                            ),
                            AngularSectorSelector(
                                axis="z", center_deg=270.0, half_angle_deg=25.0
                            ),
                        ]
                    ),
                    min_facets=10,
                ),
                # --- protected interfaces --------------------------------------
                NamedRegion(
                    name="bead_seat_interface",
                    kind=RegionKind.INTERFACE,
                    description="Full rim outer cylindrical surface (tyre interface).",
                    selector=CylinderSelector(
                        axis="z",
                        radius=d["r_out"],
                        tol=6e-4,
                        axial_min=-1e-6,
                        axial_max=d["width"] + 1e-6,
                    ),
                    min_facets=20,
                ),
                NamedRegion(
                    name="center_bore_interface",
                    kind=RegionKind.INTERFACE,
                    description="Centre-bore cylindrical surface (hub-centric location).",
                    selector=CylinderSelector(
                        axis="z",
                        radius=d["r_bore"],
                        tol=4e-4,
                        axial_min=-1e-6,
                        axial_max=hub_t + 1e-6,
                    ),
                    min_facets=6,
                ),
                NamedRegion(
                    name="non_design_hub_pad",
                    kind=RegionKind.NON_DESIGN,
                    description=(
                        "Hub pad volume carrying the bolt pattern. Its diameter and the "
                        "bolt pattern are locked; only the pad thickness is a variable."
                    ),
                    selector=RadialBandSelector(
                        axis="z",
                        r_min=d["r_bore"],
                        r_max=d["r_hub"],
                        axial_min=-1e-6,
                        axial_max=hub_t + 1e-6,
                    ),
                    required=False,
                    min_facets=1,
                ),
            ]
        )

    # ------------------------------------------------------------- properties

    def min_wall_thickness(self, p: dict[str, float]) -> float:
        d = self._derived(p)
        bolt_to_bore_web = d["r_pcd"] - d["r_bolt"] - d["r_bore"]
        hub_edge = d["r_hub"] - (d["r_pcd"] + d["r_bolt"])
        return float(
            min(
                p["rim_wall_thickness_m"],
                p["spoke_thickness_m"],
                p["hub_thickness_m"],
                bolt_to_bore_web,
                hub_edge,
            )
        )

    def preserved_interfaces(
        self, p: dict[str, float]
    ) -> list[tuple[str, str, float, float]]:
        d = self._derived(p)
        return [
            (
                "rim_outer_diameter",
                "Rim outer (bead-seat) diameter measured across the tessellated solid",
                p["rim_diameter_m"],
                1.0e-3,
            ),
            (
                "rim_width",
                "Overall axial width measured across the tessellated solid",
                p["rim_width_m"],
                1.0e-3,
            ),
            (
                "center_bore_diameter",
                "Centre-bore diameter measured as the minimum material radius in the hub band",
                p["center_bore_diameter_m"],
                1.0e-3,
            ),
        ]

    def mesh_size_hint(self, p: dict[str, float]) -> float:
        # Scaled off the thinnest structural member. A mesh-refinement study on
        # the default wheel (11.0 / 9.0 / 7.2 mm) moved peak displacement by
        # 0.7 percent, so this exploration size is already converged for the
        # stiffness metric; peak stress is refined by the verification preset.
        thin = min(p["rim_wall_thickness_m"], p["spoke_thickness_m"])
        return float(max(0.008, min(0.013, thin * 1.4)))
