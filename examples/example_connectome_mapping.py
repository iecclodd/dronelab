"""Experimental example mapping, not a FlyWire/hemibrain runtime.

Replace `rates_for_observation` with a selected, versioned connectome or neural
model inference function. It must return named non-negative firing rates.
"""
import math

def rates_for_observation(observation):
    # Deliberately transparent placeholder sensory encoding for development.
    target = observation["relativeTarget"]
    return {
        "forward": max(0.0, target[0]), "back": max(0.0, -target[0]),
        "right": max(0.0, target[1]), "left": max(0.0, -target[1]),
        "up": max(0.0, target[2]), "down": max(0.0, -target[2]),
        "yaw_right": max(0.0, target[1]), "yaw_left": max(0.0, -target[1]),
    }

def policy(request):
    r = rates_for_observation(request["observation"])
    nav = lambda positive, negative, limit: max(-limit, min(limit, r[positive] - r[negative]))
    return {
        "action": {"kind": "nav", "velocity": [nav("forward", "back", 3), nav("right", "left", 3), nav("up", "down", 3)], "yawRate": nav("yaw_right", "yaw_left", 1.5)},
        "metadata": {"datasetVersion": "example-sensory-encoding-v0", "model": "transparent-rate-mapping", "mappingVersion": "enu-nav-v1-experimental"},
    }
