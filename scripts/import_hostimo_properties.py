#!/usr/bin/env python3
"""Generate the SQL that imports the Hostimo Property Management portfolio.

One-shot importer kept in the repo for auditability: it is the record of how
the 48 rows of the "Tendwell x hostimo Cleaning - Property Info" sheet became
`properties` rows, so a later question about where a door code or a par level
came from has an answer that isn't "someone pasted it in".

Reads the source CSV, applies the curated per-row corrections below, and
writes a single idempotent SQL transaction to stdout.

Usage:  python3 scripts/import_hostimo_properties.py <csv> > out.sql

What the curation covers (the CSV alone is not enough):

* Door codes  - the sheet crams every code for a property into one free-text
  cell in ~20 different shapes ("2667/224-Crawlspace", "Door codes\nFront
  Door: 0513\n..."). A regex that got this 90% right would silently put an
  owners-closet code on a front door, so the primary entry code and the
  remaining codes are mapped by hand, per row, from the raw cell.
* Bed sizes   - the Kings/Queens/Twins columns already fold sleeper sofas and
  bunk beds into the nearest size, which is what the linen formula wants, but
  a few rows disagree with the "Linen Count" text (fulls recorded under
  Queens, a sofa sleeper left out entirely). The text wins there.
* Hot tub / pool - there is no column for either. Only the properties whose
  own instructions evidence one are flagged; everything else stays false
  rather than guessing, because pool_towels keys off it.
"""

import csv
import re
import sys
from datetime import date

CLIENT_NAME = "Hostimo"
CLIENT_COMPANY = "Hostimo Property Management"
NAME_PREFIX = "HPM-"
ONBOARDING_STAGE_ID = 3
IMPORT_ACTOR = "Hostimo CSV import"
# Bare month/day start dates ("9/17(turn)") carry no year; the sheet was built
# for the 2026 onboarding wave and every explicit date in it is 2026.
START_DATE_YEAR = 2026

# ── Curated per-row data, keyed by 1-based CSV row ────────────────────────────
# (primary entry code, the remaining codes as they should read in other_codes)
CODES = {
    1:  ("2255", "Lockbox (porch, near front door): 1776\nRocky Flats Theatre: 5555"),
    2:  ("2008", "Owners closets (all): 4678\nAlarm code: 7007"),
    3:  ("5683", "Lock box (backup keys): 5683\nOwners closet: 4678"),
    4:  ("7333", "Owners closet: 4678"),
    5:  ("2017", "Garage / owners closet: 1161\nDownstairs bedroom door: 2021\nLiving room closet battery box: 912"),
    6:  ("7187", ""),
    7:  ("2667", "Crawlspace: 224"),
    8:  ("4433", "Crawlspace: 4678"),
    9:  ("1111", "Crawlspace: 224"),
    10: ("0690", "Owners closet: 7500"),
    11: ("6468", "Owners closet: 4678\nLockbox: 6468"),
    12: ("1300", "Owners closet: 4678\nGame room / theatre: 7007\nLock box: 5203"),
    13: ("0511", "Lockbox: 0928\nOwners closet: 4678"),
    14: ("074379", "Firewood lock: 074\nOwners closet: 1999"),
    15: ("1993", "Owners closet: 2004"),
    16: ("2719", "Owners closet: 3258\nParking pass: Happyvacay7 / Happy123"),
    17: ("9091", "Owners closet: 6969#"),
    18: ("2683", "Downstairs: 6668"),
    19: ("0513", "Backup: 2239\nOwners closet: 6638"),
    20: ("3098", "Movie theatre: 2468\nLock box: 7658"),
    21: ("5683", ""),
    22: ("5333", "Owners closet: 224"),
    23: ("8303", "Owners closet: 896"),
    24: ("0913", "Lock box: 4207\nSecurity code: 4207 / thinkagain\nOwners closet: 4678"),
    25: ("5683", "Owners closet: 4678"),
    26: ("1952", "Owners closet: 9399"),
    27: ("7007", ""),
    28: ("2390", "Owners closet: 5484"),
    29: ("5486", "Owners closet: 5484"),
    30: ("6834", "Owners closet: 5484\nBear-proof trash: 0745"),
    31: ("6172", "Utility closet: 7581"),
    32: ("2327", "Owners closet: 4678"),
    33: ("1964", ""),
    34: ("9671", "Owners closet: 4678\nLock box for outside theatre: 4678"),
    35: ("1705", "Owners closet: 1014"),
    36: ("7777", "Lock box for crawlspace: 3258\nKey for the chest is in the laundry room."),
    37: ("3828", "Front porch lock box: 4641\nOwners closet digital lock: 2678\nCrawl space: 6521\nKeys to the front door and owners closet are also in the front porch lock box."),
    38: ("9876", "Pool code: 2014\nOwners closet: 342\nFirewood code: 987"),
    39: ("8618", ""),
    40: ("1925", "Owners closet: 200\nEntry gate code, by month:\n"
                 "January - 1480\nFebruary - 7931\nMarch - 4637\nApril - 8923\n"
                 "May - 5290\nJune - 2475\nJuly - 3172\nAugust - 6924\n"
                 "September - 9486\nOctober - 4970\nNovember - 5632\nDecember - 7240"),
    41: ("4642", ""),
    42: ("2326", "Owners closet: 2727"),
    43: ("2022", "Owner closet (2nd floor): 2990\nGate code: 37862"),
    44: ("0712", "Gate access code: 1301*\nTrash can: 0712"),
}

