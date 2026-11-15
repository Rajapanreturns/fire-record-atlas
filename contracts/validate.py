#!/usr/bin/env python3
"""Validate a site data directory against contracts/*.schema.json plus cross-file rules.

Usage:
  python3 contracts/validate.py [DATA_DIR] [--production]
    DATA_DIR      default: site/data
    --public      skip only the cross-checks against research files that a public release does not ship
                  (the M2 recompute from analysis/results_m2, audit-flag source paths); every schema and
                  internal-consistency check still runs. Use with --production for the public site build.
    --production  additionally FAIL on any fixture content (kind: fixture,
                  watermark, region/global-layer status 'fixture', ⟨placeholder⟩ text).
    (contract 1.4.0) m2_validation.json pooled numbers are recomputed from its own month rows and,
    for real builds, from analysis/results_m2/confirm/predictions_q1.parquet (+ constants.json).
    --recompute-from=PARQUET
                  additionally recompute belt_monthly counts/years_seen from
                  the Aqua 2003-2011 pre-cut (data/processed/pre_exposed/, M4.1) with
                  pyarrow (independent of the pandas builder) and require exact
                  equality (contract 1.3.0). A source whose row groups extend past
                  the period end (the global file) is refused, never decoded.

Uses the `jsonschema` package if installed; otherwise a built-in checker that
supports the subset of JSON Schema used by these contracts. Exit 0 = pass.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMAS = {name: json.loads((HERE / f"{name}.schema.json").read_text(encoding="utf-8"))
           for name in ("manifest", "series", "validation", "belt", "belt_monthly", "sensors", "m2_validation")}
CONTRACT_MAJOR = 1

try:  # optional dependency
    import jsonschema  # type: ignore
except ImportError:  # pragma: no cover
    jsonschema = None


# ---------------- minimal JSON Schema subset ----------------
def _type_ok(v, t):
    if t == "null":
        return v is None
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if t == "string":
        return isinstance(v, str)
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return isinstance(v, dict)
    raise ValueError(f"unsupported type {t}")


def _resolve(ref, root):
    assert ref.startswith("#/"), f"only local $ref supported: {ref}"
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def mini_validate(v, s, root, path="$"):
    errs = []
    if s is True or s == {}:
        return errs
    if s is False:
        return [f"{path}: not allowed"]
    if "$ref" in s:
        errs += mini_validate(v, _resolve(s["$ref"], root), root, path)
    if "type" in s:
        ts = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(_type_ok(v, t) for t in ts):
            return errs + [f"{path}: expected type {ts}, got {type(v).__name__} {v!r:.60}"]
    if "const" in s and v != s["const"]:
        errs.append(f"{path}: expected const {s['const']!r}, got {v!r:.60}")
    if "enum" in s and v not in s["enum"]:
        errs.append(f"{path}: {v!r:.60} not in {s['enum']}")
    if isinstance(v, str):
        if "pattern" in s and not re.search(s["pattern"], v):
            errs.append(f"{path}: {v!r:.60} does not match {s['pattern']}")
        if "minLength" in s and len(v) < s["minLength"]:
            errs.append(f"{path}: shorter than {s['minLength']}")
    if _type_ok(v, "number"):
        if "minimum" in s and v < s["minimum"]:
            errs.append(f"{path}: {v} < minimum {s['minimum']}")
        if "maximum" in s and v > s["maximum"]:
            errs.append(f"{path}: {v} > maximum {s['maximum']}")
        if "exclusiveMinimum" in s and v <= s["exclusiveMinimum"]:
            errs.append(f"{path}: {v} <= exclusiveMinimum {s['exclusiveMinimum']}")
        if "exclusiveMaximum" in s and v >= s["exclusiveMaximum"]:
            errs.append(f"{path}: {v} >= exclusiveMaximum {s['exclusiveMaximum']}")
    if isinstance(v, list):
        if "minItems" in s and len(v) < s["minItems"]:
            errs.append(f"{path}: fewer than {s['minItems']} items")
        if "maxItems" in s and len(v) > s["maxItems"]:
            errs.append(f"{path}: more than {s['maxItems']} items")
        pre = s.get("prefixItems", [])
        for i, item in enumerate(v):
            if i < len(pre):
                errs += mini_validate(item, pre[i], root, f"{path}[{i}]")
            elif "items" in s:
                errs += mini_validate(item, s["items"], root, f"{path}[{i}]")
    if isinstance(v, dict):
        for k in s.get("required", []):
            if k not in v:
                errs.append(f"{path}: missing required '{k}'")
        props = s.get("properties", {})
        for k, item in v.items():
            if k in props:
                errs += mini_validate(item, props[k], root, f"{path}.{k}")
            elif "additionalProperties" in s:
                ap = s["additionalProperties"]
                if ap is False:
                    errs.append(f"{path}: unexpected property '{k}'")
                elif isinstance(ap, dict):
                    errs += mini_validate(item, ap, root, f"{path}.{k}")
    for sub in s.get("allOf", []):
        errs += mini_validate(v, sub, root, path)
    if "anyOf" in s and not any(not mini_validate(v, sub, root, path) for sub in s["anyOf"]):
        errs.append(f"{path}: matches none of anyOf")
    if "oneOf" in s and sum(not mini_validate(v, sub, root, path) for sub in s["oneOf"]) != 1:
        errs.append(f"{path}: must match exactly one of oneOf")
    if "if" in s:
        if not mini_validate(v, s["if"], root, path):
            if "then" in s:
                errs += mini_validate(v, s["then"], root, path)
        elif "else" in s:
            errs += mini_validate(v, s["else"], root, path)
    return errs


def schema_errors(doc, name):
    schema = SCHEMAS[name]
    if jsonschema is not None:
        cls = jsonschema.validators.validator_for(schema)
        return [f"$.{'.'.join(map(str, e.absolute_path))}: {e.message[:160]}"
                for e in cls(schema).iter_errors(doc)]
    return mini_validate(doc, schema, schema)


# ---------------- cross-file semantic checks ----------------
def _next_month(m):
    y, mo = int(m[:4]), int(m[5:])
    return f"{y + (mo == 12):04d}-{1 if mo == 12 else mo + 1:02d}"


def check_series(s, manifest, region):
    errs = []
    methods = {m["id"] for m in manifest.get("methods", [])}
    if s["region_id"] != region["id"]:
        errs.append(f"region_id {s['region_id']} != manifest id {region['id']}")
    if s["strategy_id"] != manifest["strategy"]["id"]:
        errs.append(f"strategy_id {s['strategy_id']} != manifest strategy {manifest['strategy']['id']}")
    if s["kind"] != manifest["kind"]:
        errs.append("series kind differs from manifest kind")
    held = set(region.get("held_out_years", []))
    prev = None
    for i, r in enumerate(s["months"]):
        p = f"months[{i}] {r['month']}"
        if prev is not None and r["month"] != _next_month(prev):
            errs.append(f"{p}: months must be contiguous and ascending (after {prev})")
        prev = r["month"]
        if r["held_out"] != (int(r["month"][:4]) in held):
            errs.append(f"{p}: held_out disagrees with manifest held_out_years")
        if r["held_out"] != (r["split"] == "held_out"):
            errs.append(f"{p}: held_out and split disagree")
        for lane, c in r["modelled"].items():
            if c["status"] == "estimated":
                if c["method_id"] not in methods:
                    errs.append(f"{p}: modelled.{lane}.method_id {c['method_id']!r} not in manifest.methods")
                if c["lo"] is not None and c["hi"] is not None and not (c["lo"] <= c["value"] <= c["hi"]):
                    errs.append(f"{p}: modelled.{lane} value outside [lo, hi]")
        rec, aqua = r["record"], r["native"]["aqua"]
        src = rec["source"]
        if src == "observed_aqua":
            if aqua["status"] != "observed" or rec["value"] != aqua["n"]:
                errs.append(f"{p}: observed_aqua record must equal native.aqua.n with status observed")
        elif src in ("modelled_from_viirs", "blended"):
            if rec["method_id"] not in methods:
                errs.append(f"{p}: record.method_id {rec['method_id']!r} not in manifest.methods")
            lane = rec.get("lane")
            if src == "modelled_from_viirs":
                if lane not in r["modelled"] or r["modelled"][lane]["status"] != "estimated":
                    errs.append(f"{p}: modelled_from_viirs record must point at an estimated modelled lane")
                elif r["modelled"][lane]["value"] != rec["value"]:
                    errs.append(f"{p}: record.value != modelled.{lane}.value")
        elif src == "terra_only":
            if aqua["status"] == "observed":
                errs.append(f"{p}: terra_only but Aqua observed")
        if src in ("modelled_from_viirs", "blended") and aqua["status"] == "observed" \
                and (s["kind"] == "real" and version_tuple(s) >= (1, 4, 0) or "value_kind" in rec):
            errs.append(f"{p}: a converted value sits in the record slot where observed Aqua exists (1.4.0)")
        if rec["lo"] is not None and rec["hi"] is not None and rec["value"] is not None \
                and not (rec["lo"] <= rec["value"] <= rec["hi"]):
            errs.append(f"{p}: record value outside [lo, hi]")
    return errs


# ---------------- 1.4.0 value kinds ----------------
VALUE_KINDS = {"observed", "raw_viirs", "raw_terra", "converted_validated", "converted_unvalidated", "unavailable"}
M2_TIER = "m2_primary"
RECORD_KIND = {"observed_aqua": {"observed"}, "modelled_from_viirs": {"converted_validated", "converted_unvalidated"},
               "blended": {"converted_validated", "converted_unvalidated"}, "terra_only": {"unavailable"},
               "not_observed": {"unavailable"}}


def _native_kind(platform, cell):
    if cell["status"] != "observed":
        return "unavailable"
    return {"aqua": "observed", "terra": "raw_terra"}.get(platform, "raw_viirs")


def check_value_kinds(s, region, m2v=None):
    """Every value carries exactly one kind, consistent with its slot; all-or-nothing per file;
    required for tier m2_primary. converted_validated only in an m2_primary region inside the
    M2 window, and (when m2_validation is loaded) it must be one of its held-out month rows."""
    errs = []
    cells = []
    for r in s["months"]:
        for pl, c in r["native"].items():
            cells.append((r, f"native.{pl}", c, ("native", pl)))
        for lane, c in r["modelled"].items():
            cells.append((r, f"modelled.{lane}", c, ("modelled", lane)))
        cells.append((r, "record", r["record"], ("record", None)))
    have = [c for c in cells if "value_kind" in c[2]]
    m2 = region.get("tier") == M2_TIER
    if not have:
        return ["tier m2_primary series must carry value_kind on every value (1.4.0)"] if m2 else []
    if len(have) != len(cells):
        miss = next(c for c in cells if "value_kind" not in c[2])
        errs.append(f"value_kind must be on every value or none; missing at {miss[0]['month']} {miss[1]}")
    win = (m2v or {}).get("window") or {}
    rows = {}
    if m2v:
        rows = {r["month"]: r for r in m2v["month_rows"] if r["region_id"] == s["region_id"]}
    n_val = 0
    for r, path, c, (slot, name) in have:
        k, p = c["value_kind"], f"{r['month']} {path}"
        if k not in VALUE_KINDS:
            errs.append(f"{p}: unknown value_kind {k!r}")
            continue
        if slot == "native":
            if k != _native_kind(name, c):
                errs.append(f"{p}: value_kind {k} but expected {_native_kind(name, c)} for {name} status {c['status']}")
        elif slot == "modelled":
            est = c["status"] == "estimated"
            if est != k.startswith("converted_"):
                errs.append(f"{p}: status {c['status']} with value_kind {k}")
            if k == "converted_validated":
                n_val += 1
                if not m2:
                    errs.append(f"{p}: converted_validated outside an m2_primary region")
                if win and not (win["start"] <= r["month"] <= win["end"]):
                    errs.append(f"{p}: converted_validated outside the M2 window {win['start']}..{win['end']}")
                if m2v is not None:
                    v = rows.get(r["month"])
                    if v is None:
                        errs.append(f"{p}: converted_validated but no m2_validation month row")
                    elif any(abs(c[a] - v[b]) > 0.006 for a, b in (("value", "pred"), ("lo", "lo90"), ("hi", "hi90"))):
                        errs.append(f"{p}: converted_validated value/lo/hi differ from m2_validation row")
        else:
            src = c["source"]
            if k not in RECORD_KIND[src]:
                errs.append(f"{p}: record.source {src} with value_kind {k}")
            if k.startswith("converted_") and r["native"]["aqua"]["status"] == "observed":
                errs.append(f"{p}: converted value in the record slot where observed Aqua exists")
            if src == "modelled_from_viirs" and c.get("lane") in r["modelled"] \
                    and r["modelled"][c["lane"]].get("value_kind") != k:
                errs.append(f"{p}: record value_kind differs from its lane's")
    if m2v is not None and m2:
        if n_val != len(rows):
            errs.append(f"{n_val} converted_validated values but {len(rows)} m2_validation rows for {s['region_id']}")
    return errs


def all_regions(manifest):
    """regions[] (M1-evaluated set, unchanged meaning) + m2_regions[] (1.4.0)."""
    return list(manifest.get("regions", [])) + list(manifest.get("m2_regions", []))


def _featured_index(lock_id, region, n):
    return int(hashlib.sha256(f"{lock_id}:{region}".encode()).hexdigest(), 16) % n


Q4_CLASSES = ["below", "within", "above", "cant_tell"]
# Mirror of the site copy rules (site/js/story.js BANNED) for labels the site shows verbatim.
SITE_BANNED = [r"\bnot comparable\b", r"\baccurate\b", r"\bproves?\b", r"\bcalibrated\b", r"\bsignificant\b",
               r"\btypically off by\b", r"\bnever saw\b", r"\bfires\b"]


def _point_class(v, p10, p90, n_years, min_years, low=False):
    if v is None or n_years < min_years or low:
        return "cant_tell"
    return "above" if v > p90 else ("below" if v < p10 else "within")


def _q4_stats(truth, arm):
    both = [(t, a) for t, a in zip(truth, arm) if t != "cant_tell" and a != "cant_tell"]
    agree = sum(t == a for t, a in both) / len(both) if both else None
    wd = sum(t != a for t, a in both) / len(truth) if truth else None
    dec = sum(a != "cant_tell" for a in arm) / len(arm) if arm else None
    kap = None
    if both:
        po = agree
        n = len(both)
        pe = sum((sum(a == c for _, a in both) / n) * (sum(t == c for t, _ in both) / n) for c in ("below", "within", "above"))
        kap = None if pe >= 1 else (po - pe) / (1 - pe)
    conf = [[sum(1 for t, a in zip(truth, arm) if t == ct and a == ca) for ca in Q4_CLASSES] for ct in Q4_CLASSES]
    return {"agreement_among_decided": agree, "wrong_decisive_rate": wd, "decided_fraction": dec, "cohen_kappa": kap,
            "counts": conf, "n_decided": len(both)}


def _close(a, b, tol):
    return a is None and b is None or (a is not None and b is not None and abs(a - b) <= tol * max(1.0, abs(b)))


def check_m2_validation(v, manifest, series_docs, repo_root):
    """Contract 1.4.0 §2g. Recomputes pooled cov90/cov80, skill and Q4 agreement/kappa/confusion from the
    month rows; for real builds also from the confirm parquet + constants (pyarrow, no analysis code),
    the provenance sha256s, the featured months and the envelope against each series' baseline."""
    errs = []
    if version_tuple(manifest) < (1, 4, 0):
        errs.append("m2_validation requires a manifest at contract >= 1.4.0")
    regs = {r["id"]: r for r in all_regions(manifest)}
    rows = v["month_rows"]
    win = v["window"]
    q4 = v["pooled"]["q4"]
    min_years, lct = q4["rule"]["min_years"], q4["rule"]["low_count_threshold"]
    seen = set()
    for i, r in enumerate(rows):
        p = f"month_rows[{i}] {r['region_id']} {r['month']}"
        if (r["region_id"], r["month"]) in seen:
            errs.append(f"{p}: duplicate row")
        seen.add((r["region_id"], r["month"]))
        if r["region_id"] not in regs or regs[r["region_id"]].get("tier") != M2_TIER:
            errs.append(f"{p}: region is not an m2_primary manifest region")
        if not (win["start"] <= r["month"] <= win["end"]) or int(r["month"][5:]) != r["cal_month"] \
                or int(r["month"][:4]) != r["fold"]:
            errs.append(f"{p}: month/cal_month/fold outside or inconsistent with the window")
        if not (r["lo90"] <= r["lo80"] <= r["pred"] <= r["hi80"] <= r["hi90"]):
            errs.append(f"{p}: intervals not nested around pred")
        for L in (80, 90):
            if r[f"inside{L}"] != (r[f"lo{L}"] <= r["actual"] <= r[f"hi{L}"]):
                errs.append(f"{p}: inside{L} inconsistent")
        if r["low_count"] != (r["noaa20_raw"] < lct):
            errs.append(f"{p}: low_count != noaa20_raw < {lct}")
        cl = lambda x, low=False: _point_class(x, r["env_p10"], r["env_p90"], r["env_n_years"], min_years, low)
        exp = {"q4_truth": cl(r["actual"]), "q4_n20": cl(r["pred"], r["low_count"]),
               "q4_clim": cl(r["clim_pred"], r["low_count"]), "q4_naive": cl(r["noaa20_raw"], r["low_count"])}
        for k, e in exp.items():
            if r[k] != e:
                errs.append(f"{p}: {k} {r[k]} but the point rule gives {e}")
        lo, hi = r["lo90"], r["hi90"]
        cross = not (hi < r["env_p10"] or lo > r["env_p90"] or (lo >= r["env_p10"] and hi <= r["env_p90"]))
        if r["range_crosses_edge"] != cross:
            errs.append(f"{p}: range_crosses_edge inconsistent")
        if abs(r["log1p_error"] - (math.log1p(r["pred"]) - math.log1p(r["actual"]))) > 2e-4:
            errs.append(f"{p}: log1p_error inconsistent")
    # per region
    lock = v["provenance"]["lock_id"]
    for g in v["regions"]:
        rid = g["region_id"]
        rr = [r for r in rows if r["region_id"] == rid]
        p = f"regions[{rid}]"
        if g["n"] != len(rr):
            errs.append(f"{p}: n {g['n']} != {len(rr)} month rows")
            continue
        for L in (80, 90):
            k = sum(r[f"inside{L}"] for r in rr)
            if g[f"cov{L}_covered"] != k or not _close(g[f"cov{L}"], k / len(rr), 1e-9):
                errs.append(f"{p}: cov{L} {g[f'cov{L}']} ({g[f'cov{L}_covered']}) != rows {k}/{len(rr)}")
        mae = sum(abs(r["log1p_error"]) for r in rr) / len(rr)
        if not _close(g["mae_log1p"], mae, 1e-3):
            errs.append(f"{p}: mae_log1p {g['mae_log1p']} != rows {mae:.4f}")
        w = sum(math.log1p(r["hi90"]) - math.log1p(r["lo90"]) for r in rr) / len(rr)
        if not _close(g["mean_width90_log1p"], w, 1e-3):
            errs.append(f"{p}: mean_width90_log1p {g['mean_width90_log1p']} != rows {w:.4f}")
        for season, b in g["by_season"].items():
            sr = [r for r in rr if r["season"] == season]
            if b["n"] != len(sr) or b["cov90_covered"] != sum(r["inside90"] for r in sr) \
                    or b["cov80_covered"] != sum(r["inside80"] for r in sr):
                errs.append(f"{p}.by_season.{season}: counts differ from month rows")
        months = sorted(r["month"] for r in rr)
        fi = _featured_index(lock, rid, len(months))
        if g["featured_index"] != fi or g["featured_month"] != months[fi]:
            errs.append(f"{p}: featured month {g['featured_month']} (index {g['featured_index']}) != rule {months[fi]} ({fi})")
        if rid in regs and regs[rid].get("status") != g["status"]:
            errs.append(f"{p}: status {g['status']} != manifest status {regs[rid].get('status')}")
        s = series_docs.get(rid)
        if s is not None and s.get("baseline"):
            ent = s["baseline"]["entries"]
            for r in rr:
                e = ent[r["cal_month"] - 1]
                if not (_close(e["p10"], r["env_p10"], 1e-9) and _close(e["p90"], r["env_p90"], 1e-9)
                        and e["n_years"] == r["env_n_years"]):
                    errs.append(f"{p} {r['month']}: envelope differs from series baseline month {r['cal_month']}")
                    break
    # pooled
    P = v["pooled"]["q1"]
    n = len(rows)
    if P["n"] != n:
        errs.append(f"pooled.q1.n {P['n']} != {n} month rows")
    for L in (80, 90):
        k = sum(r[f"inside{L}"] for r in rows)
        if P[f"cov{L}_covered"] != k or not _close(P[f"cov{L}"], k / n, 1e-9):
            errs.append(f"pooled.q1.cov{L} {P[f'cov{L}']} != rows {k}/{n}")
    ea = sum(abs(r["log1p_error"]) for r in rows) / n
    eb = sum(abs(math.log1p(r["clim_pred"]) - math.log1p(r["actual"])) for r in rows) / n
    if not _close(P["skill_vs_aqua_clim"], 1 - ea / eb, 1e-3):
        errs.append(f"pooled.q1.skill_vs_aqua_clim {P['skill_vs_aqua_clim']} != rows {1 - ea / eb:.4f}")
    for season, b in P["by_season"].items():
        sr = [r for r in rows if r["season"] == season]
        if b["n"] != len(sr) or b["cov90_covered"] != sum(r["inside90"] for r in sr):
            errs.append(f"pooled.q1.by_season.{season}: counts differ from month rows")
    truth = [r["q4_truth"] for r in rows]
    if q4["n_rows"] != n or q4["n_low_count"] != sum(r["low_count"] for r in rows):
        errs.append("pooled.q4 n_rows / n_low_count differ from month rows")
    for arm, a in q4["arms"].items():
        if not a.get("row_field"):
            continue
        st = _q4_stats(truth, [r[a["row_field"]] for r in rows])
        if a["confusion"]["counts"] != st["counts"]:
            errs.append(f"pooled.q4.arms.{arm}: confusion (truth x arm) != recomputed from month rows")
        for k in ("agreement_among_decided", "wrong_decisive_rate", "decided_fraction", "cohen_kappa"):
            if not _close(a[k], st[k], 1e-9):
                errs.append(f"pooled.q4.arms.{arm}.{k} {a[k]} != recomputed {st[k]}")
        rt = [sum(row) for row in a["confusion"]["counts"]]
        if rt != [truth.count(c) for c in Q4_CLASSES]:
            errs.append(f"pooled.q4.arms.{arm}: confusion row totals != truth class counts")
    for name in ("viirs_era_arm",):
        c = q4[name]["confusion"]["counts"]
        if sum(map(sum, c)) != n or [sum(row) for row in c] != [truth.count(k) for k in Q4_CLASSES]:
            errs.append(f"pooled.q4.{name}: confusion row totals != truth class counts")
    site_text = " ".join([q4["viirs_era_arm"].get("site_label", "")] + [g.get("status_label", "") for g in v["regions"]])
    for pat in SITE_BANNED:
        if re.search(pat, site_text, re.IGNORECASE):
            errs.append(f"site-facing label uses a banned site phrase ({pat})")
    if v["kind"] == "real" and not PUBLIC:
        errs += _m2_against_confirm(v, repo_root)
    return errs


