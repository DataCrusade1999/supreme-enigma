FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y tar xz && \
    curl -fL --retry 3 --retry-delay 5 https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz && \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/looper ${LAMBDA_TASK_ROOT}/looper

ENV NUMBA_CACHE_DIR=/tmp/numba_cache

CMD ["looper.handler.handler"]
