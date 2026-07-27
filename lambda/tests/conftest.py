import os

# Set dummy AWS credentials at module import time (not inside a fixture):
# looper.handler builds its S3 client at module scope, and pytest imports
# test_handler.py (which imports looper.handler) during collection, before
# any fixture would run. A fixture-based env var set would arrive too late
# for that module-level client, so this must execute at conftest import time.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
