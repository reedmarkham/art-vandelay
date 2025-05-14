FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

WORKDIR /app

# Install Python and system dependencies
RUN apt-get update && \
    apt-get install -y python3.10 python3-pip git && \
    ln -sf python3.10 /usr/bin/python3 && \
    rm -rf /var/lib/apt/lists/*

COPY . .

# Install Python dependencies (PyTorch with CUDA, etc.)
RUN pip3 install --upgrade pip
RUN pip3 install torch torchvision --extra-index-url https://download.pytorch.org/whl/cu118
RUN pip3 install -r requirements.txt
RUN pip3 install git+https://github.com/openai/CLIP.git

ENTRYPOINT ["python3", "main.py"]