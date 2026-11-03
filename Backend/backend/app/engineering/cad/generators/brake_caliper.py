"""Parameterized brake-caliper body template (spec 2.4).

Simplification note, stated here and surfaced in the UI: this is a *simplified
structural representation* of a fixed (opposed-piston) caliper body - a U-shaped
channel straddling the disc, with a piston bore pocket in the inboard leg,
mounting holes through the inboard leg, and optional stiffening ribs across the
bridge. It deliberately omits the hydraulic circuit, seal grooves, bleed ports,
pistons, pads, the disc itself, dust boots and casting draft.

Coordinate convention as built: X is circumferential (along the disc tangent),
Y is axial (across the disc, so the two legs sit at negative and positive Y),
and Z is radial (outward from the disc centre). The disc slot opens towards
Z = 0, which is the radially inner edge.

Protected (non-design) interfaces: disc slot width, piston bore diameter and
position, mounting hole diameter and spacing, and overall body length.
"""
from __future__ import annotations

import cadquery as cq

from app.engineering.cad.base import ComponentGenerator
from app.engineering.cad.regions import (
    AndSelector,
    BoxSelector,
    CylinderSelector,
    NamedRegion,
    OffsetCylinderSelector,
    OrSelector,
    PlaneSelector,
    RegionKind,
    RegionSet,
)
from app.schemas.common import ComponentType
from app.schemas.engineering import DesignVariableSpec

_EPS = 1e-4


