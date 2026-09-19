"""
Seed a large synthetic patient dataset into the existing Supabase tables.

What it does, in order:
  1. Reads the clinics that already exist in ehr_doctors. Each clinic is one practice.
  2. Adds the demo practice (Joel's Clinic: Dr. Patel, Dr. Lee, NP Gomez) if it is missing.
  3. Tops every practice up to DOCTORS_PER_PRACTICE doctors.
  4. Inserts the 12 hand-written demo patients under Dr. Patel.
  5. Generates patients until every practice has PATIENTS_PER_PRACTICE and the demo
     practice has DEMO_PRACTICE_PATIENTS, and inserts them into ehr_patients in
     batches of BATCH_SIZE.

It only appends. Existing rows are never changed or deleted, so existing patient
ids (for example the RAG test patient 198) stay valid. No columns are added.

Every value follows the format of the rows already in the table:
  phone   555-2XX-NNNN, numbered by row
  email   first.last.N@example.com
  diagnoses, current_prescriptions, allergies   text arrays
  next_followup_due = last_appointment + recommended_followup_months, always
  relevant_notes ends with one of the two fixed follow-up sentences

Diagnosis names must stay exactly equal to the names used in pharma_drugs.indications
and in the routing table in Rag/rag_agent.py. Matching is by exact name.

All data is synthetic: fictional names, 555 phone numbers, example.com emails.

Usage:
  python db/seed/seed_patients.py --dry-run     # generate, print a summary, write nothing, needs no keys
  python db/seed/seed_patients.py               # insert into Supabase
  python db/seed/seed_patients.py --today 2026-09-20   # pin the date used for overdue math

Needs SUPABASE_URL and SUPABASE_SECRET_KEY in a .env file at the repo root (same
names the Rag scripts use) and the packages in Rag/requirements.txt.

To remove what this script added, run this in the Supabase SQL editor:
  delete from ehr_patients where id > 250;
  delete from ehr_doctors  where id > 25;
"""

import argparse
import os
import random
import sys
from collections import Counter
from datetime import date, timedelta

# ------------------------------------------------------------
# SETTINGS
# ------------------------------------------------------------

SEED = 20260919                 # fixed, so every run generates the same people
PATIENTS_PER_PRACTICE = 1000
# The demo practice is the one shown on the doctor screens, so the hourly recall job
# draws from it run after run. It is larger so that pool does not run out.
# About 40% are overdue and about 98% of those have consent, so 5000 gives roughly
# 1950 callable patients. At 25 calls per hourly run that lasts about 78 runs.
DEMO_PRACTICE_PATIENTS = 5000
DOCTORS_PER_PRACTICE = 4
BATCH_SIZE = 1000

# Share of generated patients whose follow-up date has already passed.
# This is the pool the hourly recall job works through.
OVERDUE_SHARE = 0.40
MAX_DAYS_OVERDUE = 450
TYPICAL_DAYS_OVERDUE = 45       # most overdue patients are recently overdue

CONSENT_CALLS_SHARE = 0.91      # measured from the existing rows
CONSENT_SMS_SHARE = 0.92
NO_CONSENT_SHARE = 0.02         # neither call nor text consent: never eligible for recall

# Refuse to run twice by accident.
ALREADY_SEEDED_THRESHOLD = 1000

DEMO_CLINIC = "Joel's Clinic"
DEMO_DOCTORS = [
    # first_name, last_name, specialty. The first one is the demo physician.
    ("Anika", "Patel", "Internal Medicine"),
    ("Daniel", "Lee", "Family Medicine"),
    ("Marisol", "Gomez", "Family Medicine"),
]

SPECIALTY_TO_AREA = {
    "Internal Medicine": "Primary Care",
    "Family Medicine": "Primary Care",
    "Endocrinology": "Endocrinology",
    "Cardiology": "Cardiology",
    "Pulmonology": "Pulmonology",
    "Neurology": "Neurology",
    "Gastroenterology": "Gastroenterology",
    "Rheumatology": "Rheumatology",
}

# Used only by --dry-run, which has no database access. A real run reads ehr_doctors.
FALLBACK_PRACTICES = [
    ("Blue Ridge Medical Center", "Internal Medicine"),
    ("New River Endocrine Clinic", "Endocrinology"),
    ("Virginia Heart Partners", "Cardiology"),
    ("Mountain View Pulmonary", "Pulmonology"),
    ("Valley Family Health", "Family Medicine"),
    ("Appalachian Neurology Associates", "Neurology"),
    ("Southwest Digestive Health", "Gastroenterology"),
    ("Blue Ridge Rheumatology", "Rheumatology"),
    ("Hokie Internal Medicine", "Internal Medicine"),
    ("New River Cardiology Group", "Cardiology"),
    ("Commonwealth Metabolic Care", "Endocrinology"),
    ("Roanoke Lung Center", "Pulmonology"),
    ("Christiansburg Family Practice", "Family Medicine"),
    ("Virginia NeuroCare", "Neurology"),
    ("Blue Ridge GI Associates", "Gastroenterology"),
    ("Allegheny Arthritis Center", "Rheumatology"),
    ("Cedar Grove Medical", "Internal Medicine"),
    ("Piedmont Heart Clinic", "Cardiology"),
    ("Summit Endocrine Specialists", "Endocrinology"),
    ("Commonwealth Pulmonary Care", "Pulmonology"),
    ("Oak Valley Primary Care", "Family Medicine"),
    ("New River Neurology", "Neurology"),
    ("Mountain Digestive Institute", "Gastroenterology"),
    ("Virginia Joint & Autoimmune", "Rheumatology"),
    ("Stone Creek Internal Medicine", "Internal Medicine"),
]

