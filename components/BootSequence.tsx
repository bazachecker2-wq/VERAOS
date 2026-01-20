import React, { useState, useEffect } from 'react';

interface BootSequenceProps {
  onComplete: () => void;
}

export const BootSequence: React.FC<BootSequenceProps> = ({ onComplete }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const bootLines = [
    "BIOS DATE 17/01/26 15:32:00 VER 1.02",
    "CPU: NEURAL QUANTUM PROCESSOR 64-BIT",
    "64GB RAM SYSTEM DETECTED",
    "LOADING KERNEL...",
    "MOUNTING FILE SYSTEMS...",
    "INITIATING GRAPHICS ADAPTER...",
    "> ЗАГРУЗКА МОДУЛЕЙ ЗРЕНИЯ [OK]",
    "> ПОДКЛЮЧЕНИЕ К TENSORFLOW.JS [OK]",
    "> ПРОВЕРКА ДАТЧИКОВ ГЛУБИНЫ [ЭМУЛЯЦИЯ]",
    "> УСТАНОВЛЕНИЕ СВЯЗИ С GEMINI API...",
    "АВТОРИЗАЦИЯ...",
    "ДОСТУП РАЗРЕШЕН.",
    "ЗАПУСК ГРАФИЧЕСКОГО ИНТЕРФЕЙСА..."
  ];

  useEffect(() => {
    let currentLine = 0;
    
    const interval = setInterval(() => {
        if (currentLine >= bootLines.length) {
            clearInterval(interval);
            setTimeout(onComplete, 1000);
            return;
        }

        setLines(prev => [...prev, bootLines[currentLine]]);
        setProgress(p => Math.min(p + (100 / bootLines.length), 100));
        currentLine++;

    }, 300); 

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-screen h-screen bg-black/40 backdrop-blur-[2px] text-[#FF7F00] font-mono p-10 overflow-hidden flex flex-col justify-end transition-opacity duration-1000">
      <div className="scanlines opacity-10"></div>
      
      <div className="mb-10 text-xl font-bold border-b border-[#FF7F00] pb-4 mb-4">
        СИСТЕМА ТАКТИЧЕСКОГО АНАЛИЗА v2.5
      </div>

      <div className="flex-1 flex flex-col justify-end space-y-2 text-sm md:text-base text-white">
        {lines.map((line, i) => (
            <div key={i} className="flex gap-2">
                <span className="opacity-50 text-gray-400">[{new Date().toLocaleTimeString('ru-RU')}]</span>
                <span className="text-white drop-shadow-[0_0_2px_rgba(255,255,255,0.5)]">{line}</span>
            </div>
        ))}
      </div>

      <div className="mt-8">
        <div className="w-full border border-[#FF7F00] h-6 p-1">
            <div 
                className="h-full bg-[#FF7F00] shadow-[0_0_10px_#FF7F00]" 
                style={{ width: `${progress}%` }}
            ></div>
        </div>
        <div className="flex justify-between mt-2 text-xs font-bold tracking-widest text-[#FF7F00]">
            <span>СТАТУС ПАМЯТИ: OK</span>
            <span>ЗАГРУЗКА: {Math.floor(progress)}%</span>
        </div>
      </div>
    </div>
  );
};