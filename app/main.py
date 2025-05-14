# Standard library imports
import asyncio
import json
import os
import io

# Third party library imports
import boto3
import torch
import aioboto3
import aiohttp
from PIL import Image
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
import clip  # Requires: pip install git+https://github.com/openai/CLIP.git


BASE_URL = "https://collectionapi.metmuseum.org/public/collection/v1"
OUTPUT_FILE = "met_objects.json"
S3_BUCKET = os.getenv("S3_BUCKET")
CONCURRENT_REQUESTS = 20  # Tunable
OPENSEARCH_DOMAIN_ARN = os.getenv("OPENSEARCH_DOMAIN_ARN")

# Set up OpenSearch client with AWS SigV4 auth
def get_opensearch_client():
    region = OPENSEARCH_DOMAIN_ARN.split(":")[3]
    host = OPENSEARCH_DOMAIN_ARN.split("/")[1]
    credentials = boto3.Session().get_credentials()
    auth = AWSV4SignerAuth(credentials, region)
    return OpenSearch(
        hosts=[{'host': host, 'port': 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection
    )

# Load OpenAI CLIP model and preprocessing
device = "cuda" if torch.cuda.is_available() else "cpu"
clip_model, clip_preprocess = clip.load("ViT-B/32", device=device)

async def fetch_object(session, object_id, semaphore):
    url = f"{BASE_URL}/objects/{object_id}"
    async with semaphore:
        try:
            async with session.get(url, timeout=10) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            return None

async def fetch_and_upload_image(session, s3, object_id, image_url):
    if not image_url or not image_url.lower().endswith('.jpg'):
        return None, None
    try:
        async with session.get(image_url, timeout=20) as resp:
            if resp.status == 200:
                img_bytes = await resp.read()
                key = f"images/{object_id}.jpg"
                await s3.put_object(
                    Bucket=S3_BUCKET,
                    Key=key,
                    Body=img_bytes,
                    ContentType="image/jpeg"
                )
                print(f"Uploaded image {key} to s3://{S3_BUCKET}/")
                return key, img_bytes
    except Exception:
        pass
    return None, None

def get_image_embedding(img_bytes):
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        img_input = clip_preprocess(img).unsqueeze(0).to(device)
        with torch.no_grad():
            embedding = clip_model.encode_image(img_input)
        embedding = embedding.squeeze().cpu().numpy().tolist()
        return embedding
    except Exception:
        return None

async def upload_to_s3(data, bucket, key):
    session = aioboto3.Session()
    async with session.client("s3") as s3:
        await s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType="application/json"
        )
    print(f"Uploaded {key} to s3://{bucket}/")

def upload_embedding_to_opensearch(object_id, embedding, opensearch_client):
    try:
        doc = {
            "objectID": object_id,
            "embedding": embedding
        }
        opensearch_client.index(index="art-vandelay-embeddings", id=object_id, body=doc)
        print(f"Uploaded embedding for object {object_id} to OpenSearch")
    except Exception as e:
        print(f"Failed to upload embedding for {object_id}: {e}")

async def main():
    opensearch_client = get_opensearch_client()

    # Step 1: Get object IDs
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{BASE_URL}/objects") as resp:
            data = await resp.json()
            object_ids = data.get("objectIDs", [])
            print(f"Found {len(object_ids)} objects.")

        # Step 2: Fetch objects concurrently
        semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
        tasks = [
            fetch_object(session, oid, semaphore)
            for oid in object_ids
        ]

        objects = []
        session_boto = aioboto3.Session()
        async with session_boto.client("s3") as s3:
            for i, coro in enumerate(asyncio.as_completed(tasks), 1):
                obj = await coro
                if obj:
                    image_url = obj.get("primaryImage")
                    image_key, img_bytes = await fetch_and_upload_image(session, s3, obj["objectID"], image_url)
                    if image_key:
                        obj["s3ImageKey"] = image_key
                        # Generate and upload embedding
                        embedding = get_image_embedding(img_bytes)
                        if embedding:
                            upload_embedding_to_opensearch(obj["objectID"], embedding, opensearch_client)
                    objects.append(obj)
                if i % 100 == 0:
                    print(f"Fetched {i} objects...")

        # Step 3: Upload JSON to S3
        await upload_to_s3(objects, S3_BUCKET, OUTPUT_FILE)

if __name__ == "__main__":
    asyncio.run(main())