class BrakeCaliperGenerator(ComponentGenerator):
    component_type = ComponentType.BRAKE_CALIPER
    name = "brake_caliper_parametric"
    version = "1.0.0"
    capability_note = (
        "Simplified fixed-caliper body template: U-shaped channel over the disc, "
        "piston bore pocket in the inboard leg, mounting holes through the inboard "
        "leg, optional bridge ribs. The hydraulic circuit, seal grooves, pistons, "
        "pads, disc, and casting draft are not modelled. Disc slot width, piston bore "
        "diameter, mounting hole pattern and body length are preserved interfaces and "
        "cannot be changed by the optimizer."
    )

    # ------------------------------------------------------------------ schema

    def parameter_specs(self) -> list[DesignVariableSpec]:
        return [
            # ------------------- preserved interfaces (locked) ---------------
            DesignVariableSpec(
                name="body_length_m",
                label="Body length (circumferential)",
                kind="continuous",
                unit="m",
                minimum=0.080,
                maximum=0.200,
                default=0.130,
                is_design_variable=False,
                preserved_reason="Set by the pad footprint and the disc swept area.",
            ),
            DesignVariableSpec(
                name="disc_slot_width_m",
                label="Disc slot width",
                kind="continuous",
                unit="m",
                minimum=0.020,
                maximum=0.060,
                default=0.034,
                is_design_variable=False,
                preserved_reason=(
                    "Must clear the disc plus both pads and their wear allowance."
                ),
            ),
            DesignVariableSpec(
                name="piston_bore_diameter_m",
                label="Piston bore diameter",
                kind="continuous",
                unit="m",
                minimum=0.028,
                maximum=0.070,
                default=0.048,
                is_design_variable=False,
                preserved_reason=(
                    "Sets the clamping force for a given hydraulic pressure; fixed by "
                    "the brake-system sizing."
                ),
            ),
            DesignVariableSpec(
                name="mount_hole_diameter_m",
                label="Mounting hole diameter",
                kind="continuous",
                unit="m",
                minimum=0.008,
                maximum=0.016,
                default=0.012,
                is_design_variable=False,
                preserved_reason="Knuckle mounting interface.",
            ),
            DesignVariableSpec(
                name="mount_hole_spacing_m",
                label="Mounting hole spacing",
                kind="continuous",
                unit="m",
                minimum=0.050,
                maximum=0.150,
                default=0.096,
                is_design_variable=False,
                preserved_reason="Knuckle mounting interface.",
            ),
            # ---------------------------- design variables -------------------
            DesignVariableSpec(
                name="wall_thickness_m",
                label="Leg wall thickness",
                kind="continuous",
                unit="m",
                minimum=0.012,
                maximum=0.034,
                default=0.020,
                description="Axial thickness of each leg either side of the disc slot.",
            ),
            DesignVariableSpec(
                name="bridge_thickness_m",
                label="Bridge thickness",
                kind="continuous",
                unit="m",
                minimum=0.010,
                maximum=0.040,
                default=0.020,
                description=(
                    "Radial depth of the bridge joining the two legs. This is the "
                    "member that resists the caliper mouth opening."
                ),
            ),
            DesignVariableSpec(
                name="body_height_m",
                label="Body height (radial)",
                kind="continuous",
                unit="m",
                minimum=0.060,
                maximum=0.120,
                default=0.095,
            ),
            DesignVariableSpec(
                name="slot_depth_fraction",
                label="Disc slot depth fraction",
                kind="continuous",
                unit="-",
                minimum=0.35,
                maximum=0.80,
                default=0.62,
                description=(
                    "Slot depth as a fraction of body height. A deeper slot admits more "
                    "disc but leaves less bridge material."
                ),
            ),
            DesignVariableSpec(
                name="rib_count",
                label="Bridge rib count",
                kind="integer",
                unit="-",
                minimum=0,
                maximum=4,
                default=2,
                description="Stiffening ribs across the bridge, spaced along the length.",
            ),
            DesignVariableSpec(
                name="rib_thickness_m",
                label="Rib thickness",
                kind="continuous",
                unit="m",
                minimum=0.004,
                maximum=0.016,
                default=0.008,
            ),
        ]

    # ------------------------------------------------------------ derived geom

    @staticmethod
    def _derived(p: dict[str, float]) -> dict[str, float]:
        wall = p["wall_thickness_m"]
        gap = p["disc_slot_width_m"]
        height = p["body_height_m"]
        return {
            "length": p["body_length_m"],
            "height": height,
            "gap": gap,
            "wall": wall,
            "total_width": gap + 2.0 * wall,
            "z_outer": gap / 2.0 + wall,
            "z_inner": gap / 2.0,
            "slot_depth": height * p["slot_depth_fraction"],
            "bridge_base": height * p["slot_depth_fraction"],
            "bore_radius": p["piston_bore_diameter_m"] / 2.0,
            "bore_depth": 0.65 * wall,
            "bore_y": 0.5 * height * p["slot_depth_fraction"],
            "mount_radius": p["mount_hole_diameter_m"] / 2.0,
            "mount_half_spacing": p["mount_hole_spacing_m"] / 2.0,
            "mount_y": height - max(0.012, 0.5 * p["bridge_thickness_m"]),
        }

    # ------------------------------------------------------------ feasibility

    def check_feasibility(self, p: dict[str, float]) -> list[str]:
        d = self._derived(p)
        errs: list[str] = []

        if d["slot_depth"] + p["bridge_thickness_m"] > d["height"] - 1e-9:
            errs.append(
                f"slot depth ({d['slot_depth'] * 1000:.1f} mm) plus bridge thickness "
                f"({p['bridge_thickness_m'] * 1000:.1f} mm) exceeds the body height "
                f"({d['height'] * 1000:.1f} mm): there would be no bridge material left"
            )

        if d["bore_radius"] * 2.0 > d["slot_depth"] - 0.004:
            errs.append(
                f"a {p['piston_bore_diameter_m'] * 1000:.1f} mm bore does not fit within "
                f"the {d['slot_depth'] * 1000:.1f} mm slot depth with 4 mm of edge material; "
                "increase the body height or the slot depth fraction"
            )

        if d["bore_depth"] >= d["wall"] - 0.003:
            errs.append(
                "the piston bore pocket would leave less than 3 mm of material behind it; "
                "increase the leg wall thickness"
            )

        if d["mount_half_spacing"] + d["mount_radius"] + 0.006 > d["length"] / 2.0:
            errs.append(
                "the mounting holes do not fit within the body length with 6 mm of "
                "edge material"
            )

        if d["mount_y"] + d["mount_radius"] > d["height"] - 0.002:
            errs.append(
                "the mounting holes break through the top of the body; increase the "
                "body height or reduce the bridge thickness"
            )

        if d["mount_y"] - d["mount_radius"] < d["slot_depth"] + 0.002:
            errs.append(
                "the mounting holes intersect the disc slot; increase the bridge "
                "thickness or reduce the slot depth fraction"
            )

        n_ribs = int(round(p["rib_count"]))
        if n_ribs > 0:
            needed = n_ribs * p["rib_thickness_m"]
            usable = d["length"] - 2.0 * 0.010
            if needed > 0.6 * usable:
                errs.append(
                    f"{n_ribs} ribs of {p['rib_thickness_m'] * 1000:.1f} mm would occupy "
                    f"{needed * 1000:.0f} mm of the {usable * 1000:.0f} mm usable length; "
                    "reduce the rib count or thickness"
                )
        return errs

    # --------------------------------------------------------------- geometry

    def build(self, p: dict[str, float]):
        d = self._derived(p)
        L, H, W = d["length"], d["height"], d["total_width"]

        # Solid body block, centred in X and Z, sitting on y = 0.
        body = (
            cq.Workplane("XY")
            .box(L, W, H, centered=(True, True, False))
        )

        # Disc slot, open towards y = 0, leaving the bridge above it.
        slot = (
            cq.Workplane("XY")
            .box(
                L + 2 * _EPS,
                d["gap"],
                d["slot_depth"] + _EPS,
                centered=(True, True, False),
            )
            .translate((0.0, 0.0, -_EPS))
        )
        caliper = body.cut(slot)

        # Bridge ribs: blocks spanning the slot width on the underside of the
        # bridge, adding material exactly where the mouth-opening load acts.
        n_ribs = int(round(p["rib_count"]))
        if n_ribs > 0:
            rib_height = min(0.35 * d["slot_depth"], 0.012)
            spacing = L / (n_ribs + 1)
            for k in range(n_ribs):
                x = -L / 2.0 + spacing * (k + 1)
                rib = (
                    cq.Workplane("XY")
                    .box(
                        p["rib_thickness_m"],
                        d["gap"],
                        rib_height,
                        centered=(True, True, False),
                    )
                    .translate((x, 0.0, d["slot_depth"] - rib_height))
                )
                caliper = caliper.union(rib)

        # Piston bore pocket in the inboard leg, drilled from the slot face
        # outward. Built as an explicit cylinder so its axis is unambiguous.
        bore = cq.Solid.makeCylinder(
            d["bore_radius"],
            d["bore_depth"] + _EPS,
            cq.Vector(0.0, -d["z_inner"] - d["bore_depth"], d["bore_y"]),
            cq.Vector(0.0, 1.0, 0.0),
        )
        caliper = caliper.cut(cq.Workplane(obj=bore))

        # Mounting holes through the inboard leg, axis along the axial direction.
        for sign in (-1.0, 1.0):
            hole = cq.Solid.makeCylinder(
                d["mount_radius"],
                d["wall"] + 2 * _EPS,
                cq.Vector(
                    sign * d["mount_half_spacing"],
                    -d["z_outer"] - _EPS,
                    d["mount_y"],
                ),
                cq.Vector(0.0, 1.0, 0.0),
            )
            caliper = caliper.cut(cq.Workplane(obj=hole))

        return caliper

    # ---------------------------------------------------------------- regions

    def named_regions(self, p: dict[str, float]) -> RegionSet:
        d = self._derived(p)
        L = d["length"]
        # The build places the axial direction along global Y.
        return RegionSet(
            regions=[
                NamedRegion(
                    name="mounting_hole_surfaces",
                    kind=RegionKind.FIXED,
                    description=(
                        "Barrels of the two knuckle mounting holes. Fixing them "
                        "represents the bolted mount in a simplified way; bolt "
                        "pretension and contact are not modelled."
                    ),
                    selector=OrSelector(
                        of=[
                            OffsetCylinderSelector(
                                axis="y",
                                center_a=sign * d["mount_half_spacing"],
                                center_b=d["mount_y"],
                                radius=d["mount_radius"],
                                tol=4e-4,
                                axial_min=-d["z_outer"] - 1e-3,
                                axial_max=-d["z_inner"] + 1e-3,
                            )
                            for sign in (-1.0, 1.0)
                        ]
                    ),
                    min_facets=8,
                ),
                NamedRegion(
                    name="piston_bore_surfaces",
                    kind=RegionKind.PRESSURE,
                    description=(
                        "Piston bore pocket wall and base in the inboard leg. "
                        "Hydraulic pressure is applied here as a normal pressure; the "
                        "piston, seals and fluid are not modelled."
                    ),
                    selector=OrSelector(
                        of=[
                            OffsetCylinderSelector(
                                axis="y",
                                center_a=0.0,
                                center_b=d["bore_y"],
                                radius=d["bore_radius"],
                                tol=5e-4,
                                axial_min=-d["z_inner"] - d["bore_depth"] - 1e-3,
                                axial_max=-d["z_inner"] + 1e-3,
                            ),
                            AndSelector(
                                of=[
                                    PlaneSelector(
                                        axis="y",
                                        value=-d["z_inner"] - d["bore_depth"],
                                        tol=3e-4,
                                    ),
                                    BoxSelector(
                                        min=(
                                            -d["bore_radius"] - 1e-3,
                                            -d["total_width"],
                                            d["bore_y"] - d["bore_radius"] - 1e-3,
                                        ),
                                        max=(
                                            d["bore_radius"] + 1e-3,
                                            d["total_width"],
                                            d["bore_y"] + d["bore_radius"] + 1e-3,
                                        ),
                                    ),
                                ]
                            ),
                        ]
                    ),
                    min_facets=8,
                ),
                NamedRegion(
                    name="outboard_pad_abutment",
                    kind=RegionKind.LOAD,
                    description=(
                        "Inner face of the outboard leg, where the outboard pad presses "
                        "on the caliper. The pad reaction is applied here as a resultant "
                        "force; pad compliance and friction are not modelled."
                    ),
                    selector=AndSelector(
                        of=[
                            PlaneSelector(axis="y", value=d["z_inner"], tol=1e-5),
                            BoxSelector(
                                min=(-L / 2.0 - 1e-3, -d["total_width"], 0.0),
                                max=(L / 2.0 + 1e-3, d["total_width"], d["slot_depth"]),
                            ),
                        ]
                    ),
                    min_facets=8,
                ),
                NamedRegion(
                    name="inboard_pad_abutment",
                    kind=RegionKind.INTERFACE,
                    description="Inner face of the inboard leg (inboard pad contact).",
                    selector=AndSelector(
                        of=[
                            PlaneSelector(axis="y", value=-d["z_inner"], tol=1e-5),
                            BoxSelector(
                                min=(-L / 2.0 - 1e-3, -d["total_width"], 0.0),
                                max=(L / 2.0 + 1e-3, d["total_width"], d["slot_depth"]),
                            ),
                        ]
                    ),
                    min_facets=4,
                ),
                NamedRegion(
                    name="disc_slot_interface",
                    kind=RegionKind.NON_DESIGN,
                    description=(
                        "The disc slot envelope. Its width must stay clear for the disc "
                        "and pads."
                    ),
                    selector=BoxSelector(
                        min=(-L / 2.0, -d["z_inner"], 0.0),
                        max=(L / 2.0, d["z_inner"], d["slot_depth"]),
                    ),
                    required=False,
                ),
            ]
        )

    # ------------------------------------------------------------- properties

    def min_wall_thickness(self, p: dict[str, float]) -> float:
        d = self._derived(p)
        behind_bore = d["wall"] - d["bore_depth"]
        bridge_above_slot = d["height"] - d["slot_depth"]
        return float(
            min(
                p["wall_thickness_m"],
                p["bridge_thickness_m"],
                behind_bore,
                bridge_above_slot,
                p["rib_thickness_m"] if int(round(p["rib_count"])) > 0 else 1.0,
            )
        )

    def preserved_interfaces(
        self, p: dict[str, float]
    ) -> list[tuple[str, str, float, float]]:
        d = self._derived(p)
        return [
            (
                "overall_length",
                "Body length measured across the tessellated solid (X extent)",
                d["length"],
                1.0e-3,
            ),
            (
                "overall_height",
                "Axial width measured across the tessellated solid (build Y extent)",
                d["total_width"],
                1.0e-3,
            ),
            (
                "overall_width",
                "Radial body height measured across the tessellated solid (Z extent)",
                d["height"],
                1.0e-3,
            ),
        ]

    def mesh_size_hint(self, p: dict[str, float]) -> float:
        thin = min(
            p["wall_thickness_m"],
            p["bridge_thickness_m"],
            self._derived(p)["wall"] - self._derived(p)["bore_depth"],
        )
        return float(max(0.0035, min(0.008, thin * 0.75)))
