
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { TrackedObject, Vector3, ZoomState, AiAnnotation, AnalysisMode } from '../types';
import { videoWorkerScript } from '../utils/workerScript';
import { Cpu, Activity } from 'lucide-react';

interface VisionSystemProps {
  isActive: boolean;
  zoomState: ZoomState;
  activeDeviceId: string;
  localObjects: TrackedObject[];
  remoteObjects: TrackedObject[];
  aiAnnotations: AiAnnotation[];
  sceneDescription: string;
  analysisMode: AnalysisMode;
  onUpdateLocalObjects: (objects: TrackedObject[]) => void;
  onSceneChange: (summary: string) => void;
  onFrameCapture?: (base64: string, quality: number) => void;
  onDeepAnalysis?: (object: TrackedObject) => void;
  onCameraReady?: (capabilities: MediaTrackCapabilities) => void;
  onError: (error: string) => void;
}

interface PhysicsState {
    current: Vector3;
    target: Vector3;
    velocity: Vector3;
    scale: number;
}

interface TrackerState {
  id: string | number;
  class: string;
  isRemote: boolean;
  color: number;
  lastSeenTime: number;
  consecutiveMisses: number;
  opacity: number;
  lockedBox: [number, number, number, number];
  physics: PhysicsState;
  scanProgress: number;
  hasLidarScan: boolean;
  gesture?: string;
  rotationOffset: number;
  lastLabelUpdate?: string; 
  displayDist: number; // Smoothed distance for display
}

interface LoadingState {
    active: boolean;
    progress: number;
    stage: string;
}

const getRealWorldHeight = (cls: string): number => {
    const map: Record<string, number> = {
        person: 1.70, cup: 0.15, bottle: 0.25, wine_glass: 0.20, bowl: 0.15,
        chair: 1.0, couch: 0.9, potted_plant: 0.5, tv: 0.7, laptop: 0.3,
        mouse: 0.05, remote: 0.15, keyboard: 0.05, cell_phone: 0.15, book: 0.25,
        vase: 0.3, hand: 0.20
    };
    return map[cls.toLowerCase()] || 0.5;
};

