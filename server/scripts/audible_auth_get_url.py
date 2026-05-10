#!/usr/bin/env python3
"""
Phase 1 of audible-cli auth setup.
Generates the Audible OAuth URL and saves partial state to a temp file.

Usage:  python audible_auth_get_url.py <state_file> <marketplace> <profile_name>
Output: JSON on stdout  { "ok": true, "url": "https://..." }
        or              { "ok": false, "error": "..." }
"""
import sys
import json
import os
import base64

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "Usage: script <state_file> <marketplace> <profile_name>"}))
        sys.exit(1)

    state_file = sys.argv[1]
    marketplace = sys.argv[2].lower().strip()
    profile_name = sys.argv[3].strip()

    try:
        from audible.localization import Locale
        from audible.login import build_oauth_url, create_code_verifier

        locale = Locale(marketplace)

        code_verifier = create_code_verifier()
        oauth_url, serial = build_oauth_url(
            country_code=locale.country_code,
            domain=locale.domain,
            market_place_id=locale.market_place_id,
            code_verifier=code_verifier,
        )

        # Persist state needed to complete auth later
        state = {
            "code_verifier": base64.b64encode(code_verifier).decode("utf-8"),
            "serial": serial,
            "domain": locale.domain,
            "country_code": locale.country_code,
            "market_place_id": locale.market_place_id,
            "profile_name": profile_name,
        }
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f)

        print(json.dumps({"ok": True, "url": oauth_url}))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
