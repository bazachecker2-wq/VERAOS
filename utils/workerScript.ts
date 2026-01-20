
export const videoWorkerScript = `
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.17.0/dist/tf-core.min.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.17.0/dist/tf-converter.min.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.17.0/dist/tf-backend-webgl.min.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');

let objectModel = null;
let handModel = null;

self.onmessage = async (event) => {
  const { type, imageBitmap, id, scaleFactor } = event.data;

  if (type === 'load') {
    try {
      // Force aggressive cleanup of WebGL textures
      tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 0);
      
      await tf.setBackend('webgl');
      
      objectModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      
      const model = handPoseDetection.SupportedModels.MediaPipeHands;
      handModel = await handPoseDetection.createDetector(model, {
        runtime: 'tfjs', 
        modelType: 'lite',
        maxHands: 2
      });

      postMessage({ type: 'loaded' });
    } catch (e) {
      postMessage({ type: 'error', error: e.message });
    }
  }

  if (type === 'detect') {
    if (!objectModel || !handModel) {
        if (imageBitmap) imageBitmap.close();
        return;
    }
    
    const result = await tf.tidy(async () => {
        try {
          const tensor = tf.browser.fromPixels(imageBitmap);
          const predictions = [];

          // Lowered threshold from 0.4 to 0.2 to catch more objects faster
          const objects = await objectModel.detect(tensor, 20, 0.2);
          
          objects.forEach(obj => {
              if (obj.class === 'person' || obj.score > 0.3) {
                  predictions.push(obj);
              }
          });

          const hands = await handModel.estimateHands(tensor, { flipHorizontal: false });
          
          hands.forEach(hand => {
              if (hand.score > 0.5) {
                  const { x, y } = hand.keypoints[0];
                  
                  let minX = 10000, minY = 10000, maxX = 0, maxY = 0;
                  hand.keypoints.forEach(kp => {
                      if (kp.x < minX) minX = kp.x;
                      if (kp.y < minY) minY = kp.y;
                      if (kp.x > maxX) maxX = kp.x;
                      if (kp.y > maxY) maxY = kp.y;
                  });
                  
                  const width = maxX - minX;
                  const height = maxY - minY;
                  
                  const gesture = recognizeGesture(hand.keypoints, hand.handedness);

                  predictions.push({
                      class: 'hand',
                      score: hand.score,
                      bbox: [minX, minY, width, height],
                      gesture: gesture
                  });
              }
          });
          
          return predictions;

        } catch (e) {
          return null; 
        }
    });

    if (imageBitmap) imageBitmap.close();
    
    if (result) {
        postMessage({ type: 'result', predictions: result, id, scaleFactor });
    }
  }
};

function recognizeGesture(keypoints, handedness) {
    const isFingerUp = (tipIdx, dipIdx) => {
        return keypoints[tipIdx].y < keypoints[dipIdx].y;
    };

    const thumbUp = keypoints[4].y < keypoints[3].y;
    const indexUp = isFingerUp(8, 6);
    const middleUp = isFingerUp(12, 10);
    const ringUp = isFingerUp(16, 14);
    const pinkyUp = isFingerUp(20, 18);

    let upCount = 0;
    if (indexUp) upCount++;
    if (middleUp) upCount++;
    if (ringUp) upCount++;
    if (pinkyUp) upCount++;

    if (upCount === 4 && thumbUp) return "OPEN PALM";
    if (upCount === 0 && !thumbUp) return "FIST";
    if (indexUp && !middleUp && !ringUp && !pinkyUp) return "POINTING";
    if (indexUp && middleUp && !ringUp && !pinkyUp) return "VICTORY";
    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return "THUMBS UP";

    return "UNKNOWN";
}
`;