// Device capability detection
const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const VisionSystem: React.FC<VisionSystemProps> = ({
  isActive,
  zoomState,
  activeDeviceId,
  localObjects,
  remoteObjects,
  aiAnnotations,
  sceneDescription,
  analysisMode,
  onUpdateLocalObjects,
  onSceneChange,
  onFrameCapture,
  onDeepAnalysis,
  onCameraReady,
  onError
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  
  const labelsRef = useRef<Map<string | number, THREE.Group>>(new Map());
  const aiLabelsRef = useRef<Map<string, THREE.Group>>(new Map());
  const trackersRef = useRef<Map<string | number, TrackerState>>(new Map());
  const lidarPointsRef = useRef<THREE.Points | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  const nextIdRef = useRef(1);
  const animationFrameRef = useRef<number>();
  const lastCaptureTimeRef = useRef(0);
  const prevSceneDescRef = useRef(sceneDescription);
  const [scanActive, setScanActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const isLidarAvailableRef = useRef(false);

  const lastObjectSetRef = useRef<string>("");
  const lastAnalysisTimeRef = useRef<number>(0);
  
  const networkQualityRef = useRef<number>(1.0); 
  const processingIntervalRef = useRef<number>(200); 
  const previousFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const isMovingFastRef = useRef<boolean>(false);
  const motionTimeoutRef = useRef<any>(null);

  // Loading State for Modules
  const [loadingState, setLoadingState] = useState<LoadingState>({ active: true, progress: 0, stage: 'INIT' });

  useEffect(() => {
    if (videoRef.current) {
        videoRef.current.style.transformOrigin = `${zoomState.x}% ${zoomState.y}%`;
        videoRef.current.style.transform = `scale(${zoomState.level})`;
    }
    if (cameraRef.current) {
        cameraRef.current.fov = 75 / zoomState.level;
        cameraRef.current.updateProjectionMatrix();
    }
  }, [zoomState]);

  useEffect(() => {
      if (sceneDescription !== prevSceneDescRef.current) {
          prevSceneDescRef.current = sceneDescription;
          // Trigger visual scan sweep on analysis change
          setScanActive(true);
          setTimeout(() => setScanActive(false), 1000);
      }
  }, [sceneDescription]);

  useEffect(() => {
    const blob = new Blob([videoWorkerScript], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    workerRef.current = worker;
    worker.postMessage({ type: 'load' });
    worker.onmessage = (e) => {
        const { type, predictions, error, scaleFactor, progress, stage } = e.data;
        
        if (type === 'progress') {
            setLoadingState({ active: true, progress, stage });
        }
        if (type === 'loaded') {
            console.log("AI Worker Loaded");
            setLoadingState({ active: false, progress: 100, stage: 'READY' });
        }
        if (type === 'error') {
            console.warn("Worker Error", error);
            setLoadingState({ active: true, progress: 0, stage: 'ERROR' });
        }
        if (type === 'result') handleWorkerPredictions(predictions, scaleFactor);
    };

    const updateNetworkStats = () => {
        const isMobile = isMobileDevice();
        // Adjust processing interval based on device capabilities
        let baseInterval = isMobile ? 300 : 150; // Slower on mobile to save battery

        if (navigator.connection) {
            const down = navigator.connection.downlink; 
            if (down < 2) {
                networkQualityRef.current = 0.3;
                processingIntervalRef.current = baseInterval * 2; 
            } else if (down < 5) {
                networkQualityRef.current = 0.6;
                processingIntervalRef.current = baseInterval * 1.5; 
            } else {
                networkQualityRef.current = 0.8;
                processingIntervalRef.current = baseInterval; 
            }
        } else {
            processingIntervalRef.current = baseInterval;
        }
    };
    if (navigator.connection) {
        navigator.connection.addEventListener('change', updateNetworkStats);
        updateNetworkStats();
    } else {
        updateNetworkStats();
    }

    return () => {
        worker.terminate();
        if (navigator.connection) navigator.connection.removeEventListener('change', updateNetworkStats);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const switchCamera = async () => {
        if (!isActive) return;
        try {
            const isMobile = isMobileDevice();
            
            // Adaptive Constraints based on device
            const constraints: MediaStreamConstraints = {
                video: {
                    deviceId: activeDeviceId ? { exact: activeDeviceId } : undefined,
                    width: isMobile ? { ideal: 640 } : { ideal: 1280 }, 
                    height: isMobile ? { ideal: 480 } : { ideal: 720 },
                    frameRate: isMobile ? { ideal: 24, max: 30 } : { ideal: 30, max: 60 }
                }
            };

            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (isCancelled) {
                newStream.getTracks().forEach(t => t.stop());
                return;
            }
            const track = newStream.getVideoTracks()[0];
            const caps = track.getCapabilities();
            const label = track.label.toLowerCase();
            isLidarAvailableRef.current = (label.includes('back') && (caps as any).focusMode) || label.includes('lidar') || label.includes('depth');
            if (onCameraReady) onCameraReady(caps);
            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                await videoRef.current.play();
            }
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = newStream;
            if (!sceneRef.current) { initThreeJS(); startLoops(); }
        } catch (err: any) {
            if (!isCancelled) onError('ОШИБКА КАМЕРЫ: ' + err.message);
        }
    };
    switchCamera();
    return () => { isCancelled = true; };
  }, [activeDeviceId, isActive]);

  useEffect(() => {
      return () => {
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
          if (rendererRef.current) {
             rendererRef.current.dispose();
             containerRef.current?.removeChild(rendererRef.current.domElement);
          }
      }
  }, []);

  const initThreeJS = () => {
    if (!containerRef.current) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
    camera.position.set(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    Object.assign(renderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', zIndex: '10' });
    containerRef.current.appendChild(renderer.domElement);
    
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
  };

  const detectMotion = (ctx: CanvasRenderingContext2D, width: number, height: number): boolean => {
      const centerData = ctx.getImageData(width/2 - 25, height/2 - 25, 50, 50).data;
      let diff = 0;
      if (previousFrameDataRef.current) {
          for (let i = 0; i < centerData.length; i += 16) {
              diff += Math.abs(centerData[i] - previousFrameDataRef.current[i]);
          }
          if (diff > 50000) return true;
      }
      previousFrameDataRef.current = centerData;
      return false;
  };

  const startLoops = () => {
      const sendFrame = async () => {
          if (!videoRef.current || !workerRef.current || videoRef.current.readyState < 2) {
              requestAnimationFrame(sendFrame);
              return;
          }
          const video = videoRef.current;
          
          // Adaptive Analysis Resolution: Smaller on mobile for performance
          const isMobile = isMobileDevice();
          const qualityMultiplier = networkQualityRef.current < 0.5 ? 0.7 : 1.0;
          const ANALYSIS_WIDTH = isMobile ? 240 : (320 * qualityMultiplier);

          try {
             if (motionTimeoutRef.current) clearTimeout(motionTimeoutRef.current);
             const bitmap = await createImageBitmap(video, { resizeWidth: ANALYSIS_WIDTH, resizeQuality: 'low' });
             const scaleFactor = video.videoWidth / ANALYSIS_WIDTH;
             if (!isMovingFastRef.current) {
                workerRef.current.postMessage({ type: 'detect', imageBitmap: bitmap, scaleFactor }, [bitmap]);
             } else { bitmap.close(); }
          } catch (e) {}
          
          const now = Date.now();
          if (now - lastCaptureTimeRef.current > 1000 && onFrameCapture) {
             const snapCanvas = document.createElement('canvas');
             const scale = networkQualityRef.current; 
             snapCanvas.width = video.videoWidth * scale;
             snapCanvas.height = video.videoHeight * scale;
             const sCtx = snapCanvas.getContext('2d');
             if(sCtx) {
                 sCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
                 const isMoving = detectMotion(sCtx, snapCanvas.width, snapCanvas.height);
                 if (isMoving) {
                     isMovingFastRef.current = true;
                     setTimeout(() => { isMovingFastRef.current = false; }, 500);
                 }
                 const jpgQuality = isMoving ? 0.3 : (networkQualityRef.current * 0.7);
                 const base64 = snapCanvas.toDataURL('image/jpeg', jpgQuality).split(',')[1];
                 onFrameCapture(base64, jpgQuality);
             }
             lastCaptureTimeRef.current = now;
          }
          setTimeout(() => requestAnimationFrame(sendFrame), processingIntervalRef.current); 
      };
      sendFrame();
      renderLoop();
  };

  const checkSceneChange = (currentIds: string[], classes: string[]) => {
      const now = Date.now();
      if (now - lastAnalysisTimeRef.current < 2000) return; 

      const currentSetSig = classes.sort().join(',');
      if (currentSetSig !== lastObjectSetRef.current) {
          // Defer analysis to next tick to allow rendering to proceed
          setTimeout(() => {
              const counts: Record<string, number> = {};
              classes.forEach(c => counts[c] = (counts[c] || 0) + 1);
              const summary = Object.entries(counts).map(([k,v]) => `${k.toUpperCase()} x${v}`).join(', ');
              
              if (analysisMode === 'AUTO' || analysisMode === 'DETAILED') {
                  onSceneChange(summary ? `ДИНАМИКА: ${summary}` : "СКАНИРОВАНИЕ...");
              }
          }, 0);
          lastObjectSetRef.current = currentSetSig;
      }
      lastAnalysisTimeRef.current = now;
  };

  const handleWorkerPredictions = (predictions: any[], scaleFactor: number) => {
      const now = Date.now();
      if (isMovingFastRef.current) return;

      const availableTrackers = new Set<string | number>(trackersRef.current.keys());
      const currentClasses: string[] = [];
      const activeIds = new Set<string | number>();

      predictions.forEach((pred: any) => {
          if (pred.score < 0.2) return; 
          currentClasses.push(pred.class);
          const scaledBbox = [ pred.bbox[0] * scaleFactor, pred.bbox[1] * scaleFactor, pred.bbox[2] * scaleFactor, pred.bbox[3] * scaleFactor ];
          let bestId = null;
          let bestDist = 200; 
          availableTrackers.forEach(tid => {
              const t = trackersRef.current.get(tid)!;
              if (t.class !== pred.class) return;
              const dist = Math.sqrt(Math.pow(scaledBbox[0]-t.lockedBox[0],2) + Math.pow(scaledBbox[1]-t.lockedBox[1],2));
              if(dist < bestDist) { bestDist = dist; bestId = tid; }
          });

          if(bestId) {
             const t = trackersRef.current.get(bestId)!;
             const lerpFactor = processingIntervalRef.current > 300 ? 0.5 : 0.4;
             t.lockedBox[0] += (scaledBbox[0] - t.lockedBox[0]) * lerpFactor;
             t.lockedBox[1] += (scaledBbox[1] - t.lockedBox[1]) * lerpFactor;
             t.lockedBox[2] += (scaledBbox[2] - t.lockedBox[2]) * lerpFactor;
             t.lockedBox[3] += (scaledBbox[3] - t.lockedBox[3]) * lerpFactor;
             t.lastSeenTime = now;
             t.consecutiveMisses = 0;
             t.gesture = pred.gesture;
             t.opacity = 1.0;
             
             availableTrackers.delete(bestId);
             activeIds.add(bestId);
          } else {
             const newId = nextIdRef.current++;
             const color = pred.class === 'hand' ? 0xFFD700 : 0x00FF00;
             createLabel(newId, pred.class, color);
             trackersRef.current.set(newId, {
                 id: newId, class: pred.class, isRemote: false, color: color, lastSeenTime: now, consecutiveMisses: 0, 
                 opacity: 1.0, 
                 lockedBox: scaledBbox as any, physics: { current: {x:0,y:0,z:-10}, target: {x:0,y:0,z:-10}, velocity: {x:0,y:0,z:0}, scale: 0.1 },
                 scanProgress: 0, hasLidarScan: isLidarAvailableRef.current, gesture: pred.gesture, rotationOffset: Math.random(),
                 displayDist: 0
             });
             activeIds.add(newId);
          }
      });
      checkSceneChange(Array.from(activeIds).map(String), currentClasses);
  };

  const renderLoop = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !videoRef.current) return;
      updateVisualsAndPhysics();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animationFrameRef.current = requestAnimationFrame(renderLoop);
  };

  const updateVisualsAndPhysics = () => {
      const now = Date.now();
      const videoW = videoRef.current?.videoWidth || 1280;
      const videoH = videoRef.current?.videoHeight || 720;
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      const nextLocalObjects: TrackedObject[] = [];
      const trackers: TrackerState[] = Array.from(trackersRef.current.values());

      trackers.forEach(tracker => {
           const calc = calculate3DPosition(tracker.lockedBox, tracker.class, videoW, videoH, width, height);
           tracker.physics.target = { x: calc.x, y: calc.y, z: calc.z };
           const speed = isMovingFastRef.current ? 0.9 : 0.2; 
           tracker.physics.current.x += (tracker.physics.target.x - tracker.physics.current.x) * speed;
           tracker.physics.current.y += (tracker.physics.target.y - tracker.physics.current.y) * speed;
           tracker.physics.current.z += (tracker.physics.target.z - tracker.physics.current.z) * speed;
           tracker.rotationOffset += 0.05;
           const isLost = now - tracker.lastSeenTime > 500;
           
           if (isLost) tracker.opacity -= 0.05;
           if (tracker.opacity < 0.05 && isLost) { removeTracker(tracker.id); return; }
           
           if (tracker.scanProgress > 0 && tracker.scanProgress < 1) {
               tracker.scanProgress += 0.01;
               if(tracker.scanProgress > 1) tracker.scanProgress = 1;
           }

           const propObj = localObjects.find(o => o.id === tracker.id);
           const isSelected = propObj?.isSelected || false;
           
           nextLocalObjects.push({
               id: tracker.id, class: tracker.class, confidence: 1, bbox: tracker.lockedBox, position3D: tracker.physics.current,
               distance: Math.abs(tracker.physics.current.z), lastSeen: now, isOccluded: false, isSelected: isSelected,
               depthSource: isLidarAvailableRef.current ? 'LIDAR_FUSION' : 'AI_ESTIMATE', gesture: tracker.gesture,
               scanProgress: tracker.scanProgress
           });
      });

      nextLocalObjects.sort((a, b) => b.position3D.z - a.position3D.z);
      
      nextLocalObjects.forEach(obj => {
          const tracker = trackersRef.current.get(obj.id);
          const g = labelsRef.current.get(obj.id);
          if (tracker && g) {
              g.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
              
              const bracketGroup = g.getObjectByName('BRACKET');
              const textSprite = g.getObjectByName('TEXT');
              const reticle = g.getObjectByName('RETICLE');
              const progressGroup = g.getObjectByName('PROGRESS');
              
              if (bracketGroup && textSprite) {
                  let color = tracker.color;
                  if (obj.isSelected) color = 0xFF0000;
                  else if (obj.class === 'hand') color = 0xFFD700;
                  else if (isLidarAvailableRef.current) color = 0x00FFFF;
                  
                  bracketGroup.children.forEach((corner: any) => {
                      if(corner.children) {
                          corner.children.forEach((bar: any) => {
                              if(bar.material) {
                                  bar.material.color.setHex(color);
                                  bar.material.opacity = (obj.isOccluded ? 0.3 : 1.0) * tracker.opacity;
                              }
                          });
                      }
                  });
                  
                  const spriteMesh = textSprite as THREE.Sprite;
                  if (spriteMesh.material) {
                       spriteMesh.material.opacity = tracker.opacity;
                  }

                  const dist = Math.abs(obj.position3D.z);
                  // Smooth distance to prevent jitter in numbers
                  tracker.displayDist = tracker.displayDist ? tracker.displayDist * 0.9 + dist * 0.1 : dist;

                  const scale = Math.max(0.4, dist / 6);
                  g.scale.setScalar(scale); 
                  
                  // Update label content logic
                  const contentSig = `${obj.class}-${obj.gesture}-${Math.floor(tracker.displayDist * 10)}`; 
                  if (tracker.lastLabelUpdate !== contentSig) {
                       updateLabelTexture(spriteMesh, obj.class, obj.gesture, tracker.displayDist, color);
                       tracker.lastLabelUpdate = contentSig;
                  }
              }

              if (reticle) {
                  if (obj.isSelected) {
                      reticle.visible = true;
                      reticle.rotation.z -= 0.1;
                      (reticle as any).material.opacity = tracker.opacity;
                      (reticle as any).scale.setScalar(1.5 + Math.sin(now * 0.01) * 0.2);
                  } else {
                      reticle.visible = false;
                  }
              }
              
              if (progressGroup) {
                  if (analysisMode === 'DETAILED' && obj.scanProgress && obj.scanProgress > 0 && obj.scanProgress < 1) {
                      progressGroup.visible = true;
                      const fg = progressGroup.getObjectByName('PROGRESS_BAR');
                      if (fg) fg.scale.setX(obj.scanProgress);
                  } else {
                      progressGroup.visible = false;
                  }
              }
          }
      });
      onUpdateLocalObjects(nextLocalObjects);
  };

  const calculate3DPosition = (bbox: number[], cls: string, videoW: number, videoH: number, screenW: number, screenH: number) => {
      const [x, y, w, h] = bbox;
      const videoRatio = videoW / videoH;
      const screenRatio = screenW / screenH;
      let renderW, renderH, offsetX, offsetY;
      if (screenRatio > videoRatio) {
          renderW = screenW; renderH = screenW / videoRatio;
          offsetX = 0; offsetY = (screenH - renderH) / 2;
      } else {
          renderH = screenH; renderW = screenH * videoRatio;
          offsetX = (screenW - renderW) / 2; offsetY = 0;
      }
      const scaleX = renderW / videoW;
      const scaleY = renderH / videoH;
      const screenBoxCenterX = (x * scaleX + offsetX) + (w * scaleX) / 2;
      const screenBoxCenterY = (y * scaleY + offsetY) + (h * scaleY) / 2;
      const ndcX = (screenBoxCenterX / screenW) * 2 - 1;
      const ndcY = -(screenBoxCenterY / screenH) * 2 + 1;
      const realHeight = getRealWorldHeight(cls);
      const projectedHeight = h * scaleY;
      const screenHeightFraction = projectedHeight / screenH;
      const fovRad = THREE.MathUtils.degToRad(cameraRef.current?.fov || 75);
      let z = (realHeight / screenHeightFraction) / (2 * Math.tan(fovRad / 2));
      z = Math.max(1.5, Math.min(50.0, z)); 
      z = -z;
      const visibleHeightAtZ = 2 * Math.abs(z) * Math.tan(fovRad / 2);
      const visibleWidthAtZ = visibleHeightAtZ * (screenW / screenH);
      const worldX = (ndcX * visibleWidthAtZ) / 2;
      const worldY = (ndcY * visibleHeightAtZ) / 2;
      return { x: worldX, y: worldY, z };
  };

  const removeTracker = (id: string | number) => {
      const g = labelsRef.current.get(id);
      if(g) {
          sceneRef.current?.remove(g);
          g.traverse((c) => { 
              if((c as any).geometry) (c as any).geometry.dispose();
              if((c as any).material) {
                  if(Array.isArray((c as any).material)) (c as any).material.forEach((m:any) => m.dispose());
                  else (c as any).material.dispose();
              } 
          });
      }
      labelsRef.current.delete(id);
      trackersRef.current.delete(id);
  };

  const updateLabelTexture = (sprite: THREE.Sprite, cls: string, gesture: string | undefined, distance: number, colorHex: number) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      if (!mat || !mat.map) return;
      const canvas = mat.map.image as HTMLCanvasElement;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(canvas.width - 40, 40);
      ctx.lineTo(canvas.width, 80); 
      ctx.lineTo(canvas.width, 120);
      ctx.lineTo(0, 120);
      ctx.fill();
      
      ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(canvas.width - 40, 40);
      ctx.lineTo(canvas.width, 80);
      ctx.stroke();

      ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.font = 'bold 50px "Rajdhani", sans-serif'; 
      ctx.shadowColor = "black";
      ctx.shadowBlur = 4;
      
      let text = cls.toUpperCase();
      if (gesture && gesture !== 'UNKNOWN') text = `[${gesture}]`;
      ctx.fillText(text, 20, 95);

      ctx.font = '30px "Rajdhani", sans-serif';
      ctx.fillStyle = '#AAAAAA';
      ctx.fillText(`DIST: ${distance.toFixed(1)}m`, 20, 115);

      mat.map.needsUpdate = true;
  };

  const createLabel = (id: string | number, cls: string, color: number) => {
     const g = new THREE.Group();
     
     const bracketGroup = new THREE.Group();
     bracketGroup.name = 'BRACKET';
     const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 });
     const s = 0.5; const len = 0.2; const thick = 0.03; // Thicker and longer for visibility

     const createCorner = (x: number, y: number, xDir: number, yDir: number) => {
         const cGroup = new THREE.Group();
         const hBar = new THREE.Mesh(new THREE.BoxGeometry(len, thick, thick), mat);
         hBar.position.set(x - (len/2 * xDir), y, 0);
         const vBar = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick), mat);
         vBar.position.set(x, y - (len/2 * yDir), 0);
         cGroup.add(hBar); cGroup.add(vBar);
         return cGroup;
     };

     bracketGroup.add(createCorner(s, s, 1, 1));     
     bracketGroup.add(createCorner(-s, s, -1, 1));   
     bracketGroup.add(createCorner(s, -s, 1, -1));   
     bracketGroup.add(createCorner(-s, -s, -1, -1)); 
     g.add(bracketGroup);

     const reticleGeo = new THREE.RingGeometry(0.6, 0.65, 32);
     const reticleMat = new THREE.MeshBasicMaterial({ color: 0xFF0000, side: THREE.DoubleSide, transparent: true, opacity: 0 });
     const reticle = new THREE.Mesh(reticleGeo, reticleMat);
     reticle.name = 'RETICLE';
     reticle.visible = false;
     g.add(reticle);

     const canvas = document.createElement('canvas');
     canvas.width = 512; canvas.height = 160; 
     
     // Pre-render immediately to avoid empty sprite
     const ctx = canvas.getContext('2d');
     if(ctx) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0,0,300,80);
        ctx.fillStyle = '#00FFFF';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText("SCANNING...", 10, 50);
     }

     const texture = new THREE.CanvasTexture(canvas);
     const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 1.0 });
     const sprite = new THREE.Sprite(spriteMat);
     sprite.name = 'TEXT';
     sprite.position.set(0, 0.9, 0); 
     sprite.scale.set(2, 0.625, 1);
     g.add(sprite);

     const progressGroup = new THREE.Group();
     progressGroup.name = 'PROGRESS';
     progressGroup.position.set(0, -0.7, 0); 
     progressGroup.visible = false;

     const progressBg = new THREE.Mesh(
         new THREE.BoxGeometry(1.0, 0.05, 0.01),
         new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.8, transparent: true })
     );
     
     const progressFg = new THREE.Mesh(
         new THREE.BoxGeometry(1.0, 0.05, 0.01),
         new THREE.MeshBasicMaterial({ color: 0x00FFFF })
     );
     progressFg.name = 'PROGRESS_BAR';
     progressFg.scale.set(0, 1, 1);
     progressFg.geometry.translate(0.5, 0, 0); 
     progressFg.position.set(-0.5, 0, 0.01); 

     progressGroup.add(progressBg);
     progressGroup.add(progressFg);
     g.add(progressGroup);

     labelsRef.current.set(id, g);
     sceneRef.current?.add(g);
  };

  const createAiLabel = (id: string, label: string) => {
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(1.2, 1.2, 1);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = new THREE.LineBasicMaterial({ color: 0xFF7F00 });
      const mesh = new THREE.LineSegments(edges, mat);
      g.add(mesh);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if(ctx) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillRect(0, 0, 256, 64);
          ctx.fillStyle = '#FF7F00';
          ctx.font = 'bold 40px sans-serif';
          ctx.shadowColor = "black";
          ctx.shadowBlur = 5;
          ctx.fillText(label.toUpperCase(), 10, 50);
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
      sprite.position.y = 1;
      sprite.scale.set(2, 0.5, 1);
      g.add(sprite);
      aiLabelsRef.current.set(id, g);
      sceneRef.current?.add(g);
  }

  return (
    <div className="absolute inset-0 z-0 bg-transparent overflow-hidden">
      <video ref={videoRef} playsInline muted autoPlay style={{ transition: 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)', objectFit: 'cover' }} className="absolute inset-0 w-full h-full z-0" />
      <div ref={containerRef} className="absolute inset-0 z-10 pointer-events-none" />
      {scanActive && (
          <div className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-b from-[#00FFFF]/0 via-[#00FFFF]/10 to-[#00FFFF]/0 animate-pulse mix-blend-overlay"></div>
      )}
      {/* Module Loading Progress Bar Overlay */}
      {loadingState.active && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
              <div className="flex items-center gap-2 text-[#00FFFF] bg-black/70 px-4 py-2 rounded border border-[#00FFFF]/30 backdrop-blur-md">
                 <Cpu size={16} className="animate-pulse" />
                 <span className="text-xs font-bold tracking-widest">{loadingState.stage} LOADING...</span>
              </div>
              <div className="w-64 h-1 bg-gray-800 rounded overflow-hidden">
                  <div className="h-full bg-[#FF7F00] transition-all duration-300 shadow-[0_0_10px_#FF7F00]" style={{ width: `${loadingState.progress}%` }}></div>
              </div>
          </div>
      )}
    </div>
  );
};