# ------------------------------------------------------------
# VOCABULARY (values copied from the existing rows)
# ------------------------------------------------------------

CITIES = [
    ("Blacksburg", "24060"), ("Christiansburg", "24073"), ("Radford", "24141"),
    ("Roanoke", "24011"), ("Salem", "24153"), ("Floyd", "24091"),
    ("Pulaski", "24301"), ("Dublin", "24084"), ("Pearisburg", "24134"),
    ("Wytheville", "24382"), ("Bedford", "24523"), ("Lexington", "24450"),
]

STREET_NAMES = [
    "Cedar", "Maple", "Oak", "Ridge", "Main", "Church", "Mill", "Spring", "Valley",
    "Orchard", "Laurel", "Hickory", "Walnut", "Franklin", "Draper", "Peppers Ferry",
    "Prices Fork", "Harding", "Roanoke", "Meadow", "Creekside", "Sunset", "Highland",
]
STREET_TYPES = ["Road", "Way", "Street", "Lane", "Drive", "Avenue", "Court"]

INSURANCE_PROVIDERS = [
    "Piedmont Health Plan", "Virginia Community Health", "Summit Benefit Network",
    "Commonwealth Care", "Allegheny Benefit Group", "Blue Horizon Health", "New River Assurance",
]
MEDICARE_PROVIDER = "Evergreen Medicare Advantage"
COMMERCIAL_PLANS = ["PPO", "HMO", "EPO"]
MEDICARE_PLAN = "Medicare Advantage"

ALLERGIES = ["Penicillin", "Latex", "Cephalosporins", "Sulfa drugs", "Shellfish", "NSAIDs"]
ALLERGY_COUNT_WEIGHTS = [(0, 25), (1, 62), (2, 13)]          # measured from the existing rows
DIAGNOSIS_COUNT_WEIGHTS = [(1, 49), (2, 43), (3, 8)]         # measured from the existing rows

FIRST_NAMES = [
    "Maya", "Omar", "Aiden", "Grace", "Noah", "Olivia", "Ethan", "Sophia", "Lucas", "Ava",
    "Liam", "Isabella", "Mason", "Mia", "Elijah", "Amelia", "Logan", "Harper", "James", "Evelyn",
    "Benjamin", "Abigail", "Henry", "Emily", "Samuel", "Ella", "David", "Scarlett", "Joseph", "Chloe",
    "Carter", "Layla", "Owen", "Nora", "Wyatt", "Zoe", "Caleb", "Hannah", "Isaac", "Lily",
    "Andre", "Priya", "Mateo", "Aaliyah", "Wei", "Fatima", "Diego", "Naomi", "Kofi", "Mei",
    "Rafael", "Leila", "Dmitri", "Imani", "Hiro", "Camila", "Tariq", "Ingrid", "Marcus", "Yara",
    "Walter", "Dorothy", "Frank", "Ruth", "Harold", "Helen", "Raymond", "Joyce", "Eugene", "Gloria",
    "Tyler", "Brianna", "Jordan", "Kayla", "Austin", "Megan", "Dylan", "Rachel", "Trevor", "Alexis",
]
LAST_NAMES = [
    "Nelson", "Clark", "Carter", "Wilson", "Martinez", "Reed", "Shah", "Brooks", "Chen", "Foster",
    "Thompson", "Bennett", "Collins", "Ramirez", "Nguyen", "Price", "Morgan", "Turner", "Ross", "Lee",
    "Scott", "Adams", "Baker", "Campbell", "Diaz", "Edwards", "Flores", "Garcia", "Hall", "Ingram",
    "Jackson", "Kelly", "Lopez", "Mitchell", "Novak", "Ortiz", "Parker", "Quinn", "Rivera", "Sanders",
    "Taylor", "Underwood", "Vargas", "Walker", "Young", "Zimmerman", "Ali", "Banerjee", "Cho", "Dubois",
    "Eze", "Fischer", "Goldberg", "Hassan", "Ivanov", "Jensen", "Kowalski", "Larsen", "Mendoza", "Nakamura",
    "Okafor", "Petrov", "Qureshi", "Rossi", "Sato", "Tran", "Usman", "Volkov", "Williams", "Yamamoto",
    "Hairston", "Akers", "Sutphin", "Quesenberry", "Linkous", "Shelor", "Vest", "Duncan", "Cox", "Weddle",
]

GENERIC_NOTES = [
    "Routine follow-up for {dx} was recommended.",
    "Clinical status for {dx} should be reassessed at the next visit.",
]