def _m2_against_confirm(v, repo_root):
    """Independent recompute from the frozen confirm outputs (pyarrow + json only)."""
    errs = []
    for f in v["provenance"]["files"]:
        fp = repo_root / f["path"]
        if not fp.exists():
            errs.append(f"provenance: {f['path']} missing")
        elif hashlib.sha256(fp.read_bytes()).hexdigest() != f["sha256"]:
            errs.append(f"provenance: sha256 of {f['path']} differs from the stored hash")
    pq_path = repo_root / "analysis/results_m2/confirm/predictions_q1.parquet"
    if not pq_path.exists():
        return errs + ["confirm predictions_q1.parquet missing (needed for the real-build recompute)"]
    import pyarrow.parquet as pq
    t = pq.read_table(pq_path, columns=["region_id", "month", "daynight", "method", "analysis_set", "actual", "noaa20",
                                        "pred", "lo80", "hi80", "lo90", "hi90"]).to_pylist()
    t = [x for x in t if x["analysis_set"] == "primary" and x["daynight"] == v["daynight"]]
    by = {}
    for x in t:
        by.setdefault(x["method"], {})[(x["region_id"], x["month"])] = x
    n20, clim, naive = by.get(v["method"]["id"], {}), by.get("aqua_clim", {}), by.get("naive_raw", {})
    rows = {(r["region_id"], r["month"]): r for r in v["month_rows"]}
    if set(rows) != set(n20):
        errs.append(f"month_rows ({len(rows)}) are not exactly the confirm held-out rows ({len(n20)}): no subsetting allowed")
        return errs
    for k, x in n20.items():
        r = rows[k]
        for a, b in (("pred", "pred"), ("lo80", "lo80"), ("hi80", "hi80"), ("lo90", "lo90"), ("hi90", "hi90")):
            if abs(r[a] - x[b]) > 5.1e-5 * max(1.0, abs(x[b])):
                errs.append(f"month_rows {k}: {a} {r[a]} != confirm {x[b]}")
        if r["actual"] != x["actual"] or r["noaa20_raw"] != x["noaa20"] or abs(r["clim_pred"] - clim[k]["pred"]) > 5.1e-5 * max(1, clim[k]["pred"]):
            errs.append(f"month_rows {k}: actual / noaa20_raw / clim_pred differ from confirm")
        if len(errs) > 20:
            return errs
    P = v["pooled"]["q1"]
    n = len(n20)
    for L in (80, 90):
        k = sum(x[f"lo{L}"] <= x["actual"] <= x[f"hi{L}"] for x in n20.values())
        if not _close(P[f"cov{L}"], k / n, 1e-12):
            errs.append(f"pooled.q1.cov{L} {P[f'cov{L}']} != confirm parquet {k}/{n}")
    ea = sum(abs(math.log1p(x["pred"]) - math.log1p(x["actual"])) for x in n20.values()) / n
    eb = sum(abs(math.log1p(clim[k]["pred"]) - math.log1p(x["actual"])) for k, x in n20.items()) / n
    if not _close(P["skill_vs_aqua_clim"], 1 - ea / eb, 1e-9):
        errs.append(f"pooled.q1.skill_vs_aqua_clim {P['skill_vs_aqua_clim']} != confirm parquet {1 - ea / eb}")
    if not _close(P["mae_log1p"], ea, 1e-9):
        errs.append(f"pooled.q1.mae_log1p {P['mae_log1p']} != confirm parquet {ea}")
    cpath = repo_root / "analysis/results_m2/confirm/constants.json"
    env = {(e["region_id"], e["cal_month"]): e for e in json.loads(cpath.read_text())["aqua_envelope_plain"]
           if e["daynight"] == v["daynight"]}
    q4 = v["pooled"]["q4"]
    my, lct = q4["rule"]["min_years"], q4["rule"]["low_count_threshold"]
    keys = sorted(n20)
    truth, arms = [], {"q4_n20": [], "q4_clim": [], "q4_naive": []}
    for k in keys:
        x = n20[k]
        e = env[(k[0], int(k[1][5:]))]
        low = x["noaa20"] < lct
        truth.append(_point_class(x["actual"], e["p10"], e["p90"], e["n_years"], my))
        arms["q4_n20"].append(_point_class(x["pred"], e["p10"], e["p90"], e["n_years"], my, low))
        arms["q4_clim"].append(_point_class(clim[k]["pred"], e["p10"], e["p90"], e["n_years"], my, low))
        arms["q4_naive"].append(_point_class(naive[k]["pred"], e["p10"], e["p90"], e["n_years"], my, low))
    frozen = json.loads((repo_root / "analysis/results_m2/confirm/q4.json").read_text())["primary_pool"]["arms"]
    for arm, a in q4["arms"].items():
        if a.get("row_field") not in arms:
            continue
        st = _q4_stats(truth, arms[a["row_field"]])
        fz = frozen[arm]["observed_envelope"]
        fc = [[int(fz["confusion_truth_x_arm"].get(ca, {}).get(ct, 0)) for ca in Q4_CLASSES] for ct in Q4_CLASSES]
        if st["counts"] != a["confusion"]["counts"] or fc != st["counts"]:
            errs.append(f"pooled.q4.arms.{arm}: confusion differs from the confirm recompute / frozen q4.json (transposed)")
        for k in ("agreement_among_decided", "wrong_decisive_rate", "decided_fraction", "cohen_kappa"):
            if not (_close(a[k], st[k], 1e-9) and _close(fz[k], st[k], 1e-9)):
                errs.append(f"pooled.q4.arms.{arm}.{k} {a[k]} != confirm recompute {st[k]} / frozen {fz[k]}")
    return errs


