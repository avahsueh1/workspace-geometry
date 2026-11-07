FROM python:3.12-slim
WORKDIR /app
COPY requirements-photo.txt .
RUN pip install --no-cache-dir -r requirements-photo.txt
COPY scripts ./scripts
RUN python -c "from torchvision.models.detection import ssdlite320_mobilenet_v3_large, SSDLite320_MobileNet_V3_Large_Weights; ssdlite320_mobilenet_v3_large(weights=SSDLite320_MobileNet_V3_Large_Weights.COCO_V1)"
ENV PHOTO_SERVICE_HOST=0.0.0.0
EXPOSE 3140
CMD ["python", "scripts/photo_server.py"]