# One entry per diagnosis name.
#   areas   therapeutic areas, same routing as Rag/rag_agent.py
#   weight  how common it is among that area's patients, and in primary care when pc > 0
#   rx      medication strings in the existing "Drug dose frequency" format; [] means none
#   notes   diagnosis-specific first sentences; the two generic templates are always available too
#   months  follow-up intervals to draw from (repeats act as weights)
#   age     youngest and oldest age to generate
DX = {
    "Type 2 Diabetes": dict(areas=["Endocrinology", "Metabolic Disease"], weight=30, pc=22,
        rx=["Metformin 1000 mg twice daily", "Metformin 500 mg twice daily", "Empagliflozin 10 mg daily", "Glipizide 5 mg daily"],
        notes=["Glycemic control remains above target at the most recent follow-up.", "Routine diabetes follow-up and medication review were recommended."],
        months=[3, 6, 6, 12], age=(35, 84)),
    "Type 1 Diabetes": dict(areas=["Endocrinology"], weight=6, pc=1,
        rx=["Insulin glargine 20 units nightly", "Insulin lispro with meals"],
        notes=["Insulin regimen and glucose monitoring data should be reviewed at follow-up."],
        months=[3, 3, 6], age=(22, 65)),
    "Prediabetes": dict(areas=["Endocrinology", "Metabolic Disease"], weight=12, pc=10,
        rx=[], notes=["A1C trend should be reassessed at the next visit."], months=[6, 12], age=(30, 75)),
    "Obesity": dict(areas=["Metabolic Disease", "Endocrinology"], weight=10, pc=9,
        rx=[], notes=["Weight-management goals and metabolic risk factors should be reviewed at follow-up."], months=[6], age=(28, 72)),
    "Hypothyroidism": dict(areas=["Endocrinology"], weight=22, pc=10,
        rx=["Levothyroxine 50 mcg daily", "Levothyroxine 75 mcg daily", "Levothyroxine 100 mcg daily"],
        notes=["Thyroid laboratory monitoring was recommended at the next visit."], months=[6, 6, 12], age=(30, 84)),
    "Hyperthyroidism": dict(areas=["Endocrinology"], weight=5, pc=1,
        rx=["Methimazole 10 mg daily"], notes=["Thyroid function should be rechecked at the next visit."], months=[3, 6], age=(28, 70)),
    "Osteoporosis": dict(areas=["Endocrinology"], weight=10, pc=5,
        rx=["Alendronate 70 mg weekly"], notes=[], months=[6, 12], age=(55, 84)),

    "Hypertension": dict(areas=["Cardiology", "Primary Care"], weight=30, pc=30,
        rx=["Lisinopril 10 mg daily", "Amlodipine 5 mg daily", "Amlodipine 10 mg daily", "Losartan 50 mg daily"],
        notes=["Home blood pressure log was requested for the next visit.", "Office blood pressure remained above goal at the most recent visit."],
        months=[6, 6, 12], age=(35, 84)),
    "Hyperlipidemia": dict(areas=["Cardiology", "Metabolic Disease"], weight=24, pc=20,
        rx=["Atorvastatin 20 mg nightly", "Atorvastatin 40 mg nightly", "Rosuvastatin 10 mg nightly"],
        notes=["Repeat lipid panel and medication review were recommended.", "Lipid control should be reassessed at the next routine visit."],
        months=[3, 6, 6, 12], age=(38, 84)),
    "Coronary Artery Disease": dict(areas=["Cardiology"], weight=14, pc=3,
        rx=["Aspirin 81 mg daily", "Atorvastatin 40 mg nightly"], notes=[], months=[6, 12], age=(50, 84)),
    "Atrial Fibrillation": dict(areas=["Cardiology"], weight=12, pc=3,
        rx=["Apixaban 5 mg twice daily", "Metoprolol succinate 50 mg daily"],
        notes=["Rate control and anticoagulation should be reviewed at follow-up."], months=[3, 6], age=(55, 84)),
    "Heart Failure with Reduced Ejection Fraction": dict(areas=["Cardiology"], weight=8, pc=1,
        rx=["Carvedilol 12.5 mg twice daily", "Sacubitril-valsartan 49-51 mg twice daily", "Furosemide 20 mg daily"],
        notes=["Volume status and guideline-directed therapy should be reassessed at follow-up."], months=[3], age=(50, 84)),
    "Stable Angina": dict(areas=["Cardiology"], weight=6, pc=1,
        rx=["Nitroglycerin 0.4 mg as needed", "Metoprolol succinate 50 mg daily"], notes=[], months=[3, 6], age=(50, 84)),
    "Peripheral Artery Disease": dict(areas=["Cardiology"], weight=6, pc=1,
        rx=["Clopidogrel 75 mg daily", "Cilostazol 100 mg twice daily"], notes=[], months=[6], age=(55, 84)),

    "Asthma": dict(areas=["Pulmonology", "Primary Care"], weight=24, pc=10,
        rx=["Albuterol inhaler as needed", "Fluticasone inhaler twice daily"],
        notes=["Symptom control and inhaler technique should be reviewed at follow-up."], months=[6, 12], age=(22, 75)),
    "Allergic Asthma": dict(areas=["Pulmonology"], weight=10, pc=2,
        rx=["Montelukast 10 mg nightly", "Albuterol inhaler as needed"], notes=[], months=[6], age=(22, 70)),
    "Exercise-Induced Asthma": dict(areas=["Pulmonology"], weight=6, pc=1,
        rx=["Albuterol inhaler as needed"], notes=[], months=[12], age=(22, 50)),
    "COPD": dict(areas=["Pulmonology"], weight=24, pc=6,
        rx=["Fluticasone-umeclidinium-vilanterol inhaler daily", "Tiotropium inhaler daily"],
        notes=["Respiratory symptoms are stable; maintenance therapy and spirometry should be reviewed."], months=[3, 6, 6], age=(50, 84)),
    "Chronic Bronchitis": dict(areas=["Pulmonology"], weight=8, pc=1,
        rx=["Tiotropium inhaler daily"], notes=[], months=[6, 12], age=(45, 84)),
    "Obstructive Sleep Apnea": dict(areas=["Pulmonology"], weight=14, pc=4,
        rx=[], notes=["CPAP adherence and symptom control should be reviewed at follow-up."], months=[12], age=(35, 78)),

    "Migraine": dict(areas=["Neurology"], weight=26, pc=6,
        rx=["Sumatriptan 50 mg as needed", "Topiramate 50 mg nightly"],
        notes=["Headache frequency and treatment response should be reviewed at follow-up."], months=[6, 12], age=(22, 62)),
    "Epilepsy": dict(areas=["Neurology"], weight=14, pc=1,
        rx=["Levetiracetam 500 mg twice daily", "Lamotrigine 100 mg twice daily"],
        notes=["No recent breakthrough event documented; interval reassessment remains due."], months=[3, 6], age=(22, 75)),
    "Essential Tremor": dict(areas=["Neurology"], weight=8, pc=1,
        rx=["Propranolol 40 mg twice daily", "Primidone 50 mg nightly"], notes=[], months=[6, 12], age=(45, 84)),
    "Neuropathic Pain": dict(areas=["Neurology"], weight=10, pc=2,
        rx=["Duloxetine 60 mg daily", "Gabapentin 300 mg three times daily"], notes=[], months=[6], age=(40, 84)),
    "Peripheral Neuropathy": dict(areas=["Neurology"], weight=12, pc=2,
        rx=["Gabapentin 300 mg twice daily"], notes=[], months=[6], age=(45, 84)),
    "Parkinson Disease": dict(areas=["Neurology"], weight=8, pc=1,
        rx=["Carbidopa-levodopa 25-100 mg three times daily"],
        notes=["Motor symptoms and medication timing should be reviewed at follow-up."], months=[3, 6], age=(58, 84)),
    "Restless Legs Syndrome": dict(areas=["Neurology"], weight=8, pc=1,
        rx=["Pramipexole 0.25 mg nightly", "Ropinirole 0.5 mg nightly"], notes=[], months=[6, 12], age=(35, 80)),

    "GERD": dict(areas=["Gastroenterology", "Primary Care"], weight=28, pc=12,
        rx=["Omeprazole 20 mg daily", "Omeprazole 40 mg daily", "Famotidine 20 mg daily"],
        notes=["Symptoms should be reassessed and long-term acid suppression reviewed."], months=[3, 6, 6], age=(28, 84)),
    "Irritable Bowel Syndrome": dict(areas=["Gastroenterology"], weight=16, pc=3,
        rx=["Dicyclomine 20 mg as needed"], notes=[], months=[6, 12], age=(22, 65)),
    "Ulcerative Colitis": dict(areas=["Gastroenterology"], weight=10, pc=1,
        rx=["Mesalamine 1.2 g twice daily"], notes=["Disease activity and surveillance schedule should be reviewed at follow-up."], months=[3, 6], age=(22, 70)),
    "Crohn Disease": dict(areas=["Gastroenterology"], weight=10, pc=1,
        rx=["Budesonide 9 mg daily"], notes=[], months=[3, 6], age=(22, 70)),
    "Chronic Constipation": dict(areas=["Gastroenterology"], weight=10, pc=2,
        rx=["Polyethylene glycol daily"], notes=[], months=[6], age=(30, 84)),
    "Nonalcoholic Fatty Liver Disease": dict(areas=["Gastroenterology", "Metabolic Disease"], weight=12, pc=3,
        rx=[], notes=[], months=[6, 12], age=(35, 75)),

    "Rheumatoid Arthritis": dict(areas=["Rheumatology"], weight=22, pc=2,
        rx=["Methotrexate 15 mg weekly", "Hydroxychloroquine 200 mg twice daily"],
        notes=["Disease activity and medication monitoring labs should be reviewed at follow-up."], months=[3, 6], age=(30, 82)),
    "Psoriatic Arthritis": dict(areas=["Rheumatology"], weight=10, pc=1,
        rx=["Methotrexate 15 mg weekly"], notes=[], months=[3, 6], age=(30, 75)),
    "Osteoarthritis": dict(areas=["Rheumatology", "Primary Care"], weight=24, pc=12,
        rx=["Acetaminophen as needed", "Naproxen 250 mg as needed"], notes=[], months=[6, 12], age=(48, 84)),
    "Gout": dict(areas=["Rheumatology"], weight=16, pc=4,
        rx=["Allopurinol 100 mg daily", "Allopurinol 300 mg daily"], notes=["Uric acid level should be rechecked at the next visit."], months=[6, 12], age=(38, 82)),
    "Systemic Lupus Erythematosus": dict(areas=["Rheumatology"], weight=8, pc=1,
        rx=["Hydroxychloroquine 200 mg twice daily"], notes=[], months=[3, 6], age=(22, 65)),
    "Ankylosing Spondylitis": dict(areas=["Rheumatology"], weight=6, pc=1,
        rx=["Celecoxib 100 mg twice daily"], notes=[], months=[6], age=(22, 60)),

    "Generalized Anxiety Disorder": dict(areas=["Primary Care"], weight=12, pc=10,
        rx=["Sertraline 50 mg daily", "Escitalopram 10 mg daily"], notes=[], months=[6], age=(22, 75)),
}