VERDICT_RULE_P10_P90 = "aqua_p10_p90_interval_v1"


def _quantile(sorted_vals, q):
    h = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(h), math.ceil(h)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (h - lo)


def expected_verdict(row, entry, min_years):
    """Reference implementation of rule aqua_p10_p90_interval_v1 (mirrors site/js/core.js verdictFor)."""
    rec = row["record"]
    if rec["value"] is None:
        return "cant_tell"
    if entry is None or entry["n_years"] < min_years:
        return "cant_tell"
    if "low_count" in row["quality"] and rec["source"] != "observed_aqua":
        return "cant_tell"
    lo = rec["lo"] if rec["lo"] is not None else rec["value"]
    hi = rec["hi"] if rec["hi"] is not None else rec["value"]
    if lo > entry["p90"]:
        return "above"
    if hi < entry["p10"]:
        return "below"
    if lo >= entry["p10"] and hi <= entry["p90"]:
        return "within"
    return "cant_tell"


def check_baseline_verdict(s, manifest):
    errs = []
    b, rule = s.get("baseline"), s.get("verdict_rule")
    by_month = {r["month"]: r for r in s["months"]}
    if b is not None:
        era = next((e for e in manifest.get("eras", []) if e["id"] == b["era"]), None)
        if era is None:
            errs.append(f"baseline.era {b['era']!r} not in manifest.eras")
        excl = set(b.get("excluded_quality", []))
        per = b.get("period")
        if per is None and version_tuple(s) >= (1, 2, 0):
            errs.append("baseline.period is required for contract >= 1.2")
        if per is not None:
            if per["start_year"] > per["end_year"]:
                errs.append("baseline.period start_year > end_year")
            complete = set()
            for y in range(per["start_year"], per["end_year"] + 1):
                ms = [by_month.get(f"{y:04d}-{mm:02d}") for mm in range(1, 13)]
                if all(r is not None and r["native"]["aqua"]["status"] != "not_in_archive" for r in ms):
                    complete.add(y)
            for i, e in enumerate(b["entries"]):
                for y in e["years"]:
                    if not per["start_year"] <= y <= per["end_year"]:
                        errs.append(f"baseline.entries[{i}]: year {y} outside baseline.period")
                    elif per["complete_years_only"] and y not in complete:
                        errs.append(f"baseline.entries[{i}]: year {y} is not a complete Aqua year")
                # every eligible year in the period must be used (no silent cherry-picking)
                for y in range(per["start_year"], per["end_year"] + 1):
                    if per["complete_years_only"] and y not in complete:
                        continue
                    r = by_month.get(f"{y:04d}-{e['month']:02d}")
                    if r is not None and r["era"] == b["era"] and r["native"]["aqua"]["status"] == "observed" \
                            and not (excl & set(r["quality"])) and y not in e["years"]:
                        errs.append(f"baseline.entries[{i}]: eligible year {y} missing from years")
        for i, e in enumerate(b["entries"]):
            p = f"baseline.entries[{i}]"
            if e["month"] != i + 1:
                errs.append(f"{p}: entries must be months 1..12 in order")
            if e["n_years"] != len(e["years"]) or len(set(e["years"])) != len(e["years"]):
                errs.append(f"{p}: n_years must equal the number of distinct years")
            vals = []
            for y in e["years"]:
                mo = f"{y:04d}-{e['month']:02d}"
                r = by_month.get(mo)
                if r is None or r["native"]["aqua"]["status"] != "observed":
                    errs.append(f"{p}: year {y} is not an observed Aqua month in this series")
                    continue
                if r["era"] != b["era"]:
                    errs.append(f"{p}: {mo} is in era {r['era']}, not baseline era {b['era']}")
                if excl & set(r["quality"]):
                    errs.append(f"{p}: {mo} carries an excluded quality flag")
                vals.append(r["native"]["aqua"]["n"])
            if vals and len(vals) == e["n_years"]:
                vals.sort()
                for q, k in ((0.1, "p10"), (0.5, "p50"), (0.9, "p90")):
                    if abs(_quantile(vals, q) - e[k]) > 1e-6 * max(1.0, abs(e[k])):
                        errs.append(f"{p}: {k}={e[k]} but linear quantile of years is {_quantile(vals, q)}")
    has_verdict = any("verdict" in r for r in s["months"])
    if has_verdict and (rule is None or b is None):
        errs.append("months carry verdict but series has no verdict_rule/baseline")
    if has_verdict and rule is not None and b is not None:
        min_years = rule.get("min_years", b["min_years"])
        for r in s["months"]:
            v = r.get("verdict")
            if v is None:
                continue
            if v["rule_id"] != rule["id"]:
                errs.append(f"{r['month']}: verdict.rule_id {v['rule_id']!r} != verdict_rule.id")
            elif rule["id"] == VERDICT_RULE_P10_P90:
                exp = expected_verdict(r, b["entries"][int(r["month"][5:]) - 1], min_years)
                if v["class"] != exp:
                    errs.append(f"{r['month']}: verdict {v['class']} but rule gives {exp}")
    return errs


