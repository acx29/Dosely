import os
from datetime import date

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from supabase import create_client
from google import genai


# ------------------------------------------------------------
# SETUP
# ------------------------------------------------------------

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

model = SentenceTransformer("Supabase/gte-small")

gemini = genai.Client()


# ------------------------------------------------------------
# DIAGNOSIS -> THERAPEUTIC AREA ROUTING
# ------------------------------------------------------------

DIAGNOSIS_TO_AREAS = {
    "Type 2 Diabetes": ["Endocrinology", "Metabolic Disease"],
    "Type 1 Diabetes": ["Endocrinology"],
    "Prediabetes": ["Endocrinology", "Metabolic Disease"],
    "Obesity": ["Metabolic Disease", "Endocrinology"],
    "Hypothyroidism": ["Endocrinology"],
    "Hyperthyroidism": ["Endocrinology"],
    "Osteoporosis": ["Endocrinology"],

    "Hypertension": ["Cardiology", "Primary Care"],
    "Hyperlipidemia": ["Cardiology", "Metabolic Disease"],
    "Coronary Artery Disease": ["Cardiology"],
    "Atrial Fibrillation": ["Cardiology"],
    "Heart Failure with Reduced Ejection Fraction": ["Cardiology"],
    "Stable Angina": ["Cardiology"],
    "Peripheral Artery Disease": ["Cardiology"],

    "Asthma": ["Pulmonology", "Primary Care"],
    "Allergic Asthma": ["Pulmonology"],
    "Exercise-Induced Asthma": ["Pulmonology"],
    "COPD": ["Pulmonology"],
    "Chronic Bronchitis": ["Pulmonology"],
    "Obstructive Sleep Apnea": ["Pulmonology"],

    "Migraine": ["Neurology"],
    "Epilepsy": ["Neurology"],
    "Essential Tremor": ["Neurology"],
    "Neuropathic Pain": ["Neurology"],
    "Peripheral Neuropathy": ["Neurology"],
    "Parkinson Disease": ["Neurology"],
    "Restless Legs Syndrome": ["Neurology"],

    "GERD": ["Gastroenterology", "Primary Care"],
    "Irritable Bowel Syndrome": ["Gastroenterology"],
    "Ulcerative Colitis": ["Gastroenterology"],
    "Crohn Disease": ["Gastroenterology"],
    "Chronic Constipation": ["Gastroenterology"],
    "Nonalcoholic Fatty Liver Disease": [
        "Gastroenterology",
        "Metabolic Disease"
    ],

    "Rheumatoid Arthritis": ["Rheumatology"],
    "Psoriatic Arthritis": ["Rheumatology"],
    "Osteoarthritis": ["Rheumatology", "Primary Care"],
    "Gout": ["Rheumatology"],
    "Systemic Lupus Erythematosus": ["Rheumatology"],
    "Ankylosing Spondylitis": ["Rheumatology"],

    "Generalized Anxiety Disorder": ["Primary Care"],
}


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


# ------------------------------------------------------------
# CATEGORY ROUTING
# ------------------------------------------------------------

def route_categories(patient, doctor):
    areas = []

    for diagnosis in patient.get("diagnoses") or []:
        areas.extend(
            DIAGNOSIS_TO_AREAS.get(diagnosis, [])
        )

    doctor_area = SPECIALTY_TO_AREA.get(
        doctor.get("specialty")
    )

    if doctor_area:
        areas.append(doctor_area)

    # Remove duplicates while keeping original order
    return list(dict.fromkeys(areas))


# ------------------------------------------------------------
# BUILD PATIENT TEXT FOR EMBEDDING
# ------------------------------------------------------------

def build_patient_context(patient):
    diagnoses = patient.get("diagnoses") or []
    prescriptions = patient.get(
        "current_prescriptions"
    ) or []

    notes = patient.get("relevant_notes") or ""

    # Remove operational overdue information from
    # semantic drug matching
    if "Follow-up is currently" in notes:
        notes = notes.split(
            "Follow-up is currently"
        )[0].strip()

    return f"""Clinical diagnoses:
{", ".join(diagnoses)}

Current medications:
{", ".join(prescriptions) if prescriptions else "None listed"}

Relevant clinical notes:
{notes}
""".strip()


# ------------------------------------------------------------
# DATABASE LOOKUPS
# ------------------------------------------------------------

def get_patient(patient_id):
    return (
        supabase
        .table("ehr_patients")
        .select(
            "id, doctor_id, diagnoses, "
            "current_prescriptions, relevant_notes, "
            "next_followup_due"
        )
        .eq("id", patient_id)
        .single()
        .execute()
        .data
    )