# A patient gets at most one diagnosis from each of these groups.
EXCLUSIVE_GROUPS = [
    {"Type 2 Diabetes", "Type 1 Diabetes", "Prediabetes"},
    {"Asthma", "Allergic Asthma", "Exercise-Induced Asthma"},
    {"COPD", "Chronic Bronchitis"},
    {"Hypothyroidism", "Hyperthyroidism"},
    {"Neuropathic Pain", "Peripheral Neuropathy"},
    {"Ulcerative Colitis", "Crohn Disease"},
    {"Irritable Bowel Syndrome", "Chronic Constipation"},
    {"Rheumatoid Arthritis", "Psoriatic Arthritis", "Ankylosing Spondylitis", "Systemic Lupus Erythematosus"},
]

# ------------------------------------------------------------
# DEMO PATIENTS (hand-written, all under the demo physician)
# ------------------------------------------------------------
# last_visit days are 28 or lower so adding months never lands on a missing day.

DEMO_PATIENTS = [
    dict(first="Robert", last="Chen", dob="1959-02-18", last_visit="2025-05-06", months=6,
         dx=["Type 2 Diabetes", "Chronic Kidney Disease Stage 4"],
         rx=["Insulin glargine 24 units nightly", "Lisinopril 20 mg daily"],
         note="Kidney function is declining and nephrology is co-managing. Last eGFR was 24 mL/min. Glycemic control and renal labs should be reassessed at the next visit."),
    dict(first="Evelyn", last="Brooks", dob="1954-02-11", last_visit="2025-06-17", months=6,
         dx=["Hypertension", "Hyperlipidemia"], rx=["Amlodipine 5 mg daily", "Atorvastatin 20 mg nightly"],
         note="Office blood pressure remained above goal at the most recent visit. Last reading was 152/88."),
    dict(first="John", last="Smith", dob="1968-03-14", last_visit="2025-07-09", months=6,
         dx=["Type 2 Diabetes"], rx=["Metformin 1000 mg twice daily"],
         note="Glycemic control remains above target at the most recent follow-up. Last A1C was 8.4% on metformin. Diet was discussed and therapy should be reassessed."),
    dict(first="Aisha", last="Rahman", dob="1987-04-02", last_visit="2025-01-14", months=12,
         dx=["Asthma"], rx=["Fluticasone inhaler twice daily", "Albuterol inhaler as needed"],
         note="Symptom control and inhaler technique should be reviewed at follow-up."),
    dict(first="Maria", last="Lopez", dob="1980-05-23", last_visit="2025-08-12", months=6,
         dx=["Hypothyroidism"], rx=["Levothyroxine 75 mcg daily"],
         note="Thyroid laboratory monitoring was recommended at the next visit. TSH was mildly elevated and the dose was adjusted."),
    dict(first="David", last="Kim", dob="1963-01-30", last_visit="2025-11-17", months=3,
         dx=["Atrial Fibrillation"], rx=["Apixaban 5 mg twice daily", "Metoprolol succinate 50 mg daily"],
         note="Rate control and anticoagulation should be reviewed at follow-up.", sms=False),
    dict(first="Linda", last="Okafor", dob="1971-06-08", last_visit="2025-09-03", months=6,
         dx=["Hypertension"], rx=["Lisinopril 10 mg daily"],
         note="Home blood pressure log was requested for the next visit. Last reading was 148/92."),
    dict(first="Tom", last="Alvarez", dob="1977-03-19", last_visit="2025-12-11", months=3,
         dx=["GERD"], rx=["Omeprazole 20 mg daily"],
         note="Symptoms should be reassessed and long-term acid suppression reviewed."),
    dict(first="Priya", last="Nair", dob="1992-02-27", last_visit="2025-10-08", months=6,
         dx=["Migraine"], rx=["Sumatriptan 50 mg as needed"],
         note="Headache frequency and treatment response should be reviewed at follow-up."),
    dict(first="George", last="Whitman", dob="1948-05-05", last_visit="2026-01-15", months=3,
         dx=["COPD", "Hypertension"], rx=["Tiotropium inhaler daily", "Losartan 50 mg daily"],
         note="Respiratory symptoms are stable; maintenance therapy and spirometry should be reviewed."),
    dict(first="Hannah", last="Schultz", dob="1965-01-12", last_visit="2025-05-12", months=12,
         dx=["Osteoporosis"], rx=["Alendronate 70 mg weekly"],
         note="Routine follow-up for Osteoporosis was recommended."),
    dict(first="Marcus", last="Reed", dob="1974-04-21", last_visit="2025-11-05", months=6,
         dx=["Hyperlipidemia"], rx=["Rosuvastatin 10 mg nightly"],
         note="Repeat lipid panel and medication review were recommended. Last LDL was 92 mg/dL."),
]

# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def weighted(rng, pairs):
    """pairs is [(value, weight), ...]. Returns one value."""
    values = [v for v, _ in pairs]
    weights = [w for _, w in pairs]
    return rng.choices(values, weights=weights, k=1)[0]


def add_months(d, months):
    """Calendar month arithmetic. Callers only pass days of 28 or lower."""
    total = d.year * 12 + (d.month - 1) + months
    return date(total // 12, total % 12 + 1, d.day)


def clamp_day(d):
    return d if d.day <= 28 else d.replace(day=28)


def phone_for(n):
    # Row 1 is 555-200-0001. Past 9999 the middle block counts up: row 12345 is 555-201-2345.
    return f"555-{200 + n // 10000}-{n % 10000:04d}"


def email_for(first, last, n):
    clean = lambda s: "".join(ch for ch in s.lower() if ch.isalpha())
    return f"{clean(first)}.{clean(last)}.{n}@example.com"


def followup_sentence(due, today):
    if due < today:
        return f"Follow-up is currently {(today - due).days} days overdue."
    return "Follow-up remains scheduled within the recommended interval."


def conflicts(name, chosen):
    return any(name in group and group & set(chosen) for group in EXCLUSIVE_GROUPS)


def pick_diagnoses(rng, area):
    if area == "Primary Care":
        primary_pool = [(name, d["pc"]) for name, d in DX.items() if d["pc"] > 0]
    else:
        primary_pool = [(name, d["weight"]) for name, d in DX.items() if area in d["areas"]]
    chosen = [weighted(rng, primary_pool)]

    # Extra diagnoses come from what is common in the general population.
    extra_pool = [(name, d["pc"]) for name, d in DX.items() if d["pc"] > 0]
    wanted = weighted(rng, DIAGNOSIS_COUNT_WEIGHTS)
    attempts = 0
    while len(chosen) < wanted and attempts < 20:
        attempts += 1
        candidate = weighted(rng, extra_pool)
        if candidate not in chosen and not conflicts(candidate, chosen):
            chosen.append(candidate)
    return chosen


def pick_dates(rng, months, today, overdue):
    """Returns (last_appointment, next_followup_due) with due = last + months exactly."""
    for _ in range(50):
        if overdue:
            days_over = int(rng.triangular(1, MAX_DAYS_OVERDUE, TYPICAL_DAYS_OVERDUE))
            last = clamp_day(today - timedelta(days=months * 30 + days_over + 3))
        else:
            last = clamp_day(today - timedelta(days=rng.randint(0, max(1, months * 30 - 5))))
        due = add_months(last, months)
        if (due < today) == overdue and last <= today:
            return last, due
    raise RuntimeError("could not place follow-up dates")


def make_patient(rng, n, doctor_id, area, today):
    first, last_name = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
    diagnoses = pick_diagnoses(rng, area)
    primary = DX[diagnoses[0]]

    lo, hi = primary["age"]
    age = rng.randint(lo, hi)
    dob = clamp_day(today.replace(year=today.year - age) - timedelta(days=rng.randint(1, 364)))

    prescriptions = [rng.choice(DX[d]["rx"]) for d in diagnoses if DX[d]["rx"]]
    months = rng.choice(primary["months"])
    last_appt, due = pick_dates(rng, months, today, rng.random() < OVERDUE_SHARE)

    note_first = rng.choice(primary["notes"] + GENERIC_NOTES).format(dx=diagnoses[0])
    city, zip_code = rng.choice(CITIES)

    if age >= 65 and rng.random() < 0.7:
        provider, plan = MEDICARE_PROVIDER, MEDICARE_PLAN
    else:
        provider, plan = rng.choice(INSURANCE_PROVIDERS), rng.choice(COMMERCIAL_PLANS)

    if rng.random() < NO_CONSENT_SHARE:
        calls, texts = False, False
    else:
        calls, texts = rng.random() < CONSENT_CALLS_SHARE, rng.random() < CONSENT_SMS_SHARE
        if not calls and not texts:
            calls = True

    return {
        "doctor_id": doctor_id,
        "first_name": first,
        "last_name": last_name,
        "date_of_birth": dob.isoformat(),
        "address": f"{rng.randint(100, 9899)} {rng.choice(STREET_NAMES)} {rng.choice(STREET_TYPES)}",
        "city": city,
        "state": "VA",
        "zip_code": zip_code,
        "phone": phone_for(n),
        "email": email_for(first, last_name, n),
        "insurance_provider": provider,
        "insurance_plan": plan,
        "diagnoses": diagnoses,
        "current_prescriptions": prescriptions,
        "allergies": rng.sample(ALLERGIES, weighted(rng, ALLERGY_COUNT_WEIGHTS)),
        "last_appointment": last_appt.isoformat(),
        "recommended_followup_months": months,
        "next_followup_due": due.isoformat(),
        "relevant_notes": f"{note_first} {followup_sentence(due, today)}",
        "consent_for_calls": calls,
        "consent_for_sms": texts,
    }


def make_demo_patient(rng, spec, n, doctor_id, today):
    last_appt = date.fromisoformat(spec["last_visit"])
    due = add_months(last_appt, spec["months"])
    dob = date.fromisoformat(spec["dob"])
    age = (today - dob).days // 365
    city, zip_code = rng.choice(CITIES)
    medicare = age >= 65
    return {
        "doctor_id": doctor_id,
        "first_name": spec["first"],
        "last_name": spec["last"],
        "date_of_birth": spec["dob"],
        "address": f"{rng.randint(100, 9899)} {rng.choice(STREET_NAMES)} {rng.choice(STREET_TYPES)}",
        "city": city,
        "state": "VA",
        "zip_code": zip_code,
        "phone": phone_for(n),
        "email": email_for(spec["first"], spec["last"], n),
        "insurance_provider": MEDICARE_PROVIDER if medicare else rng.choice(INSURANCE_PROVIDERS),
        "insurance_plan": MEDICARE_PLAN if medicare else rng.choice(COMMERCIAL_PLANS),
        "diagnoses": spec["dx"],
        "current_prescriptions": spec["rx"],
        "allergies": rng.sample(ALLERGIES, weighted(rng, ALLERGY_COUNT_WEIGHTS)),
        "last_appointment": last_appt.isoformat(),
        "recommended_followup_months": spec["months"],
        "next_followup_due": due.isoformat(),
        "relevant_notes": f"{spec['note']} {followup_sentence(due, today)}",
        "consent_for_calls": spec.get("calls", True),
        "consent_for_sms": spec.get("sms", True),
    }


def make_doctor(rng, number, clinic, specialty, name=None):
    first, last = name if name else (rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES))
    clean = lambda s: "".join(ch for ch in s.lower() if ch.isalpha())
    return {
        "first_name": first,
        "last_name": last,
        "specialty": specialty,
        "clinic_name": clinic,
        "email": f"{clean(first)}.{clean(last)}@impericus-demo.example.com",
        "phone": f"555-100-{1000 + number}",
    }


