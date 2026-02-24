import React, { ReactNode } from 'react';

interface NodeProps {
  title: string;
  icon: ReactNode;
  color: 'blue' | 'purple' | 'pink' | 'green' | 'orange';
  children: ReactNode;
  isActive?: boolean;
  className?: string;
}

const colorMap = {
  blue: 'border-blue-500 shadow-blue-500/20 bg-blue-950/30',
  purple: 'border-indigo-500 shadow-indigo-500/20 bg-indigo-950/30',
  pink: 'border-pink-500 shadow-pink-500/20 bg-pink-950/30',
  green: 'border-emerald-500 shadow-emerald-500/20 bg-emerald-950/30',
  orange: 'border-orange-500 shadow-orange-500/20 bg-orange-950/30',
};

const iconColorMap = {
  blue: 'text-blue-400 bg-blue-500/20',
  purple: 'text-indigo-400 bg-indigo-500/20',
  pink: 'text-pink-400 bg-pink-500/20',
  green: 'text-emerald-400 bg-emerald-500/20',
  orange: 'text-orange-400 bg-orange-500/20',
};

export const Node: React.FC<NodeProps> = ({ title, icon, color, children, isActive = true, className = '' }) => {
  return (
    <div className={`relative group w-full max-w-2xl mx-auto mb-12 transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-50 grayscale'}`}>
       {/* Connection Line (Top) */}
       <div className="absolute -top-12 left-8 w-0.5 h-12 bg-slate-700 -z-10 group-first:hidden"></div>
       
      <div className={`relative rounded-xl border backdrop-blur-sm p-0 overflow-hidden transition-all duration-300 ${colorMap[color]} ${className}`}>
        
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/5 bg-white/5">
          <div className={`p-2 rounded-lg ${iconColorMap[color]}`}>
            {icon}
          </div>
          <h3 className="font-semibold text-lg text-slate-100 tracking-tight">{title}</h3>
          
          <div className="ml-auto flex gap-2">
            <div className="flex space-x-1">
              <div className="w-2 h-2 rounded-full bg-white/20"></div>
              <div className="w-2 h-2 rounded-full bg-white/20"></div>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5">
          {children}
        </div>
      </div>

       {/* Connection Line (Bottom) - handled by parent layout logic usually, but here implied by flow */}
    </div>
  );
};
