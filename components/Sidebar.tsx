import React from 'react';
import { Workflow, Film, Settings, Menu } from 'lucide-react';
import { ActiveTab } from '../types';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  labels: {
    workflow: string;
    editor: string;
    settings: string;
  }
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, setIsOpen, labels }) => {
  return (
    <>
      {/* Mobile Toggle */}
      <div className="fixed top-6 left-6 z-50 md:hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-slate-800 p-2 rounded-lg border border-slate-700 text-white shadow-lg"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* Sidebar Container */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <div className="flex flex-col h-full p-6">
          <div className="mb-10 flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-tr from-primary to-accent rounded-lg"></div>
            <h2 className="text-xl font-bold text-white tracking-tight">NanoBanana</h2>
          </div>

          <nav className="flex-1 space-y-2">
            <button
              onClick={() => setActiveTab('workflow')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'workflow'
                ? 'bg-primary/20 text-white border border-primary/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
              <Workflow size={20} />
              {labels.workflow}
            </button>

            <button
              onClick={() => setActiveTab('editor')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'editor'
                ? 'bg-accent/20 text-white border border-accent/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
              <Film size={20} />
              {labels.editor}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'settings'
                ? 'bg-slate-700/50 text-white border border-slate-600'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
              <Settings size={20} />
              {labels.settings}
            </button>
          </nav>

          <div className="pt-6 border-t border-slate-800">
            <div className="bg-slate-950/50 rounded-lg p-4 text-xs text-slate-500">
              <p>Version 2.5 (Veo)</p>
              <p className="mt-1">Nano Banana System</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};