
import React from 'react';
import { Shield, Lock, Power } from 'lucide-react';

interface PermissionGateProps {
  onRequestPermissions: () => void;
  error?: string;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({ onRequestPermissions, error }) => {
  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center relative font-mono text-[#00ff00] p-4">
      <div className="scanlines"></div>
      
      <div className="border-2 border-[#00ff00] p-6 md:p-10 w-full max-w-lg bg-black/90 relative z-10 shadow-[0_0_20px_#00ff00]">
         <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-black px-4 text-lg md:text-xl font-bold whitespace-nowrap">
            ПРОТОКОЛ БЕЗОПАСНОСТИ
         </div>

         <div className="text-center my-6 md:my-8">
            <Shield size={48} className="mx-auto mb-4 animate-pulse md:w-16 md:h-16" />
            <h1 className="text-xl md:text-2xl mb-2">ТРЕБУЕТСЯ ДОСТУП</h1>
            <p className="text-xs md:text-sm opacity-70">
                ДЛЯ ФУНКЦИОНИРОВАНИЯ СИСТЕМЫ НЕОБХОДИМ ПРЯМОЙ ДОСТУП К ОПТИЧЕСКИМ И АУДИО СЕНСОРАМ УСТРОЙСТВА.
            </p>
         </div>

         <div className="space-y-4 border-t border-[#00ff00]/30 pt-6">
            <div className="flex items-center gap-3 text-sm">
                <div className="w-4 h-4 border border-[#00ff00] flex items-center justify-center text-[10px]">X</div>
                <span>КАМЕРА: ОЖИДАНИЕ...</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
                <div className="w-4 h-4 border border-[#00ff00] flex items-center justify-center text-[10px]">X</div>
                <span>МИКРОФОН: ОЖИДАНИЕ...</span>
            </div>
         </div>

         {error && (
            <div className="mt-6 border border-red-500 text-red-500 p-2 text-xs break-words">
                ОШИБКА: {error}
            </div>
         )}

         <button 
            onClick={onRequestPermissions}
            className="w-full mt-8 border border-[#00ff00] py-4 hover:bg-[#00ff00] hover:text-black transition-colors font-bold flex items-center justify-center gap-2 text-sm md:text-base"
         >
            <Power size={18} />
            <span>ИНИЦИАЛИЗИРОВАТЬ</span>
         </button>
      </div>
    </div>
  );
};