# Rows where the Kings/Queens/Twins columns disagree with the Linen Count text.
# Each value fully replaces the parsed columns.
BED_OVERRIDES = {
    # "5 king / 4 Twin / 1 Queen sofa sleeper" - the sofa sleeper is missing
    # from the Queens column.
    4:  dict(king=5, queen=1, full=0, twin=4),
    # "2 king / 1 queen / Twin over Full Bunk Bed" - the bunk is one twin over
    # one full, counted as two twins in the columns.
    17: dict(king=2, queen=1, full=1, twin=1),
    # "2 King / 1 Full / 1 Twin / 1 Twin (trundle)" - the full sits in Queens.
    27: dict(king=2, queen=0, full=1, twin=2),
    # "2 King / 1 Full (daybed) / 4 Twin"
    35: dict(king=2, queen=0, full=1, twin=4),
    # "2 King / 3 Full / 1 Twin"
    38: dict(king=2, queen=0, full=3, twin=1),
    # "2 King / 1 Queen / 2 Sleeper Sofas (loft/downstairs)" is what the sheet
    # says, but the property is 2 kings + 4 twins + a twin daybed with a twin
    # trundle (Jordan, 2026-09-16). Per the sheet's own convention - 1344
    # Paradise Lane records "4 Twin / 1 Twin (daybed with Twin trundle)" as 6
    # twins - the daybed and its trundle are two twin sleeping surfaces. Sleep
    # count lands on 10 either way, matching the Sleeps column.
    19: dict(king=2, queen=0, full=0, twin=6),
    # "5 kings / 5 twins / 2 sleeper" - sleepers missing from Queens.
    46: dict(king=5, queen=2, full=0, twin=5),
    # "4 Kings / 2 sleepers" - every bed column is blank on this row.
    47: dict(king=4, queen=2, full=0, twin=0),
}

# Rows whose Linen Count text itself is wrong, not just mis-columned.
BED_TEXT_OVERRIDES = {
    19: "2 King / 4 Twin / 1 Twin daybed with Twin trundle",
}

# Only where the sheet itself evidences one (see module docstring).
HOT_TUB_ROWS = {1, 11}    # "hot tub towels inside sauna" / "do not drain hot tub"
POOL_ROWS = {38}          # "3bed/3bath w/ indoor pool"

# Addresses the sheet typo'd; keyed by row.
ADDRESS_FIXES = {
    35: "1523 Bluff Ridge Rd, Sevierville, TN 37876",   # ", TN 37876" twice
    36: "1602 Bear Valley Rd, Sevierville, TN 37876",   # "Sevierville, ,"
}