# ------------------------------------------------------------
# PLAN: decide every row before touching the database
# ------------------------------------------------------------

def plan_doctors(rng, existing_doctors):
    """Returns new doctor rows. existing_doctors is a list of dicts from ehr_doctors."""
    by_clinic = {}
    for d in existing_doctors:
        by_clinic.setdefault(d["clinic_name"], []).append(d)

    next_number = max([d["id"] for d in existing_doctors], default=0) + 1
    new_rows = []

    if DEMO_CLINIC not in by_clinic:
        by_clinic[DEMO_CLINIC] = []
    have = {(d["first_name"], d["last_name"]) for d in by_clinic[DEMO_CLINIC]}
    for first, last, specialty in DEMO_DOCTORS:
        if (first, last) not in have:
            new_rows.append(make_doctor(rng, next_number, DEMO_CLINIC, specialty, (first, last)))
            by_clinic[DEMO_CLINIC].append(new_rows[-1])
            next_number += 1

    for clinic, doctors in by_clinic.items():
        if clinic == DEMO_CLINIC:
            continue  # the demo practice keeps exactly its named providers, matching the Schedule screen
        specialty = doctors[0]["specialty"]
        while len(doctors) < DOCTORS_PER_PRACTICE:
            new_rows.append(make_doctor(rng, next_number, clinic, specialty))
            doctors.append(new_rows[-1])
            next_number += 1
    return new_rows


