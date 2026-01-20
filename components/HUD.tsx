
import React, { useEffect, useState, useRef } from 'react';
import { TrackedObject, TranscriptItem, LogEntry, SystemStatus, ConnectedUser } from '../types';
import { Mic, Eye, Scan, Target, Volume2, Signal, Wifi, Activity } from 'lucide-react';

interface HUDProps {
  objects: TrackedObject[];
  transcript: string; // User buffer
  aiTranscript: string; // AI buffer
  history: TranscriptItem[];
  logs: LogEntry[];
  status: SystemStatus;
  isListening: boolean;
  fps: number;
  audioAnalyser: AnalyserNode | null; // Mic Input
  aiAudioAnalyser: AnalyserNode | null; // AI Output
  networkUsers: ConnectedUser[];
  userId: string;
  situationSummary: string;
  showLogs: boolean;
}

export const HUD: React.FC<HUDProps> = ({
  objects,
  transcript,
  aiTranscript,
  history,
  logs,
  status,
  isListening,
  fps,
  audioAnalyser,
  aiAudioAnalyser,
  networkUsers,
  userId,
  situationSummary,
  showLogs
}) => {
  const [time, setTime] = useState(new Date());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aiCanvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [netQuality, setNetQuality] = useState<number>(4);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, transcript, aiTranscript]);

  // Network Quality Monitor
  useEffect(() => {
    const updateNet = () => {
        if (navigator.connection) {
            const down = navigator.connection.downlink;
            // Map downlink (Mbps) to 0-4 bars. 
            // >5 mbps = 4, >2 = 3, >1 = 2, >0.5 = 1, else 0
            if (down >= 5) setNetQuality(4);
            else if (down >= 2) setNetQuality(3);
            else if (down >= 1) setNetQuality(2);
            else if (down > 0) setNetQuality(1);
            else setNetQuality(0);
        }
    };
    if (navigator.connection) {
        navigator.connection.addEventListener('change', updateNet);
        updateNet();
    }
    return () => {
        if (navigator.connection) navigator.connection.removeEventListener('change', updateNet);
    }
  }, []);

  // Visualizer for User Mic (Cyan)
  useEffect(() => {
    if (!canvasRef.current || !audioAnalyser) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bufferLength = audioAnalyser.frequencyBinCount; 
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;
    const draw = () => {
        animationId = requestAnimationFrame(draw);
        audioAnalyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const bars = 32; 
        const barWidth = (canvas.width / bars); 
        const step = Math.floor(bufferLength / bars);
        ctx.fillStyle = '#00FFFF';
        for (let i = 0; i < bars; i++) {
            let sum = 0; for(let j=0; j<step; j++) sum += dataArray[i*step + j];
            const avg = sum / step;
            const val = avg / 255;
            const x = i * barWidth; 
            const barHeight = val * canvas.height;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [audioAnalyser]);

  // Visualizer for AI Voice (Orange)
  useEffect(() => {
    if (!aiCanvasRef.current || !aiAudioAnalyser) return;
    const canvas = aiCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bufferLength = aiAudioAnalyser.frequencyBinCount; 
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;
    const draw = () => {
        animationId = requestAnimationFrame(draw);
        aiAudioAnalyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const bars = 64; 
        const barWidth = (canvas.width / bars); 
        const step = Math.floor(bufferLength / bars);
        ctx.fillStyle = '#FF7F00'; // Orange for AI
        for (let i = 0; i < bars; i++) {
            let sum = 0; for(let j=0; j<step; j++) sum += dataArray[i*step + j];
            const avg = sum / step;
            const val = avg / 255;
            const x = canvas.width / 2 + (i % 2 === 0 ? 1 : -1) * (i * barWidth / 2); 
            const barHeight = val * canvas.height;
            ctx.fillRect(x, canvas.height/2 - barHeight/2, barWidth - 1, barHeight);
        }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [aiAudioAnalyser]);

  const localTargets = objects.filter(o => !o.isRemote);
  const analyzedTargets = localTargets.filter(o => o.isAnalyzed);
  
  const isLidarActive = localTargets.some(o => o.depthSource === 'LIDAR_FUSION');

  return (
    <div className="absolute inset-0 pointer-events-none z-20 select-none overflow-hidden font-sans">
      {/* Header Info */}
      <div className="absolute top-4 left-4 flex flex-col items-start gap-2 max-w-[50%]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-[#FF7F00] truncate tracking-tighter filter drop-shadow-[0_0_2px_#FF7F00]">{userId}</span>
                <div className={`w-2 h-2 rounded-full min-w-[8px] ${status === 'ОШИБКА' ? 'bg-red-500 animate-pulse' : 'bg-[#00FFFF] shadow-[0_0_8px_#00FFFF]'}`}></div>
            </div>
            {/* Network Signal Indicator */}
            <div className="flex items-center gap-2 pl-0.5 opacity-90">
                 <Signal size={12} className={netQuality > 1 ? "text-[#00FFFF]" : "text-red-500"} />
                 <div className="flex gap-0.5 items-end h-2.5">
                     {[0,1,2,3].map(i => (
                         <div key={i} className={`w-1 rounded-sm transition-all duration-500 ${i < netQuality ? 'bg-[#00FFFF] shadow-[0_0_5px_#00FFFF]' : 'bg-white/20'}`} style={{ height: `${(i+1)*25}%` }}></div>
                     ))}
                 </div>
                 <span className="text-[9px] font-mono text-[#00FFFF]/70 ml-1 tracking-wider">
                     {navigator.connection ? `${navigator.connection.downlink}MBPS` : 'NET'}
                 </span>
            </div>
          </div>

          <div className="text-[10px] text-white/60 font-bold tracking-[0.2em]">{status}</div>
          <div className="flex items-center gap-2 text-[10px] tracking-widest mt-1">
               <span className={isLidarActive ? "text-[#00FFFF]" : "text-gray-500"}>SENSOR: {isLidarActive ? "OPT+LIDAR" : "OPTICAL"}</span>
               {isLidarActive && <Scan size={10} className="text-[#00FFFF] animate-pulse" />}
          </div>
      </div>

      {/* Situation Summary - Responsive Width */}
      <div className="absolute top-4 right-4 flex flex-col items-end max-w-[40%] md:max-w-[33%] pointer-events-auto">
          <div className="flex items-center gap-2 text-[#00FFFF] text-xs font-bold tracking-widest mb-1 shadow-black drop-shadow-sm">
               <Eye size={12} />
               <span className="hidden md:inline">СИТУАЦИОННЫЙ АНАЛИЗ</span>
               <span className="md:hidden">АНАЛИЗ</span>
          </div>
          <div className="text-right text-white text-xs md:text-sm leading-tight pr-2 drop-shadow-[0_2px_2px_rgba(0,0,0,1)] break-words w-full bg-black/20 p-2 rounded border-r-2 border-[#00FFFF]/30">
               {situationSummary}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">{time.toLocaleTimeString('ru-RU')}</div>
      </div>

      {/* Team Link / Remote Users Status - More Prominent */}
      {networkUsers.length > 0 && (
          <div className="absolute top-32 right-4 flex flex-col gap-1 items-end animate-fadeIn">
                <div className="flex items-center gap-2 text-[#FF7F00] text-[10px] font-bold tracking-[0.2em] mb-1 opacity-80">
                    <Wifi size={10} /> NEURAL LINK
                </div>
                {networkUsers.map(user => (
                    <div key={user.id} className="group flex items-center gap-3 bg-black/60 backdrop-blur-md border-r-2 pl-4 pr-2 py-2 transition-all hover:bg-black/80 shadow-[0_0_10px_rgba(0,0,0,0.5)]" style={{ borderColor: user.color }}>
                         <div className="flex flex-col items-end">
                             <span className="text-xs font-bold text-white leading-none tracking-wider group-hover:text-[#00FFFF] transition-colors">{user.name}</span>
                             <div className="flex items-center gap-1 mt-1">
                                <Activity size={8} className="text-gray-500" />
                                <span className="text-[9px] text-gray-400 leading-none font-mono">{Math.floor(Math.random() * 40 + 15)}ms</span>
                             </div>
                         </div>
                         <div className="relative">
                            <div className={`w-2.5 h-2.5 rounded-full ${user.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            {user.status === 'online' && <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-50"></div>}
                         </div>
                    </div>
                ))}
          </div>
      )}

      {/* Target List */}
      {analyzedTargets.length > 0 && (
          <div className="absolute top-40 left-4 w-32 md:w-48 flex flex-col gap-2">
              <div className="text-[10px] text-red-500 font-bold tracking-widest uppercase flex items-center gap-2">
                <Target size={12} />
                ЦЕЛИ В ПАМЯТИ
              </div>
              {analyzedTargets.map(obj => (
                  <div key={obj.id} className="text-xs flex items-center gap-2 bg-red-900/20 p-1 border-l-2 border-red-500 backdrop-blur-sm">
                      <span className="text-[#FF7F00] font-bold truncate tracking-tighter">{obj.codeName}</span>
                      <span className="text-[9px] text-red-400 font-mono ml-auto">CONF:{Math.round(obj.confidence*100)}%</span>
                  </div>
              ))}
          </div>
      )}

      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-30 pointer-events-none">
          <div className="w-[1px] h-4 bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_white]"></div>
          <div className="w-4 h-[1px] bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_white]"></div>
          <div className="w-20 h-20 border border-white/10 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"></div>
      </div>

      {/* Chat / Logs Area - Responsive positioning and width */}
      {showLogs && (
        <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-[600px] flex flex-col justify-end pointer-events-none">
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[30vh] md:max-h-[400px] pr-2 scroll-smooth pb-4 mask-fade-top" ref={chatEndRef}>
                {history.map(item => (
                    <div 
                        key={item.id} 
                        className={`relative animate-fadeIn max-w-[100%] md:max-w-[90%] font-bold text-base md:text-lg leading-tight tracking-tight break-words
                        ${item.isAi ? 'self-start text-[#FF7F00] text-left' : 'self-end text-[#00FFFF] text-right'}`}
                        style={{ textShadow: '2px 2px 0px #000' }}
                    >
                         {item.isAi && <span className="text-[10px] text-gray-500 block mb-0.5">AI AGENT</span>}
                         {item.text}
                    </div>
                ))}
                
                {/* Live Transcript - User */}
                {transcript && (
                     <div className="self-end text-[#00FFFF] text-base md:text-lg font-bold italic opacity-100 text-right animate-pulse break-words max-w-full" 
                          style={{ textShadow: '0 0 10px #00FFFF, 2px 2px 0px #000' }}>
                         {transcript}...
                     </div>
                )}
                
                 {/* Live Transcript - AI */}
                {aiTranscript && (
                     <div className="self-start text-[#FF7F00] text-base md:text-lg font-bold italic opacity-100 text-left animate-pulse break-words max-w-full" 
                          style={{ textShadow: '0 0 10px #FF7F00, 2px 2px 0px #000' }}>
                         {aiTranscript}...
                     </div>
                )}
            </div>
            
            <div className="flex items-end justify-between w-full mt-2">
                <div className={`flex items-center gap-2 text-[10px] font-bold tracking-widest ${isListening ? 'text-[#00FFFF]' : 'text-gray-600'}`}>
                    <Mic size={14} className={isListening ? "animate-pulse" : ""} />
                    <div className="w-[100px] h-[24px] bg-black/50 border border-[#00FFFF]/30 relative overflow-hidden">
                         <div className="absolute inset-0 bg-[#00FFFF]/10 grid grid-cols-[repeat(10,1fr)]">
                             {[...Array(10)].map((_, i) => <div key={i} className="border-r border-[#00FFFF]/10 h-full"></div>)}
                         </div>
                         <canvas ref={canvasRef} width={100} height={24} className="relative z-10 w-full h-full opacity-80 mix-blend-screen" />
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* AI Visualizer (Center Bottom) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[200px] md:w-[300px] flex flex-col items-center gap-1">
          <canvas ref={aiCanvasRef} width={300} height={40} className="opacity-90 w-full h-full filter drop-shadow-[0_0_5px_#FF7F00]" />
          <div className="text-[10px] text-[#FF7F00] tracking-[0.3em] font-bold flex items-center gap-1 opacity-80">
              <Volume2 size={10} /> NEURAL VOICE
          </div>
      </div>
    </div>
  );
};
