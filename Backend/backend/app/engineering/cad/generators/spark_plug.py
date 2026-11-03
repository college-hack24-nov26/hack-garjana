"""Parameterized spark-plug template (spec 2.5).

Simplification note, stated here and surfaced in the UI: this is a *simplified
thermal representation* of a spark plug as three concentric solids of
revolution - centre electrode, ceramic insulator, and metal shell - sharing
conformal interfaces. It is built to study the heat path from the firing end to
the cylinder-head seat, which is what sets a plug's heat range.

It deliberately omits: the hex, the terminal nut, the ground (side) electrode
arm, the internal resistor and seal pack, the gasket, thread form (the thread is
modelled as a plain cylinder of the major diameter), and any precious-metal tip.
Interfaces between the three parts are treated as perfectly conducting, so no
contact thermal resistance is included.

Axis is Z, with z = 0 at the firing-end tip of the centre electrode.

Protected (non-design) interfaces: thread major diameter, thread reach, seat
position, electrode gap and the insulator/shell sealing interface.
"""
from __future__ import annotations

import cadquery as cq

from app.engineering.cad.base import ComponentGenerator, Subdomain
from app.engineering.cad.regions import (
    AndSelector,
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

_EPS = 1e-5
#: Generous outer bound for "everything radially outward" selectors.
_R_FAR = 1.0


class SparkPlugGenerator(ComponentGenerator):
    component_type = ComponentType.SPARK_PLUG
    name = "spark_plug_parametric"
    version = "1.0.0"
    capability_note = (
        "Simplified three-part spark-plug thermal template: centre electrode, ceramic "
        "insulator and metal shell as concentric solids of revolution with perfectly "
        "conducting interfaces. The hex, terminal, ground electrode arm, internal "
        "resistor, seals, gasket, thread form and precious-metal tips are not "
        "modelled. Thread major diameter, reach, seat position and electrode gap are "
        "preserved interfaces and cannot be changed by the optimizer."
    )

    # ------------------------------------------------------------------ schema

    def parameter_specs(self) -> list[DesignVariableSpec]:
        return [
            # ------------------- preserved interfaces (locked) ---------------
            DesignVariableSpec(
                name="thread_major_diameter_m",
                label="Thread major diameter",
                kind="continuous",
                unit="m",
                minimum=0.010,
                maximum=0.018,
                default=0.014,  # M14
                is_design_variable=False,
                preserved_reason="Cylinder-head thread interface.",
            ),
            DesignVariableSpec(
                name="thread_reach_m",
                label="Thread reach",
                kind="continuous",
                unit="m",
                minimum=0.010,
                maximum=0.026,
                default=0.0175,
                is_design_variable=False,
                preserved_reason=(
                    "Sets how far the plug enters the chamber; fixed by the "
                    "cylinder-head design."
                ),
            ),
            DesignVariableSpec(
                name="electrode_gap_m",
                label="Electrode gap",
                kind="continuous",
                unit="m",
                minimum=0.0005,
                maximum=0.0016,
                default=0.0008,
                is_design_variable=False,
                preserved_reason=(
                    "Electrical requirement set by the ignition system. Preserved as a "
                    "clearance; no electrical discharge is simulated."
                ),
            ),
            DesignVariableSpec(
                name="electrode_protrusion_m",
                label="Electrode protrusion past insulator",
                kind="continuous",
                unit="m",
                minimum=0.0005,
                maximum=0.0040,
                default=0.0020,
                is_design_variable=False,
                preserved_reason="Firing-end geometry tied to the gap and ignition design.",
            ),
            DesignVariableSpec(
                name="shell_length_m",
                label="Shell length",
                kind="continuous",
                unit="m",
                minimum=0.016,
                maximum=0.030,
                default=0.022,
                is_design_variable=False,
                preserved_reason="Shell envelope fixed by the plug body design.",
            ),
            DesignVariableSpec(
                name="insulator_total_length_m",
                label="Insulator total length",
                kind="continuous",
                unit="m",
                minimum=0.030,
                maximum=0.060,
                default=0.044,
                is_design_variable=False,
                preserved_reason=(
                    "Overall insulator length is set by the terminal and seal pack, "
                    "which are not modelled here."
                ),
            ),
            # ---------------------------- design variables -------------------
            DesignVariableSpec(
                name="insulator_nose_length_m",
                label="Insulator nose length",
                kind="continuous",
                unit="m",
                minimum=0.0030,
                maximum=0.0150,
                default=0.0075,
                description=(
                    "Length of insulator exposed below the shell. This is the dominant "
                    "heat-range variable: a longer nose absorbs more combustion heat "
                    "and lengthens the conduction path to the shell, giving a hotter "
                    "plug; a shorter nose runs cooler."
                ),
            ),
            DesignVariableSpec(
                name="insulator_diameter_m",
                label="Insulator nose diameter",
                kind="continuous",
                unit="m",
                minimum=0.0048,
                maximum=0.0085,
                default=0.0062,
                description=(
                    "Thicker insulator conducts more heat away but leaves less shell "
                    "wall for the same thread diameter."
                ),
            ),
            DesignVariableSpec(
                name="center_electrode_diameter_m",
                label="Centre electrode diameter",
                kind="continuous",
                unit="m",
                minimum=0.0018,
                maximum=0.0035,
                default=0.0025,
                description=(
                    "A thicker electrode is a better heat path out of the firing end."
                ),
            ),
            DesignVariableSpec(
                name="electrode_length_m",
                label="Centre electrode length",
                kind="continuous",
                unit="m",
                minimum=0.018,
                maximum=0.045,
                default=0.030,
                description=(
                    "How far the electrode extends back up inside the insulator. A "
                    "longer electrode carries heat further towards the cooler end."
                ),
            ),
        ]

    # ------------------------------------------------------------ derived geom

    @staticmethod
    def _derived(p: dict[str, float]) -> dict[str, float]:
        r_electrode = p["center_electrode_diameter_m"] / 2.0
        r_insulator = p["insulator_diameter_m"] / 2.0
        r_shell_outer = p["thread_major_diameter_m"] / 2.0
        protrusion = p["electrode_protrusion_m"]
        nose = p["insulator_nose_length_m"]

        insulator_start = protrusion
        shell_start = insulator_start + nose
        shell_top = shell_start + p["shell_length_m"]
        seat_z = shell_start + p["thread_reach_m"]

        return {
            "r_electrode": r_electrode,
            "r_insulator": r_insulator,
            "r_shell_outer": r_shell_outer,
            "shell_wall": r_shell_outer - r_insulator,
            "protrusion": protrusion,
            "nose": nose,
            "insulator_start": insulator_start,
            "insulator_top": insulator_start + p["insulator_total_length_m"],
            "shell_start": shell_start,
            "shell_top": shell_top,
            "seat_z": seat_z,
            "electrode_top": p["electrode_length_m"],
        }

    # ------------------------------------------------------------ feasibility

    def check_feasibility(self, p: dict[str, float]) -> list[str]:
        d = self._derived(p)
        errs: list[str] = []

        if d["shell_wall"] < 0.0012:
            errs.append(
                f"the shell wall would be only {d['shell_wall'] * 1000:.2f} mm "
                f"(insulator {p['insulator_diameter_m'] * 1000:.2f} mm inside a "
                f"{p['thread_major_diameter_m'] * 1000:.1f} mm thread); at least "
                "1.20 mm is required to carry the thread"
            )

        insulator_wall = d["r_insulator"] - d["r_electrode"]
        if insulator_wall < 0.0010:
            errs.append(
                f"the insulator wall around the electrode would be only "
                f"{insulator_wall * 1000:.2f} mm; at least 1.00 mm is required for "
                "electrical insulation and handling"
            )

        if d["electrode_top"] <= d["shell_start"] + 0.002:
            errs.append(
                "the centre electrode does not extend at least 2 mm above the start of "
                "the shell, so it cannot form a heat path out of the firing end"
            )

        if d["electrode_top"] >= d["insulator_top"] - 0.002:
            errs.append(
                "the centre electrode reaches the top of the insulator; it must stay "
                "at least 2 mm inside it"
            )

        if d["seat_z"] >= d["shell_top"] - 0.001:
            errs.append(
                "the sealing seat would fall at or above the top of the shell; reduce "
                "the thread reach or lengthen the shell"
            )

        if d["shell_start"] >= d["insulator_top"] - 0.005:
            errs.append(
                "the insulator nose is so long that the shell would start above the "
                "insulator; reduce the nose length"
            )
        return errs

    # --------------------------------------------------------------- geometry

    def build(self, p: dict[str, float]):
        """Return a compound of three solids: electrode, insulator, shell.

        The three bodies share exact cylindrical interfaces, which the mesher
        fragments into a conformal mesh so heat can cross them.
        """
        d = self._derived(p)

        electrode = (
            cq.Workplane("XY")
            .circle(d["r_electrode"])
            .extrude(d["electrode_top"])
        )

        insulator = (
            cq.Workplane("XY")
            .workplane(offset=d["insulator_start"])
            .circle(d["r_insulator"])
            .circle(d["r_electrode"])
            .extrude(d["insulator_top"] - d["insulator_start"])
        )

        shell = (
            cq.Workplane("XY")
            .workplane(offset=d["shell_start"])
            .circle(d["r_shell_outer"])
            .circle(d["r_insulator"])
            .extrude(d["shell_top"] - d["shell_start"])
        )

        return electrode.add(insulator).add(shell)

    # ---------------------------------------------------------------- regions

    def named_regions(self, p: dict[str, float]) -> RegionSet:
        d = self._derived(p)
        return RegionSet(
            regions=[
                NamedRegion(
                    name="combustion_exposed_surfaces",
                    kind=RegionKind.THERMAL_HOT,
                    description=(
                        "Every surface below the start of the shell: the electrode tip "
                        "and barrel, the insulator nose, and the exposed underside of "
                        "the shell. Combustion heat enters here as a convective load; "
                        "combustion itself is not simulated."
                    ),
                    selector=RadialBandSelector(
                        axis="z",
                        r_min=0.0,
                        r_max=_R_FAR,
                        axial_min=-_EPS,
                        axial_max=d["shell_start"] + 1e-6,
                    ),
                    min_facets=12,
                ),
                NamedRegion(
                    name="cylinder_head_seat",
                    kind=RegionKind.THERMAL_SINK,
                    description=(
                        "Thread flank and sealing seat in contact with the cylinder "
                        "head. This is the main heat-rejection path out of the plug."
                    ),
                    selector=OrSelector(
                        of=[
                            CylinderSelector(
                                axis="z",
                                radius=d["r_shell_outer"],
                                tol=3e-4,
                                axial_min=d["shell_start"],
                                axial_max=d["seat_z"],
                            ),
                            AndSelector(
                                of=[
                                    PlaneSelector(axis="z", value=d["seat_z"], tol=3e-4),
                                    RadialBandSelector(
                                        axis="z",
                                        r_min=d["r_insulator"],
                                        r_max=d["r_shell_outer"] + 1e-4,
                                    ),
                                ]
                            ),
                        ]
                    ),
                    min_facets=10,
                ),
                NamedRegion(
                    name="terminal_end_surfaces",
                    kind=RegionKind.THERMAL_SINK,
                    description=(
                        "Surfaces above the shell, which sit in the plug well and lose "
                        "heat to the surrounding air."
                    ),
                    selector=RadialBandSelector(
                        axis="z",
                        r_min=0.0,
                        r_max=_R_FAR,
                        axial_min=d["shell_top"] - 1e-6,
                    ),
                    min_facets=6,
                ),
                NamedRegion(
                    name="electrode_firing_tip",
                    kind=RegionKind.INTERFACE,
                    description=(
                        "Firing-end face of the centre electrode. The electrode gap is "
                        "preserved as a clearance; no discharge is simulated."
                    ),
                    selector=AndSelector(
                        of=[
                            PlaneSelector(axis="z", value=0.0, tol=1e-5),
                            RadialBandSelector(
                                axis="z", r_min=0.0, r_max=d["r_electrode"] + 1e-5
                            ),
                        ]
                    ),
                    min_facets=2,
                ),
                NamedRegion(
                    name="shell_insulator_interface",
                    kind=RegionKind.NON_DESIGN,
                    description=(
                        "Cylindrical interface where the insulator seals into the "
                        "shell. Treated as perfectly conducting."
                    ),
                    selector=CylinderSelector(
                        axis="z",
                        radius=d["r_insulator"],
                        tol=2e-4,
                        axial_min=d["shell_start"],
                        axial_max=d["shell_top"],
                    ),
                    required=False,
                ),
            ]
        )

    # ------------------------------------------------------------ subdomains

    def subdomains(self, p: dict[str, float]) -> list[Subdomain]:
        """Material regions, assigned from element centroids by radius.

        The three parts are nested annuli, so a radial band identifies each one
        unambiguously regardless of how the mesher numbers the volumes.
        """
        d = self._derived(p)
        return [
            Subdomain(
                name="electrode",
                material_key="electrode",
                description="Centre electrode, the heat path out of the firing end.",
                selector=RadialBandSelector(
                    axis="z", r_min=0.0, r_max=d["r_electrode"] + 1e-6
                ),
            ),
            Subdomain(
                name="insulator",
                material_key="insulator",
                description="Ceramic insulator; its nose length sets the heat range.",
                selector=RadialBandSelector(
                    axis="z",
                    r_min=d["r_electrode"] - 1e-6,
                    r_max=d["r_insulator"] + 1e-6,
                ),
            ),
            Subdomain(
                name="shell",
                material_key="shell",
                description="Metal shell carrying heat into the cylinder head.",
                selector=RadialBandSelector(
                    axis="z",
                    r_min=d["r_insulator"] - 1e-6,
                    r_max=d["r_shell_outer"] + 1e-4,
                ),
            ),
        ]

    # ------------------------------------------------------------- properties

    def expected_solid_count(self, p: dict[str, float]) -> int:
        """Electrode, insulator and shell are three separate bodies."""
        return 3

    def min_wall_thickness(self, p: dict[str, float]) -> float:
        d = self._derived(p)
        return float(
            min(
                d["shell_wall"],
                d["r_insulator"] - d["r_electrode"],
                d["r_electrode"],
            )
        )

    def preserved_interfaces(
        self, p: dict[str, float]
    ) -> list[tuple[str, str, float, float]]:
        d = self._derived(p)
        return [
            (
                "thread_outer_diameter",
                "Thread major diameter measured across the tessellated solid in the "
                "thread band",
                p["thread_major_diameter_m"],
                2.0e-4,
            ),
            (
                "overall_width",
                "Overall axial length measured across the tessellated solid",
                d["insulator_top"],
                3.0e-4,
            ),
        ]

    def preserved_interface_context(self, p: dict[str, float]) -> dict[str, float]:
        """Axial band the thread measurement is taken over."""
        d = self._derived(p)
        return {"_thread_z_lo": d["shell_start"], "_thread_z_hi": d["seat_z"]}

    def mesh_size_hint(self, p: dict[str, float]) -> float:
        # A spark plug is a small part; resolve the thinnest wall properly.
        thin = self.min_wall_thickness(p)
        return float(max(0.0006, min(0.0018, thin * 0.85)))