def version_tuple(doc):
    try:
        return tuple(int(x) for x in str(doc.get("contract_version", "0.0.0")).split("."))
    except ValueError:
        return (0, 0, 0)


NEW_EVENT_KINDS = {"launch", "archive_start", "archive_end", "drift_start", "constellation_exit",
                   "projected_end_of_science", "ended", "other"}
RETIREMENT_WORDS = re.compile(r"retire|decommission|end of (mission|life|operations)|\bended\b|passivat", re.IGNORECASE)
_PRECISION_LEN = {"year": 4, "month": 7, "day": 10}


def check_sensors(d):
    errs = []
    v12 = version_tuple(d) >= (1, 2, 0)
    for mi, m in enumerate(d["missions"]):
        evs = m["events"]
        for ei, e in enumerate(evs):
            p = f"missions[{mi}]({m['platform']}).events[{ei}]({e['kind']})"
            if not v12:
                continue
            if e["kind"] not in NEW_EVENT_KINDS:
                errs.append(f"{p}: legacy kind not allowed in contract >= 1.2; use {sorted(NEW_EVENT_KINDS)}")
            for k in ("date_precision", "projected"):
                if k not in e:
                    errs.append(f"{p}: missing {k} (required for contract >= 1.2)")
            if "projected" in e and e["projected"] != (e["status"] == "projected"):
                errs.append(f"{p}: projected must equal (status == 'projected')")
            if e.get("date") and "date_precision" in e and len(e["date"]) != _PRECISION_LEN[e["date_precision"]]:
                errs.append(f"{p}: date {e['date']} does not match date_precision {e['date_precision']}")
            if e["kind"] == "ended" and e["status"] != "actual":
                errs.append(f"{p}: 'ended' must be an actual event; a forecast is projected_end_of_science")
            if e["kind"] == "projected_end_of_science" and e["status"] == "actual":
                errs.append(f"{p}: projected_end_of_science cannot be status actual; use 'ended'")
            if e["kind"] in ("archive_end", "archive_start") and RETIREMENT_WORDS.search(e.get("note", "")):
                errs.append(f"{p}: archive_* is data availability; note must not describe retirement")
        if v12:
            ends = {e["date"] for e in evs if e["kind"] == "ended" and e.get("date")}
            arch = {e["date"] for e in evs if e["kind"] == "archive_end" and e.get("date")}
            for dte in ends & arch:
                if not any(e["kind"] == "ended" and e.get("date") == dte and e["source"] not in
                           {a["source"] for a in evs if a["kind"] == "archive_end"} for e in evs):
                    errs.append(f"missions[{mi}]({m['platform']}): 'ended' on {dte} reuses the archive_end source; "
                                "an archive end is not a retirement - cite independent evidence or drop 'ended'")
            starts = [e["date"] for e in evs if e["kind"] == "archive_start" and e.get("date")]
            launches = [e["date"] for e in evs if e["kind"] == "launch" and e.get("date")]
            if starts and launches and min(starts) < min(launches)[:len(min(starts))]:
                errs.append(f"missions[{mi}]({m['platform']}): archive_start precedes launch")
    for i, o in enumerate(d.get("overpass_lst", [])):
        if (o["n"] == 0) != (o["median_local_solar_time_h"] is None):
            errs.append(f"overpass_lst[{i}]: median must be null iff n == 0")
    return errs


