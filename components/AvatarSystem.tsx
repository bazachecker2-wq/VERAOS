
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AvatarAction, TrackedObject } from '../types';

interface AvatarSystemProps {
  audioAnalyser: AnalyserNode | null;
  currentAction?: AvatarAction;
  detectedPeople: TrackedObject[];
}

const PRESET_MODELS = [
    { name: "TACTICAL HELMET", url: "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf" },
    { name: "ROBOT EXPRESSIVE", url: "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/RobotExpressive/RobotExpressive.glb" },
    { name: "AI CORE", url: null }, 
];

export const AvatarSystem: React.FC<AvatarSystemProps> = ({ audioAnalyser, currentAction = 'IDLE', detectedPeople }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const requestRef = useRef<number>();
  const mouseRef = useRef({ x: 0, y: 0 });
  const [currentModelIndex, setCurrentModelIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
      if (!mixerRef.current || Object.keys(actionsRef.current).length === 0) return;
      const triggerAnimation = (animName: string, duration = 0.5, loop = true) => {
          const action = actionsRef.current[animName];
          if (!action) return;
          if (activeActionRef.current !== action) {
              if (activeActionRef.current) activeActionRef.current.fadeOut(duration);
              action.reset().fadeIn(duration).play();
              if (!loop) {
                  action.setLoop(THREE.LoopOnce, 1);
                  action.clampWhenFinished = true;
              } else action.setLoop(THREE.LoopRepeat, Infinity);
              activeActionRef.current = action;
          }
      };
      let targetAnim = 'Idle';
      let loop = true;
      switch (currentAction) {
          case 'WAVE': targetAnim = 'Wave'; loop = false; break;
          case 'TALKING': targetAnim = 'Dance'; break; 
          case 'REACT_POS': targetAnim = 'Jump'; loop = false; break;
          case 'REACT_NEG': targetAnim = 'Death'; loop = false; break;
          default: targetAnim = 'Idle'; break;
      }
      if (!actionsRef.current[targetAnim]) {
          const idleKey = Object.keys(actionsRef.current).find(k => /idle|stand/i.test(k));
          if (idleKey) targetAnim = idleKey;
      }
      triggerAnimation(targetAnim, 0.5, loop);
  }, [currentAction]);

  useEffect(() => {
    initThreeJS();
    loadPreset(0); 
    const handleMouseMove = (e: MouseEvent) => {
        mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        if (rendererRef.current && containerRef.current) containerRef.current.innerHTML = '';
        window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const initThreeJS = () => {
    if (!containerRef.current) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const keyLight = new THREE.SpotLight(0xFF7F00, 50.0);
    keyLight.position.set(5, 5, 10);
    scene.add(keyLight);
    
    const particlesGeo = new THREE.BufferGeometry();
    const posArray = new Float32Array(400 * 3);
    for(let i = 0; i < 400 * 3; i++) posArray[i] = (Math.random() - 0.5) * 15; 
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    scene.add(new THREE.Points(particlesGeo, new THREE.PointsMaterial({ size: 0.02, color: 0xFFFFFF, transparent: true, opacity: 0.2 })));

    // Camera positioned closer and slightly higher to center the agent
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0.5, 3.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.0;
    containerRef.current.appendChild(renderer.domElement);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    animate();
  };

  const loadPreset = (index: number) => {
      setCurrentModelIndex(index);
      if (avatarRef.current) sceneRef.current?.remove(avatarRef.current);
      mixerRef.current = null;
      actionsRef.current = {};
      if (!PRESET_MODELS[index].url) {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({color: 0x333333, wireframe:true})));
          avatarRef.current = g;
          sceneRef.current?.add(g);
      } else {
          loadGLB(PRESET_MODELS[index].url!);
      }
  };

  const loadGLB = (url: string) => {
      setIsLoading(true);
      new GLTFLoader().load(url, (gltf) => {
          setIsLoading(false);
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          
          // Scale up to fill screen more effectively
          const scale = 2.8 / maxDim; 
          model.scale.setScalar(scale);
          
          // Center vertically based on bounding box
          const center = box.getCenter(new THREE.Vector3());
          model.position.x = -center.x * scale;
          model.position.y = -center.y * scale - 0.2; // Minor offset to frame the face
          model.position.z = -center.z * scale;

          if (gltf.animations.length) {
              mixerRef.current = new THREE.AnimationMixer(model);
              gltf.animations.forEach(c => mixerRef.current && (actionsRef.current[c.name] = mixerRef.current.clipAction(c)));
              const idle = actionsRef.current['Idle'] || Object.values(actionsRef.current)[0];
              idle?.play();
              activeActionRef.current = idle;
          }
          const g = new THREE.Group();
          g.add(model);
          avatarRef.current = g;
          sceneRef.current?.add(g);
      }, undefined, () => setIsLoading(false));
  };

  const animate = () => {
      requestRef.current = requestAnimationFrame(animate);
      const time = Date.now() * 0.001;
      let targetX = mouseRef.current.x;
      let targetY = mouseRef.current.y;

      if (detectedPeople.length > 0) {
          const person = detectedPeople[0]; 
          const cx = person.bbox[0] + person.bbox[2]/2;
          const cy = person.bbox[1] + person.bbox[3]/2;
          targetX = (cx / 1280) * 2 - 1; 
          targetY = -(cy / 720) * 2 + 1;
      }

      if (avatarRef.current) {
          // Subtle breathing motion
          avatarRef.current.position.y += Math.sin(time) * 0.0005; 
          
          // Head/Body tracking
          avatarRef.current.rotation.y = THREE.MathUtils.lerp(avatarRef.current.rotation.y, targetX * 0.5, 0.1);
          avatarRef.current.rotation.x = THREE.MathUtils.lerp(avatarRef.current.rotation.x, targetY * 0.2, 0.1);
          
          if (currentAction === 'TALKING' && audioAnalyser) {
             const data = new Uint8Array(audioAnalyser.frequencyBinCount);
             audioAnalyser.getByteFrequencyData(data);
             // React to audio
             avatarRef.current.scale.setScalar(1 + (data[4] / 255) * 0.05);
          }
      }
      if (mixerRef.current) mixerRef.current.update(0.016);
      if (rendererRef.current && sceneRef.current && cameraRef.current) rendererRef.current.render(sceneRef.current, cameraRef.current);
  };

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-24 left-4 flex flex-col gap-1 w-48 z-20 pointer-events-auto">
           {PRESET_MODELS.map((model, idx) => (
               <button key={idx} onClick={() => loadPreset(idx)} className={`text-left px-2 py-1 text-[10px] uppercase font-bold tracking-wider flex gap-2 ${currentModelIndex === idx ? 'text-[#FF7F00]' : 'text-white/50'}`}>
                   <div className={`w-1 h-1 rounded-full ${currentModelIndex === idx ? 'bg-[#FF7F00]' : 'bg-transparent border border-white/30'}`}></div> {model.name}
               </button>
           ))}
      </div>
      {isLoading && <div className="absolute inset-0 flex items-center justify-center text-[#FF7F00] animate-pulse font-bold">ЗАГРУЗКА...</div>}
    </div>
  );
};
