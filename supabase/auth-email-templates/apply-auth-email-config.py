#!/usr/bin/env python3
"""Apply Tendwell-branded auth email config to Supabase via the Management API.

Configures the tendwell-ops Supabase project (eetsudoksvsmwtiqraot) to:
  1. Send ALL Supabase Auth emails through Resend SMTP as
     "Tendwell Cleaning Co. <noreply@tendwellcleaningco.com>"
  2. Use the branded HTML templates in this folder (reset password,
     confirm signup, magic link, change email) with branded subjects.

Requires two environment variables (see AGENT-RUNBOOK.md for how to get them):
  SUPABASE_ACCESS_TOKEN  - Supabase personal access token (sbp_...)
  RESEND_API_KEY         - Resend API key (re_...), used as the SMTP password

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_xxx RESEND_API_KEY=re_xxx \
      python3 apply-auth-email-config.py

Idempotent: safe to re-run. Uses only the Python standard library.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_REF = "eetsudoksvsmwtiqraot"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth"
HERE = os.path.dirname(os.path.abspath(__file__))

SENDER_EMAIL = "noreply@tendwellcleaningco.com"
SENDER_NAME = "Tendwell Cleaning Co."
SMTP_HOST = "smtp.resend.com"
SMTP_PORT = "465"
SMTP_USER = "resend"

TEMPLATES = {
    # management-api field stem -> (html file, subject)
    "recovery": ("reset-password.html", "Reset your Tendwell password"),
    "confirmation": ("confirm-signup.html", "Confirm your Tendwell account"),
    "magic_link": ("magic-link.html", "Your Tendwell sign-in link"),
    "email_change": ("change-email.html", "Confirm your new email"),
}


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def request(method: str, url: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # api.supabase.com sits behind Cloudflare, which rejects Python's
            # default urllib user agent with HTTP 403 (error code 1010).
            "User-Agent": "tendwell-ops-auth-email-config/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        die(f"{method} {url} -> HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        die(f"{method} {url} -> network error: {e.reason}")
    return {}  # unreachable


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    resend_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not token:
        die("SUPABASE_ACCESS_TOKEN is not set (create one at https://supabase.com/dashboard/account/tokens)")
    if not resend_key:
        die("RESEND_API_KEY is not set (create one at https://resend.com/api-keys)")

    # 1. Read the branded templates from this folder.
    payload: dict = {
        "smtp_admin_email": SENDER_EMAIL,
        "smtp_sender_name": SENDER_NAME,
        "smtp_host": SMTP_HOST,
        "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER,
        "smtp_pass": resend_key,
    }
    for stem, (filename, subject) in TEMPLATES.items():
        path = os.path.join(HERE, filename)
        if not os.path.exists(path):
            die(f"template file missing: {path}")
        html = open(path, encoding="utf-8").read()
        if "{{ .ConfirmationURL }}" not in html:
            die(f"{filename} is missing the required {{{{ .ConfirmationURL }}}} variable")
        payload[f"mailer_subjects_{stem}"] = subject
        payload[f"mailer_templates_{stem}_content"] = html

    # 2. Confirm the project is reachable and show the before state.
    before = request("GET", API, token)
    print(f"Project {PROJECT_REF} auth config fetched.")
    print(f"  before: smtp_host={before.get('smtp_host') or '(built-in mailer)'} "
          f"sender={before.get('smtp_admin_email') or '-'}")

    # 3. Apply.
    request("PATCH", API, token, payload)
    print("PATCH applied.")

    # 4. Verify by re-reading the config.
    after = request("GET", API, token)
    problems = []
    checks = {
        "smtp_host": SMTP_HOST,
        "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER,
        "smtp_admin_email": SENDER_EMAIL,
        "smtp_sender_name": SENDER_NAME,
    }
    for key, expected in checks.items():
        actual = str(after.get(key) or "")
        status = "OK" if actual == expected else "MISMATCH"
        if status == "MISMATCH":
            problems.append(f"{key}: expected {expected!r}, got {actual!r}")
        print(f"  {status}: {key} = {actual}")
    for stem, (_, subject) in TEMPLATES.items():
        actual_subject = after.get(f"mailer_subjects_{stem}") or ""
        content = after.get(f"mailer_templates_{stem}_content") or ""
        ok_subject = actual_subject == subject
        ok_content = "tendwell-logo-email.png" in content
        if not ok_subject:
            problems.append(f"mailer_subjects_{stem}: expected {subject!r}, got {actual_subject!r}")
        if not ok_content:
            problems.append(f"mailer_templates_{stem}_content: branded template not detected")
        print(f"  {'OK' if ok_subject and ok_content else 'MISMATCH'}: template {stem}")

    if problems:
        print("\nVERIFICATION FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)

    print("\nSUCCESS: Supabase Auth now sends branded emails via Resend SMTP.")
    print("Final check (manual): trigger 'Forgot password' on the login page and")
    print(f"confirm the email arrives from {SENDER_NAME} <{SENDER_EMAIL}>.")


if __name__ == "__main__":
    main()
