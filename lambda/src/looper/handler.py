import os

import boto3

from looper.pipeline import process

s3 = boto3.client("s3")

TMP_DIR = "/tmp"


def handler(event: dict, context) -> dict:
    bucket = event["bucket"]
    input_key = event["input_key"]
    output_key = event["output_key"]

    ext = os.path.splitext(input_key)[1]
    input_path = os.path.join(TMP_DIR, f"input{ext}")
    output_path = os.path.join(TMP_DIR, f"output{ext}")

    s3.download_file(bucket, input_key, input_path)
    meta = process(input_path, output_path)
    s3.upload_file(output_path, bucket, output_key)

    return {"output_key": output_key, **meta}
