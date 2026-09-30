#!/usr/bin/env python3
"""Call a paired DroneLab relay MCP endpoint from a terminal without shell execution.

Set DRONELAB_RELAY_URL, DRONELAB_RELAY_SECRET, DRONELAB_SESSION_ID and
DRONELAB_MCP_TOKEN. Examples:
  python examples/relay-policy-cli.py status
  python examples/relay-policy-cli.py reset '{"scenario":"hover"}'
  python examples/relay-policy-cli.py step '{"episodeId":"...","expectedStep":0,"action":{"kind":"nav","velocity":[0,0,0],"yawRate":0}}'
"""
import json
import os
import sys
import urllib.parse
import urllib.request

# Pairing tokens must never be sent through ambient HTTP proxy settings.
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

REQUIRED = ("DRONELAB_RELAY_URL", "DRONELAB_RELAY_SECRET", "DRONELAB_SESSION_ID", "DRONELAB_MCP_TOKEN")
missing = [name for name in REQUIRED if not os.environ.get(name)]
if missing:
    raise SystemExit("Missing environment variable(s): " + ", ".join(missing))

commands = {
    "status": ("get_policy_observation", {}),
    "reset": ("reset_policy_session", None),
    "step": ("step_policy", None),
    "finish": ("finish_policy_session", None),
    "export": ("export_dataset", None),
}
if len(sys.argv) < 2 or sys.argv[1] not in commands:
    raise SystemExit("Usage: relay-policy-cli.py {status|reset|step|finish|export} [JSON arguments]")
tool, defaults = commands[sys.argv[1]]
arguments = defaults if defaults is not None else json.loads(sys.argv[2]) if len(sys.argv) == 3 else None
if arguments is None or not isinstance(arguments, dict):
    raise SystemExit("This command needs a JSON object argument")

base = os.environ["DRONELAB_RELAY_URL"].rstrip("/")
url = base + "/mcp?" + urllib.parse.urlencode({"sessionId": os.environ["DRONELAB_SESSION_ID"]})
headers = {
    "Authorization": "Bearer " + os.environ["DRONELAB_RELAY_SECRET"],
    "X-DroneLab-Pair-Token": os.environ["DRONELAB_MCP_TOKEN"],
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}

def rpc(method, params, request_id=None, session=None):
    body = {"jsonrpc": "2.0", "method": method, "params": params}
    if request_id is not None:
        body["id"] = request_id
    request_headers = dict(headers)
    if session:
        request_headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=request_headers, method="POST")
    with opener.open(request, timeout=20) as response:
        raw = response.read().decode()
        # Streamable HTTP can return an empty acknowledgement or SSE with event lines.
        frames = [line[5:].strip() for line in raw.splitlines() if line.startswith("data:") and line[5:].strip()]
        payload = frames[-1] if frames else raw.strip()
        return (json.loads(payload) if payload else {}), response.headers.get("Mcp-Session-Id")

def close_transport(session):
    request_headers = dict(headers)
    request_headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(url, headers=request_headers, method="DELETE")
    try:
        with opener.open(request, timeout=10):
            pass
    except Exception:
        # The relay session still has a short expiry; do not hide the tool result.
        pass

initialized, mcp_session = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "dronelab-terminal-cli", "version": "0.1"}}, 1)
if not mcp_session:
    raise SystemExit("Relay did not establish an MCP session: " + json.dumps(initialized))
try:
    rpc("notifications/initialized", {}, session=mcp_session)
    result, _ = rpc("tools/call", {"name": tool, "arguments": arguments}, 2, mcp_session)
    print(json.dumps(result, indent=2))
finally:
    close_transport(mcp_session)
