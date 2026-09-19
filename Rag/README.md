# Impericus RAG Starter

V1 retrieval pipeline:

1. Check whether the patient is overdue.
2. Route diagnoses to therapeutic-area categories.
3. Build a de-identified clinical query.
4. Embed that query with the same embedding model used for pharma records.
5. Filter pharma records by therapeutic area.
6. Rank them with pgvector cosine similarity / HNSW.
7. Return Top-K records.

## Setup

Run `sql/01_vector_setup.sql` in Supabase.

Then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and add your Supabase URL and service-role key.

Generate all drug embeddings once:

```bash
python embed_drugs.py
```

Test retrieval:

```bash
python rag_agent.py
```

Change the patient ID at the bottom of `rag_agent.py` to test another synthetic patient.