def expected_tiers(sel):
    tiers = {}
    for rid in sel.get("explore_only", []) or []:
        tiers[rid] = "explore"
    if sel.get("stretch_region"):
        tiers[sel["stretch_region"]] = "stretch"
    for rid in sel.get("core_regions", []) or []:
        tiers[rid] = "core"
    if sel.get("control_region"):
        tiers[sel["control_region"]] = "control"
    return tiers


def check_tiers(manifest, repo_root):
    errs = []
    need = version_tuple(manifest) >= (1, 2, 1)
    sel_path = repo_root / "analysis/results/region_selection.json"
    tiers = None
    if manifest.get("kind") == "real" and sel_path.exists():
        tiers = expected_tiers(json.loads(sel_path.read_text(encoding="utf-8")))
    m2_primary = None
    m2_path = repo_root / "analysis/results_m2/confirm/regions.json"
    if manifest.get("kind") == "real" and m2_path.exists():
        m2_primary = set(json.loads(m2_path.read_text(encoding="utf-8"))["primary"])
        m2_status = json.loads((repo_root / "analysis/results_m2/confirm/q1_region_status.json").read_text(encoding="utf-8"))
    ids = [r["id"] for r in all_regions(manifest)]
    if len(ids) != len(set(ids)):
        errs.append("region ids must be unique across regions[] and m2_regions[]")
    for r in manifest.get("m2_regions", []):
        if r.get("tier") != M2_TIER:
            errs.append(f"m2_regions[{r['id']}]: tier must be m2_primary")
    for r in manifest.get("regions", []):
        if r.get("tier") == M2_TIER:
            errs.append(f"regions[{r['id']}]: m2_primary regions belong in m2_regions[] (1.4.0)")
    for r in all_regions(manifest):
        t = r.get("tier")
        if t == M2_TIER or (m2_primary is not None and r["id"] in m2_primary):
            if version_tuple(manifest) < (1, 4, 0):
                errs.append(f"regions[{r['id']}]: tier m2_primary requires contract >= 1.4.0")
            if "m2" not in r:
                errs.append(f"regions[{r['id']}]: tier m2_primary requires the m2 block")
            if m2_primary is not None:
                if t != M2_TIER or r["id"] not in m2_primary:
                    errs.append(f"regions[{r['id']}]: tier {t!r} disagrees with analysis/results_m2/confirm/regions.json")
                elif r["status"] != m2_status[r["id"]]["status"]:
                    errs.append(f"regions[{r['id']}]: status {r['status']} != q1_region_status.json")
            continue
        if t is None:
            if need:
                errs.append(f"regions[{r['id']}]: tier is required for contract >= 1.2.1")
            continue
        if tiers is not None:
            exp = tiers.get(r["id"], "explore")
            if t != exp:
                errs.append(f"regions[{r['id']}]: tier {t!r} disagrees with region_selection.json ({exp!r})")
    return errs


