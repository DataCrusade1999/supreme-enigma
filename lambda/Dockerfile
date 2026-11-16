FROM public.ecr.aws/lambda/python:3.12

# The host has answered 200 with a 7 KB body instead of the ~40 MB archive (#126),
# which curl -f counts as success and tar reports as a format error. Check the xz
# magic bytes and the size so the build fails here, naming the download.
RUN dnf install -y tar xz && \
    curl -fL --retry 3 --retry-delay 5 https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz && \
    { [ "$(head -c 6 /tmp/ffmpeg.tar.xz | od -An -tx1 | tr -d ' \n')" = "fd377a585a00" ] || { echo "ffmpeg download is not an xz archive"; exit 1; }; } && \
    { [ "$(stat -c%s /tmp/ffmpeg.tar.xz)" -gt 10000000 ] || { echo "ffmpeg download is under 10 MB"; exit 1; }; } && \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg* && \
    dnf clean all

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/looper ${LAMBDA_TASK_ROOT}/looper

ENV NUMBA_CACHE_DIR=/tmp/numba_cache

CMD ["looper.handler.handler"]
