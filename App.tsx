
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from "@google/genai";
import { VisionSystem } from './components/VisionSystem';
import { AvatarSystem } from './components/AvatarSystem';
import { HUD } from './components/HUD';
import { PermissionGate } from './components/PermissionGate';
import { BootSequence } from './components/BootSequence';
import { TrackedObject, TranscriptItem, SystemStatus, LogEntry, ViewMode, ConnectedUser, AvatarAction, AiAnnotation, ZoomState, AnalysisMode, CameraDevice, TooltipState } from './types';
import { NetworkService } from './utils/NetworkService';
import { ZoomIn, ZoomOut, User, Camera as CameraIcon, SwitchCamera, RotateCcw, BrainCircuit } from 'lucide-react';

type AppState = 'permissions' | 'booting' | 'active';

const toolsDeclaration: FunctionDeclaration[] = [
  {
    name: "systemControl",
    description: "Базовое управление: переключение режимов, камер, скрытие интерфейса, сброс.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            command: {
                type: Type.STRING,
                enum: ["TOGGLE_VIEW", "RESET_ZOOM", "TOGGLE_LOGS", "SWITCH_CAMERA", "CYCLE_ANALYSIS"],
                description: "Команда"
            }
        },
        required: ["command"]
    }
  },
  {
    name: "selectTarget",
    description: "Выделить/захватить объект или человека в рамку по описанию. Например: 'Выдели человека', 'Захвати чашку'.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            targetType: {
                type: Type.STRING,
                description: "Тип объекта для выделения (person, cup, bottle, и т.д.) или 'reset' для снятия выделения."
            }
        },
        required: ["targetType"]
    }
  },
  {
    name: "updateSceneStatus",
    description: "Обновить краткое описание текущей обстановки.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            description: { type: Type.STRING, description: "Краткое описание." }
        },
        required: ["description"]
    }
  },
  {
    name: "setZoomInterest",
    description: "Зумировать в точку.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
            level: { type: Type.NUMBER }
        },
        required: ["x", "y", "level"]
    }
  },
  {
    name: "annotateRegion",
    description: "Выделить и подписать объект.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
            label: { type: Type.STRING }
        },
        required: ["x", "y", "label"]
    }
  }
];

