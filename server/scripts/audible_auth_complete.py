#!/usr/bin/env python3
"""
Phase 2 of audible-cli auth setup.
Completes Audible OAuth using the redirect URL the user copied from their browser,
then saves the auth profile to the audible-cli config directory.

Usage:  python audible_auth_complete.py <state_file> <redirect_url> <output_file>
Output: JSON on stdout  { "ok": true, "file": "/path/to/saved.json" }
        or              { "ok": false, "error": "..." }
"""
import sys
import json
import os
import base64
import pathlib

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "Usage: script <state_file> <redirect_url> <output_file>"}))
        sys.exit(1)

    state_file = sys.argv[1]
    redirect_url = sys.argv[2].strip()
    output_file = sys.argv[3].strip()

    try:
        # Load saved state from phase 1
        with open(state_file, "r", encoding="utf-8") as f:
            state = json.load(f)

        code_verifier = base64.b64decode(state["code_verifier"])
        serial = state["serial"]
        domain = state["domain"]

        # Parse authorization_code from redirect URL
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(redirect_url)
        params = parse_qs(parsed.query)

        if "openid.oa2.authorization_code" not in params:
            print(json.dumps({
                "ok": False,
                "error": "No authorization code found in the URL. Make sure you copied the full URL from your browser's address bar after logging in."
            }))
            sys.exit(1)

        authorization_code = params["openid.oa2.authorization_code"][0]

        # Complete device registration
        from audible.auth import register_ as register_device, Authenticator

        device_data = register_device(
            authorization_code=authorization_code,
            code_verifier=code_verifier,
            domain=domain,
            serial=serial,
        )

        # Build and save the Authenticator
        auth = Authenticator()
        auth.locale = state["country_code"]
        auth._update_attrs(with_username=False, **device_data)

        output_path = pathlib.Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        auth.to_file(filename=output_path, encryption=False, set_default=False)

        # Clean up state file
        try:
            os.remove(state_file)
        except OSError:
            pass

        print(json.dumps({"ok": True, "file": str(output_path)}))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
