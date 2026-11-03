"""Unit-system tests (spec 4.1).

Units are the foundation every other number rests on, so these are strict: a
wrong conversion here would silently corrupt every result the platform reports.
"""
from __future__ import annotations

import math

import pytest

from app.core import units as U
from app.schemas.common import Quantity, canonical_quantity


class TestConversion:
    @pytest.mark.parametrize(
        "value,unit,expected",
        [
            (150, "MPa", 150e6),
            (1, "GPa", 1e9),
            (1, "bar", 1e5),
            (205, "N/mm2", 205e6),
            (1, "mm", 1e-3),
            (1, "in", 0.0254),
            (1, "kN", 1000.0),
            (1, "g/cm3", 1000.0),
            (1, "W/(mm.K)", 1000.0),
            (4000, "K/m", 4000.0),
            (4, "K/mm", 4000.0),
        ],
    )
    def test_to_canonical(self, value, unit, expected):
        assert U.to_canonical(value, unit) == pytest.approx(expected, rel=1e-12)

    @pytest.mark.parametrize(
        "value,unit,expected",
        [
            (0, "C", 273.15),
            (25, "C", 298.15),
            (-40, "C", 233.15),
            (-40, "F", 233.15),
            (32, "F", 273.15),
            (212, "F", 373.15),
            (300, "K", 300.0),
        ],
    )
    def test_temperature_is_affine_not_scaled(self, value, unit, expected):
        """Temperature needs an offset, not a factor: 0 C is not 0 K."""
        assert U.to_canonical(value, unit) == pytest.approx(expected, abs=1e-9)

    def test_round_trip(self):
        for unit in ("mm", "MPa", "kN", "C", "F", "in", "K/mm"):
            for value in (-12.5, 0.0, 1.0, 987.654):
                canonical = U.to_canonical(value, unit)
                assert U.from_canonical(canonical, unit) == pytest.approx(value, abs=1e-9)

    def test_convert_between_units(self):
        assert U.convert(1, "in", "mm") == pytest.approx(25.4)
        assert U.convert(1000, "MPa", "GPa") == pytest.approx(1.0)
        assert U.convert(100, "C", "F") == pytest.approx(212.0, abs=1e-9)


class TestRejection:
    def test_unknown_unit_is_rejected(self):
        with pytest.raises(U.UnitError):
            U.to_canonical(1, "furlongs")

    def test_incompatible_conversion_is_rejected(self):
        """A stress may never be silently read as a length."""
        with pytest.raises(U.UnitError):
            U.convert(1, "MPa", "mm")

    def test_quantity_requires_known_unit(self):
        with pytest.raises(Exception):
            Quantity(value=1, unit="bananas")

    def test_quantity_kind_enforcement(self):
        stress = Quantity(value=120, unit="MPa")
        assert stress.require_kind("stress") is stress
        with pytest.raises(ValueError):
            stress.require_kind("length")


class TestDisplay:
    def test_display_picks_engineering_units(self):
        value, unit = U.display(147.6e6, "Pa")
        assert unit == "MPa" and value == pytest.approx(147.6)

        value, unit = U.display(0.00095, "m")
        assert unit == "mm" and value == pytest.approx(0.95)

        value, unit = U.display(1073.15, "K")
        assert unit == "C" and value == pytest.approx(800.0)

    def test_canonical_quantity_keeps_both_representations(self):
        display = canonical_quantity(205e6, "stress")
        assert display.unit == "MPa"
        assert display.value == pytest.approx(205.0)
        # The stored canonical value travels with the display value, so the UI
        # can show MPa while the record stays in Pa.
        assert display.canonical_value == pytest.approx(205e6)
        assert display.canonical_unit == "Pa"

    def test_every_canonical_kind_has_a_display_unit(self):
        for kind, canonical in U.CANONICAL.items():
            target = U.DISPLAY_UNITS.get(kind, canonical)
            # Must not raise: every declared kind is displayable.
            U.convert(1.0, canonical, target)