def get_doctor(doctor_id):
    return (
        supabase
        .table("ehr_doctors")
        .select("id, specialty")
        .eq("id", doctor_id)
        .single()
        .execute()
        .data
    )


# ------------------------------------------------------------
# OVERDUE CHECK
# ------------------------------------------------------------

def is_overdue(patient):
    due = patient.get("next_followup_due")

    return bool(
        due and due < date.today().isoformat()
    )


# ------------------------------------------------------------
# RETRIEVAL
# ------------------------------------------------------------

def retrieve_drugs(patient, doctor, top_k=5):
    areas = route_categories(
        patient,
        doctor
    )

    context = build_patient_context(
        patient
    )

    # Convert patient clinical context into vector
    query_embedding = model.encode(
        context,
        normalize_embeddings=True
    ).tolist()

    # SQL metadata filtering +
    # vector similarity search +
    # Top-K retrieval
    matches = (
        supabase
        .rpc(
            "match_pharma_drugs",
            {
                "query_embedding": query_embedding,
                "filter_areas": areas,
                "match_count": top_k,
            },
        )
        .execute()
        .data
    )

    return context, areas, matches


# ------------------------------------------------------------
# GEMINI GENERATION
# ------------------------------------------------------------

def generate_match_explanation(
        patient_context,
        drug
):
    prompt = f"""
You are generating a short explanation for a physician-facing
section called "Sponsored Pharmaceutical Matches."

PATIENT CLINICAL CONTEXT:

{patient_context}


SPONSORED PHARMACEUTICAL RECORD:

Drug:
{drug['brand_name']}

Drug class:
{drug['drug_class']}

Therapeutic area:
{drug['therapeutic_area']}

Indications:
{drug['indications']}

Target patient description:
{drug['target_patient_description']}

Clinical summary:
{drug['clinical_summary']}


TASK:

In 1-2 sentences, explain why this sponsored pharmaceutical
record was surfaced based only on the supplied patient context.

RULES:

- Do not recommend the drug.
- Do not prescribe treatment.
- Do not say the patient should receive the drug.
- Do not make a clinical decision.
- Do not invent patient information.
- Only explain the contextual overlap between the patient
  record and pharmaceutical record.
- If the drug's listed indication directly matches a patient diagnosis,
  explicitly say that it is a direct indication match.
- If the indication does not directly match any patient diagnosis,
  explicitly state that there is no direct indication match and explain
  only the broader contextual similarity.
- Never imply that a drug is indicated for the patient's condition
  unless that indication appears in the supplied pharmaceutical record.
"""

    response = gemini.models.generate_content(
        model="gemini-3.8-flash",
        contents=prompt
    )

    return response.text.strip()


# ------------------------------------------------------------
# MAIN RAG PIPELINE FOR ONE PATIENT
# ------------------------------------------------------------

def run_for_patient(
        patient_id,
        top_k=5
):
    patient = get_patient(
        patient_id
    )

    doctor = get_doctor(
        patient["doctor_id"]
    )

    print(
        f"\nPatient ID: {patient_id}"
    )

    # ----------------------------------
    # Step 1: Overdue gate
    # ----------------------------------

    if not is_overdue(patient):
        print(
            "Patient is not overdue. Stop."
        )
        return

    print(
        "Patient is overdue. Continuing."
    )

    # ----------------------------------
    # Step 2-4:
    # category routing
    # metadata filtering
    # vector retrieval
    # ----------------------------------

    context, areas, matches = retrieve_drugs(
        patient,
        doctor,
        top_k
    )

    print(
        "\nCATEGORY FILTER:"
    )

    print(areas)

    print(
        "\nEMBEDDED PATIENT CONTEXT:"
    )

    print(context)

    print(
        f"\nSPONSORED PHARMACEUTICAL MATCHES:"
    )

    # ----------------------------------
    # Step 5:
    # Gemini generation
    # ----------------------------------

    for rank, drug in enumerate(
            matches,
            1
    ):
        explanation = (
            generate_match_explanation(
                context,
                drug
            )
        )

        print(
            f"\n{rank}. "
            f"{drug['brand_name']}"
        )

        print(
            f"Company: "
            f"{drug['company_name']}"
        )

        print(
            f"Therapeutic Area: "
            f"{drug['therapeutic_area']}"
        )

        print(
            f"Drug Class: "
            f"{drug['drug_class']}"
        )

        print(
            f"Indications: "
            f"{drug['indications']}"
        )

        print(
            f"Similarity: "
            f"{drug['similarity']:.4f}"
        )

        print(
            "Why surfaced:"
        )

        print(explanation)


# ------------------------------------------------------------
# TEST
# ------------------------------------------------------------

if __name__ == "__main__":
    run_for_patient(
        patient_id=198,
        top_k=5
    )