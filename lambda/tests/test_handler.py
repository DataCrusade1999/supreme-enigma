import boto3
from moto import mock_aws
from looper import handler as handler_module


@mock_aws
def test_handler_downloads_processes_and_uploads(monkeypatch, tmp_path):
    monkeypatch.setattr(handler_module, "TMP_DIR", str(tmp_path))

    bucket = "test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)
    s3.put_object(Bucket=bucket, Key="uploads/song.wav", Body=b"fake-audio-bytes")

    def fake_process(input_path, output_path, target_lufs=-14.0):
        with open(input_path, "rb") as f:
            data = f.read()
        with open(output_path, "wb") as f:
            f.write(data + b"-processed")
        return {"peaks": [0.5, 1.0], "tempo_bpm": 96.0}

    monkeypatch.setattr(handler_module, "process", fake_process)

    result = handler_module.handler(
        {"bucket": bucket, "input_key": "uploads/song.wav", "output_key": "outputs/song.wav"},
        None,
    )

    # The pipeline's metadata rides back out with the key — it is what the page
    # draws the result waveform and the decisions panel from.
    assert result == {
        "output_key": "outputs/song.wav",
        "peaks": [0.5, 1.0],
        "tempo_bpm": 96.0,
    }
    body = s3.get_object(Bucket=bucket, Key="outputs/song.wav")["Body"].read()
    assert body == b"fake-audio-bytes-processed"
