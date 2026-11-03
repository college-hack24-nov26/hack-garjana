"""Controlled material catalog (spec 4.3).

Material properties are never invented at request time: a simulation may only
use a record that exists in this catalog, and the record is snapshotted into the
run so results stay reproducible even if the catalog is later edited.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

_CATALOG_PATH = Path(__file__).with_name("materials.json")


class MaterialRecord(BaseModel):
    """A single catalog entry. All values are in canonical SI units."""

    material_id: str
    name: str
    family: str
    typical_use: Optional[str] = None

    #: Temper, heat-treatment or as-processed state. Required: a grade name
    #: alone does not determine strength, and the research dossiers call out a
    #: grade without its temper as a seeded failure case (F03).
    condition: str = Field(
        description="Temper / heat treatment / as-processed state of this grade"
    )

    density: float = Field(description="kg/m3")
    elastic_modulus: Optional[float] = Field(default=None, description="Pa")
    poisson_ratio: Optional[float] = Field(default=None, description="-")
    yield_strength: Optional[float] = Field(default=None, description="Pa")
    ultimate_tensile_strength: Optional[float] = Field(default=None, description="Pa")
    thermal_conductivity: Optional[float] = Field(default=None, description="W/(m·K)")
    specific_heat: Optional[float] = Field(default=None, description="J/(kg·K)")
    max_service_temperature: Optional[float] = Field(default=None, description="K")

    source_status: str
    source_document: Optional[str] = None
    notes: Optional[str] = None
    temperature_dependent_properties: Optional[dict] = None
    record_version: str
    last_reviewed: str

    @property
    def is_illustrative(self) -> bool:
        return self.source_status != "supplier_certified"

    def supports_structural(self) -> bool:
        return self.elastic_modulus is not None and self.poisson_ratio is not None

    def supports_thermal(self) -> bool:
        return self.thermal_conductivity is not None

    def supports_yield_margin(self) -> bool:
        return self.yield_strength is not None

    def snapshot(self) -> dict:
        """Immutable copy stored with every simulation run for traceability."""
        return self.model_dump(mode="json")


class MaterialCatalog(BaseModel):
    catalog_version: str
    last_reviewed: str
    provenance_note: str
    units: dict[str, str]
    materials: list[MaterialRecord]

    def by_id(self, material_id: str) -> MaterialRecord:
        for m in self.materials:
            if m.material_id == material_id:
                return m
        raise KeyError(
            f"unknown material_id {material_id!r}; "
            f"available: {sorted(m.material_id for m in self.materials)}"
        )

    def ids(self) -> list[str]:
        return [m.material_id for m in self.materials]

    def for_structural(self) -> list[MaterialRecord]:
        return [m for m in self.materials if m.supports_structural()]

    def for_thermal(self) -> list[MaterialRecord]:
        return [m for m in self.materials if m.supports_thermal()]


@lru_cache
def get_catalog() -> MaterialCatalog:
    data = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return MaterialCatalog.model_validate(data)


def get_material(material_id: str) -> MaterialRecord:
    return get_catalog().by_id(material_id)
