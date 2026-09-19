import os
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

model = SentenceTransformer("Supabase/gte-small")

drugs = (
    supabase.table("pharma_drugs")
    .select("id, rag_text")
    .execute()
    .data
)

print(f"Found {len(drugs)} drugs")

for i, drug in enumerate(drugs, 1):
    text = (drug.get("rag_text") or "").strip()
    if not text:
        continue

    embedding = model.encode(
        text,
        normalize_embeddings=True
    ).tolist()

    (
        supabase.table("pharma_drugs")
        .update({"embedding": embedding})
        .eq("id", drug["id"])
        .execute()
    )

    print(f"[{i}/{len(drugs)}] embedded drug {drug['id']}")

print("Finished embedding pharma_drugs.")