const CONTROL_HINTS = [
    "\"Переключи камеру\"",
    "\"Выдели человека\"",
    "\"Что происходит?\"",
    "\"Включи аватар\""
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('permissions');
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isListening, setIsListening] = useState(false); 
  
  const [zoomState, setZoomState] = useState<ZoomState>({ level: 1, x: 50, y: 50 });
  const [viewMode, setViewMode] = useState<ViewMode>('ar'); 
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('AUTO');
  const [showLogs, setShowLogs] = useState(true);
  
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>('');
  
  const [error, setError] = useState<string>('');
  const [fps, setFps] = useState(0);
  const lastTimeRef = useRef(performance.now());
  const lastNetworkSendRef = useRef(0);
  
  const [localObjects, setLocalObjects] = useState<TrackedObject[]>([]);
  const [remoteObjects, setRemoteObjects] = useState<TrackedObject[]>([]);
  const [aiAnnotations, setAiAnnotations] = useState<AiAnnotation[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sceneDescription, setSceneDescription] = useState<string>('ОЖИДАНИЕ ДАННЫХ...');
  const [deduction, setDeduction] = useState<string>('');
  const [hintIndex, setHintIndex] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string | number | null>(null);
  
  const knownProfilesRef = useRef<Map<string | number, string>>(new Map());
  const [avatarAction, setAvatarAction] = useState<AvatarAction>('IDLE');
  const avatarTimeoutRef = useRef<any>(null);
  const networkRef = useRef<NetworkService | null>(null);
  const [networkUsers, setNetworkUsers] = useState<ConnectedUser[]>([]);
  const [userId, setUserId] = useState<string>('INIT');
  const remoteObjectsMapRef = useRef<Map<string, TrackedObject[]>>(new Map());
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  
  // Audio Buffers for Streaming Text
  const [userBuffer, setUserBuffer] = useState('');
  const [aiBuffer, setAiBuffer] = useState('');
  
  const inputAnalyserRef = useRef<AnalyserNode | null>(null); 
  const outputAnalyserRef = useRef<AnalyserNode | null>(null); 
  const [outputAnalyserState, setOutputAnalyserState] = useState<AnalyserNode | null>(null);
  const [status, setStatus] = useState<SystemStatus>('ЗАГРУЗКА');
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // CRITICAL: Use Promise ref for reliable streaming initialization
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  // Strict connection flag to prevent sending data to closed sockets
  const connectedRef = useRef(false);
  const reconnectTimeoutRef = useRef<any>(null);
  
  const zoomTimeoutRef = useRef<any>(null);

  // Tooltip State
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, text: '', x: 0, y: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
        const now = Date.now();
        setHistory(prev => prev.filter(msg => now - msg.timestamp < 30000)); // Keep longer history
        setAiAnnotations(prev => prev.filter(ann => now - ann.timestamp < 5000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Zoom Auto Reset
  useEffect(() => {
      if (zoomState.level !== 1) {
          if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = setTimeout(() => {
              setZoomState(prev => ({ ...prev, level: 1 }));
              addLog('sys', 'АВТО-СБРОС ЗУМА');
          }, 5000);
      }
      return () => { if(zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current); };
  }, [zoomState.level]);

  // Cycle Hints
  useEffect(() => {
      const t = setInterval(() => setHintIndex(i => (i + 1) % CONTROL_HINTS.length), 6000);
      return () => clearInterval(t);
  }, []);

  useEffect(() => {
      const net = new NetworkService();
      networkRef.current = net;
      setUserId(net.getUserId());
      net.on((type, data) => {
          if (type === 'STATUS') {
             if (data === 'ПОДКЛЮЧЕНО') setStatus('СЕТЬ');
             else if (data === 'АВТОНОМНЫЙ РЕЖИМ') {
                 // Do not show ERROR for offline mode, show Ready/Standalone
                 if (status !== 'СЛЕЖЕНИЕ' && status !== 'АНАЛИЗ') {
                     setStatus('ГОТОВ');
                 }
                 addLog('net', 'АВТОНОМНЫЙ РЕЖИМ');
             }
          }
          if (type === 'USERS') setNetworkUsers(data);
          if (type === 'OBJECTS') {
             const { userId, objects } = data;
             remoteObjectsMapRef.current.set(userId, objects);
             const allRemote: TrackedObject[] = [];
             remoteObjectsMapRef.current.forEach((objs) => allRemote.push(...objs));
             setRemoteObjects(allRemote);
          }
      });
  }, []);

  useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
          if (e.key === 'ArrowUp') handleManualZoom(0.1);
          if (e.key === 'ArrowDown') handleManualZoom(-0.1);
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
  }, []); 

  useEffect(() => {
      const unlockAudio = async () => {
          if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
          if (inputContextRef.current?.state === 'suspended') await inputContextRef.current.resume();
      };
      window.addEventListener('click', unlockAudio);
      window.addEventListener('touchstart', unlockAudio);
      return () => {
          window.removeEventListener('click', unlockAudio);
          window.removeEventListener('touchstart', unlockAudio);
      }
  }, []);

  const handleManualZoom = (delta: number) => {
      setZoomState(prev => ({
          ...prev,
          level: Math.max(0.5, Math.min(4, prev.level + delta))
      }));
  };
  
  const handleSwitchCamera = () => {
      if (cameras.length < 2) return;
      const currentIndex = cameras.findIndex(c => c.deviceId === activeCameraId);
      const nextIndex = (currentIndex + 1) % cameras.length;
      setActiveCameraId(cameras[nextIndex].deviceId);
      addLog('sys', `КАМЕРА: ${cameras[nextIndex].label.toUpperCase()}`);
  };

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
        id: Date.now(),
        time: new Date().toLocaleTimeString('ru-RU'),
        type,
        message
    }].slice(-20)); 
  };

  const handlePermissions = async () => {
    try {
      // First ensure permissions
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      // Enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0,5)}` }));
      
      setCameras(videoDevices);
      if (videoDevices.length > 0) setActiveCameraId(videoDevices[0].deviceId);

      setError('');
      setAppState('booting');
      setIsVideoActive(true); 
      initOutputAudio();
    } catch (err: any) {
      setError('ДОСТУП ЗАПРЕЩЕН: Нет прав.');
      setAppState('permissions');
    }
  };

  // Immediate Voice Greeting System (Local TTS)
  const speakSystemMessage = (text: string) => {
      if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.pitch = 1.0;
          utterance.rate = 1.1;
          utterance.volume = 1.0;
          // Try to find a robotic or Russian voice
          const voices = window.speechSynthesis.getVoices();
          const ruVoice = voices.find(v => v.lang.includes('ru'));
          if (ruVoice) utterance.voice = ruVoice;
          window.speechSynthesis.speak(utterance);
      }
  };

  const handleBootComplete = async () => {
      setAppState('active');
      setIsListening(true);
      speakSystemMessage("Система онлайн. Нейроинтерфейс активен.");
      networkRef.current?.connect();
      await connectToGemini();
  };

  const initOutputAudio = useCallback(() => {
      if (!audioContextRef.current) {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256; 
          analyser.smoothingTimeConstant = 0.5;
          analyser.connect(ctx.destination);
          outputAnalyserRef.current = analyser;
          setOutputAnalyserState(analyser); 
          return { ctx, analyser };
      }
      return { ctx: audioContextRef.current, analyser: outputAnalyserRef.current! };
  }, []);

  const base64ToArrayBuffer = (base64: string) => {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
  };

  const pcmToAudioBuffer = (buffer: ArrayBuffer, ctx: AudioContext) => {
      const dataInt16 = new Int16Array(buffer);
      const float32 = new Float32Array(dataInt16.length);
      for (let i = 0; i < dataInt16.length; i++) {
          float32[i] = dataInt16[i] / 32768.0; 
      }
      const audioBuffer = ctx.createBuffer(1, float32.length, 24000); 
      audioBuffer.copyToChannel(float32, 0);
      return audioBuffer;
  };

  const triggerAvatarAction = (action: AvatarAction, duration: number = 3000) => {
      setAvatarAction(action);
      if (avatarTimeoutRef.current) clearTimeout(avatarTimeoutRef.current);
      if (action !== 'IDLE') {
          avatarTimeoutRef.current = setTimeout(() => {
              setAvatarAction('IDLE');
          }, duration);
      }
  };

  const connectToGemini = async () => {
    // Graceful offline check: Don't spam retries if browser is offline
    if (navigator.onLine === false) {
        addLog('net', 'ОФФЛАЙН. ОЖИДАНИЕ СЕТИ...');
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectToGemini, 5000);
        return;
    }

    try {
      // Clear previous session if any and reset flags
      sessionPromiseRef.current = null;
      connectedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO], 
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            },
            tools: [{ functionDeclarations: toolsDeclaration }],
            systemInstruction: `
              ПРОТОКОЛ: ОПЕРАТОР ШЛЕМА.
              Ты управляешь визуальным интерфейсом для пользователя.
              ВАЖНО: Сразу после подключения ПОПРИВЕТСТВУЙ оператора голосом и ОПИШИ, что ты видишь, используя updateSceneStatus.
              1. Если нужно рассмотреть деталь - setZoomInterest.
              2. Если видишь лицо или объект - annotateRegion.
              3. Можешь переключать камеры (SWITCH_CAMERA).
              4. Если пользователь просит выделить что-то (например "выдели человека"), используй selectTarget.
              5. Описывай кратко, четко, как в радиоэфире.
            `,
            inputAudioTranscription: {},
            outputAudioTranscription: {} 
        },
      };

      const sessionPromise = ai.live.connect({
        ...config,
        callbacks: {
            onopen: () => {
                connectedRef.current = true;
                setStatus('ГОТОВ');
                startAudioInput(); 
                addLog('sys', 'GEMINI ПОДКЛЮЧЕН');
                triggerAvatarAction('WAVE', 2000); 
                
                // Force AI to start interacting immediately
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                        try {
                            session.sendRealtimeInput([{ mimeType: 'text/plain', data: 'Система онлайн. Доложи обстановку.' }]);
                        } catch(e) {}
                    });
                }
            },
            onmessage: async (msg: LiveServerMessage) => {
                if (msg.toolCall) {
                    const responses = msg.toolCall.functionCalls.map(fc => {
                        const args = fc.args;
                        let result = "OK";
                        if (fc.name === "systemControl") {
                            if (args.command === "TOGGLE_VIEW") setViewMode(prev => prev === 'ar' ? 'avatar' : 'ar');
                            else if (args.command === "RESET_ZOOM") setZoomState({ level: 1, x: 50, y: 50 });
                            else if (args.command === "TOGGLE_LOGS") setShowLogs(prev => !prev);
                            else if (args.command === "SWITCH_CAMERA") handleSwitchCamera();
                            else if (args.command === "CYCLE_ANALYSIS") setAnalysisMode(p => p === 'AUTO' ? 'DETAILED' : p === 'DETAILED' ? 'SILENT' : 'AUTO');
                        } else if (fc.name === "selectTarget") {
                            if (args.targetType === 'reset') {
                                setSelectedTargetId(null);
                                addLog('action', 'СБРОС ВЫДЕЛЕНИЯ');
                            } else {
                                // Logic to select closest matching object
                                const targetType = args.targetType.toLowerCase();
                                const candidates = localObjects.filter(o => o.class.includes(targetType) || targetType.includes(o.class));
                                if (candidates.length > 0) {
                                    // Pick largest/closest
                                    candidates.sort((a,b) => (b.bbox[2]*b.bbox[3]) - (a.bbox[2]*a.bbox[3]));
                                    setSelectedTargetId(candidates[0].id);
                                    addLog('action', `ЗАХВАТ ЦЕЛИ: ${targetType.toUpperCase()}`);
                                } else {
                                    addLog('sys', `ЦЕЛЬ НЕ НАЙДЕНА: ${targetType}`);
                                    result = "TARGET_NOT_FOUND";
                                }
                            }
                        } else if (fc.name === "updateSceneStatus") {
                            setSceneDescription(args.description);
                        } else if (fc.name === "setZoomInterest") {
                            setZoomState({
                                level: Math.max(0.5, Math.min(4, args.level)),
                                x: args.x * 100,
                                y: args.y * 100
                            });
                        } else if (fc.name === "annotateRegion") {
                            setAiAnnotations(prev => [...prev, {
                                id: Math.random().toString(),
                                x: args.x,
                                y: args.y,
                                label: args.label,
                                timestamp: Date.now()
                            }]);
                        }
                        return { id: fc.id, name: fc.name, response: { result } };
                    });
                    
                    if (sessionPromiseRef.current) {
                        sessionPromiseRef.current.then(session => {
                            try {
                                session.sendToolResponse({ functionResponses: responses });
                            } catch(e) { console.warn("Tool response failed", e); }
                        }).catch(e => console.warn("Failed to send tool response", e));
                    }
                }

                // Handle User Transcription
                if (msg.serverContent?.inputTranscription) {
                   const text = msg.serverContent.inputTranscription.text;
                   if (text) {
                       setAvatarAction('LISTENING');
                       setUserBuffer(prev => prev + text);
                   }
                }

                // Handle AI Transcription
                if (msg.serverContent?.outputTranscription) {
                    const text = msg.serverContent.outputTranscription.text;
                    if (text) {
                        setAiBuffer(prev => prev + text);
                    }
                }
                
                // Turn Complete: Flush buffers to history
                if (msg.serverContent?.turnComplete) {
                   setStatus('СЛЕЖЕНИЕ');
                   setAvatarAction('IDLE');
                   
                   setHistory(h => {
                       const newHistory = [...h];
                       // Flush User Buffer if any
                       if (userBuffer.trim()) {
                           newHistory.push({ id: Date.now() - 1, text: userBuffer, isAi: false, timestamp: Date.now() });
                       }
                       // Flush AI Buffer if any
                       if (aiBuffer.trim()) {
                           newHistory.push({ id: Date.now(), text: aiBuffer, isAi: true, timestamp: Date.now() });
                       }
                       return newHistory.slice(-10); // Keep last 10
                   });
                   
                   setUserBuffer('');
                   setAiBuffer('');
                }

                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                    setStatus('АНАЛИЗ');
                    playAudioChunk(audioData);
                }
            },
            onclose: () => {
                connectedRef.current = false;
                sessionPromiseRef.current = null; // Prevent sending data
                setStatus('ГОТОВ'); 
                addLog('sys', 'GEMINI ОТКЛЮЧЕН');
                setAvatarAction('REACT_NEG');
            },
            onerror: (err: any) => {
                connectedRef.current = false;
                sessionPromiseRef.current = null; // Prevent sending data
                
                const msg = err.message || String(err);
                if (msg.includes('Network error') || msg.includes('aborted') || msg.includes('Failed to fetch')) {
                     addLog('net', 'СВЯЗЬ ПРЕРВАНА. ПОВТОР...');
                } else {
                     console.error("Live API Error:", err);
                     addLog('sys', `ОШИБКА: ${msg.slice(0, 20)}...`);
                }

                setAvatarAction('REACT_NEG');
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = setTimeout(() => connectToGemini(), 3000); // Auto reconnect attempt
            }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      await sessionPromise;
      
    } catch (e: any) {
        console.error("Connection failed", e);
        connectedRef.current = false;
        
        // RETRY LOGIC
        addLog('sys', `ОШИБКА СЕТИ (${e.message || '503'}). ПОВТОР...`);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => connectToGemini(), 5000);
    }
  };

  const startAudioInput = async () => {
      // Prevent multiple initialization of audio context which can lead to echo or resource exhaustion
      if (inputContextRef.current?.state === 'running' && inputAnalyserRef.current) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { channelCount: 1, sampleRate: 16000 } 
        });
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        inputContextRef.current = inputCtx;
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        const analyser = inputCtx.createAnalyser();
        analyser.fftSize = 64; 
        inputAnalyserRef.current = analyser;
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(inputCtx.destination);
        
        processor.onaudioprocess = (e) => {
            // Optimization: Skip processing if not connected
            if (!connectedRef.current || !sessionPromiseRef.current) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            let binary = '';
            const bytes = new Uint8Array(pcmData.buffer);
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);

            // Use sessionPromiseRef to ensure we only send when connected
            sessionPromiseRef.current.then(session => {
                try {
                    session.sendRealtimeInput({
                        media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                    });
                } catch(e) {
                     // Catch synchronous send errors (like closed socket)
                }
            }).catch(e => {
                // Swallow errors if session is closed/failed, we'll reconnect anyway
            });
        };
        if (inputCtx.state === 'suspended') await inputCtx.resume();
      } catch (e) {
          console.error("Audio Input Error", e);
          addLog('sys', 'ОШИБКА МИКРОФОНА');
      }
  };

  const playAudioChunk = (base64: string) => {
      const { ctx, analyser } = initOutputAudio();
      setAvatarAction('TALKING');
      if (avatarTimeoutRef.current) clearTimeout(avatarTimeoutRef.current);
      avatarTimeoutRef.current = setTimeout(() => {
          setAvatarAction('IDLE');
      }, 1000); 
      try {
          const arrayBuffer = base64ToArrayBuffer(base64);
          const audioBuffer = pcmToAudioBuffer(arrayBuffer, ctx);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(analyser); 
          const currentTime = ctx.currentTime;
          if (nextStartTimeRef.current < currentTime) nextStartTimeRef.current = currentTime;
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += audioBuffer.duration;
          scheduledSourcesRef.current.push(source);
          source.onended = () => {
              const index = scheduledSourcesRef.current.indexOf(source);
              if (index > -1) scheduledSourcesRef.current.splice(index, 1);
          };
      } catch (e) { 
          console.error("Audio Playback Error", e); 
      }
  };

  const handleDeepAnalysis = useCallback((object: TrackedObject) => {
      let knownName = knownProfilesRef.current.get(object.id);
      if (!knownName) {
          const codes = ["АЛЬФА", "БРАВО", "ДЕЛЬТА", "ОМЕГА", "ФАНТОМ"];
          const rnd = codes[Math.floor(Math.random() * codes.length)];
          const num = Math.floor(Math.random() * 900) + 100;
          knownName = `${rnd}-${num}`;
          knownProfilesRef.current.set(object.id, knownName);
          addLog('info', `НОВАЯ ЦЕЛЬ: ${knownName}`);
      }
      setLocalObjects(prev => prev.map(o => o.id === object.id ? { ...o, codeName: knownName } : o));
      setDeduction(`АНАЛИЗ: ${object.class.toUpperCase()}\nИДЕНТИФИКАЦИЯ: ${knownName}\nСТАТУС: ОТСЛЕЖИВАНИЕ...`);
      setTimeout(() => setDeduction(''), 8000);
  }, []);

  const handleUpdateLocalObjects = useCallback((newObjects: TrackedObject[]) => {
    const now = performance.now();
    const delta = now - lastTimeRef.current;
    lastTimeRef.current = now;
    setFps(Math.round(1000 / delta));
    const processed = newObjects.map(obj => ({
        ...obj,
        codeName: knownProfilesRef.current.get(obj.id),
        isSelected: obj.id === selectedTargetId
    }));
    setLocalObjects(processed);
    if (now - lastNetworkSendRef.current > 30) {
        networkRef.current?.send('TELEMETRY', processed);
        lastNetworkSendRef.current = now;
    }
  }, [selectedTargetId]);

  const handleFrameCapture = useCallback((base64: string, quality: number) => {
      // Use promise ref and connected flag to ensure safe sending
      if (connectedRef.current && sessionPromiseRef.current) {
          sessionPromiseRef.current.then(session => {
              try {
                session.sendRealtimeInput({
                    media: { mimeType: 'image/jpeg', data: base64 }
                });
              } catch(e) {}
          }).catch(e => {});
      }
  }, []); 

  // Tooltip Handlers
  const handleMouseEnter = (text: string, e: React.MouseEvent) => {
      setTooltip({ visible: true, text, x: e.clientX, y: e.clientY });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
      if (tooltip.visible) setTooltip(p => ({ ...p, x: e.clientX, y: e.clientY }));
  };
  const handleMouseLeave = () => {
      setTooltip(p => ({ ...p, visible: false }));
  };

  const toggleViewMode = () => setViewMode(prev => prev === 'ar' ? 'avatar' : 'ar');
  const allObjects = [...localObjects, ...remoteObjects];
  const detectedPeople = localObjects.filter(o => o.class === 'person');

  if (appState === 'permissions') {
    return <PermissionGate onRequestPermissions={handlePermissions} error={error} />;
  }

  return (
    <div 
        className="relative w-screen h-screen overflow-hidden select-none bg-black cursor-crosshair"
        onMouseMove={handleMouseMove}
    >
      {appState === 'booting' && (
          <div className="absolute inset-0 z-[100] pointer-events-none">
              <BootSequence onComplete={handleBootComplete} />
          </div>
      )}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${viewMode === 'ar' ? 'opacity-100' : 'opacity-0'}`}>
          <VisionSystem 
             isActive={isVideoActive} 
             zoomState={zoomState}
             activeDeviceId={activeCameraId}
             localObjects={localObjects}
             remoteObjects={remoteObjects}
             aiAnnotations={aiAnnotations}
             sceneDescription={sceneDescription}
             analysisMode={analysisMode}
             onUpdateLocalObjects={handleUpdateLocalObjects}
             onSceneChange={setSceneDescription}
             onDeepAnalysis={handleDeepAnalysis}
             onFrameCapture={handleFrameCapture}
             onError={(e) => setError(e)}
          />
      </div>
      <div className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${viewMode === 'avatar' ? 'opacity-100' : 'opacity-0'}`}>
            <AvatarSystem 
                audioAnalyser={outputAnalyserState} 
                currentAction={avatarAction}
                detectedPeople={detectedPeople}
            />
      </div>
      <HUD 
         objects={allObjects}
         transcript={userBuffer}
         aiTranscript={aiBuffer}
         history={history}
         logs={logs}
         status={status}
         isListening={isListening}
         fps={fps}
         audioAnalyser={inputAnalyserRef.current}
         aiAudioAnalyser={outputAnalyserState}
         networkUsers={networkUsers}
         userId={userId}
         situationSummary={sceneDescription} 
         showLogs={showLogs}
      />
      
      {/* Tooltip Render */}
      {tooltip.visible && (
          <div 
            className="absolute z-[200] px-2 py-1 bg-black/80 border border-[#FF7F00] text-[#FF7F00] text-xs font-bold pointer-events-none whitespace-nowrap tooltip-glitch"
            style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}
          >
              {tooltip.text}
          </div>
      )}

      {/* Dynamic Hints */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 text-[#FF7F00] text-[10px] font-bold tracking-widest opacity-60 animate-pulse pointer-events-none transition-all duration-1000">
           СОВЕТ: {CONTROL_HINTS[hintIndex]}
      </div>

      <div className="absolute top-1/2 right-4 -translate-y-1/2 flex flex-col gap-6 z-50">
          <div className="flex flex-col gap-2 border border-[#FF7F00]/50 p-1 bg-black/40 backdrop-blur-sm tech-panel">
            <button 
                onMouseEnter={(e) => handleMouseEnter("СМЕНИТЬ РЕЖИМ (AR/AVATAR)", e)} 
                onMouseLeave={handleMouseLeave}
                onClick={toggleViewMode} 
                className={`p-2 transition-all hover:bg-[#FF7F00] hover:text-black ${viewMode === 'ar' ? 'bg-[#FF7F00] text-black' : 'text-[#FF7F00]'}`}
            >
                <CameraIcon size={20} />
            </button>
            <div className="h-[1px] bg-[#FF7F00]/50"></div>
            <button 
                onMouseEnter={(e) => handleMouseEnter("РЕЖИМ АВАТАРА", e)} 
                onMouseLeave={handleMouseLeave}
                onClick={toggleViewMode} 
                className={`p-2 transition-all hover:bg-[#FF7F00] hover:text-black ${viewMode === 'avatar' ? 'bg-[#FF7F00] text-black' : 'text-[#FF7F00]'}`}
            >
                <User size={20} />
            </button>
            <div className="h-[1px] bg-[#FF7F00]/50"></div>
            <button 
                onMouseEnter={(e) => handleMouseEnter("ПЕРЕКЛЮЧИТЬ КАМЕРУ", e)} 
                onMouseLeave={handleMouseLeave}
                onClick={handleSwitchCamera} 
                className="p-2 text-[#FF7F00] hover:bg-[#FF7F00] hover:text-black transition-all group relative"
            >
                <SwitchCamera size={20} />
                <span className="absolute right-full top-2 mr-2 text-[10px] bg-black text-[#FF7F00] px-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    CAM: {cameras.length > 0 ? cameras.findIndex(c => c.deviceId === activeCameraId) + 1 : 0}/{cameras.length}
                </span>
            </button>
            <div className="h-[1px] bg-[#FF7F00]/50"></div>
            <button 
                onMouseEnter={(e) => handleMouseEnter("РЕЖИМ АНАЛИЗА", e)} 
                onMouseLeave={handleMouseLeave}
                onClick={() => setAnalysisMode(p => p === 'AUTO' ? 'DETAILED' : p === 'DETAILED' ? 'SILENT' : 'AUTO')} 
                className={`p-2 transition-all hover:bg-[#FF7F00] hover:text-black ${analysisMode !== 'SILENT' ? 'text-[#00FFFF]' : 'text-gray-500'}`}
            >
                <BrainCircuit size={20} />
            </button>
          </div>
          {viewMode === 'ar' && (
              <div className="flex flex-col gap-2 border border-[#FF7F00]/50 p-1 bg-black/40 tech-panel">
                <button 
                    onMouseEnter={(e) => handleMouseEnter("ПРИБЛИЗИТЬ (+)", e)} 
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleManualZoom(0.2)} 
                    className="text-[#FF7F00] hover:bg-[#FF7F00] hover:text-black p-2 transition-all"
                >
                    <ZoomIn size={20} />
                </button>
                <div className="text-center text-sm font-bold text-[#FF7F00]">{zoomState.level.toFixed(1)}x</div>
                <button 
                    onMouseEnter={(e) => handleMouseEnter("ОТДАЛИТЬ (-)", e)} 
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleManualZoom(-0.2)} 
                    className="text-[#FF7F00] hover:bg-[#FF7F00] hover:text-black p-2 transition-all"
                >
                    <ZoomOut size={20} />
                </button>
                <button 
                    onMouseEnter={(e) => handleMouseEnter("СБРОСИТЬ ЗУМ", e)} 
                    onMouseLeave={handleMouseLeave}
                    onClick={() => setZoomState(p => ({...p, level: 1}))} 
                    className="text-[#FF7F00] hover:bg-[#FF7F00] hover:text-black p-2 transition-all border-t border-[#FF7F00]/30"
                >
                    <RotateCcw size={16} />
                </button>
              </div>
          )}
      </div>

      {error && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-red-900/90 border-2 border-red-500 text-white px-6 py-4 font-bold z-50 text-xl backdrop-blur-md">
           КРИТИЧЕСКАЯ ОШИБКА: {error}
        </div>
      )}
    </div>
  );
};

export default App;
