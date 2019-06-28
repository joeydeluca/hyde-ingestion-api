import cv2
import json
import numpy as np
import urllib.request
import urllib.parse
import sys

def handle(event, context):
    if 'image-url' not in event["queryStringParameters"]:
        return {
            'statusCode': 404,
            'body': {'error': 'missing param: image-url'}
        }

    imageUrl = event["queryStringParameters"]['image-url']
    image = url_to_image(urllib.parse.unquote(imageUrl))
    image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    face_cascade = cv2.CascadeClassifier('/opt/cv2/data/haarcascade_frontalface_default.xml')
    faces = face_cascade.detectMultiScale(image, 1.3, 5)

    print("faces detected: " + str(len(faces)))

    return {
        'statusCode': 200,
        'body': len(faces)
    }

# download the image, convert it to a NumPy array, and then read
# it into OpenCV format
def url_to_image(url):
  print("downloading " + url)
  with urllib.request.urlopen(url) as img:
      image = np.asarray(bytearray(img.read()), dtype="uint8")
  image = cv2.imdecode(image, cv2.IMREAD_COLOR)

  return image