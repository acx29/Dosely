import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

response = (
    supabase
    .table("pharma_drugs")
    .select("id, brand_name")
    .limit(5)
    .execute()
)

print(response.data)