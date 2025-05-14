# Standard library imports
import asyncio
import json
import os

# Third-party library imports
import aioboto3
import aiohttp

BASE_URL = "https://collectionapi.metmuseum.org/public/collection/v1"
OUTPUT_FILE = "met_objects.json"
S3_BUCKET = os.getenv("S3_BUCKET")
CONCURRENT_REQUESTS = 20  # Tunable

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
        return None
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
                return key
    except Exception:
        pass
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

async def main():
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
                    # Download and upload image if available
                    image_url = obj.get("primaryImage")
                    image_key = await fetch_and_upload_image(session, s3, obj["objectID"], image_url)
                    if image_key:
                        obj["s3ImageKey"] = image_key
                    objects.append(obj)
                if i % 100 == 0:
                    print(f"Fetched {i} objects...")

        # Step 3: Upload JSON to S3
        await upload_to_s3(objects, S3_BUCKET, OUTPUT_FILE)

if __name__ == "__main__":
    asyncio.run(main())