def check_audit_flags(manifest, repo_root):
    errs = []
    for r in manifest.get("regions", []):
        for i, f in enumerate(r.get("audit_flags", [])):
            p = f"regions[{r['id']}].audit_flags[{i}]({f['id']})"
            lo, hi, v = f["ci_low"], f["ci_high"], f["value"]
            if lo is not None and hi is not None and lo > hi:
                errs.append(f"{p}: ci_low > ci_high")
            if None not in (lo, hi, v) and not (lo <= v <= hi):
                errs.append(f"{p}: value outside [ci_low, ci_high]")
            if v is None and f["flagged"] is not None:
                errs.append(f"{p}: flagged must be null when value is null")
            if manifest.get("kind") == "real" and not PUBLIC:
                path = repo_root / f["source_ref"]["path"]
                if not path.exists():
                    errs.append(f"{p}: source_ref.path {f['source_ref']['path']} does not exist")
    return errs


def check_validation(v, manifest):
    errs = []
    methods = {m["id"] for m in manifest.get("methods", [])}
    regions = {r["id"]: r for r in manifest.get("regions", [])}
    counts = {}
    for i, r in enumerate(v["rows"]):
        p = f"rows[{i}]"
        if r["method_id"] not in methods:
            errs.append(f"{p}: method {r['method_id']!r} not in manifest.methods")
        if r["region_id"] not in regions:
            errs.append(f"{p}: region {r['region_id']!r} not in manifest.regions")
        elif r["stratum"] == "held_out" and r["year"] not in regions[r["region_id"]].get("held_out_years", []):
            errs.append(f"{p}: stratum held_out but year {r['year']} not in region held_out_years")
        elif r["stratum"] == "drift" and r["year"] in regions[r["region_id"]].get("trained_on_years", []):
            errs.append(f"{p}: drift-stratum year {r['year']} is a training year")
        if int(r["month"][:4]) != r["year"]:
            errs.append(f"{p}: month not in year")
        if (r["actual"] is None) != (r["actual_status"] != "observed"):
            errs.append(f"{p}: actual must be null iff actual_status != observed")
        if r.get("inside_interval") is not None and None not in (r["actual"], r["lo"], r["hi"]):
            if r["inside_interval"] != (r["lo"] <= r["actual"] <= r["hi"]):
                errs.append(f"{p}: inside_interval inconsistent")
        if r["actual"] is not None and r["predicted"] is not None:
            for reg in (r["region_id"], "all"):
                key = (r["method_id"], reg, r["stratum"], r["daynight"])
                counts[key] = counts.get(key, 0) + 1
    for i, s in enumerate(v["summary"]):
        if s["method_id"] not in methods:
            errs.append(f"summary[{i}]: method {s['method_id']!r} not in manifest.methods")
        key = (s["method_id"], s["region_id"], s["stratum"], s["daynight"])
        avail = counts.get(key, 0)
        if s["n"] > avail:
            errs.append(f"summary[{i}]: n={s['n']} exceeds {avail} scored rows for {key}")
    errs += check_decision(v, manifest)
    return errs


def check_decision(v, manifest):
    d = v.get("decision")
    if d is None:
        return []
    errs = []
    methods = {m["id"]: m for m in manifest.get("methods", [])}
    for k in ("candidate_method", "adopted_method", "baseline_method"):
        if d.get(k) is not None and d[k] not in methods:
            errs.append(f"decision.{k} {d[k]!r} not in manifest.methods")
    if v["status"] != "evaluated":
        errs.append("decision requires status evaluated")
    crit = d["criteria"]
    if d["outcome"] == "adopt_candidate":
        if d["adopted_method"] != d["candidate_method"]:
            errs.append("decision: adopt_candidate but adopted_method != candidate_method")
        if not crit or not all(c["met"] is True for c in crit):
            errs.append("decision: adopt_candidate requires every criterion met")
    elif d["outcome"] == "fallback_to_baseline":
        if d["adopted_method"] == d["candidate_method"] or d["adopted_method"] is None:
            errs.append("decision: fallback_to_baseline must adopt a different (baseline) method")
        elif methods.get(d["adopted_method"], {}).get("role", "baseline") != "baseline":
            errs.append("decision: fallback adopted_method does not have role baseline")
        if crit and all(c["met"] is True for c in crit) and not any(t.get("fired") for t in d["triggers"]):
            errs.append("decision: fallback although all criteria met and no trigger fired")
    elif d["adopted_method"] is not None:
        errs.append("decision: inconclusive must have adopted_method null")
    for c in crit:
        if None not in (c["value"], c["threshold"]) and c.get("comparison") and c["met"] is not None:
            ok = {">=": c["value"] >= c["threshold"], ">": c["value"] > c["threshold"],
                  "<=": c["value"] <= c["threshold"], "<": c["value"] < c["threshold"]}[c["comparison"]]
            if ok != c["met"]:
                errs.append(f"decision.criteria[{c['id']}]: met={c['met']} contradicts {c['value']} {c['comparison']} {c['threshold']}")
    # consistency with summary rows (where an unambiguous matching row exists)
    def matches(item):
        mid = item.get("method_id", d["candidate_method"])
        reg = item.get("region") or "all"
        rows = [s for s in v["summary"] if s["method_id"] == mid and s["region_id"] == reg and s["metric"] == item["metric"]
                and s["stratum"] == item.get("stratum", "held_out") and s.get("season", "all") == "all"
                and ("daynight" not in item or s["daynight"] == item["daynight"])
                and ("interval_level" not in item or s.get("interval_level") == item["interval_level"])]
        return rows[0] if len(rows) == 1 else None
    for kind in ("criteria", "triggers"):
        for item in d[kind]:
            s = matches(item)
            if s is None or s["value"] is None or item["value"] is None:
                continue
            if abs(s["value"] - item["value"]) > 1e-6 * max(1.0, abs(s["value"])):
                errs.append(f"decision.{kind}[{item['id']}]: value {item['value']} != summary {s['value']}")
            if kind == "triggers" and not s["meets_minimum_n"] and item.get("below_display_minimum") is not True:
                errs.append(f"decision.triggers[{item['id']}]: summary row is below the display minimum; set below_display_minimum: true")
    b = d.get("blocks_won")
    if b and b["candidate"] > b["total"]:
        errs.append("decision.blocks_won: candidate > total")
    return errs


def check_belt(b):
    errs = []
    for i, row in enumerate(b["bands"]["rows"]):
        sh = row["monthly_share"]
        if (sh is None) != (row["n_total"] == 0):
            errs.append(f"bands.rows[{i}]: monthly_share must be null iff n_total == 0")
        if sh is not None and abs(sum(sh) - 1) > 1e-3:
            errs.append(f"bands.rows[{i}]: monthly_share sums to {sum(sh):.4f}")
    seen = set()
    for i, c in enumerate(b["cells"]):
        if (c[0], c[1]) in seen:
            errs.append(f"cells[{i}]: duplicate cell {c[0]},{c[1]}")
        seen.add((c[0], c[1]))
        if c[4] < b["grid"]["min_land_km2"]:
            errs.append(f"cells[{i}]: land_km2 below grid.min_land_km2")
    return errs


# filter_id -> row filter on global_1deg_monthly.parquet (for the independent recompute only)
BELT_FILTERS = {"type0_nh": {"type": [0], "confidence_class": ["n", "h"]}}


def _sparse(total, seen, rule):
    return total > 0 and (total < rule["min_total"] or seen <= rule["max_years_seen"])


