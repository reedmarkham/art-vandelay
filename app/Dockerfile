# Use a lightweight base image
FROM python:alpine

# Set the working directory
WORKDIR /app

# Copy the application code
COPY . .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Set the entrypoint script
ENTRYPOINT ["python", "main.py"]