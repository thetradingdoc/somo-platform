"""
YOLO Vision Probe for Video Consult Frames
-----------------------------------------

Offline test script to run YOLO on saved video frames and log detections.

Usage (after installing optional deps in requirements.txt):

  pip install ultralytics opencv-python-headless

  python vc_yolo_probe.py /path/to/frame.jpg
"""

import sys
from pathlib import Path


def main():
    try:
        from ultralytics import YOLO
    except ImportError:
        print("❌ ultralytics not installed. Run: pip install ultralytics opencv-python-headless")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python vc_yolo_probe.py /path/to/frame.jpg")
        sys.exit(1)

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(f"❌ Image not found: {image_path}")
        sys.exit(1)

    # You can swap this for a custom model later
    model_name = "yolov8n.pt"
    print(f"🔍 Loading YOLO model: {model_name}")
    model = YOLO(model_name)

    print(f"🖼  Running detection on {image_path}")
    results = model(str(image_path))

    for r in results:
        print("Detections:")
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = r.names.get(cls_id, f"class_{cls_id}")
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            print(f" - {cls_name} ({conf:.2f}) at [{x1:.0f}, {y1:.0f}, {x2:.0f}, {y2:.0f}]")

    print("✅ YOLO probe complete.")


if __name__ == "__main__":
    main()