def check_belt_monthly(bm, belt, belt_bytes, manifest):
    """Cross-file rules for belt_monthly (added 1.3.0). belt = parsed belt.json, belt_bytes = its raw bytes."""
    errs = []
    if version_tuple(manifest) < (1, 3, 0):
        errs.append("belt_monthly layer requires manifest contract_version >= 1.3.0")
    if belt is None:
        return errs + ["belt_monthly requires the belt layer (aligned_to) to be present"]
    for k in ("dataset_version", "platform", "period", "filter_id", "grid"):
        if bm[k] != belt[k]:
            errs.append(f"{k} {bm[k]!r:.80} differs from belt.json {belt[k]!r:.80}")
    al = bm["aligned_to"]
    n = len(belt["cells"])
    sha = hashlib.sha256(belt_bytes).hexdigest()
    if al["sha256"] != sha:
        errs.append(f"aligned_to.sha256 {al['sha256'][:12]}.. != sha256(belt.json) {sha[:12]}..; rebuild both together")
    if al["n_cells"] != n:
        errs.append(f"aligned_to.n_cells {al['n_cells']} != len(belt.cells) {n}")
    for k in ("counts", "sparse") + (("years_seen",) if "years_seen" in bm else ()):
        if len(bm[k]) != n:
            errs.append(f"len({k}) {len(bm[k])} != len(belt.cells) {n}")
    if errs:
        return errs
    rule, ny = bm["sparse_rule"], bm["period"]["n_years"]
    if rule["n_years"] != ny:
        errs.append(f"sparse_rule.n_years {rule['n_years']} != period.n_years {ny}")
    same_dn = bm["daynight"] == belt["daynight"]
    sub_dn = belt["daynight"] == "DN" and bm["daynight"] in ("D", "N")
    if not (same_dn or sub_dn):
        errs.append(f"daynight {bm['daynight']} is not belt's {belt['daynight']} or a subset of it")
    ys = bm.get("years_seen")
    for i, (row, mask) in enumerate(zip(bm["counts"], bm["sparse"])):
        if len(errs) > 25:
            break
        p = f"cells[{i}] ({belt['cells'][i][0]},{belt['cells'][i][1]})"
        tot, ntot = sum(row), belt["cells"][i][3]
        if same_dn and tot != ntot:
            errs.append(f"{p}: sum(counts)={tot} != belt n_total {ntot}")
        elif sub_dn and tot > ntot:
            errs.append(f"{p}: {bm['daynight']}-only sum(counts)={tot} > belt day+night n_total {ntot}")
        seen = [int(ch) for ch in ys[i]] if ys is not None else None
        for j, c in enumerate(row):
            bit = bool(mask >> j & 1)
            if seen is not None:
                sj = seen[j]
                if sj > ny or (sj == 0) != (c == 0) or sj > c:
                    errs.append(f"{p} month {j + 1}: years_seen {sj} inconsistent with count {c} / n_years {ny}")
                    continue
                if bit != _sparse(c, sj, rule):
                    errs.append(f"{p} month {j + 1}: sparse bit {int(bit)} but rule gives {int(not bit)} (count {c}, seen {sj})")
            else:
                if c == 0 and bit:
                    errs.append(f"{p} month {j + 1}: zero count marked sparse")
                elif 0 < c < rule["min_total"] and not bit:
                    errs.append(f"{p} month {j + 1}: count {c} < {rule['min_total']} but not marked sparse")
        allbit = bool(mask >> 12 & 1)
        if tot == 0 and allbit:
            errs.append(f"{p}: zero cell marked sparse (all-year bit)")
        elif 0 < tot < rule["min_total"] and not allbit:
            errs.append(f"{p}: all-year total {tot} < {rule['min_total']} but all-year bit clear")
        elif seen is not None and tot >= rule["min_total"]:
            lo_years, hi_years = max(seen), min(ny, sum(seen))
            if lo_years > rule["max_years_seen"] and allbit:
                errs.append(f"{p}: all-year bit set although seen in >= {lo_years} years")
            if hi_years <= rule["max_years_seen"] and not allbit:
                errs.append(f"{p}: all-year bit clear although seen in <= {hi_years} years")
    # bands: same edges as belt; totals consistent; cells inside a band cannot exceed the band
    brows = belt["bands"]["rows"]
    if [(r["lat_min"], r["lat_max"]) for r in bm["bands"]["rows"]] != [(r["lat_min"], r["lat_max"]) for r in brows]:
        errs.append("bands.rows edges differ from belt.bands.rows")
    else:
        for k, (r, br) in enumerate(zip(bm["bands"]["rows"], brows)):
            if r["n_total"] != sum(r["counts"]):
                errs.append(f"bands.rows[{k}]: n_total {r['n_total']} != sum(counts) {sum(r['counts'])}")
            if same_dn and r["n_total"] != br["n_total"]:
                errs.append(f"bands.rows[{k}]: n_total != belt band n_total")
            elif sub_dn and r["n_total"] > br["n_total"]:
                errs.append(f"bands.rows[{k}]: {bm['daynight']}-only n_total {r['n_total']} > belt day+night {br['n_total']}")
            inside = sum(sum(row) for c, row in zip(belt["cells"], bm["counts"]) if r["lat_min"] <= c[0] < r["lat_max"])
            if inside > r["n_total"]:
                errs.append(f"bands.rows[{k}]: cells inside the band sum to {inside} > band n_total {r['n_total']}")
    if bm["kind"] == "real":
        ins = bm["provenance"].get("inputs") or []
        if not ins or any(not x.get("sha256") for x in ins):
            errs.append("real belt_monthly needs provenance.inputs[] each with a sha256")
    return errs


