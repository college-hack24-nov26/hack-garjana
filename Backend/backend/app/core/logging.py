"""Structured-enough logging for a single-machine engineering app."""
from __future__ import annotations

import logging
import sys

_CONFIGURED = False
_FORMAT = "%(asctime)s %(levelname)-7s %(name)-34s %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT))
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler]
    # Gmsh and matplotlib-adjacent libraries are extremely chatty.
    for noisy in ("trimesh", "skfem", "skfem.assembly", "skfem.utils", "matplotlib"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)
