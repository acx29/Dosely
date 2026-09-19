-- Impericus RAG V1
create extension if not exists vector with schema extensions;

alter table public.pharma_drugs
add column if not exists embedding extensions.vector(384);

create index if not exists pharma_drugs_therapeutic_area_idx
on public.pharma_drugs (therapeutic_area);

create index if not exists pharma_drugs_company_id_idx
on public.pharma_drugs (company_id);

create index if not exists pharma_companies_partner_idx
on public.pharma_companies (impericus_partner);

create index if not exists pharma_drugs_embedding_hnsw_idx
on public.pharma_drugs
using hnsw (embedding vector_cosine_ops);

create or replace function public.match_pharma_drugs(
    query_embedding extensions.vector(384),
    filter_areas text[],
    match_count integer default 5
)
returns table (
    drug_id bigint,
    company_id bigint,
    company_name text,
    brand_name text,
    generic_name text,
    drug_class text,
    therapeutic_area text,
    indications text[],
    target_patient_description text,
    clinical_summary text,
    rag_text text,
    similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
    select
        d.id,
        d.company_id,
        c.company_name,
        d.brand_name,
        d.generic_name,
        d.drug_class,
        d.therapeutic_area,
        d.indications,
        d.target_patient_description,
        d.clinical_summary,
        d.rag_text,
        1 - (d.embedding <=> query_embedding) as similarity
    from public.pharma_drugs d
    join public.pharma_companies c on c.id = d.company_id
    where d.embedding is not null
      and c.impericus_partner = true
      and (
          filter_areas is null
          or cardinality(filter_areas) = 0
          or d.therapeutic_area = any(filter_areas)
      )
    order by d.embedding <=> query_embedding
    limit least(greatest(match_count, 1), 20);
$$;
