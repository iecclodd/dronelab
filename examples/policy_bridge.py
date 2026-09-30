#!/usr/bin/env python3
"""Loopback-only DroneLab policy/connectome bridge.

The operator explicitly selects a trusted local module and callable; this script
does not download models or execute terminal commands. It has no dependencies.

Example:
  DRONELAB_POLICY_CALLABLE=examples/example_connectome_mapping.py:policy \
  DRONELAB_POLICY_BRIDGE_TOKEN=replace-me python examples/policy_bridge.py
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import math
import os
import sys

spec_value = os.environ.get("DRONELAB_POLICY_CALLABLE", "")
if ":" not in spec_value:
    raise SystemExit("Set DRONELAB_POLICY_CALLABLE=/absolute/or/relative/module.py:callable")
module_path, callable_name = spec_value.rsplit(":", 1)
spec = importlib.util.spec_from_file_location("dronelab_selected_policy", module_path)
if not spec or not spec.loader:
    raise SystemExit("Unable to load selected policy module")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
policy = getattr(module, callable_name, None)
if not callable(policy):
    raise SystemExit("Selected policy callable was not found")
token = os.environ.get("DRONELAB_POLICY_BRIDGE_TOKEN")
port = int(os.environ.get("DRONELAB_POLICY_BRIDGE_PORT", "8790"))

def invalid(message):
    raise ValueError(message)

def finite(value, label):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        invalid(label + " must be finite")
    return float(value)

def validate_request(value):
    if not isinstance(value, dict) or set(value) != {"expectedStep", "observation"}:
        invalid("request must contain only expectedStep and observation")
    observation = value["observation"]
    if not isinstance(value["expectedStep"], int) or value["expectedStep"] < 0:
        invalid("expectedStep must be a non-negative integer")
    if not isinstance(observation, dict) or observation.get("version") != "state-v1":
        invalid("observation.version must be state-v1")
    if observation.get("deliveryStep") != value["expectedStep"]:
        invalid("expectedStep must equal observation.deliveryStep")
    return value

def validate_response(value):
    if not isinstance(value, dict) or set(value) != {"action", "metadata"}:
        invalid("policy output must contain only action and metadata")
    action, metadata = value["action"], value["metadata"]
    if not isinstance(action, dict) or set(action) != {"kind", "velocity", "yawRate"} or action.get("kind") != "nav":
        invalid("action must be a nav action")
    velocity = action.get("velocity")
    if not isinstance(velocity, list) or len(velocity) != 3:
        invalid("action.velocity must have three ENU components")
    velocity = [finite(component, "velocity") for component in velocity]
    yaw_rate = finite(action.get("yawRate"), "yawRate")
    if any(abs(component) > 3 for component in velocity) or abs(yaw_rate) > 1.5:
        invalid("action exceeds DroneLab nav bounds")
    if not isinstance(metadata, dict) or set(metadata) != {"datasetVersion", "model", "mappingVersion"} or not all(isinstance(metadata[key], str) and metadata[key] for key in metadata):
        invalid("metadata must name non-empty datasetVersion, model, and mappingVersion")
    return {"action": {"kind": "nav", "velocity": velocity, "yawRate": yaw_rate}, "metadata": metadata}

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        if self.path != "/v1/action":
            return self.respond(404, {"error": "not_found"})
        if token and self.headers.get("Authorization") != "Bearer " + token:
            return self.respond(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 128 * 1024:
                invalid("body size is invalid")
            request = validate_request(json.loads(self.rfile.read(length)))
            self.respond(200, validate_response(policy(request)))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.respond(400, {"error": str(error)})
        except Exception:
            # A selected model/runtime failed. Keep its traceback and paths out of the relay response.
            self.respond(500, {"error": "selected policy inference failed"})

    def log_message(self, format, *args):
        print("policy-bridge:", format % args, file=sys.stderr)

print("DroneLab policy bridge listening at http://127.0.0.1:%d/v1/action" % port)
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
