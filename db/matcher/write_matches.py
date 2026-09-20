"""
Save the output of Joel's RAG pipeline (Rag/rag_agent.py) into the matches table, which is
where the web app reads the sponsored pharmaceutical matches from.

This script adds no logic of its own. It imports Rag/rag_agent.py unchanged and calls the same
functions, in the same order, that its run_for_patient() calls:

  1. get_patient(id), get_doctor(id)
  2. is_overdue(patient)                       stop if the patient is not overdue
  3. retrieve_drugs(patient, doctor, top_k=5)  category routing, then the 5 nearest drugs by
                                               vector similarity (KNN over the pgvector column)
  4. generate_match_explanation(context, drug) the Gemini "why surfaced" text, one call per drug

Where run_for_patient() prints, this script saves: one row per drug with its rank, its
similarity score and the Gemini text.

Gemini is slow and rate limited (5 calls per patient), so the explanation step is opt-in:

  python db/matcher/write_matches.py                                # every found patient: top 5 + scores, no Gemini
  python db/matcher/write_matches.py --explain --patients 253 255   # these patients: top 5 + scores + Gemini text
  python db/matcher/write_matches.py --dry-run --explain --patients 253   # print only, save nothing

A run without --explain leaves alone any patient who already has Gemini text saved.

Needs the same .env as the Rag scripts (SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY) and
the packages in Rag/requirements.txt. Run from the repo root.
"""

import argparse
import hashlib
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "Rag"))

CLINIC = "Joel's Clinic"
EMBEDDING_MODEL = "Supabase/gte-small"
TOP_K = 5                 # same as run_for_patient() in rag_agent.py
GEMINI_RETRIES = 4        # on a rate-limit error, wait and try again


def found_patient_ids(sb, limit):
    """Patients the recall agent has flagged at the clinic. Those already contacted come first."""
    ids, seen, start = [], set(), 0
    contacted = sb.table("outreach").select("patient_id").eq("clinic_name", CLINIC).order("created_at", desc=True).limit(1000).execute().data
    for row in contacted:
        if row["patient_id"] not in seen:
            seen.add(row["patient_id"]); ids.append(row["patient_id"])
    while limit is None or len(ids) < limit:
        page = (sb.table("events").select("patient_id").eq("clinic_name", CLINIC).eq("type", "patient_flagged")
                  .order("patient_id").range(start, start + 999).execute().data)
        for row in page:
            if row["patient_id"] not in seen:
                seen.add(row["patient_id"]); ids.append(row["patient_id"])
        if len(page) < 1000:
            break
        start += 1000
    return ids if limit is None else ids[:limit]


def patients_with_gemini_text(sb):
    done, start = set(), 0
    while True:
        page = sb.table("matches").select("patient_id").not_.is_("reason_text", "null").range(start, start + 999).execute().data
        done.update(r["patient_id"] for r in page)
        if len(page) < 1000:
            return done
        start += 1000


def explain(rag, context, drug):
    """Joel's Gemini call, retried when the API says to slow down. Returns None if it never succeeds."""
    for attempt in range(GEMINI_RETRIES):
        try:
            return rag.generate_match_explanation(context, drug)
        except Exception as err:   # the client raises different error types for rate limits and bad requests
            message = str(err)
            if "429" in message or "RESOURCE_EXHAUSTED" in message or "rate" in message.lower():
                wait = 15 * (attempt + 1)
                print(f"      Gemini rate limit, waiting {wait}s")
                time.sleep(wait)
                continue
            print(f"      Gemini error, no text saved for {drug['brand_name']}: {message[:160]}")
            return None
    return None


def main():
    parser = argparse.ArgumentParser(description="Save the RAG pipeline's top 5 matches per patient.")
    parser.add_argument("--explain", action="store_true", help="also call Gemini for the 'why surfaced' text (5 calls per patient)")
    parser.add_argument("--dry-run", action="store_true", help="print results, save nothing")
    parser.add_argument("--limit", type=int, help="process at most this many patients")
    parser.add_argument("--patients", type=int, nargs="*", help="specific patient ids")
    args = parser.parse_args()

    import rag_agent as rag   # loads the embedding model, the Supabase client and the Gemini client, as Joel's script does
    sb = rag.supabase

    ids = args.patients or found_patient_ids(sb, args.limit)
    keep_explained = set() if (args.explain or args.patients) else patients_with_gemini_text(sb)
    print(f"{len(ids)} patients to process" + (f", {len(keep_explained & set(ids))} already have Gemini text and are left alone" if keep_explained else ""))

    saved = 0
    for n, patient_id in enumerate(ids, 1):
        if patient_id in keep_explained:
            continue
        patient = rag.get_patient(patient_id)
        if not rag.is_overdue(patient):
            print(f"[{n}/{len(ids)}] patient {patient_id}: not overdue, skipped")
            continue
        doctor = rag.get_doctor(patient["doctor_id"])
        context, areas, matches = rag.retrieve_drugs(patient, doctor, TOP_K)

        rows = []
        for rank, drug in enumerate(matches, 1):
            text = explain(rag, context, drug) if args.explain else None
            rows.append({
                "patient_id": patient_id,
                "drug_id": drug["drug_id"],
                "rank": rank,
                "similarity": drug["similarity"],
                "reason_text": text,
                "why_facts": [],
                "rules_fired": [],
                "context_hash": hashlib.sha256(context.encode()).hexdigest(),
                "embedding_model": EMBEDDING_MODEL,
            })
            if args.dry_run or args.patients:
                print(f"    {rank}. {drug['similarity']:.4f}  {drug['brand_name']:<13} {drug['drug_class'] or '':<32} {drug['indications']}  ({drug['company_name']})")
                if text:
                    print(f"       why surfaced: {text}")

        print(f"[{n}/{len(ids)}] patient {patient_id}: areas {areas} -> {[m['brand_name'] for m in matches]}")
        if args.dry_run:
            continue
        sb.table("matches").delete().eq("patient_id", patient_id).execute()
        if rows:
            sb.table("matches").insert(rows).execute()
            saved += 1

    print(f"\nDone. Saved matches for {saved} patients." if not args.dry_run else "\nDone. Nothing was saved (dry run).")


if __name__ == "__main__":
    main()