def plan_patients(rng, doctors, existing_per_doctor, first_number, today):
    """doctors must all have ids. Returns (demo_rows, bulk_rows)."""
    by_clinic = {}
    for d in doctors:
        by_clinic.setdefault(d["clinic_name"], []).append(d)

    n = first_number
    demo_doctor = next(
        d for d in by_clinic[DEMO_CLINIC]
        if (d["first_name"], d["last_name"]) == DEMO_DOCTORS[0][:2]
    )
    demo_rows = []
    for spec in DEMO_PATIENTS:
        demo_rows.append(make_demo_patient(rng, spec, n, demo_doctor["id"], today))
        n += 1

    bulk_rows = []
    for clinic, clinic_doctors in by_clinic.items():
        area = SPECIALTY_TO_AREA.get(clinic_doctors[0]["specialty"], "Primary Care")
        already = sum(existing_per_doctor.get(d["id"], 0) for d in clinic_doctors)
        target = PATIENTS_PER_PRACTICE
        if clinic == DEMO_CLINIC:
            already += len(demo_rows)
            target = DEMO_PRACTICE_PATIENTS
        for _ in range(max(0, target - already)):
            doctor = rng.choice(clinic_doctors)
            bulk_rows.append(make_patient(rng, n, doctor["id"], area, today))
            n += 1
    return demo_rows, bulk_rows