def recompute_belt_monthly(bm, belt, parquet_path):
    """Independent recompute of counts and years_seen from the global parquet with pyarrow
    (no pandas, no analysis/ code). Returns a list of problems (empty = exact match)."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    f = BELT_FILTERS.get(bm["filter_id"])
    if f is None:
        return [f"recompute: unknown filter_id {bm['filter_id']!r}"]
    errs = []
    sha = hashlib.sha256(Path(parquet_path).read_bytes()).hexdigest()
    # M4.1 (docs/m41/SPLIT-RECONCILE.md): the recompute source is normally the Aqua 2003-2011 pre-cut
    # (data/processed/pre_exposed/...parquet + .manifest.json). Its manifest's stands_in_for names the global file
    # that provenance records; the pre-cut itself must match its manifest sha.
    name, want = Path(parquet_path).name, sha
    man_p = Path(str(parquet_path) + ".manifest.json")
    if man_p.is_file():
        man = json.loads(man_p.read_text())
        if man.get("output_sha256") != sha:
            return [f"recompute: {name} sha256 {sha[:12]}.. != its manifest output_sha256; refusing"]
        si = man.get("stands_in_for") or {}
        name, want = Path(si.get("path", name)).name, si.get("sha256", sha)
    prov = [x.get("sha256") for x in bm["provenance"].get("inputs", []) if str(x.get("path", "")).endswith(name)]
    if prov and prov[0] != want:
        errs.append(f"recompute: provenance sha256 {prov[0][:12]}.. != {name} sha256 {want[:12]}..")
    # Row-group guard (footer statistics only): refuse a source in which any row group overlapping the period
    # extends past the period end (e.g. the global file's row group spanning 2011-11..2012-03), so that no month
    # after the period (sealed 2012+) is ever decoded.
    pf = pq.ParquetFile(parquet_path)
    mi = pf.schema_arrow.names.index("month")
    for i in range(pf.metadata.num_row_groups):
        st = pf.metadata.row_group(i).column(mi).statistics
        if st is None or not st.has_min_max:
            return [f"recompute: {Path(parquet_path).name} row group {i} has no month statistics; refusing"]
        if st.min <= bm["period"]["end"] and st.max > bm["period"]["end"]:
            return [f"recompute: {Path(parquet_path).name} row group {i} spans {st.min}..{st.max}, past the period end "
                    f"{bm['period']['end']}; refusing to decode (use the pre-exposed pre-cut)"]
    del pf
    filt = [("platform", "==", "aqua"), ("is_nrt", "==", False), ("type", "in", f["type"]),
            ("confidence_class", "in", f["confidence_class"]),
            ("month", ">=", bm["period"]["start"]), ("month", "<=", bm["period"]["end"])]
    if bm["daynight"] in ("D", "N"):
        filt.append(("daynight", "==", bm["daynight"]))
    pf = pq.ParquetFile(parquet_path)
    keep = [i for i in range(pf.metadata.num_row_groups)
            if pf.metadata.row_group(i).column(mi).statistics.max <= bm["period"]["end"]]
    t = pf.read_row_groups(keep, columns=["lat_bin", "lon_bin", "month", "n", "platform", "is_nrt", "type",
                                          "confidence_class", "daynight"])
    import pyarrow.dataset as ds
    t = ds.dataset(t).to_table(columns=["lat_bin", "lon_bin", "month", "n"], filter=pq.filters_to_expression(filt))
    t = t.filter(pc.greater(t["n"], 0))
    t = t.append_column("y", pc.utf8_slice_codeunits(t["month"], 0, 4))
    t = t.append_column("m", pc.cast(pc.utf8_slice_codeunits(t["month"], 5, 7), "int32"))
    by_year = t.group_by(["lat_bin", "lon_bin", "m", "y"]).aggregate([("n", "sum")])
    agg = {}
    for la, lo, m, s in zip(*(by_year[c].to_pylist() for c in ("lat_bin", "lon_bin", "m", "n_sum"))):
        a = agg.setdefault((la, lo, m), [0, 0])
        a[0] += s
        a[1] += 1
    ys = bm.get("years_seen")
    for i, c in enumerate(belt["cells"]):
        for j in range(12):
            tot, seen = agg.get((c[0], c[1], j + 1), (0, 0))
            if bm["counts"][i][j] != tot or (ys is not None and int(ys[i][j]) != seen):
                errs.append(f"recompute: cell ({c[0]},{c[1]}) month {j + 1}: file count {bm['counts'][i][j]}"
                            f"{'/seen ' + ys[i][j] if ys else ''} != parquet {tot}/seen {seen}")
                if len(errs) > 20:
                    return errs
    return errs


FIXTURE_TEXT = re.compile(r"[⟨⟩]|fixture", re.IGNORECASE)


def production_errors(doc, rel):
    errs = []
    if doc.get("kind") != "real":
        errs.append(f"{rel}: kind is {doc.get('kind')!r}; production requires 'real'")
    if "watermark" in doc:
        errs.append(f"{rel}: has a fixture watermark")

    def walk(x, path):
        if isinstance(x, dict):
            if x.get("status") == "fixture":
                errs.append(f"{rel}{path}: status 'fixture'")
            for k, val in x.items():
                walk(val, f"{path}.{k}")
        elif isinstance(x, list):
            for j, val in enumerate(x[:100000]):
                walk(val, f"{path}[{j}]")
        elif isinstance(x, str) and FIXTURE_TEXT.search(x):
            errs.append(f"{rel}{path}: placeholder/fixture text {x[:50]!r}")
    walk(doc, "")
    return errs[:20]


def load(path, problems):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append(f"{path}: missing")
    except json.JSONDecodeError as e:
        problems.append(f"{path}: invalid JSON ({e})")
    return None


def validate_dir(data_dir, production=False, recompute_from=None):
    problems, checked = [], []

    def report(rel, errs):
        checked.append(rel)
        problems.extend(f"{rel}: {e}" for e in errs[:25])
        if len(errs) > 25:
            problems.append(f"{rel}: ... {len(errs) - 25} more")

    mpath = data_dir / "manifest.json"
    manifest = load(mpath, problems)
    if manifest is None:
        return problems, checked
    merrs = schema_errors(manifest, "manifest")
    report("manifest.json", merrs or (check_audit_flags(manifest, HERE.parent) + check_tiers(manifest, HERE.parent)))
    docs = {"manifest.json": manifest}
    major = str(manifest.get("contract_version", "0")).split(".")[0]
    if major != str(CONTRACT_MAJOR):
        problems.append(f"manifest.json: contract major {major} != validator major {CONTRACT_MAJOR}")
    series_by_region = {}
    if manifest.get("m2_regions") and version_tuple(manifest) < (1, 4, 0):
        problems.append("manifest.json: m2_regions requires contract >= 1.4.0")
    for region in all_regions(manifest):
        rel = region.get("series_path", "")
        s = load(data_dir / rel, problems)
        if s is None:
            continue
        errs = schema_errors(s, "series")
        if not errs:
            errs = check_series(s, manifest, region) + check_baseline_verdict(s, manifest)
        series_by_region[region["id"]] = (s, region, rel, errs)
        docs[rel] = s
    m2v = None
    m2rel = manifest.get("m2_validation_path")
    if m2rel:
        d = load(data_dir / m2rel, problems)
        if d is not None:
            errs = schema_errors(d, "m2_validation")
            if not errs:
                errs = check_m2_validation(d, manifest, {k: v[0] for k, v in series_by_region.items()}, HERE.parent)
                m2v = d
            report(m2rel, errs)
            docs[m2rel] = d
    for rid, (s, region, rel, errs) in series_by_region.items():
        if not errs and not schema_errors(s, "series"):
            errs = errs + check_value_kinds(s, region, m2v)
        report(rel, errs)
    for key, name in (("validation_path", "validation"), ("sensors_path", "sensors")):
        rel = manifest.get(key)
        if rel:
            d = load(data_dir / rel, problems)
            if d is not None:
                errs = schema_errors(d, name)
                if not errs and name == "validation":
                    errs = check_validation(d, manifest)
                if not errs and name == "sensors":
                    errs = check_sensors(d)
                report(rel, errs)
                docs[rel] = d
    belt_doc = belt_bytes = None
    layers = {l.get("id"): l for l in manifest.get("global_layers", [])}
    for layer in manifest.get("global_layers", []):
        if layer.get("id") == "belt" and layer.get("status") != "pending":
            d = load(data_dir / layer["path"], problems)
            if d is not None:
                errs = schema_errors(d, "belt")
                if not errs:
                    errs = check_belt(d)
                    belt_doc, belt_bytes = d, (data_dir / layer["path"]).read_bytes()
                report(layer["path"], errs)
                docs[layer["path"]] = d
    lm = layers.get("belt_monthly")
    if lm is not None and lm.get("status") != "pending":
        d = load(data_dir / lm["path"], problems)
        if d is not None:
            errs = schema_errors(d, "belt_monthly")
            if not errs:
                errs = check_belt_monthly(d, belt_doc, belt_bytes or b"", manifest)
                if belt_doc is not None and d["aligned_to"]["path"] != layers["belt"]["path"]:
                    errs.append(f"aligned_to.path {d['aligned_to']['path']} != manifest belt path {layers['belt']['path']}")
            if not errs and recompute_from is not None:
                errs = recompute_belt_monthly(d, belt_doc, recompute_from)
                checked.append(f"{lm['path']} (independent pyarrow recompute from {recompute_from})")
            report(lm["path"], errs)
            docs[lm["path"]] = d
    for rel, d in docs.items():
        if d.get("kind") != manifest.get("kind"):
            problems.append(f"{rel}: kind {d.get('kind')!r} differs from manifest kind {manifest.get('kind')!r}")
        if production:
            problems.extend(production_errors(d, rel))
    return problems, checked


PUBLIC = False


def main(argv):
    global PUBLIC
    PUBLIC = "--public" in argv
    production = "--production" in argv
    rec = [a.split("=", 1)[1] for a in argv if a.startswith("--recompute-from=")]
    args = [a for a in argv if not a.startswith("--")]
    data_dir = Path(args[0]) if args else Path("site/data")
    if not data_dir.is_dir():
        print(f"FAIL: data directory {data_dir} does not exist")
        return 2
    if rec and not Path(rec[0]).is_file():
        print(f"FAIL: --recompute-from {rec[0]} does not exist")
        return 2
    problems, checked = validate_dir(data_dir, production, rec[0] if rec else None)
    engine = "jsonschema " + jsonschema.__version__ if jsonschema else "built-in subset checker"
    print(f"validator: {engine}; dir={data_dir}; production={production}; public={PUBLIC}")
    if PUBLIC:
        print("  note: research-file cross-checks skipped (--public); schema and consistency checks ran")
    for c in checked:
        print(f"  checked {c}")
    if problems:
        print(f"FAIL: {len(problems)} problem(s)")
        for p in problems:
            print("  -", p)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
