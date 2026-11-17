import os

import boto3

from looper.pipeline import process

s3 = boto3.client("s3")

TMP_DIR = "/tmp"


def handler(event: dict, context) -> dict:
    bucket = event["bucket"]
    input_key = event["input_key"]
    output_key = event["output_key"]

    # The route checks the key too; this holds for a caller that skips the route.
    if not input_key.startswith("uploads/") or ".." in input_key:
        raise ValueError(f"input_key must be under uploads/: {input_key!r}")
    if not output_key.startswith("outputs/") or ".." in output_key:
        raise ValueError(f"output_key must be under outputs/: {output_key!r}")

    ext = os.path.splitext(input_key)[1]
    input_path = os.path.join(TMP_DIR, f"input{ext}")
    output_path = os.path.join(TMP_DIR, f"output{ext}")

    s3.download_file(bucket, input_key, input_path)
    meta = process(input_path, output_path)
    s3.upload_file(output_path, bucket, output_key)

    return {"output_key": output_key, **meta}