def summarize(doctor_rows, demo_rows, bulk_rows, today, demo_doctor_ids):
    rows = demo_rows + bulk_rows
    overdue = [r for r in rows if r["next_followup_due"] < today.isoformat()]
    eligible = [r for r in overdue if r["consent_for_calls"] or r["consent_for_sms"]]
    demo_all = [r for r in rows if r["doctor_id"] in demo_doctor_ids]
    demo_eligible = [r for r in eligible if r["doctor_id"] in demo_doctor_ids]
    coming_due = [r for r in demo_all if today.isoformat() <= r["next_followup_due"] <= (today + timedelta(days=30)).isoformat()]
    dx = Counter(d for r in rows for d in r["diagnoses"])
    print(f"\nnew doctors:            {len(doctor_rows)}")
    print(f"demo patients:          {len(demo_rows)}")
    print(f"generated patients:     {len(bulk_rows)}")
    print(f"overdue today:          {len(overdue)} ({100 * len(overdue) // max(1, len(rows))}%)")
    print(f"overdue with consent:   {len(eligible)}  <- what the recall job can work on, all practices")
    print(f"{DEMO_CLINIC}:          {len(demo_all)} patients, {len(demo_eligible)} callable now, {len(coming_due)} more come due in the next 30 days")
    print(f"no consent at all:      {sum(1 for r in rows if not r['consent_for_calls'] and not r['consent_for_sms'])}")
    print(f"diagnoses per patient:  {dict(sorted(Counter(len(r['diagnoses']) for r in rows).items()))}")
    print(f"distinct diagnoses:     {len(dx)}")
    print("most common:            " + ", ".join(f"{k} {v}" for k, v in dx.most_common(6)))
    broken = [r for r in rows if add_months(date.fromisoformat(r["last_appointment"]), r["recommended_followup_months"]).isoformat() != r["next_followup_due"]]
    future = [r for r in rows if r["last_appointment"] > today.isoformat()]
    print(f"rows where due != last + months: {len(broken)}   rows with a last_appointment in the future: {len(future)}")


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Seed synthetic patients into Supabase.")
    parser.add_argument("--dry-run", action="store_true", help="generate and summarize only, write nothing")
    parser.add_argument("--today", help="YYYY-MM-DD, the date used for overdue math (default: today)")
    parser.add_argument("--force", action="store_true", help="run even if the table already looks seeded")
    args = parser.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    rng = random.Random(SEED)

    if args.dry_run:
        doctors = [
            {"id": i + 1, "first_name": "Existing", "last_name": f"Doctor{i + 1}", "specialty": s, "clinic_name": c}
            for i, (c, s) in enumerate(FALLBACK_PRACTICES)
        ]
        new_doctors = plan_doctors(rng, doctors)
        for i, d in enumerate(new_doctors):
            d["id"] = len(doctors) + i + 1
        per_doctor = {d["id"]: 10 for d in doctors}
        demo_rows, bulk_rows = plan_patients(rng, doctors + new_doctors, per_doctor, 251, today)
        demo_ids = {d["id"] for d in doctors + new_doctors if d["clinic_name"] == DEMO_CLINIC}
        print(f"DRY RUN for {today}. Nothing was written. Practice list is the built-in copy, not the database.")
        summarize(new_doctors, demo_rows, bulk_rows, today, demo_ids)
        for label, row in [("demo", demo_rows[2]), ("generated", bulk_rows[0]), ("generated", bulk_rows[-1])]:
            print(f"\nsample {label} row:")
            for k, v in row.items():
                print(f"  {k}: {v}")
        return

    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

    doctors = sb.table("ehr_doctors").select("id, first_name, last_name, specialty, clinic_name").order("id").execute().data
    head = sb.table("ehr_patients").select("id", count="exact").order("id", desc=True).limit(1).execute()
    patient_count = head.count or 0
    max_patient_id = head.data[0]["id"] if head.data else 0
    print(f"found {len(doctors)} doctors and {patient_count} patients (highest patient id {max_patient_id})")

    if patient_count >= ALREADY_SEEDED_THRESHOLD and not args.force:
        sys.exit(f"ehr_patients already has {patient_count} rows, so this looks seeded. Stopping. Use --force to add more anyway.")

    # Count existing patients per doctor so practices are topped up, not overfilled.
    per_doctor = Counter()
    start = 0
    while True:
        page = sb.table("ehr_patients").select("doctor_id").range(start, start + 999).execute().data
        per_doctor.update(r["doctor_id"] for r in page)
        if len(page) < 1000:
            break
        start += 1000

    new_doctors = plan_doctors(rng, doctors)
    if new_doctors:
        inserted = sb.table("ehr_doctors").insert(new_doctors).execute().data
        print(f"inserted {len(inserted)} doctors")
        doctors = doctors + inserted

    demo_rows, bulk_rows = plan_patients(rng, doctors, per_doctor, max_patient_id + 1, today)
    demo_ids = {d["id"] for d in doctors if d["clinic_name"] == DEMO_CLINIC}
    summarize(new_doctors, demo_rows, bulk_rows, today, demo_ids)

    inserted_demo = sb.table("ehr_patients").insert(demo_rows).execute().data
    print("\ndemo patient ids:")
    for r in inserted_demo:
        print(f"  {r['id']:>6}  {r['first_name']} {r['last_name']}")

    done = 0
    for i in range(0, len(bulk_rows), BATCH_SIZE):
        batch = bulk_rows[i:i + BATCH_SIZE]
        sb.table("ehr_patients").insert(batch).execute()
        done += len(batch)
        print(f"inserted {done}/{len(bulk_rows)} patients")

    print("\nFinished.")


if __name__ == "__main__":
    main()