def q(value):
    """Render a Python value as a SQL literal."""
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def num(raw):
    """The sheet writes counts as '2.' / '2.5' / ''."""
    raw = (raw or "").strip().rstrip(".")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def money(raw):
    raw = (raw or "").replace("$", "").replace(",", "").strip()
    try:
        return round(float(raw), 2)
    except ValueError:
        return None


def clean_lines(raw):
    return [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]


def parse_start_date(raw):
    """'9/17(turn)' / '09/28/2026' / '9/20 (departure)' -> ISO date or None."""
    raw = (raw or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if m:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
    m = re.match(r"^(\d{1,2})/(\d{1,2})\b", raw)
    if m:
        return date(START_DATE_YEAR, int(m.group(1)), int(m.group(2))).isoformat()
    return None


def split_baths(raw):
    """'2.5' -> (2 full, 1 half). The sheet only ever uses whole or .5."""
    value = num(raw)
    if value is None:
        return None, None
    full = int(value)
    half = 1 if value - full >= 0.5 else 0
    return full, half


def normalize_wifi(raw):
    lines = clean_lines(raw)
    # Drop the one row's redundant "- Wifi Username/Password" header.
    lines = [ln for ln in lines if not re.fullmatch(r"-?\s*wifi username/password", ln, re.I)]
    text = "\n".join(lines)
    # One row lost the separator between the network name and the password.
    text = text.replace("Mountain-homePassword:", "Mountain-home\nPassword:")
    return text or None


def linens(guests, king, queen, full, twin, full_baths, watered):
    """Haven's par-level rules (client/src/lib/linen-calc.ts).

    sleep = guest count when set, else king*2 + queen*2 + full*2 + twin*1.
    """
    sleep = guests if guests else king * 2 + queen * 2 + full * 2 + twin
    return dict(
        hand_towels=sleep,
        washcloths=sleep,
        bath_towels=sleep + full_baths,
        bathmats=full_baths,
        pool_towels=sleep if watered else 0,
    )


def build(rows):
    out = []
    for idx, r in enumerate(rows, 1):
        addr_lines = clean_lines(r["Property Address"])
        if not addr_lines:
            continue
        street = addr_lines[0].split(",")[0].strip()
        address = ADDRESS_FIXES.get(idx, ", ".join(addr_lines))

        beds = BED_OVERRIDES.get(idx) or dict(
            king=int(num(r["Kings"]) or 0),
            queen=int(num(r["Queens"]) or 0),
            full=0,
            twin=int(num(r["Twins"]) or 0),
        )
        full_baths, half_baths = split_baths(r["Baths"])
        guests = int(num(r["Sleeps"]) or 0)
        hot_tub, pool = idx in HOT_TUB_ROWS, idx in POOL_ROWS
        par = linens(guests, beds["king"], beds["queen"], beds["full"], beds["twin"],
                     full_baths or 0, hot_tub or pool)

        door_code, other_codes = CODES.get(idx, ("", ""))
        listing = (r["Airbnb Link"] or "").strip()
        # Two rows list an Airbnb feed AND a VRBO feed in one cell; the column
        # holds a single URL, so the extras go to a note rather than being
        # concatenated into an unusable one.
        icals = re.findall(r"https?://\S+", r["ICals"] or "")

        out.append(dict(
            row=idx,
            name=NAME_PREFIX + street,
            address=address,
            listing_url=listing if listing.startswith("http") else None,
            ical_url=icals[0] if icals else None,
            ce_charged=money(r["Tendwell Final Price"]),
            cleaner_pay=money(r["Proposed Cleaner Pay"]),
            guest_count=guests or None,
            bedrooms=int(num(r["Bedrooms"])) if num(r["Bedrooms"]) is not None else None,
            full_baths=full_baths,
            half_baths=half_baths,
            king_beds=beds["king"], queen_beds=beds["queen"],
            full_beds=beds["full"], twin_beds=beds["twin"],
            number_of_beds=beds["king"] + beds["queen"] + beds["full"] + beds["twin"],
            hot_tub=hot_tub, pool=pool,
            door_code=door_code or None,
            other_codes=other_codes or None,
            wifi_info=normalize_wifi(r["Wifi Info"]),
            bed_sizes_text=BED_TEXT_OVERRIDES.get(idx, (r["Linen Count"] or "").strip()) or None,
            first_clean_date=parse_start_date(r["Start Date"]),
            notes=property_notes(r, idx, listing, icals[1:]),
            **par,
        ))
    return out


def property_notes(r, idx, listing, extra_icals):
    """The free-text columns, as one property_notes row each."""
    notes = []
    consumables = (r["Special Consumables"] or "").strip()
    if consumables:
        notes.append(("Special consumables (restock every turn): " + consumables, None))

    instructions = (r["Special Instructions"] or "").strip()
    if instructions:
        notes.append(("Special instructions: " + instructions, None))

    netflix = (r["Netflix Sign In"] or "").strip()
    if netflix and netflix.upper() != "N/A":
        notes.append(("Netflix / streaming sign-in: " + " / ".join(clean_lines(netflix)), "access"))

    # The four rows whose listing column holds a description instead of a link
    # would otherwise lose it.
    if listing and not listing.startswith("http"):
        notes.append(("From the Hostimo sheet's listing column: " + listing, None))

    if extra_icals:
        notes.append(("Additional calendar feeds from the Hostimo sheet:\n"
                      + "\n".join(extra_icals), None))

    onboarding = []
    if (r["Start Date"] or "").strip():
        onboarding.append("Start date: " + r["Start Date"].strip())
    if (r["Onboarding Phase"] or "").strip():
        onboarding.append("Onboarding phase: " + r["Onboarding Phase"].strip())
    if (r["Quote Status"] or "").strip():
        onboarding.append("Quote status at import: " + r["Quote Status"].strip())
    if (r["Linen Count"] or "").strip():
        onboarding.append("Bed configuration as written: " + r["Linen Count"].strip())
    if onboarding:
        notes.append(("Hostimo onboarding — imported from the property info sheet.\n"
                      + "\n".join(onboarding), None))
    return notes


COLUMNS = [
    "name", "address", "listing_url", "ical_url", "ce_charged", "cleaner_pay",
    "guest_count", "bedrooms", "full_baths", "half_baths",
    "king_beds", "queen_beds", "full_beds", "twin_beds", "number_of_beds",
    "hot_tub", "pool", "door_code", "other_codes", "wifi_info",
    "bed_sizes_text", "first_clean_date",
    "bath_towels", "hand_towels", "washcloths", "bathmats", "pool_towels",
]


def emit(props):
    w = sys.stdout.write
    w("-- Hostimo Property Management portfolio import.\n")
    w("-- Generated by scripts/import_hostimo_properties.py — do not hand-edit.\n")
    w(f"-- {len(props)} properties, all landing in the Onboarding stage.\n\nBEGIN;\n\n")

    w("-- The client every one of these properties bills under.\n")
    w("INSERT INTO contacts (full_name, company, source, client_stage, client_stage_since, is_active)\n")
    w(f"SELECT {q(CLIENT_NAME)}, {q(CLIENT_COMPANY)}, 'Referral', 'won', now(), true\n")
    w(f"WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE lower(full_name) = lower({q(CLIENT_NAME)}));\n\n")

    w("-- Property rows. Re-running is a no-op: the name is the natural key, and\n")
    w("-- the trigger-derived financials/linen columns are left to recalc_property_formulas().\n")
    w("WITH client AS (\n")
    w(f"  SELECT id FROM contacts WHERE lower(full_name) = lower({q(CLIENT_NAME)}) LIMIT 1\n")
    w("), incoming (" + ", ".join(COLUMNS) + ") AS (\n  VALUES\n")

    rendered = []
    for i, p in enumerate(props):
        vals = []
        for c in COLUMNS:
            v = q(p[c])
            # The VALUES list needs its types pinned on the first row so the CTE
            # doesn't come out all-text.
            if i == 0:
                if c in ("ce_charged", "cleaner_pay"):
                    v += "::numeric"
                elif c in ("guest_count", "bedrooms", "full_baths", "half_baths",
                           "king_beds", "queen_beds", "full_beds", "twin_beds",
                           "number_of_beds", "bath_towels", "hand_towels",
                           "washcloths", "bathmats", "pool_towels"):
                    v += "::int"
                elif c in ("hot_tub", "pool"):
                    v += "::boolean"
                elif c == "first_clean_date":
                    v += "::date"
                else:
                    v += "::text"
            vals.append(v)
        rendered.append("    (" + ", ".join(vals) + ")")
    w(",\n".join(rendered))
    w("\n)\nINSERT INTO properties (stage_id, contact_id, onboarding_date, " + ", ".join(COLUMNS) + ")\n")
    w(f"SELECT {ONBOARDING_STAGE_ID}, client.id, CURRENT_DATE, i.*\n")
    w("FROM incoming i CROSS JOIN client\n")
    w("WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE lower(p.name) = lower(i.name));\n\n")

    w("-- Stage audit trail, matching what a manual move writes.\n")
    w("INSERT INTO stage_transitions (property_id, from_stage_id, to_stage_id, transitioned_by, notes)\n")
    w(f"SELECT p.id, NULL, {ONBOARDING_STAGE_ID}, {q(IMPORT_ACTOR)},\n")
    w("       'Imported from the Hostimo property info sheet, straight into Onboarding.'\n")
    w(f"FROM properties p WHERE p.name LIKE {q(NAME_PREFIX + '%')}\n")
    w("  AND NOT EXISTS (SELECT 1 FROM stage_transitions s WHERE s.property_id = p.id);\n\n")

    w("-- Free-text columns from the sheet, as property notes. One statement so a\n")
    w("-- re-run is a single pass, matched on (property, exact content).\n")
    w("WITH incoming (property_name, content, context) AS (\n  VALUES\n")
    note_rows = []
    for i, (p, (content, context)) in enumerate(
            (p, n) for p in props for n in p["notes"]):
        cast = "::text" if i == 0 else ""
        note_rows.append(f"    ({q(p['name'])}{cast}, {q(content)}{cast}, {q(context)}{cast})")
    w(",\n".join(note_rows))
    w("\n)\nINSERT INTO property_notes (property_id, content, context, created_by)\n")
    w(f"SELECT p.id, i.content, i.context, {q(IMPORT_ACTOR)}\n")
    w("FROM incoming i JOIN properties p ON p.name = i.property_name\n")
    w("WHERE NOT EXISTS (SELECT 1 FROM property_notes n\n")
    w("                  WHERE n.property_id = p.id AND n.content = i.content);\n\n")

    w("-- One activity row per property so the import shows up on /activity.\n")
    w("INSERT INTO activity_log (entity_type, entity_id, entity_name, action, field_name, new_value, changed_by, metadata)\n")
    w("SELECT 'property', p.id::text, p.name, 'created', 'stage', 'Onboarding', "
      f"{q(IMPORT_ACTOR)}, jsonb_build_object('source', 'hostimo_property_info_sheet')\n")
    w(f"FROM properties p WHERE p.name LIKE {q(NAME_PREFIX + '%')}\n")
    w("  AND NOT EXISTS (SELECT 1 FROM activity_log a\n")
    w("                  WHERE a.entity_type = 'property' AND a.entity_id = p.id::text\n")
    w(f"                    AND a.changed_by = {q(IMPORT_ACTOR)});\n\n")
    w("COMMIT;\n")


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: import_hostimo_properties.py <csv>")
    with open(sys.argv[1], newline="", encoding="utf-8") as fh:
        props = build(list(csv.DictReader(fh)))
    emit(props)


if __name__ == "__main__":
    main()
